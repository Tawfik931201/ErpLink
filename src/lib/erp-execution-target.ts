import { AsyncLocalStorage } from 'async_hooks'
import { createHash } from 'crypto'

import { supabase } from '@/lib/supabase'

export type CommercePlatform = 'zid' | 'salla' | 'shopify' | 'odoo'
export function isCommercePlatform(platform: string): platform is Exclude<CommercePlatform, 'odoo'> {
  return platform === 'zid' || platform === 'salla' || platform === 'shopify'
}
export interface ExecutionTarget { erpConnectionId: string; connectionGeneration: string }
export interface TrustedErpConnection {
  id: string; workspace_id: string; url: string; username: string; password: string
  db_name?: string | null; erp_type?: string | null; status?: string | null
}
export interface ExecutionScope extends ExecutionTarget {
  workspaceId: string; platform: CommercePlatform; storeId: string; eventId: string
  validatedConn?: TrustedErpConnection
}
const executionScope = new AsyncLocalStorage<ExecutionScope>()
export const getErpExecutionScope = () => executionScope.getStore()
export function withErpTarget<T>(scope: ExecutionScope, work: () => Promise<T>): Promise<T> {
  return executionScope.run(scope, work)
}

/** Legacy field_mappings has no platform column: derive only from unique, owned token identity. */
export async function resolveOwnedStorePlatform(workspaceId: string, merchantId: string): Promise<'zid' | 'salla' | 'shopify'> {
  if (!workspaceId || !merchantId) throw new Error('Store ownership scope missing')
  const results = await Promise.all([
    supabase.from('merchant_tokens').select('merchant_id').eq('workspace_id', workspaceId).eq('merchant_id', merchantId).maybeSingle(),
    supabase.from('salla_tokens').select('merchant_id').eq('workspace_id', workspaceId).eq('merchant_id', merchantId).maybeSingle(),
    supabase.from('shopify_tokens').select('shop_domain').eq('workspace_id', workspaceId).eq('shop_domain', merchantId).maybeSingle(),
  ])
  if (results.some(result => result.error)) throw new Error('Store platform ownership lookup failed')
  const matches = results.flatMap((result, index) => result.data ? [(['zid', 'salla', 'shopify'] as const)[index]] : [])
  if (matches.length !== 1) throw new Error('Store platform ownership missing or ambiguous; controlled mapping repair required')
  return matches[0]
}

/** Only configuration affecting external authority participates; display metadata does not. */
export function connectionGeneration(connection: TrustedErpConnection): string {
  return createHash('sha256').update(JSON.stringify([
    connection.id, connection.workspace_id, connection.erp_type || 'odoo', connection.url,
    connection.db_name || '', connection.username, connection.password,
  ])).digest('hex')
}

/** A destination change retires database-specific mappings before using the new ERP. */
export async function requireWorkspaceBinding(connection: TrustedErpConnection, followSettings = false): Promise<void> {
  const binding = {
    workspace_id: connection.workspace_id, erp_connection_id: connection.id,
    erp_type: connection.erp_type || 'odoo', url: connection.url, db_name: connection.db_name || '',
  }
  let { data, error } = await supabase.from('erp_workspace_bindings').select('*')
    .eq('workspace_id', connection.workspace_id).maybeSingle()
  if (error) throw new Error('ERP workspace resource binding unavailable')
  if (!data) {
    // First binding is permitted only for an unambiguous workspace connection.
    const current = await supabase.from('erp_connections').select('id').eq('workspace_id', connection.workspace_id).maybeSingle()
    if (current.error || current.data?.id !== connection.id) throw new Error('ERP workspace resource binding ambiguous')
    const inserted = await supabase.from('erp_workspace_bindings').insert(binding)
    if (inserted.error && inserted.error.code !== '23505') throw new Error('ERP workspace resource binding unavailable')
    const reread = await supabase.from('erp_workspace_bindings').select('*').eq('workspace_id', connection.workspace_id).maybeSingle()
    data = reread.data
    error = reread.error
  }
  if (!error && data && Object.entries(binding).every(([key, value]) => String(data[key] ?? '') === value)) return
  if (!error && data && followSettings) {
    const refreshed = await supabase.rpc('switch_erp_mapping_destination', {
      p_workspace_id: connection.workspace_id,
      p_connection_id: connection.id,
      p_erp_type: binding.erp_type,
      p_url: binding.url,
      p_db_name: binding.db_name,
    })
    if (!refreshed.error && refreshed.data === true) return
  }
  throw new Error('ERP workspace resource changed; controlled mapping reconciliation required')
}

async function requireStore(workspaceId: string, platform: string, storeId: string) {
  if (!workspaceId || !storeId || !['zid', 'salla', 'shopify', 'odoo'].includes(platform)) throw new Error('Invalid ERP execution scope')
  // Odoo ingress is scoped by the authenticated workspace/mapping trigger;
  // it has no commerce token row. The connection is independently revalidated below.
  if (platform === 'odoo') return
  const table = platform === 'zid' ? 'merchant_tokens' : platform === 'salla' ? 'salla_tokens' : 'shopify_tokens'
  let query = supabase.from(table).select('workspace_id').eq('workspace_id', workspaceId)
  if (platform === 'shopify') query = query.eq('shop_domain', storeId)
  else if (platform === 'salla') query = query.eq('merchant_id', storeId)
  else {
    if (!/^[a-zA-Z0-9_-]+$/.test(storeId)) throw new Error('Invalid store identity')
    query = query.or(`store_id.eq.${storeId},merchant_id.eq.${storeId}`)
  }
  const { data, error } = await query.maybeSingle()
  if (error || !data) throw new Error('Store does not belong to ERP execution workspace')
}

export async function resolveExecutionTarget(workspaceId: string, platform: string, storeId: string): Promise<ExecutionTarget> {
  await requireStore(workspaceId, platform, storeId)
  const { data, error } = await supabase.from('erp_connections').select('*').eq('workspace_id', workspaceId).maybeSingle()
  if (error || !data || (data.status && data.status !== 'connected')) throw new Error('No unique active ERP execution connection')
  await requireWorkspaceBinding(data as TrustedErpConnection, isCommercePlatform(platform))
  return { erpConnectionId: data.id, connectionGeneration: connectionGeneration(data as TrustedErpConnection) }
}

export async function validateExecutionTarget(workspaceId: string, platform: string, storeId: string, target: ExecutionTarget): Promise<TrustedErpConnection> {
  if (!target?.erpConnectionId || !target.connectionGeneration) throw new Error('Unpinned ERP execution target requires controlled recovery')
  const scope = getErpExecutionScope()
  if (
    scope?.validatedConn &&
    scope.workspaceId === workspaceId &&
    scope.platform === platform &&
    scope.storeId === storeId &&
    scope.erpConnectionId === target.erpConnectionId &&
    scope.connectionGeneration === target.connectionGeneration
  ) {
    return scope.validatedConn
  }
  await requireStore(workspaceId, platform, storeId)
  const { data, error } = await supabase.from('erp_connections').select('*')
    .eq('id', target.erpConnectionId).eq('workspace_id', workspaceId).maybeSingle()
  if (error || !data || (data.status && data.status !== 'connected')) throw new Error('ERP execution connection missing, disabled or outside workspace')
  await requireWorkspaceBinding(data as TrustedErpConnection)
  if (connectionGeneration(data as TrustedErpConnection) !== target.connectionGeneration) throw new Error('ERP execution connection generation changed; controlled recovery required')
  const connection = data as TrustedErpConnection
  if (scope && scope.erpConnectionId === target.erpConnectionId && scope.connectionGeneration === target.connectionGeneration) {
    scope.validatedConn = connection
  }
  return connection
}
