/**
 * Odoo → Zid Stock Sync Engine
 *
 * Real-time inventory sync from Odoo to Zid (per linked location pair).
 *
 * Direction: Odoo is the source of truth for stock when the "مزامنة المخزون"
 * checkbox is enabled in the Products tab (mapping-center). Purchases, sales,
 * inventory adjustments and production in Odoo all write `stock.quant`, an Odoo
 * Automated Action notifies our webhook route, which enqueues into sync_queue,
 * and this module reads the current balance from Odoo and updates the matching
 * Zid product at the paired Zid location.
 *
 * `processOdooStockEvent` is invoked from the sync-queue runner for
 * platform='odoo' items. It returns { ok:true } for skips (feature disabled,
 * product not linked …) and throws on transient failures so the queue retries.
 */
import { createClient } from '@supabase/supabase-js'

import { decrypt } from './crypto'
import { getInventorySyncSettings } from './inventory-sync-settings'
import { OdooClient } from './odoo-client'
import { getAccessToken } from './zid/token'
import { ZidAPI, type ZidCredentials } from './zid-client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface ProcessResult {
  ok: boolean
  skipped?: boolean
  transferred?: number
}

/**
 * نتيجة الدفع لمنتج واحد.
 *   pushed  — الرصيد وصل زد.
 *   skipped — لا يوجد ما يُفعل (المنتج غير مربوط بمنتج زد، أو مخزونه غير
 *             محدود في زد). هذه حالة دائمة لا تحلها إعادة المحاولة، فحسابها
 *            فشلاً كان يحرق خمس محاولات ثم يذهب الصف إلى صندوق الموتى.
 *   failed  — خطأ عابر (شبكة/مصادقة/حدRate) ⇒ يستحق إعادة المحاولة.
 */
type PushOutcome = 'pushed' | 'skipped' | 'failed'

function toInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  // Odoo m2o values arrive as [id, display_name]
  if (Array.isArray(v)) return toInt(v[0])
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

/**
 * رسالة خطأ مفيدة. axios يبتلع جسم الاستجابة في `message` ويكتفي بـ
 * "Request failed with status code 400" — وهو لا يقول شيئاً عن سبب رفض زد.
 * هنا نُخرج تفاصيل Zid (رسائل التحقق) لأن تشخيص 400 بدونها مستحيل.
 */
function describeError(err: unknown): string {
  const e = err as {
    message?: string
    response?: { status?: number; data?: unknown }
  }
  const parts: string[] = []
  if (e?.response?.status) parts.push(`HTTP ${e.response.status}`)

  const data = e?.response?.data
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    const detail =
      d.detail ?? d.error_description ?? d.error ?? d.message ?? d.errors ?? d.non_field_errors
    if (detail !== undefined && detail !== null) {
      parts.push(typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300))
    } else {
      parts.push(JSON.stringify(d).slice(0, 300))
    }
  } else if (typeof data === 'string' && data.trim()) {
    parts.push(data.slice(0, 300))
  }

  if (parts.length === 0) parts.push(String(e?.message ?? err))
  return parts.join(' — ').slice(0, 400)
}

export async function processOdooStockEvent(payload: Record<string, unknown>): Promise<ProcessResult> {
  const workspaceId = String(payload.workspace_id || '')
  if (!workspaceId) return { ok: true, skipped: true }

  const settings = await getInventorySyncSettings(workspaceId)
  if (!settings.sync_enabled) {
    console.info('[StockSync] Odoo stock event ignored — inventory sync is disabled.')
    return { ok: true, skipped: true }
  }

  // 1. Odoo connection
  const { data: erpConn } = await supabaseAdmin
    .from('erp_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!erpConn) {
    console.warn('[StockSync] No ERP connection for workspace', workspaceId)
    return { ok: true, skipped: true }
  }
  const client = new OdooClient({
    url: erpConn.url,
    db: erpConn.db_name || '',
    username: erpConn.username,
    apiKey: decrypt(erpConn.password),
  })

  // 2. Zid token (stock is pushed to the Zid store only)
  const { data: zidTok } = await supabaseAdmin
    .from('merchant_tokens')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!zidTok) {
    console.warn('[StockSync] No Zid token for workspace', workspaceId)
    return { ok: true, skipped: true }
  }
  const tokenData = await getAccessToken(zidTok.merchant_id)
  const zidCreds: ZidCredentials = {
    authorization: tokenData.authorization || '',
    managerToken: tokenData.accessToken,
    storeId: zidTok.store_id || undefined,
  }

  // 3. Location pairing (Zid location ↔ Odoo stock.location)
  const { data: whRows } = await supabaseAdmin
    .from('warehouse_mappings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'zid')
  const pairByOdooLoc = new Map<number, string>()
  for (const row of whRows || []) {
    const odooLoc = toInt(row.odoo_location_id)
    const zidLoc = String(row.source_location_id || '')
    if (odooLoc && zidLoc) pairByOdooLoc.set(odooLoc, zidLoc)
  }
  if (pairByOdooLoc.size === 0) {
    console.info('[StockSync] No warehouse location pairs configured for workspace', workspaceId)
    return { ok: true, skipped: true }
  }

  // 4. Identify the affected Odoo product + location
  let odooProductId = toInt(payload.product_id)
  let odooLocationId = toInt(payload.location_id)
  const quantId = toInt(payload.quant_id)

  const quantFields: Array<[number, number]> = []
  if (odooProductId && odooLocationId) {
    quantFields.push([odooProductId, odooLocationId])
  } else {
    // Resolve from the quant itself
    try {
      const qid = quantId || (await findQuantForProduct(client, odooProductId)) || null
      if (qid) {
        const q = await readQuant(client, qid)
        if (q) {
          odooProductId = q.product_id
          odooLocationId = q.location_id
          quantFields.push([q.product_id, q.location_id])
        }
      }
    } catch (err: any) {
      console.warn('[StockSync] Failed to resolve quant record:', err?.message ?? err)
    }
  }

  if (!odooProductId || !odooLocationId) {
    console.info('[StockSync] No product/location to sync for workspace', workspaceId)
    return { ok: true, skipped: true }
  }

  // Only sync locations the user paired via the mapping-center UI
  const filtered = quantFields.filter(([pid, loc]) => {
    const zidLoc = pairByOdooLoc.get(Number(loc))
    return Boolean(zidLoc) && pid
  })
  if (filtered.length === 0) {
    const zidLocOnly = pairByOdooLoc.get(odooLocationId)
    if (!zidLocOnly) {
      console.info(`[StockSync] Location #${odooLocationId} is not paired — skipping.`)
      return { ok: true, skipped: true }
    }
    filtered.push([odooProductId, odooLocationId])
  }

  // 5. Read balances and push
  let transferred = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const [pid, loc] of filtered) {
    const zidLocId = pairByOdooLoc.get(Number(loc))!
    try {
      const qty = await readOdooQtyAtLocation(client, Number(pid), Number(loc), settings.sync_mode)
      const outcome = await pushStockToZid({
        client,
        creds: zidCreds,
        zidLocationId: zidLocId,
        odooProductId: Number(pid),
        odooConnection: erpConn,
        quantity: qty,
      })
      if (outcome === 'pushed') transferred++
      else if (outcome === 'skipped') skipped++
      else failed++
    } catch (err: any) {
      failed++
      errors.push(`product#${pid}: ${describeError(err)}`)
    }
  }

  await logStockTransfer({
    workspaceId,
    direction: 'odoo_to_zid',
    transferred,
    failed,
    errors,
    payload: {
      mode: settings.sync_mode,
      products: filtered.map(([pid, loc]) => ({ product_id: pid, location_id: loc })),
      quant_id: quantId || null,
    },
  })

  // Telegram notification for stock sync
  try {
    let sku = String(payload.default_code || payload.sku || '')
    let name = String(payload.product_name || payload.name || '')
    if ((!sku || !name) && odooProductId) {
      try {
        const prods = await client.execute<Array<{ default_code?: string; name?: string }>>(
          'product.product',
          'read',
          [[odooProductId]],
          { fields: ['default_code', 'name'] }
        )
        if (prods?.[0]) {
          sku = sku || prods[0].default_code || ''
          name = name || prods[0].name || ''
        }
      } catch { /* best effort */ }
    }

    const { notifySyncResult } = await import('@/lib/telegram-notifier')
    await notifySyncResult({
      workspaceId,
      record: {
        status: failed > 0 ? (transferred > 0 ? 'success' : 'failed') : transferred > 0 ? 'success' : 'skipped',
        event: 'stock.updated',
        mappingName: 'تحديث المخزون (أودوو ⬅️ زد)',
        mappingId: 'stock_sync_odoo_zid',
        model: 'stock.quant',
        odooRecordId: odooProductId,
        storeName: zidTok.name || 'Zid Store',
        storeId: zidTok.store_id || undefined,
        errorMessage: errors.length > 0 ? errors.join(', ') : null,
        details: {
          productSku: sku || undefined,
          productName: name || undefined,
          stockQuantity: transferred,
        }
      }
    }).catch(() => {})
  } catch {
    // best-effort
  }

  // Skips لا تُعدّ فشلاً: لا تعالجها إعادة المحاولة. نعيد ok طالما نجحت
  // محاولة واحدة على الأقل، وإلا نُبلّغ العميل بالسبب الحقيقي.
  if (failed > 0 && transferred === 0 && skipped === 0) {
    throw new Error(
      `[StockSync] All stock updates failed: ${errors.length ? errors.join(' ; ') : 'no reason recorded'}`
    )
  }
  return { ok: true, transferred }
}

// ─── Odoo quant helpers ───────────────────────────────────────────────────────

async function findQuantForProduct(
  client: OdooClient,
  productId: number | null
): Promise<number | null> {
  if (!productId) return null
  const ids = await client.search('stock.quant', [['product_id', '=', productId]], 1)
  return ids?.[0] ?? null
}

interface QuantRecord {
  product_id: number
  location_id: number
  quantity: number
  inventory_quantity: number
  incoming: number
  outgoing: number
}

const odooFieldCache = new Map<string, boolean>()

async function odooModelHasField(client: OdooClient, model: string, field: string): Promise<boolean> {
  const version = await client.getMajorVersion().catch(() => 0)
  const key = `${version}:${model}.${field}`
  if (odooFieldCache.has(key)) return odooFieldCache.get(key)!
  try {
    const rows = await client.searchRead<any>(
      'ir.model.fields',
      [['model', '=', model], ['name', '=', field]],
      ['id'],
      1
    )
    odooFieldCache.set(key, rows.length > 0)
  } catch {
    odooFieldCache.set(key, false)
  }
  return odooFieldCache.get(key)!
}

async function readQuant(client: OdooClient, quantId: number): Promise<QuantRecord | null> {
  const forecastFields =
    (await odooModelHasField(client, 'stock.quant', 'incoming')) &&
    (await odooModelHasField(client, 'stock.quant', 'outgoing'))
      ? ['incoming', 'outgoing']
      : []
  const fieldSets = [
    ['id', 'product_id', 'location_id', 'quantity', 'reserved_quantity', 'inventory_quantity', ...forecastFields],
    ['id', 'product_id', 'location_id', 'quantity'],
  ]
  let rows: any[] | null = null
  for (const fields of fieldSets) {
    try {
      rows = await client.read<any>('stock.quant', [quantId], fields)
      if (rows?.length) break
    } catch {
      rows = null
    }
  }
  const q = rows?.[0]
  if (!q) return null
  return {
    product_id: toInt(q.product_id) || 0,
    location_id: toInt(q.location_id) || 0,
    quantity: Number(q.quantity ?? q.inventory_quantity ?? 0) || 0,
    inventory_quantity: Number(q.inventory_quantity ?? q.quantity ?? 0) || 0,
    incoming: Number(q.incoming ?? 0) || 0,
    outgoing: Number(q.outgoing ?? 0) || 0,
  }
}

/**
 * Read the current balance for a product at a given Odoo location.
 *   actual  → stock.quant.quantity (on-hand counted balance)
 *   forecast→ quantity + incoming - outgoing (matched with Odoo "Forecasted")
 */
async function readOdooQtyAtLocation(
  client: OdooClient,
  productId: number,
  locationId: number,
  mode: 'actual' | 'forecast'
): Promise<number> {
  const quantIds = await client.search(
    'stock.quant',
    [
      ['product_id', '=', productId],
      ['location_id', '=', locationId],
    ],
    1
  )
  if (!quantIds || quantIds.length === 0) {
    // No quant at that location → zero balance
    return 0
  }
  const q = await readQuant(client, quantIds[0])
  if (!q) return 0
  if (mode === 'forecast') {
    const forecasted = q.quantity + q.incoming - q.outgoing
    return Math.max(0, Math.round(forecasted * 100) / 100)
  }
  return Math.max(0, Math.round(q.quantity * 100) / 100)
}

// ─── Zid stock push ───────────────────────────────────────────────────────────

async function readOdooProductMatchValues(
  client: OdooClient,
  productId: number,
  matchOdooField: string
): Promise<Record<string, any>> {
  const fields = ['id', 'default_code', 'barcode']
  if (matchOdooField && !fields.includes(matchOdooField)) fields.push(matchOdooField)
  for (const f of ['x_zid_id', 'zid_id']) {
    if (await odooModelHasField(client, 'product.product', f)) fields.push(f)
  }
  try {
    const rows = await client.read<any>('product.product', [productId], fields)
    if (rows?.length) return rows[0]
  } catch {
  }
  try {
    const rows = await client.read<any>('product.product', [productId], ['id', 'default_code', 'barcode'])
    if (rows?.length) return rows[0]
  } catch {
  }
  return {}
}

async function findZidProductByMatch(
  creds: ZidCredentials,
  matchField: string,
  value: string
): Promise<Record<string, any> | null> {
  if (!value) return null
  if (matchField === 'barcode') {
    const res = await ZidAPI.products.list(creds, { page_size: 100, barcode: value })
    const items = Array.isArray(res.data?.results) ? res.data.results : []
    return items.find((p: any) => String(p.barcode || '').trim() === value) || null
  }
  let page = 1
  for (let i = 0; i < 10; i++) {
    const res = await ZidAPI.products.list(creds, { page_size: 100, page })
    const items = Array.isArray(res.data?.results) ? res.data.results : []
    const bySku = items.find((p: any) => String(p.sku || '').trim() === value)
    if (bySku) return bySku
    const byBarcode = items.find((p: any) => String(p.barcode || '').trim() === value)
    if (byBarcode) return byBarcode
    const byName = items.find((p: any) => {
      const name = typeof p.name === 'string' ? p.name : p.name?.en || p.name?.ar || ''
      return String(name || '').trim() === value
    })
    if (byName) return byName
    const count = res.data?.count ?? items.length
    if (items.length === 0 || page * items.length >= count) break
    page++
  }
  return null
}

async function resolveZidProductId(
  creds: ZidCredentials,
  workspaceId: string,
  odooProductId: number,
  matchOdooField: string,
  matchZidField: string,
  odooValues: Record<string, any>
): Promise<Record<string, any> | null> {
  try {
    const { data: log } = await supabaseAdmin
      .from('sync_logs')
      .select('zid_entity_id')
      .eq('odoo_record_id', odooProductId)
      .in('odoo_model', ['product.product', 'product.template'])
      .eq('workspace_id', workspaceId)
      .eq('status', 'success')
      .not('zid_entity_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (log?.zid_entity_id) {
      try {
        const res = await ZidAPI.products.get(creds, String(log.zid_entity_id))
        const product = (res.data as any)?.product
        if (product?.id) {
          console.info(`[StockSync] Resolved Zid product from sync_logs (Odoo #${odooProductId} → Zid #${product.id})`)
          return product
        }
      } catch {
      }
    }
  } catch {
  }
  const matchValue = String(
    odooValues.x_zid_id ?? odooValues.zid_id ?? odooValues[matchOdooField] ?? odooValues.default_code ?? odooValues.barcode ?? ''
  ).trim()
  if (!matchValue) return null
  if (matchZidField === 'id') {
    try {
      const res = await ZidAPI.products.get(creds, matchValue)
      const product = (res.data as any)?.product
      if (product?.id) return product
    } catch {
    }
    const skuValue = String(odooValues.default_code ?? odooValues.barcode ?? '').trim()
    return skuValue ? findZidProductByMatch(creds, 'sku', skuValue) : null
  }
  const found = await findZidProductByMatch(creds, matchZidField, matchValue)
  if (found) {
    console.info(`[StockSync] Matched Zid product by ${matchZidField} (Odoo #${odooProductId} → Zid #${String(found.id)})`)
  }
  return found
}

/**
 * Update a Zid product stock at the paired Zid location with `quantity`.
 * Uses POST /v1/locations/{location_id}/stock-update/ (absolute value,
 * creates/updates the stock record for that location).
 */
async function pushStockToZid(params: {
  client: OdooClient
  creds: ZidCredentials
  zidLocationId: string
  odooProductId: number
  odooConnection: any
  quantity: number
}): Promise<PushOutcome> {
  const { client, creds, zidLocationId, odooProductId, odooConnection, quantity } = params

  const std = await loadZidProductMatchField(odooConnection.workspace_id)
  const matchZidField = std.match_zid_field || 'sku'
  const matchOdooField = std.match_odoo_field || (matchZidField === 'id' ? 'x_zid_id' : 'default_code')

  const odooValues = await readOdooProductMatchValues(client, odooProductId, matchOdooField)
  const zidProduct = await resolveZidProductId(
    creds,
    odooConnection.workspace_id,
    odooProductId,
    matchOdooField,
    matchZidField,
    odooValues
  )
  if (!zidProduct) {
    const shown =
      odooValues[matchOdooField] ?? odooValues.x_zid_id ?? odooValues.zid_id ?? odooValues.default_code ?? odooValues.barcode ?? '-'
    console.info(`[StockSync] Zid product not found for Odoo #${odooProductId} (${matchZidField}=${String(shown)}) — skipped.`)
    return 'skipped'
  }
  if (zidProduct.is_infinite) {
    console.info(`[StockSync] Zid product #${zidProduct.id} is infinite — skipped.`)
    return 'skipped'
  }

  const zidProductId = String(zidProduct.id)
  await ZidAPI.locations.stockUpdate(creds, zidLocationId, [
    {
      product_id: zidProductId,
      available_quantity: Math.round(quantity),
      is_infinite: false,
    },
  ])
  console.info(`[StockSync] ✅ Updated Zid product #${zidProductId} @ location ${zidLocationId} → ${quantity}`)
  return 'pushed'
}

async function loadZidProductMatchField(workspaceId: string): Promise<{ match_odoo_field: string; match_zid_field: string }> {
  try {
    const { data } = await supabaseAdmin
      .from('standard_mapping_settings')
      .select('settings')
      .eq('workspace_id', workspaceId)
      .eq('store_type', 'zid')
      .eq('entity_type', 'products')
      .maybeSingle()
    const s = (data?.settings as any) || {}
    return {
      match_odoo_field: String(s.match_odoo_field || ''),
      match_zid_field: String(s.match_zid_field || 'sku'),
    }
  } catch {
    return { match_odoo_field: '', match_zid_field: 'sku' }
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

async function logStockTransfer(params: {
  workspaceId: string
  direction: string
  transferred: number
  failed: number
  errors: string[]
  payload: any
}) {
  try {
    await supabaseAdmin.from('data_transfers').insert([
      {
        workspace_id: params.workspaceId,
        name: `Stock Sync — Odoo → Zid`,
        data_type: 'stock',
        direction: params.direction,
        status: params.failed > 0 && params.transferred === 0 ? 'failed' : 'completed',
        records_fetched: params.transferred + params.failed,
        records_created: params.transferred,
        records_failed: params.failed,
        failure_reason: params.errors.length > 0 ? params.errors.slice(0, 5).join('; ') : null,
        mappings: params.payload,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
  } catch (err) {
    console.error('[StockSync] Failed to record transfer log:', err)
  }
}