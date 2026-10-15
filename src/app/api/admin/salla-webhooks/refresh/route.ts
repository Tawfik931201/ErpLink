import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { isAdmin } from '@/lib/auth'
import {
  getSallaWebhookCredential,
  sallaWebhookCredentialFingerprint,
} from '@/lib/salla/webhook-auth'

/**
 * POST /api/admin/salla-webhooks/refresh — re-subscribe every linked Salla
 * store's webhooks so each one carries the derived ingress header.
 *
 * Why this exists: the credential lives **on the subscription row**, in the
 * `headers` array Salla stores at `POST /webhooks/subscribe` time. A webhook
 * created before that mechanism existed keeps delivering with no auth header
 * forever, so no amount of server-side configuration fixes it — the
 * subscription has to be replaced.
 *
 * Unlike the Odoo route there is **no delete step**: `/webhooks/subscribe`
 * upserts by URL, so re-subscribing the same URL replaces the subscription in
 * place. That is inherently create-before-delete — there is never a window in
 * which the store has no subscription — and ingress is idempotent per delivery,
 * so the overlap is harmless.
 */

interface StoreReport {
  merchantId: string
  workspaceId: string | null
  registered: number
  failed: number
  credentialAttached: boolean
  status: 'refreshed' | 'failed'
  error?: string
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function POST() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Checked before touching anything: re-subscribing without a credential would
  // produce subscriptions that can never authenticate — the same failure this
  // route exists to repair.
  if (!getSallaWebhookCredential()) {
    return NextResponse.json(
      {
        error:
          'No webhook credential is derivable — ENCRYPTION_KEY is not set. Refusing to touch existing subscriptions.',
      },
      { status: 400 }
    )
  }

  const { supabase } = await import('@/lib/supabase')
  const { registerSallaWebhooks } = await import('@/lib/salla-client')

  const { data: rows, error: rowsErr } = await supabase
    .from('salla_tokens')
    .select('merchant_id, workspace_id')

  if (rowsErr) {
    return NextResponse.json({ error: `Failed to list linked stores: ${rowsErr.message}` }, { status: 500 })
  }

  const stores = (rows ?? []) as Array<{
    merchant_id?: string | number | null
    workspace_id?: string | null
  }>

  const reports: StoreReport[] = []

  for (const [index, row] of stores.entries()) {
    const merchantId = String(row.merchant_id ?? '')
    if (!merchantId) continue

    try {
      // Sequential: Salla rate-limits subscription writes, and one store costs
      // N subscribe calls (N = SALLA_DEFAULT_WEBHOOK_EVENTS). Concurrent stores
      // would trip the limit halfway through and leave a partial registration.
      if (index > 0) await sleep(1_000)

      const result = await registerSallaWebhooks(merchantId)

      reports.push({
        merchantId,
        workspaceId: row.workspace_id ?? null,
        registered: result.registered,
        failed: result.failed,
        credentialAttached: result.credentialAttached,
        status: result.failed > 0 || !result.credentialAttached ? 'failed' : 'refreshed',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Salla Webhook] Refresh failed for merchant', { merchantId, error })
      reports.push({
        merchantId,
        workspaceId: row.workspace_id ?? null,
        registered: 0,
        failed: 1,
        credentialAttached: true,
        status: 'failed',
        error: message,
      })
    }
  }

  await recordAudit({
    actorId: userId,
    actorRole: 'admin',
    action: 'salla.webhooks_refresh',
    entityType: 'salla_webhook',
    entityId: `stores:${reports.length}`,
    metadata: {
      credential: sallaWebhookCredentialFingerprint(),
      refreshed: reports.filter((r) => r.status === 'refreshed').length,
      failed: reports.filter((r) => r.status === 'failed').length,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: reports.every((r) => r.status === 'refreshed'),
    credential: sallaWebhookCredentialFingerprint(),
    stores: reports,
  })
}

export async function GET() {
  return NextResponse.json(
    { error: 'Use POST. This route re-subscribes Salla webhooks for every linked store.' },
    { status: 405 }
  )
}
