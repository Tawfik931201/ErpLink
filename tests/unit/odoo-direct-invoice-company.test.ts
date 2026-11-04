import { createDraftInvoiceForOrder } from '@/lib/sync-engine'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

function clientFor(major: number, options: { company?: unknown; journal?: boolean; failCreate?: boolean; quantity?: number; lineCount?: number; failLineRead?: boolean } = {}) {
  return {
    getMajorVersion: async () => major,
    searchRead: jest.fn(async (model: string) => {
      if (model === 'sale.order') return [{
        id: 55, name: 'S0055', partner_id: [12, 'Customer'], partner_invoice_id: [13, 'Invoice address'],
        company_id: options.company === undefined ? [7, 'Company B'] : options.company,
        currency_id: [1, 'SAR'], payment_term_id: [4, '30 days'], fiscal_position_id: [6, 'Export'], analytic_account_id: [30, 'Project'], order_line: Array.from({ length: options.lineCount ?? 1 }, (_, i) => 100 + i),
      }]
      if (model === 'sale.order.line' && options.failLineRead) throw new Error('Cannot read taxes')
      if (model === 'sale.order.line') return [{
        id: 100, product_id: [21, 'Product'], product_uom_qty: options.quantity ?? 2, price_unit: 50, discount: 10,
        tax_id: [], product_uom: [1, 'Units'], analytic_distribution: { '30': 100, '31': 50 }, analytic_tag_ids: [41, 42],
      }]
      if (model === 'account.journal') return options.journal === false ? [] : [{ id: 8 }]
      throw new Error(`Unexpected lookup: ${model}`)
    }),
    create: jest.fn(async () => {
      if (options.failCreate) throw new Error('Create response lost')
      return 88
    }),
  } as any
}

describe('direct fallback invoice accounting company', () => {
  it.each([14, 15, 16, 17])('uses the order company and preserves product accounting on Odoo %s', async major => {
    const client = clientFor(major)
    expect(await createDraftInvoiceForOrder(client, 55)).toBe(88)
    expect(client.searchRead).toHaveBeenCalledWith('account.journal', [
      ['type', '=', 'sale'], ['company_id', '=', 7],
    ], ['id'], 1)
    expect(client.searchRead.mock.calls.some(([model]: [string]) => model === 'account.account')).toBe(false)
    const values = client.create.mock.calls[0][1]
    expect(values).toMatchObject({ company_id: 7, journal_id: 8, fiscal_position_id: 6, invoice_payment_term_id: 4 })
    expect(values.invoice_line_ids[0][2]).not.toHaveProperty('account_id')
    expect(values.invoice_line_ids[0][2]).toMatchObject({ product_id: 21, quantity: 2, tax_ids: [[5, 0, 0]] })
    const valuesLine = values.invoice_line_ids[0][2]
    if (major >= 16) {
      expect(valuesLine.analytic_distribution).toEqual({ '30': 100, '31': 50 })
      expect(valuesLine).not.toHaveProperty('analytic_account_id')
    } else {
      expect(valuesLine.analytic_account_id).toBe(30)
      expect(valuesLine.analytic_tag_ids).toEqual([[6, 0, [41, 42]]])
      expect(valuesLine).not.toHaveProperty('analytic_distribution')
    }
  })

  it.each([{ company: false }, { journal: false }])('does not guess accounting when the company or its journal is unavailable (%o)', async options => {
    const client = clientFor(17, options)
    expect(await createDraftInvoiceForOrder(client, 55)).toBeNull()
    expect(client.create).not.toHaveBeenCalled()
  })

  it('does not retry a failed create after dropping fiscal position and payment terms', async () => {
    const client = clientFor(17, { failCreate: true })
    expect(await createDraftInvoiceForOrder(client, 55)).toBeNull()
    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create.mock.calls[0][1]).toMatchObject({ fiscal_position_id: 6, invoice_payment_term_id: 4 })
  })

  it('does not create a tax-free invoice when the complete line read fails', async () => {
    const client = clientFor(17, { failLineRead: true })
    expect(await createDraftInvoiceForOrder(client, 55)).toBeNull()
    expect(client.create).not.toHaveBeenCalled()
    const lineReads = client.searchRead.mock.calls.filter(([model]: [string]) => model === 'sale.order.line')
    expect(lineReads).toHaveLength(2)
    expect(lineReads.every((call: any[]) => call[2].includes('tax_id') || call[2].includes('tax_ids'))).toBe(true)
  })

  it('does not turn a cancelled zero-quantity line into one invoiced unit', async () => {
    const client = clientFor(17, { quantity: 0 })
    await createDraftInvoiceForOrder(client, 55)
    expect(client.create.mock.calls[0][1].invoice_line_ids[0][2].quantity).toBe(0)
  })

  it('requests every line instead of silently truncating orders above the default 100-line limit', async () => {
    const client = clientFor(17, { lineCount: 150 })
    await createDraftInvoiceForOrder(client, 55)
    const lineRead = client.searchRead.mock.calls.find(([model]: [string]) => model === 'sale.order.line')
    expect(lineRead[3]).toBe(150)
  })
})
