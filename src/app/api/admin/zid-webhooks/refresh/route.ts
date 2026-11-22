import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  getZidWebhookCredential,
  zidWebhookCredentialFingerprint,
} from '@/lib/zid/webhook-auth'
import {
  ZID_CORE_EVENTS,
  syncWebhooksWithSettings,
  unregisterAllZidWebhooks,
} from '@/lib/zid/webhooks'

/**
 * POST /api/admin/zid-webhooks/refresh — re-create every linked store's Zid
 * webhooks so they carry the HTTP Basic credential the ingress route verifies.
 *
 * Why this exists: Zid stores the Basic `username`/`password` **on the webhook
 * row at creation time** (docs.zid.sa/create-a-webhook). A webhook created
 * before that mechanism was adopted keeps delivering with no `Authorization`
 * header forever, so no amount of server-side configuration fixes it — the row
 * must be deleted and re-created. Every store therefore needs one pass of this
 * route before unauthenticated deliveries can be refused outright.
 *
 * It is a delete-then-create per store, so the events registered at that instant
 * are briefly absent. Run it once, then stop the
 * "Unauthenticated delivery #N" warnings in the server log.
 */

type SyncSettings = Record<string, { odoo2zid: boolean; zid2odoo: boolean }>

interface StoreReport {
  merchantId: string
  storeId: string | null
  workspaceId: string | null
  removed: number
  registered: number
  failed: number
  listFailed: boolean
  status: 'refreshed' | 'failed'
  error?: string
}

/**
 * Settings the merchant actually enabled. A row with no `sync_settings` (an
 * older connection, or one whose column was never written) falls back to the
 * core event set — the same defaults the OAuth callback applies on connect
 * (src/app/api/zid/callback/route.ts).
 */
function resolveSettings(raw: unknown): SyncSettings {
  const source = raw && typeof raw === 'object' ? (raw as SyncSettings) : null
  const settings: SyncSettings = {}

  if (source) {
    for (const [key, value] of Object.entries(source)) {
      if (!value || typeof value !== 'object') continue
      settings[key] = {
        odoo2zid: Boolean((value as { odoo2zid?: boolean }).odoo2zid),
        zid2odoo: Boolean((value as { zid2odoo?: boolean }).zid2odoo),
      }
    }
  }

  const hasEnabledEvent = Object.values(settings).some((v) => v.zid2odoo)
  if (!hasEnabledEvent) {
    for (const key of ZID_CORE_EVENTS) {
      settings[key] = { odoo2zid: false, zid2odoo: true }
    }
  }

  return settings
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function POST() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Checked before any deletion: re-creating webhooks without a credential
  // would replace working subscriptions with ones that can never authenticate.
  if (!getZidWebhookCredential('credential-check')) {
    return NextResponse.json(
      { error: 'No webhook credential is derivable — ENCRYPTION_KEY is not set. Refusing to touch existing webhooks.' },
      { status: 400 }
    )
  }

  const { data: rows, error: rowsErr } = await supabase
    .from('merchant_tokens')
    .select('merchant_id, store_id, workspace_id, sync_settings')

  if (rowsErr) {
    return NextResponse.json({ error: `Failed to list linked stores: ${rowsErr.message}` }, { status: 500 })
  }

  const stores = (rows ?? []) as Array<{
    merchant_id?: string | number | null
    store_id?: string | number | null
    workspace_id?: string | null
    sync_settings?: unknown
  }>

  const reports: StoreReport[] = []

  for (const [index, row] of stores.entries()) {
    // Webhooks are registered under the merchant id, which is what the OAuth
    // callback passes and what the `?store_id=` marker in target_url contains.
    const merchantId = String(row.merchant_id || row.store_id || '')
    if (!merchantId) continue

    try {
      // Sequential: Zid allows ~60 req/min and a store costs ~1 list + N deletes
      // + N creates. Concurrent stores would trip the limit halfway through.
      if (index > 0) await sleep(1_000)

      const cleanup = await unregisterAllZidWebhooks(merchantId)
      const registered = await syncWebhooksWithSettings(merchantId, resolveSettings(row.sync_settings))

      reports.push({
        merchantId,
        storeId: row.store_id != null ? String(row.store_id) : null,
        workspaceId: row.workspace_id ?? null,
        removed: cleanup.removed,
        registered: registered.registered,
        failed: registered.failed,
        listFailed: cleanup.listFailed,
        status: registered.failed > 0 ? 'failed' : 'refreshed',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Zid Webhook] Refresh failed for merchant', { merchantId, error })
      reports.push({
        merchantId,
        storeId: row.store_id != null ? String(row.store_id) : null,
        workspaceId: row.workspace_id ?? null,
        removed: 0,
        registered: 0,
        failed: 1,
        listFailed: false,
        status: 'failed',
        error: message,
      })
    }
  }

  await recordAudit({
    actorId: userId,
    actorRole: 'admin',
    action: 'zid.webhooks_refresh',
    entityType: 'zid_webhook',
    entityId: `stores:${reports.length}`,
    metadata: {
      credential: zidWebhookCredentialFingerprint(),
      refreshed: reports.filter((r) => r.status === 'refreshed').length,
      failed: reports.filter((r) => r.status === 'failed').length,
    },
  }).catch(() => {})

  return NextResponse.json({
    ok: reports.every((r) => r.status === 'refreshed'),
    credential: zidWebhookCredentialFingerprint(),
    stores: reports,
  })
}

export async function GET() {
  return NextResponse.json(
    { error: 'Use POST. This route deletes and re-creates Zid webhooks for every linked store.' },
    { status: 405 }
  )
}