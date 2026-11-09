/**
 * Odoo → Store Stock Sync Engine (Zid + Salla)
 *
 * Real-time inventory sync from Odoo to the linked store (per paired
 * Odoo location ↔ store location/branch).
 *
 * Direction: Odoo is the source of truth for stock when the "مزامنة المخزون"
 * checkbox is enabled in the Products tab (mapping-center). Purchases, sales,
 * inventory adjustments and production in Odoo all write `stock.quant`, an Odoo
 * Automated Action notifies our webhook route, which enqueues into sync_queue,
 * and this module reads the current balance from Odoo and updates the matching
 * product in each enabled store (Zid, Salla).
 *
 * The engine keeps the Zid path exactly as it was when only Zid existed: for a
 * Zid-only workspace, `runZidArm` reproduces the original flow verbatim (same
 * skip messages, same log/telegram/throw behavior). Salla runs as a second,
 * independent arm with the same pairing model, matched against `x_salla_id` /
 * `salla_id` / sku / barcode / name and pushed via Salla's bulk quantities API.
 *
 * `processOdooStockEvent` is invoked from the sync-queue runner for
 * platform='odoo' items. It returns { ok:true } for skips (feature disabled,
 * product not linked …) and throws on transient failures so the queue retries.
 */
import { createClient } from '@supabase/supabase-js'

import { decrypt } from './crypto'
import { connectionGeneration, getErpExecutionScope } from './erp-execution-target'
import { getInventorySyncSettings, isInventorySyncActive, type InventorySyncSettings } from './inventory-sync-settings'
import { getEffectiveStandardMappingSettings } from './mapping-settings'
import { OdooClient } from './odoo-client'
import { findSallaProductByMatchField, SALLA_DEFAULT_BRANCH_ID, updateSallaStockBulk } from './salla-client'
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
 *   pushed  — الرصيد وصل المتجر.
 *   skipped — لا يوجد ما يُفعل (المنتج غير مربوط بمنتج المتجر، أو مخزونه
 *             غير محدود في المتجر). هذه حالة دائمة لا تحلها إعادة المحاولة،
 *             فحسابها فشلاً كان يحرق خمس محاولات ثم يذهب الصف إلى صندوق الموتى.
 *   failed  — خطأ عابر (شبكة/مصادقة/حدRate) ⇒ يستحق إعادة المحاولة.
 */
type PushOutcome = 'pushed' | 'skipped' | 'failed'

/** Result of one store arm that did real work. */
interface ArmResult {
  worked: boolean
  transferred: number
  skipped: number
  failed: number
  errors: string[]
}

function toInt(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  // Odoo m2o values arrive as [id, display_name]
  if (Array.isArray(v)) return toInt(v[0])
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

/**
 * رسالة خطأ مفيدة. axios يبتلع جسم الاستجابة في `message` ويكتفي بـ
 * "Request failed with status code 400" — وهو لا يقول شيئاً عن سبب رفض
 * المتجر. هنا نُخرج تفاصيل الاستجابة (رسائل التحقق) لأن تشخيص 400 بدونها
 * مستحيل.
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
  const executionScope = getErpExecutionScope()
  if (executionScope && executionScope.workspaceId !== workspaceId) throw new Error('Stock ERP execution workspace mismatch')
  if (!workspaceId) return { ok: true, skipped: true }

  // Load per-platform dispatch gates — a platform runs when its default OR
  // any linked store enabled the push. Each store then runs with its own
  // effective settings inside the arms below.
  const [zidEnabled, sallaEnabled] = await Promise.all([
    isInventorySyncActive(workspaceId, 'zid'),
    isInventorySyncActive(workspaceId, 'salla'),
  ])
  if (!zidEnabled && !sallaEnabled) {
    console.info('[StockSync] Odoo stock event ignored — inventory sync is disabled.')
    return { ok: true, skipped: true }
  }

  // 1. Odoo connection (shared — Odoo is the single source of truth)
  const { data: erpConn } = await supabaseAdmin
    .from('erp_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!erpConn) {
    console.warn('[StockSync] No ERP connection for workspace', workspaceId)
    return { ok: true, skipped: true }
  }
  if (executionScope && (executionScope.erpConnectionId !== erpConn.id || connectionGeneration(erpConn) !== executionScope.connectionGeneration)) throw new Error('Stock ERP execution target changed; controlled recovery required')
  const client = new OdooClient({
    url: erpConn.url,
    db: erpConn.db_name || '',
    username: erpConn.username,
    apiKey: decrypt(erpConn.password),
  })

  // 2. Dispatch each enabled store arm. Each arm fans out per linked store
  // (each with its own effective settings) and logs its own transfer row,
  // so every enabled store gets full bookkeeping.
  const results: ArmResult[] = []
  if (zidEnabled) {
    const res = await runZidArm({ workspaceId, client, erpConn, settings: await getInventorySyncSettings(workspaceId, 'zid'), payload })
    if (res) results.push(res)
  }
  if (sallaEnabled) {
    const res = await runSallaArm({ workspaceId, client, settings: await getInventorySyncSettings(workspaceId, 'salla'), payload })
    if (res) results.push(res)
  }

  // Skips لا تُعدّ فشلاً: لا تعالجها إعادة المحاولة. نعيد ok طالما نجحت
  // محاولة واحدة على الأقل، وإلا نُبلّغ العميل بالسبب الحقيقي.
  const worked = results.filter((r) => r.worked)
  const allFailed = worked.filter((r) => r.failed > 0 && r.transferred === 0 && r.skipped === 0)
  if (allFailed.length > 0) {
    const reasons = allFailed.map((r) => (r.errors.length ? r.errors.join(' ; ') : '')).filter(Boolean)
    throw new Error(
      `[StockSync] All stock updates failed: ${reasons.length ? reasons.join(' ; ') : 'no reason recorded'}`
    )
  }
  if (worked.length === 0) {
    return { ok: true, skipped: true }
  }
  return { ok: true, transferred: worked.reduce((sum, r) => sum + r.transferred, 0) }
}

/** Merge per-store arm results (multi-store fan-out) into one. */
function mergeArmResults(results: (ArmResult | null)[], tag: (i: number) => string): ArmResult | null {
  const done = results.filter((r): r is ArmResult => !!r && r.worked)
  if (done.length === 0) return null
  return {
    worked: true,
    transferred: done.reduce((s, r) => s + r.transferred, 0),
    skipped: done.reduce((s, r) => s + r.skipped, 0),
    failed: done.reduce((s, r) => s + r.failed, 0),
    errors: done.flatMap((r, i) => r.errors.map(e => `${tag(i)} ${e}`)),
  }
}

// ─── Zid arm (preserved verbatim from the pre-Salla engine) ──────────────────

async function runZidArm(args: {
  workspaceId: string
  client: OdooClient
  erpConn: any
  settings: InventorySyncSettings
  payload: Record<string, unknown>
  /** Multi-store fan-out: when set, push to this store only. */
  storeTok?: any
}): Promise<ArmResult | null> {
  const { workspaceId, client, erpConn, settings, payload } = args

  // Multi-store: push the same stock event to EVERY linked Zid store, each
  // with full bookkeeping (the body below logs per store). Pairs in
  // warehouse_mappings are platform-level; a pair pointing at a location id
  // the store does not know simply fails that push visibly in the log.
  if (!args.storeTok) {
    const { data: toks } = await supabaseAdmin
      .from('merchant_tokens')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false, nullsFirst: false })
    if (!toks || toks.length === 0) {
      console.warn('[StockSync] No Zid token for workspace', workspaceId)
      return null
    }
    const perStore: (ArmResult | null)[] = []
    for (const t of toks) {
      // Each store runs with its own effective settings (store row, else the
      // platform default) — a store that turned its push off is skipped.
      const s = await getInventorySyncSettings(workspaceId, 'zid', String((t as any).merchant_id))
      if (!s.sync_enabled) {
        console.info(`[StockSync] Inventory push disabled for Zid store ${(t as any).merchant_id} — skipping.`)
        continue
      }
      perStore.push(await runZidArm({ ...args, settings: s, storeTok: t }))
    }
    return mergeArmResults(perStore, i => `[store ${(toks[i] as any)?.merchant_id}]`)
  }

  // 2. Zid token (stock is pushed to this Zid store)
  const zidTok = args.storeTok
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
    return null
  }

  // 4. Identify the affected Odoo product + location
  const target = await identifyStockTarget(client, payload)
  if (!target) {
    console.info('[StockSync] No product/location to sync for workspace', workspaceId)
    return null
  }
  const { odooProductId, odooLocationId, quantId, quantFields } = target

  // Only sync locations the user paired via the mapping-center UI
  const filtered = quantFields.filter(([pid, loc]) => {
    const zidLoc = pairByOdooLoc.get(Number(loc))
    return Boolean(zidLoc) && pid
  })
  if (filtered.length === 0) {
    const zidLocOnly = pairByOdooLoc.get(odooLocationId)
    if (!zidLocOnly) {
      console.info(`[StockSync] Location #${odooLocationId} is not paired — skipping.`)
      return null
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
        storeId: String(zidTok.merchant_id ?? ''),
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
    name: `Stock Sync — Odoo → Zid`,
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

  return { worked: true, transferred, skipped, failed, errors }
}

// ─── Salla arm ───────────────────────────────────────────────────────────────

async function runSallaArm(args: {
  workspaceId: string
  client: OdooClient
  settings: InventorySyncSettings
  payload: Record<string, unknown>
  /** Multi-store fan-out: when set, push to this store only. */
  storeTok?: any
}): Promise<ArmResult | null> {
  const { workspaceId, client, settings, payload } = args

  // Multi-store: same fan-out as runZidArm — every linked Salla store gets
  // the push with its own bookkeeping.
  if (!args.storeTok) {
    const { data: toks } = await supabaseAdmin
      .from('salla_tokens')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false, nullsFirst: false })
    if (!toks || toks.length === 0) {
      console.warn('[StockSync] No Salla token for workspace', workspaceId)
      return null
    }
    const perStore: (ArmResult | null)[] = []
    for (const t of toks) {
      const s = await getInventorySyncSettings(workspaceId, 'salla', String((t as any).merchant_id))
      if (!s.sync_enabled) {
        console.info(`[StockSync] Inventory push disabled for Salla store ${(t as any).merchant_id} — skipping.`)
        continue
      }
      perStore.push(await runSallaArm({ ...args, settings: s, storeTok: t }))
    }
    return mergeArmResults(perStore, i => `[store ${(toks[i] as any)?.merchant_id}]`)
  }

  // 1. Salla token + merchant id (stock is pushed to this Salla store)
  const sallaTok = args.storeTok
  if (!sallaTok?.merchant_id) {
    console.warn('[StockSync] No Salla token for workspace', workspaceId)
    return null
  }
  const merchantId = String(sallaTok.merchant_id)

  // 2. Location pairing (Salla branch ↔ Odoo stock.location). A mapping whose
  // source_location_id is SALLA_DEFAULT_BRANCH_ID means "Salla default branch"
  // (the engine then omits `branch` from the bulk call).
  const { data: whRows } = await supabaseAdmin
    .from('warehouse_mappings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('platform', 'salla')
  const pairByOdooLoc = new Map<number, string>()
  for (const row of whRows || []) {
    const odooLoc = toInt(row.odoo_location_id)
    const sallaLoc = String(row.source_location_id || '')
    if (odooLoc && sallaLoc) pairByOdooLoc.set(odooLoc, sallaLoc)
  }
  if (pairByOdooLoc.size === 0) {
    console.info('[StockSync] No warehouse location pairs configured for workspace (salla)', workspaceId)
    return null
  }

  // 3. Identify the affected Odoo product + location
  const target = await identifyStockTarget(client, payload)
  if (!target) {
    console.info('[StockSync] No product/location to sync for workspace (salla)', workspaceId)
    return null
  }
  const { odooProductId, odooLocationId, quantId, quantFields } = target

  // Only sync locations the user paired via the mapping-center UI
  const filtered = quantFields.filter(([pid, loc]) => {
    const sallaLoc = pairByOdooLoc.get(Number(loc))
    return Boolean(sallaLoc) && pid
  })
  if (filtered.length === 0) {
    const sallaLocOnly = pairByOdooLoc.get(odooLocationId)
    if (!sallaLocOnly) {
      console.info(`[StockSync] Location #${odooLocationId} is not paired (salla) — skipping.`)
      return null
    }
    filtered.push([odooProductId, odooLocationId])
  }

  const matchSettings = await loadSallaProductMatchField(workspaceId, merchantId)
  const matchSallaField = matchSettings.match_salla_field || 'sku'
  const matchOdooField = matchSettings.match_odoo_field || (matchSallaField === 'id' ? 'x_salla_id' : 'default_code')

  // 4. Read balances and push
  let transferred = 0
  let skipped = 0
  let failed = 0
  const errors: string[] = []

  for (const [pid, loc] of filtered) {
    const sallaBranchId = pairByOdooLoc.get(Number(loc))!
    try {
      const qty = await readOdooQtyAtLocation(client, Number(pid), Number(loc), settings.sync_mode)
      const outcome = await pushStockToSalla({
        client,
        merchantId,
        workspaceId,
        sallaBranchId,
        odooProductId: Number(pid),
        quantity: qty,
        matchSallaField,
        matchOdooField,
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
    name: `Stock Sync — Odoo → Salla`,
    direction: 'odoo_to_salla',
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
        mappingName: 'تحديث المخزون (أودوو ⬅️ سلة)',
        mappingId: 'stock_sync_odoo_salla',
        model: 'stock.quant',
        odooRecordId: odooProductId,
        storeName: (sallaTok as any).store_name || 'Salla Store',
        storeId: merchantId,
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

  return { worked: true, transferred, skipped, failed, errors }
}

// ─── Odoo quant helpers ───────────────────────────────────────────────────────

/**
 * Identify the affected Odoo product + location from the webhook payload,
 * falling back to reading the `stock.quant` record itself when the payload
 * only carries a product id (or only a quant id).
 */
async function identifyStockTarget(
  client: OdooClient,
  payload: Record<string, unknown>
): Promise<null | { odooProductId: number; odooLocationId: number; quantId: number | null; quantFields: Array<[number, number]> }> {
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
    return null
  }
  return { odooProductId, odooLocationId, quantId, quantFields }
}

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

// ─── Store stock push ─────────────────────────────────────────────────────────

/**
 * Read the Odoo product's store-matching values (`default_code`, `barcode`,
 * plus the platform's own id column when present on the model). `idFields`
 * defaults to the Zid columns so the Zid path is unchanged.
 */
async function readOdooProductMatchValues(
  client: OdooClient,
  productId: number,
  matchOdooField: string,
  idFields: string[] = ['x_zid_id', 'zid_id']
): Promise<Record<string, any>> {
  const fields = ['id', 'default_code', 'barcode']
  if (matchOdooField && !fields.includes(matchOdooField)) fields.push(matchOdooField)
  for (const f of idFields) {
    if (!fields.includes(f) && (await odooModelHasField(client, 'product.product', f))) fields.push(f)
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

// ─── Zid stock push ───────────────────────────────────────────────────────────

/** A variant nested under a Zid parent (structure=child). Variant SKUs live
 * inside `parent.variants[]`, never as top-level list rows. */
function asVariantProduct(variant: any, parentId: string): Record<string, any> | null {
  if (!variant?.id) return null
  return {
    ...variant,
    parent_id: String(variant.parent_id || parentId),
    structure: variant.structure || 'child',
    is_infinite: variant.is_infinite ?? false,
  }
}

function findVariantByMatch(product: Record<string, any>, field: 'sku' | 'barcode', value: string): Record<string, any> | null {
  const variants = Array.isArray((product as any).variants) ? (product as any).variants : []
  for (const v of variants) {
    const candidate = field === 'sku' ? String((v as any)?.sku || '').trim() : String((v as any)?.barcode || '').trim()
    if (candidate && candidate === value) {
      const normalized = asVariantProduct(v, String(product.id))
      if (normalized) return normalized
    }
  }
  return null
}

async function findZidProductByMatch(
  creds: ZidCredentials,
  matchField: string,
  value: string
): Promise<Record<string, any> | null> {
  if (!value) return null
  // `extended: true` makes Zid include parent.variants[] in list results;
  // without it Odoo variant SKUs are invisible (they exist only nested).
  if (matchField === 'barcode') {
    const res = await ZidAPI.products.list(creds, { page_size: 100, barcode: value, extended: true })
    const items = Array.isArray(res.data?.results) ? res.data.results : []
    const direct = items.find((p: any) => String(p.barcode || '').trim() === value)
    if (direct) return direct
    for (const p of items) {
      const nested = findVariantByMatch(p as Record<string, any>, 'barcode', value)
      if (nested) return nested
    }
    return null
  }
  let page = 1
  for (let i = 0; i < 10; i++) {
    const res = await ZidAPI.products.list(creds, { page_size: 100, page, extended: true })
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
    // Variant SKU/barcode nested inside parent.variants[] — otherwise the
    // Odoo variant would silently match nothing and its stock never pushes.
    for (const p of items) {
      const nested = findVariantByMatch(p as Record<string, any>, 'sku', value)
        || findVariantByMatch(p as Record<string, any>, 'barcode', value)
      if (nested) return nested
    }
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
  storeId?: string
}): Promise<PushOutcome> {
  const { client, creds, zidLocationId, odooProductId, odooConnection, quantity, storeId = '' } = params

  const std = await loadZidProductMatchField(odooConnection.workspace_id, storeId)
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
  const parentId = (zidProduct as any).parent_id ? String((zidProduct as any).parent_id) : null
  const isChildVariant = (zidProduct as any).structure === 'child' || !!parentId
  const roundedQty = Math.round(quantity)

  if (isChildVariant && parentId) {
    // Variants are documented to carry their own stocks[] per location and are
    // written via the variants endpoint on the PARENT. The flat
    // locations/stock-update payload targets the parent record, which Zid
    // treats as stock-disabled while variants exist — so it never moves a
    // variant's quantity. Use the documented variants path instead.
    await ZidAPI.products.variants(creds, parentId, {
      variants: [
        {
          id: zidProductId,
          is_deleted: false,
          stocks: [
            {
              available_quantity: roundedQty,
              is_infinite: false,
              location: zidLocationId,
            },
          ],
        },
      ],
    })
    console.info(`[StockSync] ✅ Updated Zid variant #${zidProductId} (parent ${parentId}) @ location ${zidLocationId} → ${quantity}`)
    return 'pushed'
  }

  await ZidAPI.locations.stockUpdate(creds, zidLocationId, [
    {
      product_id: zidProductId,
      available_quantity: roundedQty,
      is_infinite: false,
    },
  ])
  console.info(`[StockSync] ✅ Updated Zid product #${zidProductId} @ location ${zidLocationId} → ${quantity}`)
  return 'pushed'
}

async function loadZidProductMatchField(workspaceId: string, storeId = ''): Promise<{ match_odoo_field: string; match_zid_field: string }> {
  try {
    // Delegated to the shared reader: per-store row first, platform default
    // ('') as fallback, store key resolved and compared as TEXT. The bare
    // maybeSingle() this replaces threw (PostgREST PGRST116) the moment a
    // per-store row existed, so the catch returned sku/default_code and the
    // configured match field was silently ignored.
    const s = (await getEffectiveStandardMappingSettings(supabaseAdmin, workspaceId, 'zid', 'products', storeId)) || {}
    return {
      match_odoo_field: String(s.match_odoo_field || ''),
      match_zid_field: String(s.match_zid_field || 'sku'),
    }
  } catch {
    return { match_odoo_field: '', match_zid_field: 'sku' }
  }
}

// ─── Salla stock push ─────────────────────────────────────────────────────────

/**
 * Resolve the Salla product that corresponds to an Odoo product (Salla-side,
 * so by the real Salla product id), in order:
 *   1. sync_logs — the last successful sync row for this Odoo record,
 *      scoped to THIS Salla store via `store_id = merchantId` (sync_logs has
 *      no platform column, so the store id is the only disambiguator in a
 *      workspace that also syncs Zid).
 *   2. Odoo-persisted id columns (`x_salla_id` / `salla_id`), then the
 *      configured match field, then default_code/barcode/name via
 *      `findSallaProductByMatchField`.
 */
async function resolveSallaProductId(
  merchantId: string,
  workspaceId: string,
  odooProductId: number,
  matchSallaField: string,
  matchOdooField: string,
  odooValues: Record<string, any>
): Promise<Record<string, any> | null> {
  try {
    const { data: log } = await supabaseAdmin
      .from('sync_logs')
      .select('zid_entity_id')
      .eq('odoo_record_id', odooProductId)
      .in('odoo_model', ['product.product', 'product.template'])
      .eq('workspace_id', workspaceId)
      .eq('store_id', merchantId)
      .eq('status', 'success')
      .not('zid_entity_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (log?.zid_entity_id) {
      const product = await findSallaProductByMatchField(merchantId, 'id', String(log.zid_entity_id))
      if (product?.id) {
        console.info(`[StockSync] Resolved Salla product from sync_logs (Odoo #${odooProductId} → Salla #${product.id})`)
        return product
      }
    }
  } catch {
  }
  const matchValue = String(
    odooValues.x_salla_id ?? odooValues.salla_id ?? odooValues[matchOdooField] ?? odooValues.default_code ?? odooValues.barcode ?? ''
  ).trim()
  if (!matchValue) return null
  if (matchSallaField === 'id') {
    const byId = await findSallaProductByMatchField(merchantId, 'id', matchValue)
    if (byId?.id) return byId
    const skuValue = String(odooValues.default_code ?? odooValues.barcode ?? '').trim()
    return skuValue ? findSallaProductByMatchField(merchantId, 'sku', skuValue) : null
  }
  const found = await findSallaProductByMatchField(merchantId, matchSallaField, matchValue)
  if (found) {
    console.info(`[StockSync] Matched Salla product by ${matchSallaField} (Odoo #${odooProductId} → Salla #${String(found.id)})`)
  }
  return found
}

/**
 * Update a Salla product's quantity at the paired Salla branch.
 * Uses POST /products/quantities/bulk with mode 'overwrite' (absolute value).
 * A branch id of SALLA_DEFAULT_BRANCH_ID omits `branch`, so Salla applies the
 * change to its default branch. Products marked `unlimited_quantity` are
 * skipped (mirrors the Zid `is_infinite` guard).
 */
async function pushStockToSalla(params: {
  client: OdooClient
  merchantId: string
  workspaceId: string
  sallaBranchId: string
  odooProductId: number
  quantity: number
  matchSallaField: string
  matchOdooField: string
}): Promise<PushOutcome> {
  const { client, merchantId, workspaceId, sallaBranchId, odooProductId, quantity, matchSallaField, matchOdooField } = params

  const odooValues = await readOdooProductMatchValues(client, odooProductId, matchOdooField, ['x_salla_id', 'salla_id'])
  const sallaProduct = await resolveSallaProductId(
    merchantId,
    workspaceId,
    odooProductId,
    matchSallaField,
    matchOdooField,
    odooValues
  )
  if (!sallaProduct) {
    const shown =
      odooValues[matchOdooField] ?? odooValues.x_salla_id ?? odooValues.salla_id ?? odooValues.default_code ?? odooValues.barcode ?? '-'
    console.info(`[StockSync] Salla product not found for Odoo #${odooProductId} (${matchSallaField}=${String(shown)}) — skipped.`)
    return 'skipped'
  }
  if (sallaProduct.unlimited_quantity === true) {
    console.info(`[StockSync] Salla product #${sallaProduct.id} has unlimited quantity — skipped.`)
    return 'skipped'
  }

  const sallaProductId = String(sallaProduct.id)
  const branch = sallaBranchId === SALLA_DEFAULT_BRANCH_ID ? undefined : sallaBranchId
  await updateSallaStockBulk(merchantId, [
    {
      identifer_type: 'id',
      identifer: sallaProductId,
      quantity: Math.round(quantity),
      mode: 'overwrite',
      branch,
    },
  ])
  console.info(`[StockSync] ✅ Updated Salla product #${sallaProductId}${branch ? ` @ branch ${branch}` : ' @ default branch'} → ${quantity}`)
  return 'pushed'
}

async function loadSallaProductMatchField(workspaceId: string, storeId = ''): Promise<{ match_odoo_field: string; match_salla_field: string }> {
  try {
    // Same shared reader as the Zid loader — one implementation of
    // per-store-first / default-fallback with a TEXT-compared store key.
    const s = (await getEffectiveStandardMappingSettings(supabaseAdmin, workspaceId, 'salla', 'products', storeId)) || {}
    return {
      match_odoo_field: String(s.match_odoo_field || ''),
      // Salla reuses the same generic settings key as Zid (the Odoo→Salla
      // product push in the odoo webhook route reads `mapping.zid_match_field`).
      match_salla_field: String(s.match_zid_field || 'sku'),
    }
  } catch {
    return { match_odoo_field: '', match_salla_field: 'sku' }
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

async function logStockTransfer(params: {
  workspaceId: string
  name: string
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
        name: params.name,
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
