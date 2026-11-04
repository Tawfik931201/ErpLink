import type { OdooClient } from '@/lib/odoo-client'

interface Actions { odoo_state?: string; picking_action?: string; invoice_action?: string }
type Client = Pick<OdooClient, 'searchRead' | 'getMajorVersion'>
type Order = { state: string; locked?: boolean; picking_ids?: number[]; invoice_ids?: number[] }

/** A completed SO write must not conceal a failed configured workflow action. */
export async function assertOrderActionResults(client: Client, orderId: number, actions: Actions): Promise<void> {
  const stateAction = actions.odoo_state || ''
  const pickingAction = actions.picking_action || ''
  const invoiceAction = actions.invoice_action || ''
  const needsLock = stateAction === 'done' && await client.getMajorVersion() >= 17
  const orderFields = ['state', ...(needsLock ? ['locked'] : []),
    ...(pickingAction && pickingAction !== 'none' ? ['picking_ids'] : []),
    ...(invoiceAction && invoiceAction !== 'none' ? ['invoice_ids'] : [])]
  if (!['sale', 'done', 'cancel'].includes(stateAction) && !pickingAction && !invoiceAction) return
  const [order] = await client.searchRead<Order>('sale.order', [['id', '=', orderId]], orderFields, 1)
  if (!order) throw new Error('Cannot verify configured order actions: sale order is unavailable')
  if (stateAction === 'sale' && !['sale', 'done'].includes(order.state)) throw new Error('Configured order confirmation did not complete')
  if (stateAction === 'cancel' && order.state !== 'cancel') throw new Error('Configured order cancellation did not complete')
  if (stateAction === 'done' && (needsLock ? order.state !== 'sale' || order.locked !== true : order.state !== 'done')) throw new Error('Configured order locking did not complete')
  if (['create', 'create_and_validate'].includes(pickingAction) && ['draft', 'sent'].includes(order.state)) throw new Error('Configured picking creation did not confirm the order')
  const pickingIds = Array.isArray(order.picking_ids) ? order.picking_ids : []
  if (pickingIds.length && ['validate', 'create_and_validate', 'cancel'].includes(pickingAction)) {
    const pickings = await client.searchRead<{ id: number; state: string }>('stock.picking', [['id', 'in', pickingIds]], ['id', 'state'], pickingIds.length)
    if (pickings.length !== pickingIds.length) throw new Error('Cannot verify all configured order pickings')
    // Services legitimately have no picking; completed/cancelled historical
    // transfers do not require another validation or stock movement.
    if (pickings.some(p => !['done', 'cancel'].includes(p.state))) throw new Error('Configured picking action did not complete')
  }
  const invoiceIds = Array.isArray(order.invoice_ids) ? order.invoice_ids : []
  if (invoiceAction && invoiceAction !== 'none') {
    const invoices = invoiceIds.length
      ? await client.searchRead<{ id: number; state: string; move_type: string }>('account.move', [['id', 'in', invoiceIds]], ['id', 'state', 'move_type'], invoiceIds.length)
      : []
    if (invoices.length !== invoiceIds.length) throw new Error('Cannot verify all configured order invoices')
    const active = invoices.filter(inv => inv.move_type === 'out_invoice' && inv.state !== 'cancel')
    if (['create', 'create_and_post'].includes(invoiceAction) && !active.length) throw new Error('Configured invoice creation did not complete')
    if (['post', 'create_and_post'].includes(invoiceAction) && active.some(inv => inv.state !== 'posted')) throw new Error('Configured invoice posting did not complete')
    if (invoiceAction === 'cancel' && active.length) throw new Error('Configured invoice cancellation did not complete')
  }
}
