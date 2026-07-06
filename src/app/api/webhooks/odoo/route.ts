import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { OdooClient } from '@/lib/odoo-client'
import { decrypt } from '@/lib/crypto'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'
import { findSallaProductByMatchField, updateSallaProduct } from '@/lib/salla-client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
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

  // Diagnostic Logs
  console.info('[Odoo Webhook Debug] Method:', req.method)
  console.info('[Odoo Webhook Debug] Headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2))
  console.info('[Odoo Webhook Debug] Query Params:', req.nextUrl.search)
  console.info('[Odoo Webhook Debug] Raw Body Text:', rawText)
  console.info('[Odoo Webhook] Received payload:', payload)

  // Support both array payloads (Odoo native webhook read()) and object payloads
  const actualPayload = Array.isArray(payload) ? (payload[0] || {}) : payload

  // Extract parameters (support both native webhooks and manual python webhook payloads)
  const field_mapping_id = req.nextUrl.searchParams.get('field_mapping_id') || payload.field_mapping_id || actualPayload.field_mapping_id

  if (!field_mapping_id) {
    console.warn('[Odoo Webhook] Missing field_mapping_id query parameter or body key')
    return NextResponse.json({ error: 'Missing field_mapping_id' }, { status: 400 })
  }

  // 1. Fetch FieldMapping to resolve odoo_model if not passed in request
  const { data: mapping, error: mappingErr } = await supabaseAdmin
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

  // Pass the actual payload fields directly to background sync to avoid a second Odoo API call
  // when Odoo already sent the field values in the webhook body
  runBackgroundSync(field_mapping_id, model, Number(odooRecordId), actualPayload).catch(err => {
    console.error('[Odoo Webhook Background] Final uncaught background sync error:', err)
  })

  // Return a 202 Accepted response immediately so Odoo connection closes cleanly
  return NextResponse.json({ success: true, message: 'Webhook received and processing started.' }, { status: 202 })
}

/**
 * Background synchronization routine.
 * Accepts the payload received from Odoo directly so we can skip a redundant Odoo read()
 * when the webhook body already contains the updated field values.
 */
async function runBackgroundSync(field_mapping_id: string, model: string, odooRecordId: number, payloadData?: Record<string, any>) {
  console.info(`[Odoo Webhook Bg] Starting sync for mapping=${field_mapping_id}, model=${model}, recordId=${odooRecordId}`)

  // 1. Fetch FieldMapping
  const { data: mapping, error: mappingErr } = await supabaseAdmin
    .from('field_mappings')
    .select('*')
    .eq('id', field_mapping_id)
    .maybeSingle()

  if (mappingErr || !mapping) {
    console.warn('[Odoo Webhook Bg] Field mapping not found:', field_mapping_id)
    return
  }

  // Check sync direction
  const syncDirection = mapping.sync_direction || 'store_to_erp'
  const hasErpToStore = syncDirection.split(',').map((s: string) => s.trim()).includes('erp_to_store')
  if (!hasErpToStore) {
    console.warn(`[Odoo Webhook Bg] Mapping "${mapping.name}" does not support ERP to Store sync direction. Skipping.`)
    return
  }

  // 2. Fetch Odoo Connection
  const { data: odooConn, error: connErr } = await supabaseAdmin
    .from('erp_connections')
    .select('*')
    .eq('id', mapping.erp_connection_id)
    .maybeSingle()

  if (connErr || !odooConn) {
    console.warn('[Odoo Webhook Bg] Odoo connection not found')
    return
  }

  if (odooConn.erp_type && odooConn.erp_type !== 'odoo') {
    console.warn(`[Odoo Webhook Bg] Webhook sync for non-Odoo ERP (${odooConn.erp_type}) is not supported yet.`)
    return
  }

  // Determine fields to fetch
  const modelMappings = mapping.mappings?.[model] || []
  if (modelMappings.length === 0) {
    console.info(`[Odoo Webhook Bg] No mappings defined for model "${model}". Skipping.`)
    return
  }

  const matchField = mapping.odoo_match_field
  let odooRecord: Record<string, any>

  // 3. Use the payload data if already received, otherwise fetch from Odoo via XML-RPC
  const payloadHasFields = payloadData && Object.keys(payloadData).length > 1
  if (payloadHasFields) {
    console.info(`[Odoo Webhook Bg] Using field values from webhook payload directly (skipping Odoo read)`, payloadData)
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
      return
    }
    odooRecord = odooRecords[0]
  }

  // 4. Determine platform (Salla vs Zid)
  const isSallaEvent = (action: string) => {
    return (
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
    )
  }
  const isSalla = isSallaEvent(mapping.action)

  // Match reference value
  const matchValue = String(odooRecord[matchField] || '').trim()
  if (!matchValue) {
    console.warn(`[Odoo Webhook Bg] Match field "${matchField}" is empty on Odoo record. Cannot sync.`)
    return
  }

  // 5. Update target store
  if (isSalla) {
    console.info(`[Odoo Webhook Bg] Syncing to Salla (Merchant ID=${mapping.merchant_id})...`)
    
    // Search for the product in Salla
    const sallaProduct = await findSallaProductByMatchField(
      mapping.merchant_id,
      mapping.zid_match_field || 'sku',
      matchValue
    )

    if (!sallaProduct) {
      console.warn(`[Odoo Webhook Bg] Salla product with ${mapping.zid_match_field}="${matchValue}" not found`)
      await logOdooToZidSync({
        workspace_id: mapping.workspace_id || '',
        field_mapping_id: mapping.id,
        event: mapping.action,
        store_id: String(mapping.store_id || mapping.merchant_id),
        odoo_model: model,
        odoo_record_id: odooRecordId,
        status: 'skipped',
        error_message: `Salla product with match field not found`,
        payload: { operation: 'search_not_found', matchValue }
      })
      return
    }

    // Build update payload
    const updateData: Record<string, any> = {}
    for (const line of modelMappings) {
      const odooVal = odooRecord[line.erpField]
      // Salla product structure updates
      if (line.zidField === 'name') {
        updateData.name = odooVal
      } else if (line.zidField === 'price') {
        updateData.price = Number(odooVal)
      } else if (line.zidField === 'sku') {
        updateData.sku = odooVal
      } else if (line.zidField === 'barcode') {
        updateData.barcode = odooVal
      } else {
        updateData[line.zidField] = odooVal
      }
    }

    console.info('[Odoo Webhook Bg] Salla update payload:', updateData)
    try {
      await updateSallaProduct(mapping.merchant_id, sallaProduct.id, updateData)
      console.info(`[Odoo Webhook Bg] Salla product ID=${sallaProduct.id} updated successfully!`)

      // Log SUCCESS
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
      console.error('[Odoo Webhook Bg] Failed to update product in Salla:', errMsg)

      // Log FAILED
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
    }
    
  } else {
    console.info(`[Odoo Webhook Bg] Syncing to Zid (Merchant ID=${mapping.merchant_id})...`)
    
    // Get Zid credentials
    const tokenData = await getAccessToken(mapping.merchant_id)
    const zidCreds = {
      authorization: tokenData.authorization || '',
      managerToken: tokenData.accessToken,
      storeId: mapping.store_id || undefined,
    }

    // Search for product in Zid
    const matchFieldZid = mapping.zid_match_field || 'sku'
    console.info(`[Odoo Webhook Bg] Searching Zid product by ${matchFieldZid}="${matchValue}"...`)
    
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
      
      // Exact match check
      const match = products.find((p: any) => {
        if (matchFieldZid === 'sku') return String(p.sku || '').trim() === matchValue
        if (matchFieldZid === 'barcode') return String(p.barcode || '').trim() === matchValue
        return false
      })

      if (match) {
        zidProductId = match.id
      }
    }

    if (!zidProductId) {
      // Build Zid create payload
      const createData: Record<string, any> = {
        product_class: 'standalone',
        is_draft: false,
      }
      for (const line of modelMappings) {
        const odooVal = odooRecord[line.erpField]
        if (line.zidField === 'name') {
          createData.name = {
            ar: String(odooVal),
            en: String(odooVal)
          }
        } else if (line.zidField === 'price') {
          createData.price = Number(odooVal)
        } else if (line.zidField === 'sku') {
          createData.sku = odooVal
        } else if (line.zidField === 'barcode') {
          createData.barcode = odooVal
        } else {
          createData[line.zidField] = odooVal
        }
      }

      // Ensure match field is present in createData
      if (matchFieldZid && !createData[matchFieldZid]) {
        if (matchFieldZid === 'name') {
          createData.name = { ar: matchValue, en: matchValue }
        } else if (matchFieldZid === 'price') {
          createData.price = Number(matchValue)
        } else {
          createData[matchFieldZid] = matchValue
        }
      }

      // Default required fields for Zid if not provided
      if (!createData.name) {
        createData.name = { ar: 'Product ' + matchValue, en: 'Product ' + matchValue }
      }
      if (createData.price === undefined) {
        createData.price = 0
      }

      console.info('[Odoo Webhook Bg] Creating new product in Zid:', createData)
      try {
        const createRes = await ZidAPI.products.create(zidCreds, createData)
        const newZidId = createRes.data?.product?.id || createRes.data?.id
        console.info(`[Odoo Webhook Bg] Zid product created successfully! ID=${newZidId || 'unknown'}`)

        // Log SUCCESS
        await logOdooToZidSync({
          workspace_id: mapping.workspace_id || '',
          field_mapping_id: mapping.id,
          event: mapping.action,
          store_id: String(mapping.store_id || mapping.merchant_id),
          zid_entity_id: String(newZidId || ''),
          odoo_model: model,
          odoo_record_id: odooRecordId,
          status: 'success',
          payload: { operation: 'create', createData, result: createRes.data }
        })
      } catch (err: any) {
        const errMsg = err.response?.data?.message || err.message || 'Failed to create product in Zid'
        console.error('[Odoo Webhook Bg] Failed to create product in Zid:', errMsg)

        // Log FAILED
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
      }
      return
    }

    // Build Zid update payload
    const updateData: Record<string, any> = {}
    for (const line of modelMappings) {
      const odooVal = odooRecord[line.erpField]
      if (line.zidField === 'name') {
        updateData.name = {
          ar: String(odooVal),
          en: String(odooVal)
        }
      } else if (line.zidField === 'price') {
        updateData.price = Number(odooVal)
      } else if (line.zidField === 'sku') {
        updateData.sku = odooVal
      } else if (line.zidField === 'barcode') {
        updateData.barcode = odooVal
      } else {
        updateData[line.zidField] = odooVal
      }
    }

    console.info('[Odoo Webhook Bg] Zid update payload:', updateData)
    try {
      await ZidAPI.products.update(zidCreds, zidProductId, updateData)
      console.info(`[Odoo Webhook Bg] Zid product ID=${zidProductId} updated successfully!`)

      // Log SUCCESS
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
      console.error('[Odoo Webhook Bg] Failed to update product in Zid:', errMsg)

      // Log FAILED
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
    }
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

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Odoo Webhook Receiver is ready.' })
}
