'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { processSingleMapping, cleanupExpiredLogs } from '@/lib/sync-engine'

async function getOrCreateDbUser() {
  console.log('[sync-logs action] Calling Clerk auth()...')
  const { userId } = await auth()
  console.log('[sync-logs action] Clerk userId:', userId)
  if (!userId) throw new Error('Unauthorized')
  
  console.log('[sync-logs action] Calling ensureDbUser...')
  const dbUser = await ensureDbUser(userId)
  console.log('[sync-logs action] dbUser resolved with active_workspace_id:', dbUser?.active_workspace_id)
  return dbUser
}

export async function getSyncLogs(params: {
  mappingId?: string
  status?: string
  limit?: number
  offset?: number
  platform?: string
  eventFilter?: string
}) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, logs: [], totalCount: 0 }
    }

    // Purge expired logs in background
    cleanupExpiredLogs().catch(err => console.error('[getSyncLogs] Background cleanup failed:', err))

    console.log('[getSyncLogs] Querying sync_logs table for workspace:', user.active_workspace_id)
    
    // We want to fetch the logs and join with field_mappings if possible to get mapping names.
    // If field_mappings table has name, we can select it.
    let query = supabase
      .from('sync_logs')
      .select('*, field_mappings(name)', { count: 'exact' })
      .eq('workspace_id', user.active_workspace_id)
      .order('created_at', { ascending: false })

    if (params.mappingId && params.mappingId !== 'all') {
      if (params.mappingId === 'none') {
        return { success: true, logs: [], totalCount: 0 }
      }
      const mappingIds = params.mappingId.split(',')
      if (mappingIds.length > 0) {
        query = query.in('field_mapping_id', mappingIds)
      }
    }

    if (params.platform && params.platform !== 'all') {
      const shopifyEvents = [
        'products/create', 'products/update', 'products/delete',
        'orders/create', 'orders/updated', 'orders/cancelled', 'orders/fulfilled',
        'customers/create', 'customers/update'
      ]

      const sallaEvents = [
        // Products
        'product.created', 'product.updated', 'product.deleted', 'product.available',
        'product.quantity.low', 'product.channels.changed', 'product.review.added', 'product.review.updated',
        // Orders
        'order.created', 'order.updated', 'order.status.updated', 'order.cancelled',
        'order.refunded', 'order.deleted', 'order.payment.updated', 'order.coupon.updated',
        'order.total.price.updated', 'order.products.updated', 'order.customer.updated',
        'order.shipping.address.updated',
        // Shipments
        'order.shipment.creating', 'order.shipment.created', 'order.shipment.cancelled',
        'order.shipment.return.creating', 'order.shipment.return.created', 'order.shipment.return.cancelled',
        // Customers
        'customer.created', 'customer.updated', 'customer.login',
        // Categories
        'category.created', 'category.updated', 'category.deleted',
        // Branches
        'store.branch.created', 'store.branch.updated', 'store.branch.deleted',
        // Store
        'store.settings.updated',
        // Carts
        'abandoned.cart', 'abandoned.cart.update', 'abandoned.cart.purchased',
        // Coupons
        'coupon.applied', 'coupon.applied.v2',
        // Brands
        'brand.created', 'brand.updated', 'brand.deleted',
        // Special Offers
        'special.offer.created', 'special.offer.updated', 'special.offer.deleted',
        // App events
        'app.installed', 'app.updated', 'app.uninstalled', 'app.store.authorize',
        'app.trial.started', 'app.trial.expired', 'app.subscription.started', 'app.settings.updated',
      ]

      const zidEvents = [
        'product.create', 'product.update', 'product.delete', 'product.publish',
        'order.create', 'order.status.update', 'order.payment_status.update',
        'customer.create', 'customer.update', 'customer.merchant.update',
        'category.create', 'category.update', 'category.delete',
        'cart.abandoned'
      ]

      const platforms = params.platform.split(',')
      const allowedEvents: string[] = []

      if (platforms.includes('salla')) {
        allowedEvents.push(...sallaEvents)
      }
      if (platforms.includes('zid')) {
        allowedEvents.push(...zidEvents)
      }
      if (platforms.includes('shopify')) {
        allowedEvents.push(...shopifyEvents)
      }

      if (platforms.includes('none') || allowedEvents.length === 0) {
        query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      } else {
        query = query.in('event', allowedEvents)
      }
    }
    
    if (params.eventFilter) {
      const entityEvents: Record<string, string[]> = {
        category: [
          'category.create', 'category.update', 'category.delete',
          'category.created', 'category.updated', 'category.deleted',
        ],
      }
      const filters = params.eventFilter.split(',')
      const matchedEvents: string[] = []
      for (const f of filters) {
        const events = entityEvents[f.trim()]
        if (events) matchedEvents.push(...events)
      }
      if (matchedEvents.length > 0) {
        query = query.in('event', matchedEvents)
      }
    }

    if (params.status && params.status !== 'all') {
      const selectedTypes = params.status.split(',')
      const clauses: string[] = []

      if (selectedTypes.includes('success') && selectedTypes.includes('manual')) {
        clauses.push("status.eq.success")
      } else if (selectedTypes.includes('success')) {
        clauses.push("and(status.eq.success,or(error_message.is.null,error_message.not.ilike.%Resolved manually%))")
      } else if (selectedTypes.includes('manual')) {
        clauses.push("and(status.eq.success,error_message.ilike.%Resolved manually%)")
      }

      if (selectedTypes.includes('failed')) {
        clauses.push("status.eq.failed")
      }
      if (selectedTypes.includes('skipped')) {
        clauses.push("status.eq.skipped")
      }

      if (clauses.length > 0 && clauses.length < 4) {
        query = query.or(clauses.join(','))
      } else if (clauses.length === 0) {
        // If nothing is selected, force query to return no results
        query = query.eq('id', '00000000-0000-0000-0000-000000000000')
      }
    }

    const limit = params.limit || 20
    const offset = params.offset || 0
    query = query.range(offset, offset + limit - 1)

    const { data: logs, count, error } = await query

    if (error) throw new Error('Failed to query sync logs: ' + error.message)

    return {
      success: true,
      logs: logs || [],
      totalCount: count || 0
    }
  } catch (error: any) {
    console.error('[Sync Logs Action] getSyncLogs failed:', error)
    return { success: false, error: error.message || 'Failed to fetch sync logs' }
  }
}

export async function retrySyncLog(logId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    console.log('[retrySyncLog] Fetching log by ID:', logId)
    // 1. Fetch log
    const { data: log, error: logErr } = await supabase
      .from('sync_logs')
      .select('*')
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (logErr) throw new Error('Failed to fetch log: ' + logErr.message)
    if (!log) throw new Error('Sync log not found')

    console.log('[retrySyncLog] Fetching mapping by ID:', log.field_mapping_id)
    // 2. Fetch field mapping
    const { data: mapping, error: mapErr } = await supabase
      .from('field_mappings')
      .select('*')
      .eq('id', log.field_mapping_id)
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (mapErr) throw new Error('Failed to fetch field mapping: ' + mapErr.message)
    if (!mapping) throw new Error('المطابقة الخاصة بهذا السجل تم حذفها ولا يمكن إعادة إرسالها (Associated field mapping was deleted)')

    console.log('[retrySyncLog] Re-running sync processing for mapping:', mapping.name)
    // 3. Re-run mapping
    const result = await processSingleMapping(
      mapping,
      log.event,
      log.store_id,
      log.payload || {},
      'manual', // triggerType
      logId // existingLogId
    )

    revalidatePath('/dashboard/mapping-center')

    return {
      success: true,
      status: result.status,
      message: result.message || 'تمت إعادة معالجة المزامنة بنجاح (Sync retry completed)'
    }
  } catch (error: any) {
    console.error('[Sync Logs Action] retrySyncLog failed:', error)
    return { success: false, error: error.message || 'Failed to retry sync' }
  }
}

export async function resolveLogManually(logId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('No active workspace selected')
    }

    console.log('[resolveLogManually] Updating log ID to success (manual resolve):', logId)
    
    const { data: updated, error } = await supabase
      .from('sync_logs')
      .update({
        status: 'success',
        error_message: 'Resolved manually in Odoo / تم الحل يدويًا في أودو',
        trigger_type: 'manual'
      })
      .eq('id', logId)
      .eq('workspace_id', user.active_workspace_id)
      .select()
      .maybeSingle()

    if (error) {
      throw new Error('Failed to resolve log: ' + error.message)
    }

    revalidatePath('/dashboard/mapping-center')

    return {
      success: true,
      message: 'تم تعيين السجل كمحلول يدويًا بنجاح (Log marked as manually resolved)'
    }
  } catch (error: any) {
    console.error('[Sync Logs Action] resolveLogManually failed:', error)
    return { success: false, error: error.message || 'Failed to resolve log manually' }
  }
}
