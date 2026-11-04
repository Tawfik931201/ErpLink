import { withErpExecutionContext } from '@/lib/erp-effect-context'
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import type { OdooClient } from '@/lib/odoo-client'

/** Related customer creation shares one durable identity across different orders. */
export async function createPreparedOrderCustomer(
  client: Pick<OdooClient, 'create'>,
  pending: { values: Record<string, unknown>; sourceId: string },
): Promise<number> {
  const scope = getErpExecutionScope()
  const sourceId = pending.sourceId || JSON.stringify([pending.values.email || '', pending.values.phone || '', pending.values.name])
  const create = () => client.create('res.partner', pending.values)
  const id = scope
    ? await withErpExecutionContext({
        workspaceId: scope.workspaceId, platform: scope.platform, storeId: scope.storeId,
        erpConnectionId: scope.erpConnectionId, connectionGeneration: scope.connectionGeneration,
        eventId: 'order.customer.prepare', storeEntityId: sourceId, rootModel: 'res.partner',
      }, create)
    : await create()
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Order customer creation returned an invalid identity')
  return id
}
