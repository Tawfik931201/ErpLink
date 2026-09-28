import { type NextRequest, NextResponse } from 'next/server'

import { decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { createSallaProduct, findSallaProductByMatchField, updateSallaProduct } from '@/lib/salla-client'
import { createShopifyProduct, findShopifyProductByMatchField, isValidShopDomain, updateShopifyProduct } from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

const supabaseAdmin = supabase

/**
 * نتيجة تنفيذ مزامنة واحدة.
 *
 * `ok: false` تعني «لم ينجح» → يجب إعادة الجدولة (حتى 5 محاولات ثم صندوق
 * الموتى). `ok: true` مع `skipped: true` تعني «قرار مقصود» (إعداد معطّل،
 * اتجاه غير مفعّل، سجل محذوف) → يُحذف الصف ولا يُعاد.
 *
 * سابقاً كانت الدالة ترجع `undefined` في كل الحالات، وكان الطابور يعتبر
 * ذلك «نجاحاً» ويحذف الصف — أي فقدان صامت لطلبات عند تعطّل Odoo.
 */
type SyncOutcome = { ok: true; skipped?: boolean; message?: string } | { ok: false; message: string }

const SKIP = (message: string): SyncOutcome => ({ ok: true, skipped: true, message })
const FAIL = (message: string): SyncOutcome => ({ ok: false, message })
const DONE = (message = 'done'): SyncOutcome => ({ ok: true, message })

export async function POST(req: NextRequest) {
  const odooSecret = process.env.ODOO_WEBHOOK_SECRET
  if (odooSecret) {
    const authHeader = req.headers.get('authorization') || ''
    const bearerToken = authHeader.replace(/^Bearer\s+/i, '').trim()
    const headerSecret = req.headers.get('x-odoo-secret') || ''
    const querySecret = req.nextUrl.searchParams.get('secret') || req.nextUrl.searchParams.get('token') || ''
    const provided = bearerToken || headerSecret || querySecret
    if (!provided || provided !== odooSecret) {
      return NextResponse.json({ error: 'Unauthorized: Invalid or missing Odoo webhook secret' }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[Odoo Webhook] Security Alert: ODOO_WEBHOOK_SECRET is not configured in production.')
    return NextResponse.json({ error: 'Webhook secret not configured on server' }, { status: 500 })
  }

  let rawText = ''
  let payload: any = {}
  try {
    rawText = await req.text()
    if (rawText) {
      payload = JSON.parse(rawText)
    }
  } catch (err: any) {
    console.warn('[Odoo Webhook] Raw body read/parse failed:', err.message)
  }

  // Support both array payloads (Odoo native webhook read()) and object payloads
  const actualPayload = Array.isArray(payload) ? (payload[0] || {}) : payload

  // Extract parameters (support both native webhooks and manual python webhook payloads)
  const field_mapping_id = req.nextUrl.searchParams.get('field_mapping_id') || payload.field_mapping_id || actualPayload.field_mapping_id

  if (!field_mapping_id) {
    console.warn('[Odoo Webhook] Missing field_mapping_id query parameter or body key')
    return NextResponse.json({ error: 'Missing field_mapping_id' }, { status: 400 })
  }

  // 1. Fetch FieldMapping to resolve odoo_model if not passed in request
  const { data: mapping, error: mappingErr } = await supabase
    .from('field_mappings')
    .select('*')
    .eq('id', field_mapping_id)
    .maybeSingle()

  if (mappingErr || !mapping) {
    console.warn('[Odoo Webhook] Field mapping not found:', field_mapping_id)
    return NextResponse.json({ error: 'Field mapping not found' }, { status: 404 })
  }

  const model = payload._model || payload.model || payload._name || actualPayload._model || actualPayload._name || actualPayload.model || mapping.odoo_model
  // Odoo native webhook uses _id for the record identifier
  const odooRecordId = payload._id || payload.id || payload.odooRecordId || actualPayload._id || actualPayload.id || actualPayload.odooRecordId

  if (!model || !odooRecordId) {
    console.warn('[Odoo Webhook] Missing model or record ID:', { model, odooRecordId })
    return NextResponse.json({ error: 'Missing model or record ID' }, { status: 400 })
  }

  const workspaceId = mapping.workspace_id
  if (!workspaceId) {
    return NextResponse.json({ error: 'Field mapping has no workspace' }, { status: 400 })
  }

  // Enqueue to central sync_queue for Zero Data Loss, retries, and rate-limit control
  //
  // ⚠️ dedup_key هنا لازم أن يعرّف *الحدث* لا *السجل*. Odoo لا يرسل معرّف
  // تسليم (الـAutomated Action يرسل السجل فقط)، فنستخدم:
  //   1) write_date إن موجود (Odoo يضبطه عند كل كتابة ⇒ يتغيّر مع كل تعديل)
  //   2) وإلا بصمة المحتوى.
  // النتيجة: إعادة إرسال نفس الحدث ⇒ duplicate (لا عمل مكرر)، بينما أي
  // تعديل حقيقي لاحق على نفس السجل ⇒ مفتاح مختلف ⇒ يُعالَج ولا يُسقَط.
  const enqueuePayload: Record<string, unknown> = {
    field_mapping_id,
    model,
    odooRecordId: Number(odooRecordId),
    payloadData: actualPayload,
  }
  const writeDate = actualPayload.write_date ?? actualPayload.__last_update ?? null
  if (writeDate) enqueuePayload.updated_at = String(writeDate)

  const { enqueueWebhookEvent, fingerprintPayload } = await import('@/lib/sync-queue')
  const eventVersion = writeDate
    ? String(writeDate)
    : fingerprintPayload({ model, odooRecordId, data: actualPayload })
  const dedupKey = `odoo:${field_mapping_id}:${model}:${odooRecordId}:${eventVersion}`

  const queued = await enqueueWebhookEvent({
    workspaceId,
    storeId: mapping.store_id ? String(mapping.store_id) : workspaceId,
    event: 'odoo.model.sync',
    platform: 'odoo',
    payload: enqueuePayload,
    dedupKey,
  })

  // فشل التخزين الدائم → 503 حتى يعيد Odoo الإرسال. الحدث محفوظ في
  // webhook_inbox على أي حال، لكن الرد غير 2xx هو خط الدفاع الثاني.
  if (queued.error) {
    console.error('[Odoo Webhook] durable enqueue failed:', queued.error)
    return NextResponse.json(
      { error: 'Failed to persist webhook', detail: queued.error },
      { status: 503 }
    )
  }

  // 202 Accepted: بعدCommit للتخزين الدائم، فالمعالجة في الخلفية آمنة.
  return NextResponse.json(
    { success: true, queued: true, duplicate: queued.duplicate ?? false, message: 'Webhook received and queued for sync.' },
    { status: 202 }
  )
}

/**
 * Background synchronization routine.
 * Accepts the payload received from Odoo directly so we can skip a redundant Odoo read()
 * when the webhook body already contains the updated field values.
 */
export async function runBackgroundSync(field_mapping_id: string, model: string, odooRecordId: number, payloadData?: Record<string, any>): Promise<SyncOutcome> {
  console.info(`[Odoo Webhook Bg] Starting sync for mapping=${field_mapping_id}, model=${model}, recordId=${odooRecordId}`)

  // 1. Fetch FieldMapping
  const { data: mapping, error: mappingErr } = await supabaseAdmin
    .from('field_mappings')
    .select('*')
    .eq('id', field_mapping_id)
    .maybeSingle()

  if (mappingErr || !mapping) {
    console.warn('[Odoo Webhook Bg] Field mapping not found:', field_mapping_id)
    return FAIL(`field mapping ${field_mapping_id} not found`)
  }

  // Check sync direction
  const syncDirection = mapping.sync_direction || 'store_to_erp'
  const hasErpToStore = syncDirection.split(',').map((s: string) => s.trim()).includes('erp_to_store')
  if (!hasErpToStore) {
    console.warn(`[Odoo Webhook Bg] Mapping "${mapping.name}" does not support ERP to Store sync direction. Skipping.`)
    return SKIP('mapping does not include erp_to_store direction')
  }

  // 2. Fetch Odoo Connection
  const { data: odooConn, error: connErr } = await supabaseAdmin
    .from('erp_connections')
    .select('*')
    .eq('id', mapping.erp_connection_id)
    .maybeSingle()

  if (connErr || !odooConn) {
    console.warn('[Odoo Webhook Bg] Odoo connection not found')
    return FAIL('Odoo connection not found for this mapping')
  }

  if (odooConn.erp_type && odooConn.erp_type !== 'odoo') {
    console.warn(`[Odoo Webhook Bg] Webhook sync for non-Odoo ERP (${odooConn.erp_type}) is not supported yet.`)
    return SKIP(`non-odoo erp type: ${odooConn.erp_type}`)
  }

  // Determine fields to fetch
  const modelMappings = mapping.mappings?.[model] || []
  if (modelMappings.length === 0) {
    console.info(`[Odoo Webhook Bg] No mappings defined for model "${model}". Skipping.`)
    return SKIP(`no field mappings for model ${model}`)
  }

  let matchField = mapping.odoo_match_field
  let odooRecord: Record<string, any>

  // 3. Use the payload data if already received, otherwise fetch from Odoo via XML-RPC
  // Check if payloadData contains actual Odoo field values (not just meta keys)
  const metaKeys = new Set(['field_mapping_id', 'model', 'odooRecordId', '_model', '_name', '_id', 'id', 'odoo_model', 'erp_connection_id'])
  const hasActualFields = payloadData && Object.keys(payloadData).some(k => !metaKeys.has(k))
  if (hasActualFields) {
    odooRecord = payloadData
  } else {
    // Fallback: Connect to Odoo and fetch the record fields
    const decryptedPassword = decrypt(odooConn.password)
    const odooClient = new OdooClient({
      url: odooConn.url,
      db: odooConn.db_name || '',
      username: odooConn.username,
      apiKey: decryptedPassword,
    })

    const erpFields = modelMappings.map((m: any) => m.erpField)
    if (matchField && !erpFields.includes(matchField)) erpFields.push(matchField)

    console.info(`[Odoo Webhook Bg] Reading record ID=${odooRecordId} for fields:`, erpFields)
    const odooRecords = await odooClient.read<any>(model, [odooRecordId], erpFields)
    if (!odooRecords || odooRecords.length === 0) {
      console.warn(`[Odoo Webhook Bg] Record ID=${odooRecordId} not found in Odoo`)
      return SKIP(`Odoo record ${model}#${odooRecordId} no longer exists`)
    }
    odooRecord = odooRecords[0]
  }

  // 4. Determine platform from event naming convention
  const platform: 'zid' | 'salla' | 'shopify' = (() => {
    const action = mapping.action
    // Shopify events use "/" syntax (products/create, orders/create) or "shopify:" prefix
    if (action.includes('/') || action.startsWith('shopify:')) return 'shopify'
    // Salla events use dot notation with past-tense suffixes: product.created, order.cancelled
    if (
      action.startsWith('product.') ||
      action.startsWith('order.') ||
      action.startsWith('customer.') ||
      action.startsWith('category.') ||
      action.startsWith('store.branch.') ||
      action.startsWith('store.settings.') ||
      action.startsWith('abandoned.cart') ||
      action.startsWith('coupon.') ||
      action.startsWith('brand.') ||
      action.startsWith('special.offer.') ||
      action.startsWith('app.')
    ) return 'salla'
    // Zid events use dot notation with present-tense: product.create, order.update
    return 'zid'
  })()

  // ——— Read product standard mapping settings (applies to Odoo → Zid too) ———
  // standard_mapping_settings (store_type=zid, entity_type=products) is the source
  // of truth for match fields / enabled_actions / on_delete / disabled — apply it
  // to the ERP → store direction just like sync-engine applies it for store → ERP.
  let stdProductSettings: Record<string, any> | null = null
  if (platform === 'zid' && (model === 'product.template' || model === 'product.product')) {
    const { data: stdRow } = await supabaseAdmin
      .from('standard_mapping_settings')
      .select('settings')
      .eq('workspace_id', mapping.workspace_id)
      .eq('store_type', 'zid')
      .eq('entity_type', 'products')
      .maybeSingle()
    if (stdRow?.settings) stdProductSettings = stdRow.settings as Record<string, any>
    if (stdProductSettings?.match_odoo_field) matchField = stdProductSettings.match_odoo_field
  }

  // Match reference value
  let matchValue = String(odooRecord[matchField] || '').trim()

  // ——— Odoo product variants enrichment (best-effort) ———
  // Multi-option Odoo templates often have an empty default_code / zero price
  // while their variants carry the real SKU / barcode / price. When the webhook
  // payload includes product_variant_ids, fall back to the first variant so the
  // product can still be matched & created in the store.
  const variantIds: number[] =
    model === 'product.template' && Array.isArray(odooRecord.product_variant_ids)
      ? odooRecord.product_variant_ids
          .map((v: any) => (Array.isArray(v) ? v[0] : v))
          .filter((id: any) => typeof id === 'number' && id > 0)
      : []

  const needsVariantEnrichment =
    variantIds.length > 0 &&
    (!matchValue || !odooRecord.list_price || Number(odooRecord.list_price) === 0)

  if (needsVariantEnrichment) {
    try {
      const richClient = new OdooClient({
        url: odooConn.url,
        db: odooConn.db_name || '',
        username: odooConn.username,
        apiKey: decrypt(odooConn.password),
      })
      const variants = await richClient.read<any>('product.product', [variantIds[0]], ['default_code', 'barcode', 'list_price'])
      const firstVariant = variants?.[0]
      if (firstVariant) {
        const varSku = String(firstVariant.default_code || '').trim()
        const varBarcode = String(firstVariant.barcode || '').trim()
        if (varSku && !String(odooRecord.default_code || '').trim()) odooRecord.default_code = varSku
        if (varBarcode && !String(odooRecord.barcode || '').trim()) odooRecord.barcode = varBarcode
        if (!matchValue) matchValue = varSku || varBarcode || matchValue
        if ((!odooRecord.list_price || Number(odooRecord.list_price) === 0) && Number(firstVariant.list_price) > 0) {
          odooRecord.list_price = firstVariant.list_price
        }
        console.info(`[Odoo Webhook Bg] Enriched template from first variant #${variantIds[0]} (sku=${varSku || '-'}, barcode=${varBarcode || '-'})`)
      }
    } catch (err: any) {
      console.warn('[Odoo Webhook Bg] Variant enrichment failed (non-fatal):', err?.message ?? err)
    }
  }

  if (!matchValue) {
    console.warn(`[Odoo Webhook Bg] Match field "${matchField}" is empty on Odoo record. Cannot sync.`)
    return SKIP(`match field ${matchField} is empty — cannot identify the store record`)
  }

  // Detect removal intent (product archived/deleted in Odoo)
  const removalRequested = hasRemovalSignal(payloadData, odooRecord, model)

  // 5. Push to target platform
  if (platform === 'shopify') {
    // ── Shopify (ERP → store; يحتاج write_products عند التفعيل) ─────────────
    const shopDomain = mapping.merchant_id
    // منتج محذوف/مؤرشف في أودو = لا نعيد إنشاءه في المتجر (حذف Shopify غير مطبَّق بعد)
    if (removalRequested) {
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(shopDomain || ''),
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'skipped',
        error_message: 'Odoo product removal → Shopify delete is not implemented yet',
        payload: { operation: 'delete', platform: 'shopify', skipped: true }
      })
      return SKIP('Shopify product delete is not implemented yet')
    }
    // early-return خفيف: نطاق غير صالح = لا مكالمات Shopify عبثاً (429/فشل)
    if (!shopDomain || !isValidShopDomain(String(shopDomain))) {
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(shopDomain || ''),
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'failed',
        error_message: 'Invalid Shopify shop domain',
        payload: { operation: 'skip', reason: 'invalid_shop_domain' }
      })
      return FAIL(`invalid Shopify shop domain: ${shopDomain}`)
    }
    const shopifyProduct = await findShopifyProductByMatchField(
      shopDomain,
      (mapping.zid_match_field || 'sku') as 'sku' | 'barcode' | 'id',
      matchValue
    )

    if (!shopifyProduct) {
      // Create new product in Shopify
      const createData: Record<string, any> = {
        title: String(odooRecord.name || `Product ${matchValue}`),
      }
      for (const line of modelMappings) {
        const odooVal = odooRecord[line.erpField]
        const field = line.zidField
        if (field === 'body_html') createData.body_html = String(odooVal)
        else if (field === 'variants.0.price') createData.variants = [{ price: Number(odooVal) }]
        else if (field === 'variants.0.sku') {
          if (!createData.variants) createData.variants = [{}]
          createData.variants[0].sku = odooVal
        }
        else if (field === 'variants.0.barcode') {
          if (!createData.variants) createData.variants = [{}]
          createData.variants[0].barcode = odooVal
        }
        else if (field === 'variants.0.weight') {
          if (!createData.variants) createData.variants = [{}]
          createData.variants[0].weight = Number(odooVal)
        }
      }
      // Ensure match field is present in create payload
      if (mapping.zid_match_field === 'sku' && createData.variants?.[0]) createData.variants[0].sku = matchValue
      if (mapping.zid_match_field === 'barcode' && createData.variants?.[0]) createData.variants[0].barcode = matchValue

      try {
        const res = await createShopifyProduct(shopDomain, createData)
        const newId = res.product?.id
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: shopDomain,
          zid_entity_id: String(newId || ''),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'success',
          payload: { operation: 'create', createData }
        })
      } catch (err: any) {
        const errMsg = err.response?.data?.errors || err.message || 'Failed to create product in Shopify'
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: shopDomain,
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'failed',
          error_message: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
          payload: { operation: 'create', createData, error: errMsg }
        })
        return FAIL(`Shopify create failed: ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`)
      }
      return DONE('Shopify product created')
    }

    // Update existing Shopify product (match specific variant by SKU/barcode instead of always [0])
    const matchedVariant =
      (shopifyProduct.variants || []).find((v: any) => {
        if (mapping.zid_match_field === 'barcode' && v.barcode && matchValue) {
          return String(v.barcode).trim() === String(matchValue).trim()
        }
        if (v.sku && matchValue) {
          return String(v.sku).trim() === String(matchValue).trim()
        }
        return false
      }) || shopifyProduct.variants?.[0]

    const targetVariantId = matchedVariant?.id

    const updateData: Record<string, any> = {}
    const variantPayload: Record<string, any> = targetVariantId ? { id: targetVariantId } : {}
    let hasVariantUpdates = false

    for (const line of modelMappings) {
      const odooVal = odooRecord[line.erpField]
      const field = line.zidField
      if (field === 'title') updateData.title = String(odooVal)
      else if (field === 'body_html') updateData.body_html = String(odooVal)
      else if (field === 'variants.0.price' || field === 'price') {
        variantPayload.price = Number(odooVal)
        hasVariantUpdates = true
      }
      else if (field === 'variants.0.sku' || field === 'sku') {
        variantPayload.sku = odooVal
        hasVariantUpdates = true
      }
      else if (field === 'variants.0.barcode' || field === 'barcode') {
        variantPayload.barcode = odooVal
        hasVariantUpdates = true
      }
      else if (field === 'variants.0.weight' || field === 'weight') {
        variantPayload.weight = Number(odooVal)
        hasVariantUpdates = true
      }
    }

    if (hasVariantUpdates && targetVariantId) {
      updateData.variants = [variantPayload]
    }

    try {
      await updateShopifyProduct(shopDomain, shopifyProduct.id, updateData)
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: shopDomain,
        zid_entity_id: shopifyProduct.id,
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'success',
        payload: { operation: 'update', updateData }
      })
    } catch (err: any) {
      const errMsg = err.response?.data?.errors || err.message || 'Failed to update product in Shopify'
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: shopDomain,
        zid_entity_id: shopifyProduct.id,
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'failed',
        error_message: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
        payload: { operation: 'update', updateData, error: errMsg }
      })
      return FAIL(`Shopify update failed: ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`)
    }
    return DONE('Shopify product updated')

  } else if (platform === 'salla') {
    // ── Salla ─────────────────────────────────────────────────────────────────
    console.info(`[Odoo Webhook Bg] Syncing to Salla (merchant=${mapping.merchant_id})...`)

    // منتج محذوف/مؤرشف في أودو = لا نعيد إنشاءه في المتجر (حذف Salla غير مطبَّق بعد)
    if (removalRequested) {
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'skipped',
        error_message: 'Odoo product removal → Salla delete is not implemented yet',
        payload: { operation: 'delete', platform: 'salla', skipped: true }
      })
      return SKIP('Salla product delete is not implemented yet')
    }

    const sallaProduct = await findSallaProductByMatchField(
      mapping.merchant_id,
      mapping.zid_match_field || 'sku',
      matchValue
    )

    if (!sallaProduct) {
      // Create new product in Salla
      const createData: Record<string, any> = {
        name: String(odooRecord.name || `Product ${matchValue}`),
        price: { amount: 0, currency: 'SAR' },
      }
      for (const line of modelMappings) {
        const odooVal = odooRecord[line.erpField]
        if (line.zidField === 'name') createData.name = odooVal
        else if (line.zidField === 'price') createData.price = { amount: Number(odooVal), currency: 'SAR' }
        else if (line.zidField === 'sku') createData.sku = odooVal
        else if (line.zidField === 'barcode') createData.barcode = odooVal
        else createData[line.zidField] = odooVal
      }
      // Ensure match field is present
      if (mapping.zid_match_field === 'sku' && !createData.sku) createData.sku = matchValue
      if (mapping.zid_match_field === 'barcode' && !createData.barcode) createData.barcode = matchValue

      try {
        const res = await createSallaProduct(mapping.merchant_id, createData)
        const newId = res?.data?.id || res?.data?.data?.id
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          zid_entity_id: String(newId || ''),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'success',
          payload: { operation: 'create', createData }
        })
      } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Failed to create product in Salla'
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'failed',
          error_message: errMsg,
          payload: { operation: 'create', createData, error: err.response?.data || err.message }
        })
        return FAIL(`Salla create failed: ${errMsg}`)
      }
      return DONE('Salla product created')
    }

    // Update existing Salla product
    const updateData: Record<string, any> = {}
    for (const line of modelMappings) {
      const odooVal = odooRecord[line.erpField]
      if (line.zidField === 'name') updateData.name = odooVal
      else if (line.zidField === 'price') updateData.price = Number(odooVal)
      else if (line.zidField === 'sku') updateData.sku = odooVal
      else if (line.zidField === 'barcode') updateData.barcode = odooVal
      else updateData[line.zidField] = odooVal
    }

    try {
      await updateSallaProduct(mapping.merchant_id, sallaProduct.id, updateData)
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        zid_entity_id: sallaProduct.id,
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'success',
        payload: { operation: 'update', updateData }
      })
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Failed to update product in Salla'
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        zid_entity_id: sallaProduct.id,
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'failed',
        error_message: errMsg,
        payload: { operation: 'update', updateData, error: err.response?.data || err.message }
      })
      return FAIL(`Salla update failed: ${errMsg}`)
    }
    return DONE('Salla product updated')

  } else {
    // ── Zid ───────────────────────────────────────────────────────────────────
    console.info(`[Odoo Webhook Bg] Syncing to Zid (merchant=${mapping.merchant_id})...`)

    const tokenData = await getAccessToken(mapping.merchant_id)
    const zidCreds = {
      authorization: tokenData.authorization || '',
      managerToken: tokenData.accessToken,
      storeId: mapping.store_id || undefined,
    }

    const matchFieldZid = stdProductSettings?.match_zid_field || mapping.zid_match_field || 'sku'
    const enabledActions: string[] = stdProductSettings?.enabled_actions || ['create', 'update']
    console.info(`[Odoo Webhook Bg] Searching Zid product by ${matchFieldZid}...`)

    // احترام إعداد "تعطيل مزامنة المنتجات" من إعدادات الاستندر ماب
    if (stdProductSettings?.disabled === true) {
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'skipped',
        error_message: 'Product sync is disabled via standard mapping settings',
        payload: { operation: 'disable', skipped: true }
      })
      return SKIP('product sync disabled via standard mapping settings')
    }

    let zidProductId: string | null = null

    if (matchFieldZid === 'id') {
      zidProductId = matchValue
    } else {
      const searchParams: Record<string, any> = { page_size: 1 }
      if (matchFieldZid === 'sku') searchParams.sku = matchValue
      else if (matchFieldZid === 'barcode') searchParams.barcode = matchValue
      else searchParams.search = matchValue

      const listRes = await ZidAPI.products.list(zidCreds, searchParams)
      const products = listRes.data?.results || []

      const match = products.find((p: any) => {
        if (matchFieldZid === 'sku') return String(p.sku || '').trim() === matchValue
        if (matchFieldZid === 'barcode') return String(p.barcode || '').trim() === matchValue
        return false
      })
      if (match) zidProductId = match.id

      // Fallback: match by product name when SKU/barcode lookup found nothing
      if (!zidProductId && (matchFieldZid === 'sku' || matchFieldZid === 'barcode')) {
        const odooName = String(odooRecord.name || '').trim()
        if (odooName) {
          try {
            const nameRes = await ZidAPI.products.list(zidCreds, { page_size: 1, search: odooName })
            const byName = (nameRes.data?.results || []).find((p: any) => {
              const pName = typeof p.name === 'object'
                ? String(p.name?.ar || p.name?.en || '')
                : String(p.name || '')
              return pName.trim().toLowerCase() === odooName.toLowerCase()
            })
            if (byName) zidProductId = byName.id
          } catch {
            console.warn('[Odoo Webhook Bg] Name fallback search failed (best-effort).')
          }
        }
      }
    }

    if (removalRequested) {
      // behavior يتبع إعداد on_delete من إعدادات الاستندر ماب:
      //   nothing           → لا نفعل شيئاً
      //   archive (الافتراضي)→ إخفاء المنتج من المتجر (is_draft = true)
      //   delete / delete_or_archive → حذف فعلي من زد
      const onDeleteMode = stdProductSettings
        ? (stdProductSettings.on_delete || (enabledActions.includes('delete') ? 'delete_or_archive' : 'nothing'))
        : 'delete_or_archive'

      if (onDeleteMode === 'nothing') {
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'skipped',
          error_message: 'Odoo product removal skipped (on_delete = nothing in standard mapping settings)',
          payload: { operation: 'delete', skipped: true, mode: onDeleteMode }
        })
        return SKIP(`on_delete = nothing in standard mapping settings`)
      }

      if (!zidProductId) {
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'success',
          payload: { operation: 'delete', zid_product_id: null, result: 'not_found_or_already_deleted', mode: onDeleteMode }
        })
        return DONE('product already absent in Zid')
      }

      if (onDeleteMode === 'archive') {
        // يُخفى المنتج من المتجر (زد ليس لديه أرشفة فعلية — is_draft يُخفي المنتج)
        try {
          await ZidAPI.products.update(zidCreds, zidProductId, { is_draft: true })
          await logOdooToZidSync({
            workspace_id: mapping.workspace_id || '',
            field_mapping_id: mapping.id,
            event: mapping.action,
            store_id: String(mapping.store_id || mapping.merchant_id),
            zid_entity_id: String(zidProductId),
            odoo_model: model,
            odoo_record_id: odooRecordId,
            status: 'success',
            payload: { operation: 'archive', zid_product_id: zidProductId, mode: onDeleteMode }
          })
        } catch (err: any) {
          const errMsg = err.response?.data?.message || err.message || 'Failed to unpublish product in Zid'
          await logOdooToZidSync({
            workspace_id: mapping.workspace_id || '',
            field_mapping_id: mapping.id,
            event: mapping.action,
            store_id: String(mapping.store_id || mapping.merchant_id),
            zid_entity_id: String(zidProductId),
            odoo_model: model,
            odoo_record_id: odooRecordId,
            status: 'failed',
            error_message: errMsg,
            payload: { operation: 'archive', zid_product_id: zidProductId, error: err.response?.data || err.message }
          })
          return FAIL(`Zid archive (unpublish) failed: ${errMsg}`)
        }
        return DONE('Zid product unpublished')
      }

      // delete / delete_or_archive → حذف فعلي من زد
      try {
        await ZidAPI.products.delete(zidCreds, zidProductId)
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          zid_entity_id: String(zidProductId),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'success',
          payload: { operation: 'delete', zid_product_id: zidProductId, mode: onDeleteMode }
        })
      } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Failed to delete product in Zid'
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          zid_entity_id: String(zidProductId),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'failed',
          error_message: errMsg,
          payload: { operation: 'delete', zid_product_id: zidProductId, error: err.response?.data || err.message }
        })
        return FAIL(`Zid delete failed: ${errMsg}`)
      }
      return DONE('Zid product deleted')
    }

    // احترام enabled_actions من إعدادات الاستندر ماب (create / update)
    if (!zidProductId && !enabledActions.includes('create')) {
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'skipped',
        error_message: 'Product create is not enabled in standard mapping settings',
        payload: { operation: 'create', skipped: true }
      })
      return SKIP('product create not enabled in standard mapping settings')
    }
    if (zidProductId && !enabledActions.includes('update')) {
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'skipped',
        error_message: 'Product update is not enabled in standard mapping settings',
        payload: { operation: 'update', skipped: true }
      })
      return SKIP('product update not enabled in standard mapping settings')
    }

    if (!zidProductId) {
      // Create new product in Zid
      const createData: Record<string, any> = {
        product_class: 'standalone',
        is_draft: false,
      }
      for (const line of modelMappings) {
        const odooVal = odooRecord[line.erpField]
        if (line.zidField === 'name') createData.name = { ar: String(odooVal), en: String(odooVal) }
        else if (line.zidField === 'price') {
          const stdMarkup = Number(stdProductSettings?.price?.markup_percent || 0)
          const rawPrice = Number(odooVal)
          createData.price = stdMarkup !== 0 ? rawPrice * (1 + stdMarkup / 100) : rawPrice
        }
        else createData[line.zidField] = odooVal
      }
      if (matchFieldZid && !createData[matchFieldZid]) {
        if (matchFieldZid === 'name') createData.name = { ar: matchValue, en: matchValue }
        else createData[matchFieldZid] = matchValue
      }
      if (!createData.name) createData.name = { ar: 'Product ' + matchValue, en: 'Product ' + matchValue }
      if (createData.price === undefined) createData.price = 0

      // Best-effort: ربط تصنيف أودو → تصنيف زد (إن وُجد)
      const odooCateg = odooRecord.categ_id ?? odooRecord.categ_name
      if (odooCateg !== undefined && odooCateg !== null) {
        const zidCategoryId = await resolveZidCategoryId(zidCreds, odooConn, odooCateg)
        if (zidCategoryId) createData.category_id = zidCategoryId
      }

      try {
        let createRes
        try {
          createRes = await ZidAPI.products.create(zidCreds, createData)
        } catch (createErr: any) {
          // لو رفض زد حقل category_id نعيد المحاولة بدونه حتى لا يفشل الإنشاء بسبب التصنيف
          if (createData.category_id) {
            delete createData.category_id
            createRes = await ZidAPI.products.create(zidCreds, createData)
          } else {
            throw createErr
          }
        }
        const newZidId = createRes.data?.product?.id || createRes.data?.id
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          zid_entity_id: String(newZidId || ''),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'success',
          payload: { operation: 'create', createData }
        })
      } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Failed to create product in Zid'
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'failed',
          error_message: errMsg,
          payload: { operation: 'create', createData, error: err.response?.data || err.message }
        })
        return FAIL(`Zid create failed: ${errMsg}`)
      }
      return DONE('Zid product created')
    }

    // Update existing product in Zid
    const updateData: Record<string, any> = {}
    for (const line of modelMappings) {
      const odooVal = odooRecord[line.erpField]
      if (line.zidField === 'name') updateData.name = { ar: String(odooVal), en: String(odooVal) }
      else if (line.zidField === 'price') {
        const stdMarkup = Number(stdProductSettings?.price?.markup_percent || 0)
        const rawPrice = Number(odooVal)
        updateData.price = stdMarkup !== 0 ? rawPrice * (1 + stdMarkup / 100) : rawPrice
      }
      else if (line.zidField === 'sku') updateData.sku = odooVal
      else if (line.zidField === 'barcode') updateData.barcode = odooVal
      else updateData[line.zidField] = odooVal
    }

    try {
      await ZidAPI.products.update(zidCreds, zidProductId, updateData)
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        zid_entity_id: zidProductId,
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'success',
        payload: { operation: 'update', updateData }
      })
    } catch (err: any) {
      const errMsg = err.response?.data?.message || err.message || 'Failed to update product in Zid'
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        zid_entity_id: zidProductId,
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'failed',
        error_message: errMsg,
        payload: { operation: 'update', updateData, error: err.response?.data || err.message }
      })
      return FAIL(`Zid update failed: ${errMsg}`)
    }
    return DONE('Zid product updated')
  }
}

/**
 * Log helper for Odoo -> Store sync operations.
 */
async function logOdooToZidSync(params: {
  workspace_id: string
  field_mapping_id: string
  event: string
  store_id: string
  zid_entity_id?: string
  odoo_model: string
  odoo_record_id: number
  status: 'success' | 'failed' | 'skipped'
  error_message?: string
  payload: any
}) {
  try {
    const logData = {
      workspace_id: params.workspace_id,
      field_mapping_id: params.field_mapping_id,
      event: params.event,
      store_id: params.store_id,
      zid_entity_id: params.zid_entity_id || null,
      odoo_model: params.odoo_model,
      odoo_record_id: params.odoo_record_id,
      status: params.status,
      error_message: params.error_message || null,
      payload: params.payload,
      trigger_type: 'automatic',
      created_at: new Date().toISOString(),
    }
    await supabaseAdmin.from('sync_logs').insert([logData])
    console.info(`[Odoo Webhook Bg] Log entry created with status=${params.status}`)
  } catch (err) {
    console.error('[Odoo Webhook Bg] Failed to write sync log:', err)
  }
}

/**
 * Resolve an Odoo product category (categ_id) to a Zid category id (best-effort).
 * Finds an existing Zid category by name, or creates it when missing.
 * Never throws — returns null on any failure so product sync continues.
 */
async function resolveZidCategoryId(
  zidCreds: { authorization: string; managerToken: string; storeId?: string },
  odooConn: any,
  categValue: any
): Promise<string | number | null> {
  try {
    let categId: number | null = null
    let categName = ''
    if (Array.isArray(categValue)) {
      categId = Number(categValue[0]) || null
      categName = String(categValue[1] || '').trim()
    } else {
      const n = Number(categValue)
      if (Number.isFinite(n) && n > 0) categId = n
      else return null
    }
    if (!categId) return null

    // Get the category name from Odoo when the payload only carried the id
    if (!categName && odooConn) {
      try {
        const catClient = new OdooClient({
          url: odooConn.url,
          db: odooConn.db_name || '',
          username: odooConn.username,
          apiKey: decrypt(odooConn.password),
        })
        const rows = await catClient.read<any>('product.category', [categId], ['name'])
        categName = String(rows?.[0]?.name || '').trim()
      } catch (err: any) {
        console.warn('[Odoo Webhook Bg] Failed to read Odoo category name (non-fatal):', err?.message ?? err)
      }
    }
    if (!categName) return null

    // Find existing Zid category by name, else create it
    const listRes = await ZidAPI.categories.list(zidCreds)
    const cats = Array.isArray(listRes?.data?.results)
      ? listRes.data.results
      : Array.isArray(listRes?.data?.categories)
        ? listRes.data.categories
        : (Array.isArray(listRes?.data) ? listRes.data : [])
    const target = categName.toLowerCase()
    const existing = cats.find((c: any) => String(c?.name ?? c?.name_ar ?? '').trim().toLowerCase() === target)
    if (existing) return existing.id

    const created = await ZidAPI.categories.create(zidCreds, { name: categName })
    return created?.data?.category?.id ?? created?.data?.id ?? null
  } catch (err: any) {
    console.warn('[Odoo Webhook Bg] Category resolve failed (non-fatal):', err?.message ?? err)
    return null
  }
}

/**
 * Detect whether an Odoo product record signals removal (deleted or archived).
 * Supports both the webhook payload and the read() record.
 */
function hasRemovalSignal(
  payloadData: Record<string, any> | undefined,
  record: Record<string, any>,
  model: string
): boolean {
  if (model !== 'product.template' && model !== 'product.product') return false

  const metaKeys = new Set(['field_mapping_id', 'model', 'odooRecordId', '_model', '_name', '_id', 'id', 'odoo_model', 'erp_connection_id'])
  const hasActualFields = payloadData && Object.keys(payloadData).some(k => !metaKeys.has(k))
  const src = hasActualFields ? payloadData : record

  if (src.active !== undefined && (src.active === false || src.active === 'false' || src.active === 0 || src.active === '0')) {
    return true
  }

  for (const key of ['is_deleted', 'deleted', 'is_archived']) {
    const val = src[key]
    if (val === true || val === 'true' || val === 1 || val === '1') return true
  }

  if (src.deleted_at !== undefined && src.deleted_at !== null) {
    const s = String(src.deleted_at).trim()
    if (s !== '' && s !== 'false') return true
  }

  return false
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Odoo Webhook Receiver is ready.' })
}
