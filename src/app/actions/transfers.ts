'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { supabase } from '@/lib/supabase'
import {
  buildOdooValues,
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
  direction: 'zid_to_odoo'
  odooModel: string
  mappings: any
}) {
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

    // Retrieve Zid merchant token
    const { data: merchantTok } = await supabase
      .from('merchant_tokens')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (!merchantTok) {
      throw new Error('متجرك في زد غير متصل - يرجى ربط زد أولاً (Zid store not connected)')
    }

    // Create the transfer record in database with pending status
    const { data: transfer, error: insertError } = await supabase
      .from('data_transfers')
      .insert([{
        workspace_id: user.active_workspace_id,
        name: data.name.trim(),
        data_type: data.dataType,
        direction: data.direction,
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
    runTransferInBackground(transfer.id, user.active_workspace_id, odooConn, merchantTok, data)

    revalidatePath('/dashboard/initial-transfer')
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
  merchantTok: any,
  data: {
    name: string
    dataType: 'categories' | 'products' | 'customers'
    direction: 'zid_to_odoo'
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

    // 3. Setup Zid Credentials
    const tokenData = await getAccessToken(merchantTok.merchant_id)
    const zidCreds = {
      authorization: tokenData.authorization || '',
      managerToken: tokenData.accessToken,
      // storeId is only required for products/variants endpoints
      storeId: data.dataType === 'products' ? (merchantTok.store_id || undefined) : undefined,
    }

    // 4. Fetch field metadata from Odoo
    const odooModel = data.odooModel
    const mappingItems = data.mappings?.[odooModel] ?? []
    const erpFieldNames = mappingItems.map((m: any) => m.erpField)
    const fieldMeta = await fetchFieldMeta(odooClient, odooModel, erpFieldNames)

    // 5. Fetch all Zid Data
    let entities: any[] = []

    if (data.dataType === 'categories') {
      try {
        const res = await ZidAPI.categories.list(zidCreds)
        entities = res.data.categories || res.data.results || (Array.isArray(res.data) ? res.data : [])
      } catch (err: any) {
        const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)
        logError(`فشل جلب التصنيفات من زد: ${errorDetail}`)
        throw err
      }
    } else if (data.dataType === 'products') {
      let page = 1
      let hasMore = true
      while (hasMore) {
        try {
          const res = await ZidAPI.products.list(zidCreds, { page, page_size: 50 })
          const pageResults = res.data.results || []
          if (pageResults.length === 0) {
            hasMore = false
          } else {
            entities = [...entities, ...pageResults]
            page++
            if (!res.data.next) {
              hasMore = false
            }
          }
        } catch (err: any) {
          const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)
          logError(`فشل جلب صفحة المنتجات رقم ${page} من زد: ${errorDetail}`)
          hasMore = false
          if (entities.length === 0) throw err
        }
      }
    } else if (data.dataType === 'customers') {
      let page = 1
      let hasMore = true
      while (hasMore) {
        try {
          const res = await ZidAPI.customers.list(zidCreds, { page, per_page: 50 })
          const pageResults = res.data.customers || []
          if (pageResults.length === 0) {
            hasMore = false
          } else {
            entities = [...entities, ...pageResults]
            page++
            if (pageResults.length < 50) {
              hasMore = false
            }
          }
        } catch (err: any) {
          const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : (err.message || err)
          logError(`فشل جلب صفحة العملاء رقم ${page} من زد: ${errorDetail}`)
          hasMore = false
          if (entities.length === 0) throw err
        }
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
    await runWithConcurrencyLimit(5, entities, async (entity) => {
      const zidId = String(entity.id || '')
      const nameForLog = entity.name?.ar || entity.name?.en || entity.name || zidId

      try {
        // Build Odoo values using mapping rules
        const odooValues = await buildOdooValues(odooClient, mappingItems, entity, fieldMeta, 'zid')

        if (Object.keys(odooValues).length === 0) {
          logError(`تخطي السجل [${nameForLog}]: جميع الحقول المربوطة فارغة`)
          records_failed++
          await updateDbProgress()
          return
        }

        // Duplication check in Odoo
        const existingId = await findExistingOdooRecord(odooClient, odooModel, entity, odooValues, {
          odoo_match_field: odooConn.odoo_match_field || undefined,
          zid_match_field: odooConn.zid_match_field || undefined,
        })

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
      storeId: merchantTok.store_id ?? null,
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
      storeId: merchantTok.store_id ?? null,
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
