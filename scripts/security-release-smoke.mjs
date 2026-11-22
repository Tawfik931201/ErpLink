/**
 * Non-destructive external production smoke check. Only submits invalid
 * authentication to endpoints with guaranteed rejection before business I/O;
 * never sends a real order, product, ERP record, or workspace identifier.
 *
 * Run: node scripts/security-release-smoke.mjs
 * HOST_BASE_URL defaults to the canonical ERP Link production origin.
 */
const baseUrl = (process.env.HOST_BASE_URL || 'https://erplink.bizsahla.com').replace(/\/$/, '')
const marker = 'erplink-security-prelaunch-20261123-r1'

async function request(path, method = 'GET', headers = {}, body) {
  const response = await fetch(baseUrl + path, {
    method, headers, body,
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(12_000),
  })
  const excerpt = (await response.text()).slice(0, 200)
  return { status: response.status, excerpt }
}

async function waitForDeployment() {
  for (let attempt = 1; attempt <= 36; attempt++) {
    try {
      const result = await request('/api/health/live')
      if (result.status === 200) {
        const json = JSON.parse(result.excerpt)
        if (json.release === marker && json.ok === true) {
          console.log('Deployment marker verified on Hostinger')
          return
        }
      }
      console.log(`Deployment marker not active, check ${attempt}/36 (HTTP ${result.status})`)
    } catch (error) {
      console.log(`Deployment marker unreachable on check ${attempt}/36: ${error instanceof Error ? error.name : 'error'}`)
    }
    if (attempt < 36) await new Promise(resolve => setTimeout(resolve, 10_000))
  }
  throw new Error('The new release marker was not seen; do not declare Hostinger deployed')
}

async function verifyRejection(label, path, method = 'GET', headers = {}, body) {
  const response = await request(path, method, headers, body)
  if (response.status !== 401) {
    throw new Error(`${label}: expected HTTP 401, received ${response.status}. Check deployed secrets and strict auth.`)
  }
  console.log(`${label}: rejected unauthorized request (401)`)
}

await waitForDeployment()
await verifyRejection('Reconcile cron', '/api/cron/reconcile')
await verifyRejection('Queue cron', '/api/cron/sync-queue')
await verifyRejection('Archive cron', '/api/cron/central-archive')
await verifyRejection('Clerk Svix signature', '/api/webhooks/clerk', 'POST', {
  'Content-Type': 'application/json',
}, '{}')
await verifyRejection('Shopify HMAC', '/api/webhooks/shopify', 'POST', {
  'Content-Type': 'application/json', 'x-shopify-hmac-sha256': 'deliberately-invalid',
}, '{}')
await verifyRejection('Salla signature', '/api/webhooks/salla', 'POST', {
  'Content-Type': 'application/json', 'x-erplink-webhook-secret': 'deliberately-invalid',
}, '{}')
await verifyRejection('Zid merchant Basic', '/api/webhooks/zid?event=product.update&store_id=999999999', 'POST', {
  'Content-Type': 'application/json', Authorization: 'Basic deliberately-invalid',
}, '{}')
await verifyRejection('Odoo stock unsigned', '/api/webhooks/odoo/stock?workspace_id=00000000-0000-4000-8000-000000000000', 'POST', {
  'Content-Type': 'application/json',
}, '{}')
const csrf = await request('/api/admin/impersonate', 'POST', { Origin: 'https://example.invalid', 'Content-Type': 'application/json' }, '{}')
if (csrf.status !== 403) throw new Error(`Admin impersonation CSRF check expected 403; got ${csrf.status}`)
console.log('Admin impersonation CSRF: rejected cross-origin POST (403)')
console.log('External production security smoke checks: PASS')
