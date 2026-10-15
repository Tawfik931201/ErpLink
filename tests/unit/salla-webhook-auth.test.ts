import fs from 'fs'
import path from 'path'

import type * as SallaWebhookAuthModuleType from '@/lib/salla/webhook-auth'

const ROUTE_PATH = path.join(process.cwd(), 'src/app/api/webhooks/salla/route.ts')
const CLIENT_PATH = path.join(process.cwd(), 'src/lib/salla-client.ts')
const CALLBACK_PATH = path.join(process.cwd(), 'src/app/api/salla/callback/route.ts')
const REFRESH_PATH = path.join(
  process.cwd(),
  'src/app/api/admin/salla-webhooks/refresh/route.ts'
)

type SallaWebhookAuthModule = typeof SallaWebhookAuthModuleType

const AUTH_MODULE = '../../src/lib/salla/webhook-auth'

const TEST_KEY = 'test-encryption-key-not-a-real-secret'
const PORTAL_SECRET = 'a'.repeat(64)
const BODY = JSON.stringify({ event: 'product.updated', merchant: 123, data: { id: 456 } })

/**
 * Regression tests for src/lib/salla/webhook-auth.ts.
 *
 * Salla **does** sign natively (`x-salla-signature`, HMAC-SHA256 of the raw
 * body) — unlike Zid, which signs nothing. But the Portal signing secret was
 * never set on the host, and the route treated that as a hard 500 *before*
 * parsing anything, so every Salla delivery was lost with no error on Salla's
 * side. Setting the env var alone would not have fixed it either: registration
 * attached the secret to a `x-erplink-webhook-secret` header that the route
 * never read, so only the native signature was ever accepted.
 *
 * What is pinned here:
 *
 *   1. the native Salla HMAC is verified correctly when the secret IS configured,
 *   2. the credential is derived from `ENCRYPTION_KEY` (guaranteed in
 *      production) so ingress works with no host env var at all,
 *   3. a delivery carrying nothing verifiable is `legacy`, never `ok` — and
 *      specifically NOT `unconfigured`, which is the 500,
 *   4. an unauthenticated `app.uninstalled` is refused (the one irreversible
 *      thing a webhook can do, and merchant_id is in the payload),
 *   5. registration attaches the derived header rather than reading the env var.
 */
function loadAuth(env: Record<string, string | undefined>) {
  let mod: SallaWebhookAuthModule
  const previousEncryptionKey = process.env.ENCRYPTION_KEY
  const previousSigningSecret = process.env.SALLA_WEBHOOK_SECRET
  // `Object.assign` would coerce `undefined` into the string "undefined", which
  // is a perfectly valid key — the absence case has to be a real delete.
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  jest.resetModules()
  jest.isolateModules(() => {
    mod = require(AUTH_MODULE)
  })
  return {
    mod: mod!,
    restore: () => {
      if (previousEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY
      else process.env.ENCRYPTION_KEY = previousEncryptionKey
      if (previousSigningSecret === undefined) delete process.env.SALLA_WEBHOOK_SECRET
      else process.env.SALLA_WEBHOOK_SECRET = previousSigningSecret
    },
  }
}

/** Minimal case-insensitive header reader, like `Headers.get`. */
function reader(headers: Record<string, string>) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return (name: string) => lower.get(name.toLowerCase()) ?? null
}

/**
 * Strips comments so a negative assertion cannot be satisfied by prose. Several
 * of the files below *deliberately* name the retired variable in their
 * explanatory comments, and a comment is not a read.
 */
function code(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('Salla native HMAC verification', () => {
  it('accepts the signature Salla actually sends over the raw body', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      const signature = mod.computeSallaSignature(BODY, PORTAL_SECRET)!
      expect(signature).toHaveLength(64)
      expect(mod.verifySallaWebhookAuth(BODY, reader({ 'X-Salla-Signature': signature }))).toEqual({
        status: 'ok',
        method: 'signature',
      })
    } finally {
      restore()
    }
  })

  it('rejects a signature computed over different bytes', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      // Re-serialising the parsed body changes the bytes — the classic reason a
      // signature check must run against `await req.text()`, not a re-stringify.
      const reparsed = JSON.stringify(JSON.parse(BODY), null, 2)
      const signature = mod.computeSallaSignature(BODY, PORTAL_SECRET)!
      expect(mod.verifySallaWebhookAuth(reparsed, reader({ 'x-salla-signature': signature }))).toEqual({
        status: 'invalid',
        method: 'signature',
      })
    } finally {
      restore()
    }
  })

  it('rejects a wrong signature, including one of the same length', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      const sameLength = '0'.repeat(64)
      expect(sameLength).toHaveLength(mod.computeSallaSignature(BODY, PORTAL_SECRET)!.length)
      expect(mod.verifySallaWebhookAuth(BODY, reader({ 'x-salla-signature': sameLength }))).toEqual({
        status: 'invalid',
        method: 'signature',
      })
    } finally {
      restore()
    }
  })

  it('treats a signed delivery as legacy — not unconfigured — when the host has no Portal secret', () => {
    // This is the live production shape: Salla sends a signature, the host has
    // never had SALLA_WEBHOOK_SECRET. Failing closed here is the outage.
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: undefined })
    try {
      const result = mod.verifySallaWebhookAuth(BODY, reader({ 'x-salla-signature': 'deadbeef' }))
      expect(result).toEqual({ status: 'legacy' })
    } finally {
      restore()
    }
  })
})

describe('the derived header credential', () => {
  it('is not derivable without a key', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: undefined, SALLA_WEBHOOK_SECRET: undefined })
    try {
      expect(mod.getSallaWebhookCredential()).toBeNull()
    } finally {
      restore()
    }
  })

  it('is deterministic per key, different per key, and never the key itself', () => {
    const first = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    const firstValue = first.mod.getSallaWebhookCredential()?.headerValue
    first.restore()

    const again = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    const againValue = again.mod.getSallaWebhookCredential()?.headerValue
    again.restore()

    const rotated = loadAuth({ ENCRYPTION_KEY: `${TEST_KEY}-rotated` })
    const rotatedValue = rotated.mod.getSallaWebhookCredential()?.headerValue
    rotated.restore()

    expect(firstValue).toBe(againValue)
    expect(firstValue).not.toBe(rotatedValue)
    expect(firstValue).not.toBe(TEST_KEY)
    expect(firstValue).not.toContain(TEST_KEY)
  })

  it('uses a distinct HKDF domain from Zid and Odoo, so credentials cannot cross over', async () => {
    const sallaValue = loadAuth({ ENCRYPTION_KEY: TEST_KEY }).mod.getSallaWebhookCredential()?.headerValue

    // Different modules on purpose: the point is that the same key yields a
    // *different* credential per ingress, so holding Zid's secret authenticates
    // nothing to Salla.
    const previous = process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = TEST_KEY
    jest.resetModules()
    const zidAuth = await import('../../src/lib/zid/webhook-auth')
    const odooSecret = await import('../../src/lib/odoo/webhook-secret')
    const zidValue = zidAuth.getZidWebhookCredential()?.headerValue
    const odooValue = odooSecret.deriveOdooWebhookSecret(odooSecret.odooStockSecretScope('ws-1'))
    if (previous === undefined) delete process.env.ENCRYPTION_KEY
    else process.env.ENCRYPTION_KEY = previous

    expect(sallaValue).toBeDefined()
    expect(sallaValue).not.toBe(zidValue)
    expect(sallaValue).not.toBe(odooValue)
  })

  it('lets an explicit secret override the derived one', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      expect(mod.getSallaWebhookCredential('explicit-value')?.headerValue).toBe('explicit-value')
      // Blank/whitespace is not an override — it used to mean "send no header at all".
      expect(mod.getSallaWebhookCredential('   ')?.headerValue).not.toBe('   ')
      expect(mod.getSallaWebhookCredential()?.headerValue).not.toBe('   ')
    } finally {
      restore()
    }
  })

  it('accepts the header it registers, and rejects a wrong one', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      const { headerKey, headerValue } = mod.getSallaWebhookCredential()!
      expect(headerKey).toBe('x-erplink-webhook-secret')
      expect(mod.verifySallaWebhookAuth(BODY, reader({ [headerKey]: headerValue }))).toEqual({
        status: 'ok',
        method: 'header',
      })
      expect(mod.verifySallaWebhookAuth(BODY, reader({ [headerKey]: `${headerValue}x` }))).toEqual({
        status: 'invalid',
        method: 'header',
      })
    } finally {
      restore()
    }
  })

  it('is compared before the signature, so a bad header never falls back to a signature check', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      const signature = mod.computeSallaSignature(BODY, PORTAL_SECRET)!
      // A present-but-wrong header is `invalid`. If the code tried the signature
      // afterwards it would answer `ok` for a request carrying a forged header.
      expect(
        mod.verifySallaWebhookAuth(
          BODY,
          reader({ 'x-erplink-webhook-secret': 'wrong', 'x-salla-signature': signature })
        )
      ).toEqual({ status: 'invalid', method: 'header' })
    } finally {
      restore()
    }
  })

  it('has a stable 12-char fingerprint that is not the credential', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      const credential = mod.getSallaWebhookCredential()!
      const fingerprint = mod.sallaWebhookCredentialFingerprint()
      expect(fingerprint).toHaveLength(12)
      expect(fingerprint).toBe(mod.sallaWebhookCredentialFingerprint())
      expect(fingerprint).not.toBe(credential.headerValue)
      expect(credential.headerValue).not.toContain(fingerprint)
    } finally {
      restore()
    }
  })
})

describe('the unconfigured verdict is reserved for development', () => {
  it('is reported only when nothing at all is derivable or configured', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: undefined, SALLA_WEBHOOK_SECRET: undefined })
    try {
      expect(mod.verifySallaWebhookAuth(BODY, reader({}))).toEqual({ status: 'unconfigured' })
      expect(mod.verifySallaWebhookAuth(BODY, reader({ 'x-salla-signature': 'abc' }))).toEqual({
        status: 'unconfigured',
      })
      expect(mod.verifySallaWebhookAuth(BODY, reader({ 'x-erplink-webhook-secret': 'abc' }))).toEqual({
        status: 'unconfigured',
      })
    } finally {
      restore()
    }
  })

  it('never reports unconfigured merely because the env secret is absent', () => {
    // ENCRYPTION_KEY is guaranteed in production, so this must be `legacy`.
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: undefined })
    try {
      expect(mod.verifySallaWebhookAuth(BODY, reader({}))).toEqual({ status: 'legacy' })
    } finally {
      restore()
    }
  })

  it('accepts an env-configured signature even with no ENCRYPTION_KEY', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: undefined, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      const signature = mod.computeSallaSignature(BODY, PORTAL_SECRET)!
      expect(mod.verifySallaWebhookAuth(BODY, reader({ 'x-salla-signature': signature }))).toEqual({
        status: 'ok',
        method: 'signature',
      })
    } finally {
      restore()
    }
  })
})

describe('the `token` security strategy', () => {
  // Salla's docs contradict themselves here: the strategy table and the AsyncAPI
  // spec both put the token in `Authorization`, while one prose paragraph claims
  // a body hash in `X-Salla-Signature`. We follow the table and the spec, and
  // these tests exist so the resolution is a deliberate, pinned decision rather
  // than an accident of whichever header we happened to read.
  it('compares the Authorization value as-is, never hashing it over the body', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      const headers = reader({
        'X-Salla-Security-Strategy': 'Token',
        Authorization: PORTAL_SECRET,
      })
      // Hashing the body would produce 64 chars and answer `invalid` here.
      expect(mod.verifySallaWebhookAuth(BODY, headers)).toEqual({ status: 'ok', method: 'token' })
    } finally {
      restore()
    }
  })

  it('rejects a wrong token, including a body HMAC sent in Authorization', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      const bodyHmac = mod.computeSallaSignature(BODY, PORTAL_SECRET)!
      expect(
        mod.verifySallaWebhookAuth(
          BODY,
          reader({ 'x-salla-security-strategy': 'token', authorization: bodyHmac })
        )
      ).toEqual({ status: 'invalid', method: 'token' })
    } finally {
      restore()
    }
  })

  it('is case-insensitive about the strategy value Salla sends', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      for (const strategy of ['token', 'Token', 'TOKEN']) {
        expect(
          mod.verifySallaWebhookAuth(
            BODY,
            reader({ 'x-salla-security-strategy': strategy, authorization: PORTAL_SECRET })
          )
        ).toEqual({ status: 'ok', method: 'token' })
      }
    } finally {
      restore()
    }
  })

  it('does not let a strategy header promote a Signature delivery to `ok`', () => {
    // `Signature` must keep using the HMAC path even if a token also rides along.
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: PORTAL_SECRET })
    try {
      expect(
        mod.verifySallaWebhookAuth(
          BODY,
          reader({ 'x-salla-security-strategy': 'signature', authorization: PORTAL_SECRET })
        )
      ).toEqual({ status: 'legacy' })
    } finally {
      restore()
    }
  })

  it('falls back to legacy, not unconfigured, when the host holds no Portal secret', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY, SALLA_WEBHOOK_SECRET: undefined })
    try {
      expect(
        mod.verifySallaWebhookAuth(
          BODY,
          reader({ 'x-salla-security-strategy': 'token', authorization: 'anything' })
        )
      ).toEqual({ status: 'legacy' })
    } finally {
      restore()
    }
  })
})

describe('the route keeps the documented mechanisms only', () => {
  const route = fs.readFileSync(ROUTE_PATH, 'utf8')

  it('no longer hard-fails on a missing SALLA_WEBHOOK_SECRET', () => {
    expect(code(route)).not.toMatch(/SALLA_WEBHOOK_SECRET/)
    expect(code(route)).not.toMatch(/verifySallaSignature/)
    expect(code(route)).not.toMatch(/createHmac/)
    // The only 500 left is the genuinely unconfigured (no ENCRYPTION_KEY) case.
    expect(route).not.toMatch(/is not configured in production/)
  })

  it('verifies through the shared classifier', () => {
    expect(route).toMatch(/verifySallaWebhookAuth\(rawBody, getHeader\)/)
  })

  it('answers 401 to a wrong credential', () => {
    expect(route).toMatch(/authResult\.status === 'invalid'[\s\S]{0,400}status: 401/)
  })

  it('refuses an unauthenticated app.uninstalled instead of deleting tokens', () => {
    expect(route).toMatch(
      /if \(event === 'app\.uninstalled'\) \{[\s\S]{0,600}if \(isUnauthenticated\) \{[\s\S]{0,400}unauthenticated_uninstall/
    )
    // The destructive branch must remain for authenticated callers.
    expect(route).toMatch(/from\('salla_tokens'\)\.delete\(\)\.eq\('merchant_id', merchantId\)/)
  })

  it('logs the fingerprint rather than the credential', () => {
    expect(route).toMatch(/credential: sallaWebhookCredentialFingerprint\(\)/)
    expect(route).not.toMatch(/console\.(log|warn|error|info)\([^)]*getSallaWebhookCredential\(\)/)
  })

  it('counts legacy deliveries instead of staying silent about them', () => {
    expect(route).toMatch(/legacyUnauthenticatedDeliveries/)
    expect(route).toMatch(/Unauthenticated delivery #\$\{count\}/)
  })

  it('never keys dedup on payload.uuid, which is the entity id not the delivery', () => {
    // AGENTS.md records this exact bug for Zid: a record-scoped key makes every
    // later update look like a duplicate, silently dropping real changes.
    expect(route).not.toMatch(/payload\?\.uuid/)
    expect(route).not.toMatch(/extractSallaWebhookId\([^)]*uuid/)
  })

  it('routes through the canonical enqueue instead of hand-rolling an insert', () => {
    expect(route).toMatch(/await import\('@\/lib\/sync-queue'\)/)
    expect(route).toMatch(/enqueueWebhookEvent\(\{/)
    // The hand-rolled contract: 3 retries instead of the shared 5, and its own
    // coalescing/receipt code duplicating what sync-queue already does.
    expect(route).not.toMatch(/max_retries: 3/)
    expect(route).not.toMatch(/from\('sync_queue'\)\.insert\(/)

    // `recordWebhookReceipt` is still called directly — by the stale branch, which
    // must persist a payload it deliberately refuses to enqueue. So scope the
    // assertion to the enqueue block, where a second receipt would double-write.
    const enqueueAt = route.indexOf("const { enqueueWebhookEvent }")
    const metricAt = route.indexOf('await recordSallaWebhookMetric')
    expect(enqueueAt).toBeGreaterThan(-1)
    expect(metricAt).toBeGreaterThan(enqueueAt)
    expect(route.slice(enqueueAt, metricAt)).not.toMatch(/recordWebhookReceipt\(/)

    expect(route).toMatch(/status: 503/)
  })

  it('keeps the settings gate and the orphan-receipt path', () => {
    // Multi-store: the gate is scoped to THIS merchant, so one store's
    // disabled toggle never silences a sibling store's events.
    expect(route).toMatch(/isWebhookEventEnabled\(sallaToken\.workspace_id, 'salla', event, merchantId\)/)
    expect(route).toMatch(/recordOrphanReceipt\(/)
    expect(route).toMatch(/status: 202/)
  })

  it('saves a stale delivery instead of discarding it', () => {
    // A late redelivery must not be *enqueued* (it would regress newer state),
    // but "not enqueued" is not "thrown away" — reconcileZidOrders has no Salla
    // peer, so nothing else would ever recover it. The null workspace_id is what
    // keeps it out of the drain query.
    expect(route).toMatch(/dedupKey: `salla:stale:/)
    expect(route).toMatch(/workspaceId: null/)
    expect(route).toMatch(/savedForRecovery: true/)
    expect(route).toMatch(/staleSkippedDeliveries/)
    // And a failed write on this branch must still be 503, not 2xx.
    expect(route).toMatch(/stale_store_failed'[\s\S]{0,80}status: 503/)
  })
})

describe('registration attaches a credential and subscribes the shipment events', () => {
  const client = fs.readFileSync(CLIENT_PATH, 'utf8')

  it('attaches the derived header, not an env var read', () => {
    expect(client).toMatch(/const credential = getSallaWebhookCredential\(webhookSecret\)/)
    expect(client).toMatch(/body\.headers = \[\{ key: credential\.headerKey, value: credential\.headerValue \}\]/)
    expect(code(client)).not.toMatch(/process\.env\.SALLA_WEBHOOK_SECRET/)
  })

  it('subscribes only event slugs that Salla actually publishes', () => {
    // Every slug registered here came from guessing, and most of the guesses were
    // wrong: `order.shipment.ready`, `order.shipment.in_transit`,
    // `order.shipment.delivered`, `product.publish` and `abandoned.cart.update`
    // do not exist. Registration counted them as `failed` and warned, so it was
    // loud — but the deliver preset still had nothing real to fire on.
    //
    // Verified against the Portal's own `salla_events action=list` for this app
    // (cross-checked with https://docs.salla.dev/webhooks), so this pin is the
    // anti-fabrication guard: a new guess fails here rather than in production.
    const SALLA_PUBLISHED_EVENTS = new Set([
      // order
      'order.created', 'order.updated', 'order.status.updated', 'order.cancelled',
      'order.refunded', 'order.deleted', 'order.payment.updated', 'order.products.updated',
      'order.customer.updated', 'order.coupon.updated', 'order.total.price.updated',
      'order.shipping.address.updated',
      'order.shipment.creating', 'order.shipment.created', 'order.shipment.cancelled',
      'order.shipment.return.creating', 'order.shipment.return.created',
      'order.shipment.return.cancelled',
      // product
      'product.created', 'product.updated', 'product.deleted', 'product.available',
      'product.quantity.low', 'product.price.updated', 'product.status.updated',
      'product.image.updated', 'product.category.updated', 'product.brand.updated',
      'product.tags.updated', 'product.channels.changed',
      // shipment / shipping company
      'shipment.creating', 'shipment.created', 'shipment.cancelled', 'shipment.updated',
      'shipping.zone.created', 'shipping.zone.updated',
      'shipping.company.created', 'shipping.company.updated', 'shipping.company.deleted',
      // customer / category / brand
      'customer.created', 'customer.updated', 'customer.login', 'customer.otp.request',
      'category.created', 'category.updated',
      'brand.created', 'brand.updated', 'brand.deleted',
      // store / cart / invoice / misc
      'store.branch.created', 'store.branch.updated', 'store.branch.deleted',
      'store.branch.setDefault', 'store.branch.activated', 'storetax.created',
      'abandoned.cart', 'coupon.applied', 'invoice.created',
      'specialoffer.created', 'specialoffer.updated', 'review.added',
    ])

    // Comments are stripped first: the catalogue is documented inline, and the
    // prose is full of apostrophes that a naive quoted-string scan reads as slugs.
    const declared = code(client).match(/export const SALLA_DEFAULT_WEBHOOK_EVENTS = \[([\s\S]*?)\n\]/)![1]
    const events = [...declared.matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(events.length).toBeGreaterThan(20)
    const invented = events.filter(e => !SALLA_PUBLISHED_EVENTS.has(e))
    expect(invented).toEqual([])
    expect(new Set(events).size).toBe(events.length) // no duplicates
  })

  it('subscribes order.shipment.* so the deliver preset can fire', () => {
    // `order.shipment.*` — not Salla's bare `shipment.*`. Only the prefixed ones
    // map to the `orders` entity in webhook-gate.ts (the match is on the name
    // containing "order"), so the bare ones would be enqueued with no entity to
    // sync against. `shipment.updated` in particular would otherwise look like
    // the natural way to catch a delivery, and quietly do nothing.
    const declared = code(client).match(/export const SALLA_DEFAULT_WEBHOOK_EVENTS = \[([\s\S]*?)\n\]/)![1]
    for (const event of [
      'order.shipment.creating',
      'order.shipment.created',
      'order.shipment.cancelled',
      'order.shipment.return.created',
    ]) {
      expect(declared).toContain(`'${event}'`)
    }
    expect(declared).not.toMatch(/'shipment\./)
  })

  it('does not subscribe category.deleted, which Salla never publishes', () => {
    // This one was *not* a guess I made — it predates this work and was asserted
    // here as "needed, without it delete sync can never run". The premise is
    // false: Salla's category catalogue is created/updated only. Subscribing to a
    // non-existent event can only ever fail, so it cost an API call per refresh
    // and a permanent phantom entry in `failed`. The engine's category-delete
    // path is real but is not webhook-drivable — do not re-add it as if it were.
    const declared = code(client).match(/export const SALLA_DEFAULT_WEBHOOK_EVENTS = \[([\s\S]*?)\n\]/)![1]
    expect(declared).not.toContain("'category.deleted'")
    expect(declared).toContain("'category.created'")
    expect(declared).toContain("'category.updated'")
  })

  it('reports a partial registration instead of only warning', () => {
    expect(client).toMatch(/export interface SallaWebhookRegistrationResult/)
    expect(client).toMatch(/failed\+\+/)
    expect(client).toMatch(/return \{ registered, failed, credentialAttached: Boolean\(credential\) \}/)
  })

  it('lets the OAuth callback fall back to the derived credential', () => {
    const callback = fs.readFileSync(CALLBACK_PATH, 'utf8')
    // Passing the (possibly empty) env value meant "no auth header at all".
    expect(callback).toMatch(/registerSallaWebhooks\(merchantId, undefined\)/)
    // Naming the variable in prose is fine; *reading* it is not.
    expect(code(callback)).not.toMatch(/process\.env\.SALLA_WEBHOOK_SECRET/)
    expect(callback).toMatch(/result\.failed > 0/)
  })
})

describe('the re-registration path exists and is admin-only', () => {
  const refresh = fs.readFileSync(REFRESH_PATH, 'utf8')

  it('requires a signed-in admin', () => {
    expect(refresh).toMatch(/const \{ userId \} = await auth\(\)/)
    expect(refresh).toMatch(/if \(!userId \|\| !isAdmin\(userId\)\)/)
  })

  it('refuses to touch subscriptions when no credential is derivable', () => {
    const guardAt = refresh.indexOf('if (!getSallaWebhookCredential())')
    const firstWrite = refresh.indexOf('registerSallaWebhooks(merchantId)')
    expect(guardAt).toBeGreaterThan(-1)
    expect(firstWrite).toBeGreaterThan(guardAt)
  })

  it('re-subscribes rather than delete-then-create', () => {
    // Salla upserts by URL, so there is no teardown step to order correctly.
    expect(refresh).toMatch(/registerSallaWebhooks\(merchantId\)/)
    expect(refresh).not.toMatch(/unregisterSallaWebhooks|deleteSallaWebhook/)
  })

  it('never exposes the credential in its response', () => {
    expect(refresh).toMatch(/credential: sallaWebhookCredentialFingerprint\(\)/)
    expect(refresh).not.toMatch(/headerValue/)
  })
})
