import type { OdooClient } from '@/lib/odoo-client'

/** Public invoicing wizard shared by Odoo 14–17 (private SO methods reject RPC). */
export async function createOrderInvoice(client: OdooClient, orderId: number): Promise<void> {
  const context = { active_model: 'sale.order', active_id: orderId, active_ids: [orderId] }
  const wizardId = await client.execute<number>(
    'sale.advance.payment.inv', 'create', [{ advance_payment_method: 'delivered' }], { context }
  )
  if (!Number.isInteger(wizardId) || wizardId <= 0) throw new Error('Odoo invoice wizard returned an invalid id')
  await client.execute('sale.advance.payment.inv', 'create_invoices', [[wizardId]], { context })
}
