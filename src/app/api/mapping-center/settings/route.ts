import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser } from '@/lib/users'

const ENTITIES = new Set(['categories', 'products', 'customers', 'orders'])
const STORES = new Set(['zid', 'salla', 'shopify'])
const READ_TIMEOUT_MS = 5_000

async function timeout<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out while loading saved mapping settings')), READ_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * A small, read-only endpoint intentionally kept independent of ERP calls.
 * Mapping settings must remain visible even when the ERP is unreachable.
 */
export async function GET(request: NextRequest) {
  const store = request.nextUrl.searchParams.get('store') || ''
  const entity = request.nextUrl.searchParams.get('entity') || ''

  if (!STORES.has(store) || !ENTITIES.has(entity)) {
    return NextResponse.json({ error: 'Invalid mapping settings request' }, { status: 400 })
  }

  try {
    const userId = await getActiveUserId()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const user = await timeout(getOrCreateDbUser(userId))
    if (!user.active_workspace_id) {
      return NextResponse.json({ settings: null, orderStatusMappings: null }, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }

    const settingsQuery = supabase
      .from('standard_mapping_settings')
      .select('settings')
      .eq('workspace_id', user.active_workspace_id)
      .eq('store_type', store)
      .eq('entity_type', entity)
      .maybeSingle()

    const statusQuery = entity === 'orders'
      ? supabase
        .from('order_status_mappings')
        .select('zid_status, odoo_state, enabled')
        .eq('workspace_id', user.active_workspace_id)
        .eq('platform', store)
      : Promise.resolve({ data: [], error: null })

    const [settingsRes, statusRes] = await timeout(Promise.all([settingsQuery, statusQuery]))
    if (settingsRes.error) throw settingsRes.error
    if (statusRes.error) throw statusRes.error

    const orderStatusMappings: Record<string, { state: string; enabled: boolean }> = {}
    for (const row of statusRes.data || []) {
      if (row.zid_status && row.odoo_state) {
        orderStatusMappings[row.zid_status] = { state: row.odoo_state, enabled: row.enabled !== false }
      }
    }

    return NextResponse.json({
      settings: settingsRes.data?.settings || null,
      orderStatusMappings: entity === 'orders' && Object.keys(orderStatusMappings).length > 0
        ? orderStatusMappings
        : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error: any) {
    console.error('[MappingCenterSettings] Read failed:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load saved mapping settings' }, { status: 503 })
  }
}
