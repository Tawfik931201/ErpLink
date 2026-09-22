import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'

import { decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { enqueueWebhookEvent } from '@/lib/sync-queue'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Odoo → Zid real-time stock receiver.
 *
 * An Odoo Automated Action on `stock.quant` posts here whenever a quantity
 * changes (purchase receipt, sale delivery, inventory adjustment, production).
 * We resolve the affected product + location (or read the quant when the
 * payload only carries its id), then enqueue an idempotent job. The sync-queue
 * coalesces repeated events for the same product before the stock-sync engine
 * pushes the balance to Zid at the paired location.
 */
export async function POST(req: NextRequest) {
  let payload: any = {}
  try {
    const raw = await req.text()
    if (raw) payload = JSON.parse(raw)
  } catch {
    // ignore malformed body
  }

  const actual = Array.isArray(payload) ? (payload[0] || {}) : payload

  const workspaceId =
    req.nextUrl.searchParams.get('workspace_id') ||
    payload.workspace_id ||
    actual.workspace_id ||
    ''

  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 })
  }

  const quantId = toId(actual._id || actual.id || payload.id)
  const productId = toId(actual.product_id ?? payload.product_id)
  const locationId = toId(actual.location_id ?? payload.location_id)

  let resolvedProduct = productId
  let resolvedLocation = locationId

  // Fall back to reading the quant when the payload does not carry the links
  if ((!resolvedProduct || !resolvedLocation) && quantId) {
    try {
      const { data: erpConn } = await supabaseAdmin
        .from('erp_connections')
        .select('*')
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      if (erpConn) {
        const client = new OdooClient({
          url: erpConn.url,
          db: erpConn.db_name || '',
          username: erpConn.username,
          apiKey: decrypt(erpConn.password),
        })
        const rows = await client.read<any>('stock.quant', [quantId], ['id', 'product_id', 'location_id', 'write_date'])
        const q = rows?.[0]
        if (q) {
          resolvedProduct = toId(q.product_id)
          resolvedLocation = toId(q.location_id)
        }
      }
    } catch (err) {
      console.warn('[Odoo Stock Webhook] Failed to read quant:', err)
    }
  }

  if (!resolvedProduct) {
    return NextResponse.json({ error: 'Missing product_id' }, { status: 400 })
  }

  const writeDate =
    payload.write_date || actual.write_date || payload.__last_update || actual.__last_update || null

  const enqueuePayload: Record<string, unknown> = {
    workspace_id: workspaceId,
    product_id: resolvedProduct,
    location_id: resolvedLocation,
    quant_id: quantId,
  }
  if (writeDate) enqueuePayload.updated_at = String(writeDate)

  // storeId is set to workspace_id so events coalesce per workspace+product.
  try {
    await enqueueWebhookEvent({
      workspaceId,
      storeId: workspaceId,
      event: 'odoo.stock.quant.update',
      platform: 'odoo',
      payload: enqueuePayload,
    })
  } catch (err) {
    console.error('[Odoo Stock Webhook] Enqueue failed:', err)
  }

  // Process immediately (fire-and-forget) so events don't wait for an external
  // cron. In production an external scheduler calls GET /api/cron/sync-queue.
  import('@/lib/sync-queue-runner').then(({ runSyncQueueOnce }) => {
    runSyncQueueOnce().catch(() => {})
  })

  return NextResponse.json(
    { success: true, message: 'Stock webhook received and processing started.' },
    { status: 202 }
  )
}

function toId(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  if (Array.isArray(v)) return toId(v[0])
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Odoo Stock Webhook Receiver is ready.' })
}