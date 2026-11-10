'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { decrypt } from '@/lib/crypto'
import { withErpExecutionContext } from '@/lib/erp-effect-context'
import { connectionGeneration, withErpTarget } from '@/lib/erp-execution-target'
import { getEffectiveStandardMappingSettings } from '@/lib/mapping-settings'
import { OdooClient } from '@/lib/odoo-client'
import { listSallaProducts, listSallaCustomers, listSallaCategories } from '@/lib/salla-client'
import { listShopifyProducts, listShopifyCustomers, listShopifyCollections } from '@/lib/shopify-client'
import { supabase } from '@/lib/supabase'
import {
  buildOdooValues,
  executeOdooOperation,
  fetchFieldMeta,
  findExistingOdooRecord,
} from '@/lib/sync-engine'
import { notifySyncResult } from '@/lib/telegram-notifier'
import type { SyncRecordSummary } from '@/lib/telegram-notifier'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { getAccessToken } from '@/lib/zid/token'
import { ZidAPI } from '@/lib/zid-client'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

export async function getTransfers() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, transfers: [] }
    }

    // Clean up expired transfer logs in background
    cleanupExpiredTransfers().catch(err => console.error('[getTransfers] Background cleanup failed:', err))

    const { data: transfers, error } = await supabase
      .from('data_transfers')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw new Error('Failed to query transfers: ' + error.message)

    return { success: true, transfers: transfers || [] }
  } catch (error: any) {
    console.error('[Transfers Action] getTransfers failed:', error)
    return { success: false, error: error.message || 'Failed to fetch transfers' }
  }
}

export async function getTransferById(id: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: false, error: 'No active workspace selected' }
    }

    const { data: transfer, error } = await supabase
      .from('data_transfers')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (error) throw new Error('Failed to query transfer: ' + error.message)
    if (!transfer) return { success: false, error: 'Transfer log not found' }

    return { success: true, transfer }
  } catch (error: any) {
    console.error('[Transfers Action] getTransferById failed:', error)
    return { success: false, error: error.message || 'Failed to fetch transfer' }
  }
}

export async function startInitialTransfer(data: {
  name: string
  dataType: 'categories' | 'products' | 'customers'
  direction: 'store_to_odoo' | 'odoo_to_store' | 'zid_to_odoo' | 'odoo_to_zid'
  platform?: 'zid' | 'salla' | 'shopify'
  odooModel: string
  mappings: any
  /** Multi-store: merchant_id (zid/salla) or shop_domain (shopify). Defaults to the newest store. */
  storeKey?: string
}) {
  // Normalize direction values for backward compatibility
  const direction = data.direction === 'zid_to_odoo' ? 'store_to_odoo'
    : data.direction === 'odoo_to_zid' ? 'odoo_to_store'
    : data.direction
  const platform = data.platform || 'zid'

  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('لم يتم تحديد بيئة عمل نشطة (No active workspace selected)')
    }

    if (!data.name || !data.name.trim()) {
      throw new Error('اسم عملية النقل مطلوب (Transfer name is required)')
    }

    // Retrieve Odoo Connection
    const { data: odooConn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (!odooConn) {
      throw new Error('لم يتم ضبط اتصال الـ ERP لهذه البيئة (ERP connection not configured)')
    }

    if (odooConn.erp_type && odooConn.erp_type !== 'odoo') {
      throw new Error('نقل البيانات الكلية غير مدعوم حالياً إلا لنظام أودو (Bulk transfer is currently only supported for Odoo)')
    }

    // Retrieve platform-specific store token (multi-store: all rows, newest
    // first; explicit storeKey wins, otherwise the newest store).
    let storeToken: any = null
    let storeIdentifier = ''
    const pickToken = <T,>(rows: T[] | null, match: (r: T) => string): T | null => {
      if (!rows || rows.length === 0) return null
      if (data.storeKey) return rows.find(r => match(r) === String(data.storeKey)) ?? null
      return rows[0]
    }

    if (platform === 'shopify') {
      const { data: toks } = await supabase
        .from('shopify_tokens')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .order('updated_at', { ascending: false, nullsFirst: false })
      const tok: any = pickToken(toks, r => String((r as any).shop_domain))
      if (!tok) throw new Error(data.storeKey ? 'متجر Shopify المحدد غير متصل (Selected Shopify store not connected)' : 'متجر Shopify غير متصل (Shopify store not connected)')
      storeToken = tok
      storeIdentifier = tok.shop_domain
    } else if (platform === 'salla') {
      const { data: toks } = await supabase
        .from('salla_tokens')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .order('updated_at', { ascending: false, nullsFirst: false })
      const tok: any = pickToken(toks, r => String((r as any).merchant_id))
      if (!tok) throw new Error(data.storeKey ? 'متجر Salla المحدد غير متصل (Selected Salla store not connected)' : 'متجر Salla غير متصل (Salla store not connected)')
      storeToken = tok
      storeIdentifier = tok.merchant_id
    } else {
      // Zid (default)
      const { data: toks } = await supabase
        .from('merchant_tokens')
        .select('*')
        .eq('workspace_id', user.active_workspace_id)
        .order('updated_at', { ascending: false, nullsFirst: false })
      const tok: any = pickToken(toks, r => String((r as any).merchant_id))
      if (!tok) throw new Error(data.storeKey ? 'متجر زد المحدد غير متصل (Selected Zid store not connected)' : 'متجرك في زد غير متصل - يرجى ربط زد أولاً (Zid store not connected)')
      storeToken = tok
      storeIdentifier = tok.merchant_id
    }

    // Create the transfer record in database with pending status
    const { data: transfer, error: insertError } = await supabase
      .from('data_transfers')
      .insert([{
        workspace_id: user.active_workspace_id,
        name: data.name.trim(),
        data_type: data.dataType,
        direction,
        status: 'pending',
        records_fetched: 0,
        records_created: 0,
        records_failed: 0,
        failure_reason: '',
        mappings: data.mappings,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single()

    if (insertError || !transfer) {
      throw new Error('Failed to create transfer record: ' + insertError?.message)
    }

    // Trigger the background task without awaiting it!
    runTransferInBackground(transfer.id, user.active_workspace_id, odooConn, storeToken, { ...data, direction, platform, storeIdentifier })

    revalidatePath('/app/initial-transfer')
    return { success: true, transfer }
  } catch (error: any) {
    console.error('[Transfers Action] startInitialTransfer failed:', error)
    return { success: false, error: error.message || 'Failed to start data transfer' }
  }
}

async function runTransferInBackground(
  transferId: string,
  workspaceId: string,
  odooConn: any,
  storeToken: any,
  data: {
    name: string
    dataType: 'categories' | 'products' | 'customers'
    direction: 'store_to_odoo' | 'odoo_to_store'
    platform: 'zid' | 'salla' | 'shopify'
    storeIdentifier: string
    odooModel: string
    mappings: any
  }
) {
  let records_fetched = 0
  let records_created = 0
  let records_failed = 0
  let failure_reason = ''

  const logError = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString('ar-EG')
    failure_reason += `[${timestamp}] ${msg}\n`
  }

  try {
    // 1. Update status to 'running'
    await supabase
      .from('data_transfers')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', transferId)

    // 2. Setup Odoo Client
    const decryptedPassword = decrypt(odooConn.password)
    const odooClient = new OdooClient({
      url: odooConn.url,
      db: odooConn.db_name || '',
      username: odooConn.username,
      apiKey: decryptedPassword,
    })

    // 3. Setup Store Credentials (platform-specific)
    let storeCreds: any = null
    if (data.platform === 'zid') {
      const tokenData = await getAccessToken(storeToken.merchant_id, workspaceId)
      storeCreds = {
        authorization: tokenData.authorization || '',
        managerToken: tokenData.accessToken,
        storeId: data.dataType === 'products' ? (storeToken.store_id || undefined) : undefined,
      }
    }

    // 4. Fetch field metadata from Odoo
    const odooModel = data.odooModel
    const mappingItems = data.mappings?.[odooModel] ?? []
    const erpFieldNames = mappingItems.map((m: any) => m.erpField)
    const fieldMeta = await fetchFieldMeta(odooClient, odooModel, erpFieldNames)

    // 5. Fetch source data (store for store_to_odoo, Odoo for odoo_to_store)
    let entities: any[] = []

    if (data.direction === 'odoo_to_store') {
      // ── Fetch from Odoo (search_read on the mapped model) ────────────────
      try {
        const readFields = erpFieldNames.length > 0 ? [...erpFieldNames, 'id'] : ['id', 'name']
        const pageSize = 100
        let offset = 0
        while (true) {
          const page = await odooClient.searchRead<any>(odooModel, [], readFields, pageSize, offset)
          if (!page || page.length === 0) break
          entities = [...entities, ...page]
          if (page.length < pageSize) break
          offset += pageSize
        }
      } catch (err: any) {
        const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)
        logError(`فشل جلب البيانات من أودو: ${errorDetail}`)
        throw err
      }
    } else if (data.platform === 'shopify') {
      // ── Shopify: fetch products/customers/collections ─────────────────────
      try {
        if (data.dataType === 'products') {
          let pageInfo: string | null = null
          do {
            const res = await listShopifyProducts(data.storeIdentifier, 250, pageInfo || undefined)
            entities = [...entities, ...res.products]
            pageInfo = res.nextPageInfo
          } while (pageInfo)
        } else if (data.dataType === 'customers') {
          let pageInfo: string | null = null
          do {
            const res = await listShopifyCustomers(data.storeIdentifier, 250, pageInfo || undefined)
            entities = [...entities, ...res.customers]
            pageInfo = res.nextPageInfo
          } while (pageInfo)
        } else if (data.dataType === 'categories') {
          let pageInfo: string | null = null
          do {
            const res = await listShopifyCollections(data.storeIdentifier, 250, pageInfo || undefined)
            entities = [...entities, ...res.collections]
            pageInfo = res.nextPageInfo
          } while (pageInfo)
        }
      } catch (err: any) {
        const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)
        logError(`فشل جلب البيانات من Shopify: ${errorDetail}`)
        throw err
      }
    } else if (data.platform === 'salla') {
      // ── Salla: fetch products/customers/categories ────────────────────────
      try {
        if (data.dataType === 'products') {
          let page = 1
          let hasMore = true
          while (hasMore) {
            const res = await listSallaProducts(data.storeIdentifier, page, 100)
            entities = [...entities, ...res.products]
            hasMore = res.next !== null
            page++
          }
        } else if (data.dataType === 'customers') {
          let page = 1
          let hasMore = true
          while (hasMore) {
            const res = await listSallaCustomers(data.storeIdentifier, page, 100)
            entities = [...entities, ...res.customers]
            hasMore = res.next !== null
            page++
          }
        } else if (data.dataType === 'categories') {
          let page = 1
          let hasMore = true
          while (hasMore) {
            const res = await listSallaCategories(data.storeIdentifier, page, 100)
            entities = [...entities, ...res.categories]
            hasMore = res.next !== null
            page++
          }
        }
      } catch (err: any) {
        const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)
        logError(`فشل جلب البيانات من Salla: ${errorDetail}`)
        throw err
      }
    } else {
      // ── Zid (default): fetch products/customers/categories ────────────────
      try {
        if (data.dataType === 'categories') {
          const res = await ZidAPI.categories.list(storeCreds)
          entities = res.data.categories || res.data.results || (Array.isArray(res.data) ? res.data : [])
        } else if (data.dataType === 'products') {
          let page = 1
          let hasMore = true
          while (hasMore) {
            const res = await ZidAPI.products.list(storeCreds, { page, page_size: 50 })
            const pageResults = res.data.results || []
            if (pageResults.length === 0) {
              hasMore = false
            } else {
              entities = [...entities, ...pageResults]
              page++
              if (!res.data.next) hasMore = false
            }
          }
        } else if (data.dataType === 'customers') {
          let page = 1
          let hasMore = true
          while (hasMore) {
            const res = await ZidAPI.customers.list(storeCreds, { page, per_page: 50 })
            const pageResults = res.data.customers || []
            if (pageResults.length === 0) {
              hasMore = false
            } else {
              entities = [...entities, ...pageResults]
              page++
              if (pageResults.length < 50) hasMore = false
            }
          }
        }
      } catch (err: any) {
        const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)
        logError(`فشل جلب البيانات من زد: ${errorDetail}`)
        throw err
      }
    }

    records_fetched = entities.length

    // Update fetched count
    await supabase
      .from('data_transfers')
      .update({ records_fetched, updated_at: new Date().toISOString() })
      .eq('id', transferId)

    // Throttled progress update in database
    let lastDbUpdate = Date.now()
    const updateDbProgress = async (force = false) => {
      const now = Date.now()
      if (force || now - lastDbUpdate > 3000) {
        lastDbUpdate = now
        await supabase
          .from('data_transfers')
          .update({
            records_created,
            records_failed,
            failure_reason: failure_reason || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', transferId)
      }
    }

    // 6. Process entities concurrently (concurrency limit = 5)
    if (data.direction === 'odoo_to_store') {
      // ── Odoo → Zid: read Odoo record, map to Zid payload, create/update in Zid ──
      await runWithConcurrencyLimit(5, entities, async (entity) => {
        const nameForLog = String(entity.name || entity.code || entity.id || '')

        try {
          const zidPayload: Record<string, any> = {}
          for (const line of mappingItems) {
            const rawVal = line.staticValue !== undefined && line.staticValue !== ''
              ? line.staticValue
              : entity[line.erpField]
            if (rawVal === undefined || rawVal === null) continue
            if (line.zidField) zidPayload[line.zidField] = rawVal
          }

          if (Object.keys(zidPayload).length === 0) {
            logError(`تخطي السجل [${nameForLog}]: جميع الحقول المربوطة فارغة`)
            records_failed++
            await updateDbProgress()
            return
          }

          if (data.dataType === 'products') {
            const createData: Record<string, any> = {
              product_class: 'standalone',
              is_draft: false,
            }
            for (const [k, v] of Object.entries(zidPayload)) {
              if (k === 'name') {
                createData.name = { ar: String(v), en: String(v) }
              } else if (k === 'price') {
                createData.price = Number(v)
              } else {
                createData[k] = v
              }
            }
            if (!createData.name) createData.name = { ar: nameForLog, en: nameForLog }
            if (createData.price === undefined) createData.price = 0

            // Lookup existing Zid product by sku or id field
            const matchKey = odooConn.zid_match_field || 'sku'
            const matchValue = createData[matchKey] ?? createData.sku ?? createData.id
            let existingId: string | null = null
            if (matchValue) {
              const listRes = await ZidAPI.products.list(storeCreds, { page_size: 1, sku: matchValue } as any)
                .catch(() => ({ data: { results: [] } }))
              const match = (listRes.data?.results || []).find((p: any) =>
                String(p[matchKey] ?? p.sku ?? '').trim() === String(matchValue).trim())
              existingId = match?.id ?? null
            }

            if (existingId) {
              delete (createData as any).id
              await ZidAPI.products.update(storeCreds, existingId, createData)
            } else {
              delete (createData as any).id
              await ZidAPI.products.create(storeCreds, createData)
            }
            records_created++
          } else if (data.dataType === 'categories') {
            const createData: Record<string, any> = {}
            for (const [k, v] of Object.entries(zidPayload)) {
              if (k === 'name') {
                createData.name = { ar: String(v), en: String(v) }
              } else {
                createData[k] = v
              }
            }
            delete (createData as any).id
            await ZidAPI.categories.create(storeCreds, createData)
            records_created++
          } else if (data.dataType === 'customers') {
            const createData: Record<string, any> = {}
            for (const [k, v] of Object.entries(zidPayload)) {
              if (v === undefined || v === null) continue
              createData[k] = v
            }
            delete (createData as any).id
            await ZidAPI.customers.create(storeCreds, createData as any)
            records_created++
          }
        } catch (err: any) {
          logError(`فشل مزامنة [${nameForLog}]: ${err.message || err}`)
          records_failed++
        }

        await updateDbProgress()
      })
    } else {
      // store_to_odoo: push fetched store entities into Odoo
      const isZidProduct = data.platform === 'zid' && data.dataType === 'products' && odooModel === 'product.template'
      const isStoreCategory = data.dataType === 'categories' && odooModel === 'product.category' && (data.platform === 'zid' || data.platform === 'salla')
      const productSettings = isZidProduct ? await getEffectiveStandardMappingSettings(supabase, workspaceId, 'zid', 'products', data.storeIdentifier) : null
      await runWithConcurrencyLimit(5, entities, async (entity) => {
        const zidId = String(entity.id ?? (isStoreCategory ? entity.category_id ?? entity.category_uuid : undefined) ?? '')
        const nameForLog = entity.name?.ar || entity.name?.en || entity.name || entity.title || zidId

        try {
          // Build Odoo values using mapping rules
          const categoryScope = { workspaceId, platform: data.platform, storeId: data.storeIdentifier, erpConnectionId: odooConn.id, connectionGeneration: connectionGeneration(odooConn), eventId: `transfer:${transferId}:${zidId}`, storeEntityId: zidId, rootModel: odooModel }
          const buildValues = () => buildOdooValues(odooClient, mappingItems, entity, fieldMeta, data.platform, workspaceId, data.storeIdentifier, productSettings)
          const odooValues = isStoreCategory
            ? await withErpTarget(categoryScope, () => withErpExecutionContext(categoryScope, buildValues))
            : await buildValues()

          if (Object.keys(odooValues).length === 0) {
            logError(`تخطي السجل [${nameForLog}]: جميع الحقول المربوطة فارغة`)
            records_failed++
            await updateDbProgress()
            return
          }

          if (isZidProduct || isStoreCategory) {
            const result = await withErpTarget({
              workspaceId, platform: data.platform, storeId: data.storeIdentifier,
              erpConnectionId: odooConn.id, connectionGeneration: connectionGeneration(odooConn),
              eventId: `transfer:${transferId}:${zidId}`,
            }, () => {
              const operation = () => executeOdooOperation({
              client: odooClient,
              mapping: {
                id: isStoreCategory ? 'transfer_categories' : 'transfer_products', workspace_id: workspaceId, erp_connection_id: odooConn.id,
                merchant_id: data.storeIdentifier, store_id: data.storeIdentifier,
                action: isStoreCategory ? 'category.create' : 'product.create', odoo_model: odooModel, name: data.name || 'Product import',
                mappings: data.mappings || {},
                odoo_match_field: odooConn.odoo_match_field,
                zid_match_field: odooConn.zid_match_field,
              },
              event: isStoreCategory ? 'category.create' : 'product.create', storeId: data.storeIdentifier, zidEntityId: zidId,
              zidData: entity, odooModel, odooOperation: 'create', odooValues,
              presetKey: null, triggerType: 'manual' as const, platformHint: data.platform,
            })
              return isStoreCategory ? withErpExecutionContext(categoryScope, operation) : operation()
            })
            if (result.status !== 'success') throw new Error(result.message || 'Product import did not complete')
            records_created++
            await updateDbProgress()
            return
          }

          // Duplication check in Odoo. workspaceId + platform are required so the
          // sync_logs fast-path lookup can never match another merchant's record.
          const existingId = await findExistingOdooRecord(
            odooClient,
            odooModel,
            entity,
            odooValues,
            {
              odoo_match_field: odooConn.odoo_match_field || undefined,
              zid_match_field: odooConn.zid_match_field || undefined,
            },
            undefined,
            undefined,
            workspaceId,
            data.platform
          )

          if (existingId !== null) {
            // Record already exists, update it to keep Odoo in sync!
            const ok = await odooClient.write(odooModel, [existingId], odooValues)
            if (!ok) {
              throw new Error(`فشل تحديث السجل في Odoo #${existingId}`)
            }
            records_created++
          } else {
            // Create new record
            const newId = await odooClient.create(odooModel, odooValues)
            if (!newId) {
              throw new Error(`فشل إنشاء السجل في أودو`)
            }
            records_created++
          }
        } catch (err: any) {
          logError(`فشل مزامنة [${nameForLog}]: ${err.message || err}`)
          records_failed++
        }

        await updateDbProgress()
      })
    }

    // Force one final DB progress update
    await updateDbProgress(true)

    // 7. Mark as Completed
    await supabase
      .from('data_transfers')
      .update({
        status: 'completed',
        records_created,
        records_failed,
        failure_reason: failure_reason || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', transferId)

    // Send Telegram summary notification for the bulk transfer
    const summary: SyncRecordSummary = {
      status: records_failed > 0 ? 'failed' : 'success',
      event: `bulk.${data.dataType}.sync`,
      mappingName: data.name || data.dataType,
      mappingId: transferId,
      model: data.odooModel,
      odooRecordId: null,
      errorMessage: records_failed > 0
        ? `فشل ${records_failed} من أصل ${records_fetched} سجل. ${failure_reason.slice(0, 200)}`
        : null,
      workspaceId,
      storeId: storeToken.store_id || storeToken.shop_domain || storeToken.merchant_id || null,
      receivedAt: new Date().toISOString(),
    }
    await notifySyncResult({ workspaceId, record: summary }).catch(() => {})

  } catch (error: any) {
    console.error('[Background Transfer Error]:', error)
    const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : (error.message || error)
    logError(`فشل العملية بالكامل: ${errorDetail}`)
    
    await supabase
      .from('data_transfers')
      .update({
        status: 'failed',
        records_fetched,
        records_created,
        records_failed,
        failure_reason: failure_reason || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', transferId)

    // Send Telegram failure notification
    const summary: SyncRecordSummary = {
      status: 'failed',
      event: `bulk.${data.dataType}.sync`,
      mappingName: data.name || data.dataType,
      mappingId: transferId,
      model: data.odooModel,
      odooRecordId: null,
      errorMessage: errorDetail.slice(0, 300),
      workspaceId,
      storeId: storeToken.store_id || storeToken.shop_domain || storeToken.merchant_id || null,
      receivedAt: new Date().toISOString(),
    }
    await notifySyncResult({ workspaceId, record: summary }).catch(() => {})
  }
}

export async function cleanupExpiredTransfers() {
  console.info('[Transfers Action] Running cleanupExpiredTransfers...')
  try {
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // 1. Delete completed transfers older than 72 hours
    const { error: err1 } = await supabase
      .from('data_transfers')
      .delete()
      .eq('status', 'completed')
      .lt('created_at', seventyTwoHoursAgo)

    // 2. Delete failed/pending transfers older than 7 days
    const { error: err2 } = await supabase
      .from('data_transfers')
      .delete()
      .in('status', ['failed', 'pending'])
      .lt('created_at', sevenDaysAgo)

    if (err1 || err2) {
      console.error('[Transfers Action] Failed to delete expired transfers:', err1 || err2)
    } else {
      console.info('[Transfers Action] Expired transfers purged successfully.')
    }
  } catch (err) {
    console.error('[Transfers Action] Exception during transfers purge:', err)
  }
}

/**
 * Concurrency Limit Helper
 * Runs a list of tasks with a concurrency limit.
 */
async function runWithConcurrencyLimit<T>(
  concurrencyLimit: number,
  items: T[],
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const executing = new Set<Promise<void>>()
  for (let i = 0; i < items.length; i++) {
    const p = Promise.resolve().then(() => fn(items[i], i))
    executing.add(p)
    const clean = () => executing.delete(p)
    p.then(clean, clean)
    if (executing.size >= concurrencyLimit) {
      await Promise.race(executing)
    }
  }
  await Promise.all(executing)
}
