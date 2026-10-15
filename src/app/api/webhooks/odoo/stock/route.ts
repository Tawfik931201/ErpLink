import { type NextRequest, NextResponse } from 'next/server'

import {
  authorizeOdooWebhook,
  odooStockSecretScope,
} from '@/lib/odoo/webhook-secret'
import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import { supabase } from '@/lib/supabase'
import { enqueueWebhookEvent, fingerprintPayload } from '@/lib/sync-queue'
import { runSyncQueueOnce } from '@/lib/sync-queue-runner'
import { isWebhookBodyTooLarge, MAX_WEBHOOK_BODY_BYTES } from '@/lib/webhook-strict'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Odoo → Stores real-time stock receiver.
 *
 * An Odoo Automated Action on `stock.quant` posts here whenever a quantity
 * changes (purchase receipt, sale delivery, inventory adjustment, production).
 * We resolve the affected product + location (or read the quant when the
 * payload only carries its id), then enqueue an idempotent job. The sync-queue
 * coalesces repeated events for the same product before the stock-sync engine
 * pushes the balance to linked stores at the paired location.
 *
 * Trust boundary: the quantity in the body is NEVER used as a value — it only
 * feeds the dedup fingerprint. `processOdooStockEvent` re-reads the real
 * balance from the customer's own Odoo (readOdooQtyAtLocation) before pushing,
 * so a forged body cannot set a stock level. What a caller with the shared
 * secret *can* do is choose which workspace/product/location gets a re-push;
 * closing that needs a per-tenant secret, which is a deployment change
 * (each customer's Automated Action must be reconfigured).
 */
export async function POST(req: NextRequest) {
  const getHeader = (name: string) => req.headers.get(name)
  const rl = checkRateLimit(rateLimitKeyFromHeaders(getHeader, 'odoo-stock-webhook'), 120, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let payload: any = {}
  try {
    const raw = await req.text()
    if (raw && isWebhookBodyTooLarge(raw)) {
      return NextResponse.json(
        { error: `Payload too large (max ${MAX_WEBHOOK_BODY_BYTES} bytes)` },
        { status: 413 }
      )
    }
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

  // The destination is caller-chosen (it arrives in the URL/body), so it is
  // checked against real rows instead of being trusted. This drops nonsense
  // ids before they reach the queue; it does NOT stop a caller with the shared
  // secret from naming a real tenant (see the trust-boundary note above).
  if (!UUID_RE.test(workspaceId)) {
    return NextResponse.json({ error: 'Invalid workspace_id' }, { status: 400 })
  }

  // Verified before any database work, so an unauthenticated caller never gets
  // an existence oracle out of the `erp_connections` lookup below. The secret is
  // scoped to the workspace the URL already names — see
  // src/lib/odoo/webhook-secret.ts for the migration window on `legacy`.
  const auth = authorizeOdooWebhook({
    scope: odooStockSecretScope(workspaceId),
    authorization: req.headers.get('authorization'),
    headerSecret: req.headers.get('x-odoo-secret'),
    querySecret: req.nextUrl.searchParams.get('secret'),
    token: req.nextUrl.searchParams.get('token'),
  })
  if (auth.action === 'reject') {
    console.warn(`[Odoo Stock Webhook] Rejected delivery: ${auth.error}`)
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { data: erpConn, error: connErr } = await supabase
    .from('erp_connections')
    .select('id')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (connErr) {
    console.error('[Odoo Stock Webhook] erp_connections lookup failed:', connErr.message)
    return NextResponse.json({ error: 'Failed to validate workspace', detail: 'lookup_failed' }, { status: 503 })
  }
  if (!erpConn) {
    return NextResponse.json({ error: 'Unknown workspace' }, { status: 404 })
  }

  const quantId = toId(actual._id || actual.id || payload.id)
  const productId = toId(actual.product_id ?? payload.product_id)
  const locationId = toId(actual.location_id ?? payload.location_id)

  if (!productId && !quantId) {
    return NextResponse.json({ error: 'Missing product_id or quant_id' }, { status: 400 })
  }

  const writeDate =
    payload.write_date || actual.write_date || payload.__last_update || actual.__last_update || null

  const enqueuePayload: Record<string, unknown> = {
    workspace_id: workspaceId,
    product_id: productId,
    location_id: locationId,
    quant_id: quantId,
  }
  if (writeDate) enqueuePayload.updated_at = String(writeDate)

  // الرصيد الوارد من Automated Action (إن وُجد) يدخل في البصمة: بدونه كان
  // تغيّران حقيقيان بنفس الـquant وبنفس write_date الغائب يُحسبان نسخة واحدة
  // فيُسقط الثاني. نلتقط الأسماء الشائعة فقط — الصومعة ليست شرطاً.
  const quantityFields: Record<string, unknown> = {}
  for (const key of ['quantity', 'available_quantity', 'reserved_quantity', 'inventory_quantity', 'incoming', 'outgoing']) {
    const v = (payload as Record<string, unknown>)[key] ?? (actual as Record<string, unknown>)[key]
    if (v !== undefined && v !== null && v !== '') quantityFields[key] = v
  }
  if (Object.keys(quantityFields).length > 0) {
    Object.assign(enqueuePayload, quantityFields)
  }

  // dedup_key لازم أن يعرّف *الحركة* لا *الكمية*، وإلا صار كل تعديل لاحق
  // على نفس الـquant duplicate مُسقَط. لذلك نضيف وقت آخر كتابة:
  //   - نفس الحركة مُعادة ⇒ نفس write_date ⇒ duplicate (لا عمل مكرر)
  //   - حركة جديدة ⇒ write_date مختلف ⇒ تُعالَج (ولا تُدمج مع غيرها)
  // أما الدمج (coalescing) فيتولّاه sync_queue على مستوى الـquant، فيصل
  // آخر رصيد إلى Odoo مرة واحدة بدل كل حركة على حدة.
  const eventVersion = writeDate
    ? String(writeDate)
    : fingerprintPayload(enqueuePayload)
  const dedupKey = `odoo:stock:${workspaceId}:${productId ?? 'na'}:${locationId ?? 'na'}:${quantId ?? 'na'}:${eventVersion}`

  // storeId is set to workspace_id so events coalesce per workspace+product.
  let queued: Awaited<ReturnType<typeof enqueueWebhookEvent>> | null = null
  try {
    queued = await enqueueWebhookEvent({
      workspaceId,
      storeId: workspaceId,
      event: 'odoo.stock.quant.update',
      platform: 'odoo',
      payload: enqueuePayload,
      dedupKey,
    })
  } catch (err) {
    console.error('[Odoo Stock Webhook] Enqueue threw:', err)
    return NextResponse.json(
      { error: 'Failed to persist webhook', detail: 'enqueue_threw' },
      { status: 503 }
    )
  }

  // فشل التخزين الدائم → 503 فيعيد Odoo الإرسال بدل فقدان حركة المخزون.
  if (queued?.error) {
    console.error('[Odoo Stock Webhook] durable enqueue failed:', queued.error)
    return NextResponse.json(
      { error: 'Failed to persist webhook', detail: queued.error },
      { status: 503 }
    )
  }

  // الحدث صار محفوظاً durably أعلاه — من هنا فصاعداً لا يجوز أن يفشل الطلب،
  // وإلا أعاد Odoo الإرسال وتكرر العمل.

  // تفريغ فوري للصف المُدرج، بلا انتظار Cron.
  //
  // على الاستضافة المشتركة تعتمد الأحداث كلياً على مجدول خارجي؛ فإن لم
  // يُنشأ ذلك الـcron، يبقى كل صف في الطابور إلى الأبد ولا يرى التاجر سوى
  // "لا شيء يحدث في زد". لذلك نجرّب دفعة واحدة فوراً. الكتابة الدائمة تمت
  // مسبقاً، فحتى لو قُتلت العملية بعد الرد (وهذا يحدث على PHP-FPM) يبقى
  // الصف محفوظاً ويلتقطه الـcron. تنفيذ عابر: الرد لا ينتظر أودو/زد.
  void runSyncQueueOnce(1).catch(err => {
    console.error('[Odoo Stock Webhook] inline drain failed:', err)
  })

  return NextResponse.json(
    { success: true, queued: true, message: 'Stock webhook received and queued for sync.' },
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