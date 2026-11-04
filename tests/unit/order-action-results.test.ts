import type { OdooClient } from '@/lib/odoo-client'
import { assertOrderActionResults } from '@/lib/orders/action-results'

function fixture(state = 'sale', locked = false, version = 17, pickingState = 'done', invoiceState = 'posted') {
  return {
    getMajorVersion: jest.fn().mockResolvedValue(version),
    searchRead: jest.fn(async (model: string) => model === 'sale.order'
      ? [{ state, locked, picking_ids: [7], invoice_ids: [8] }]
      : model === 'stock.picking' ? [{ id: 7, state: pickingState }]
        : [{ id: 8, state: invoiceState, move_type: 'out_invoice' }]),
  } as unknown as OdooClient
}

describe('configured order workflow results', () => {
  it.each([14, 15, 16])('verifies done state on Odoo %i', async major => {
    await expect(assertOrderActionResults(fixture('done', false, major), 1, { odoo_state: 'done' })).resolves.toBeUndefined()
  })
  it('requires the locked flag in Odoo 17 rather than accepting sale as done', async () => {
    await expect(assertOrderActionResults(fixture(), 1, { odoo_state: 'done' })).rejects.toThrow('locking')
    await expect(assertOrderActionResults(fixture('sale', true), 1, { odoo_state: 'done' })).resolves.toBeUndefined()
  })
  it.each(['sale', 'cancel'])('detects a silently failed %s workflow', async target => {
    await expect(assertOrderActionResults(fixture('draft'), 1, { odoo_state: target })).rejects.toThrow('did not complete')
  })
  it('detects a transfer wizard returned without validating the picking', async () => {
    await expect(assertOrderActionResults(fixture('sale', false, 17, 'assigned'), 1, { picking_action: 'create_and_validate' })).rejects.toThrow('picking action')
  })
  it('does not require a stock transfer for a service-only order', async () => {
    const client = fixture()
    ;(client.searchRead as jest.Mock).mockResolvedValue([{ state: 'sale', picking_ids: [] }])
    await expect(assertOrderActionResults(client, 1, { picking_action: 'create_and_validate' })).resolves.toBeUndefined()
  })
  it('detects a draft invoice after failed posting', async () => {
    await expect(assertOrderActionResults(fixture('sale', false, 17, 'done', 'draft'), 1, { invoice_action: 'create_and_post' })).rejects.toThrow('posting')
  })
  it('requires a created invoice instead of accepting an empty result', async () => {
    const client = fixture()
    ;(client.searchRead as jest.Mock).mockResolvedValue([{ state: 'sale', invoice_ids: [] }])
    await expect(assertOrderActionResults(client, 1, { invoice_action: 'create' })).rejects.toThrow('creation')
  })
  it('detects a cancellation that left the invoice posted', async () => {
    await expect(assertOrderActionResults(fixture(), 1, { invoice_action: 'cancel' })).rejects.toThrow('cancellation')
  })
})
