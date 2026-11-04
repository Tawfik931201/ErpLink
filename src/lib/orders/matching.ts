import { getErpExecutionScope } from '@/lib/erp-execution-target'
import type { SettingsClient } from '@/lib/mapping-settings'

/** A failed ownership check must never fall through to another matching key. */
export class OrderMatchSafetyError extends Error {}

export async function assertSaleOrderLinkOwnership(
  client: SettingsClient,
  recordId: number,
  identity: { workspaceId?: string; platform?: string; storeId?: string; storeEntityId: string },
): Promise<void> {
  const scope = getErpExecutionScope()
  if (!scope) return
  if (!identity.workspaceId || !identity.platform || !identity.storeId || !identity.storeEntityId ||
      scope.workspaceId !== identity.workspaceId || scope.platform !== identity.platform || scope.storeId !== identity.storeId) {
    throw new OrderMatchSafetyError('Sale order matching identity is missing or outside the ERP execution scope')
  }
  // Deliberately span platforms/stores: the candidate may already belong to
  // another order that happens to share the configured external reference.
  // A unique entity key permits at most one matching owner, so two rows suffice.
  const { data, error } = await client.from('odoo_entity_links')
    .select('platform, store_id, store_entity_id')
    .eq('workspace_id', scope.workspaceId)
    .eq('erp_connection_id', scope.erpConnectionId)
    .eq('connection_generation', scope.connectionGeneration)
    .eq('odoo_model', 'sale.order')
    .eq('odoo_record_id', recordId)
    .limit(2)
  if (error) throw new OrderMatchSafetyError('Cannot verify ownership of the matched Odoo sale order; sync stopped')
  const rows = (data || []) as Array<{ platform: string; store_id: string; store_entity_id: string }>
  if (rows.some(row => row.platform !== identity.platform || row.store_id !== identity.storeId || String(row.store_entity_id) !== identity.storeEntityId)) {
    throw new OrderMatchSafetyError(`Odoo sale order #${recordId} is linked to another store order; sync stopped to prevent overwriting it`)
  }
}
