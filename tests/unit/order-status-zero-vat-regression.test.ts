import type { OdooClient } from '@/lib/odoo-client'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: {},
  logSync: jest.fn(),
}))
jest.mock('../../src/lib/auto-bootstrap', () => ({ getSmartDefaultOrderState: jest.fn(() => 'draft') }))
jest.mock('../../src/lib/entity-links', () => ({ upsertEntityLink: jest.fn() }))
jest.mock('../../src/lib/odoo/order-payment', () => ({
  reconcilePendingPaymentsForOrder: jest.fn(),
  syncOrderPayment: jest.fn(async () => ({})),
}))
jest.mock('../../src/lib/sync/settings', () => ({
  getCachedStandardMappingSettings: jest.fn(),
}))
jest.mock('../../src/lib/odoo/field-meta', () => ({ getSaleOrderSelectionKeys: jest.fn() }))

import { ensureSaleOrderTaxes } from '../../src/lib/odoo/order-workflow'
import { getCachedStandardMappingSettings } from '../../src/lib/sync/settings'

const settings = getCachedStandardMappingSettings as jest.Mock

function clientFor(major: number, initialTaxes: number[][], canWrite = true) {
  const lines = initialTaxes.map((tax_ids, index) => ({
    id: index + 1, name: index ? 'Shipping' : 'Product',
    tax_ids, tax_id: tax_ids,
  }))
  const client = {
    getMajorVersion: jest.fn(async () => major),
    searchRead: jest.fn(async () => lines),
    write: jest.fn(async (_model: string, ids: number[], values: Record<string, unknown>) => {
      if (canWrite) {
        const command = values.tax_ids || values.tax_id
        for (const id of ids) {
          const taxIds = (command as number[][][])[0][2]
          lines[id - 1].tax_ids = taxIds
          lines[id - 1].tax_id = taxIds
        }
      }
      return canWrite
    }),
  }
  return { client: client as unknown as OdooClient, lines }
}

describe('enforce configured order taxes after Zid status writes', () => {
  beforeEach(() => settings.mockReset())

  it.each([14, 15, 16, 17, 18, 19, 20])(
    'Odoo %i: clears inherited 15%% VAT on both product and shipping in disabled-VAT mode',
    async version => {
      settings.mockResolvedValue({ enable_vat: false })
      const { client, lines } = clientFor(version, [[5], [5]])
      await ensureSaleOrderTaxes(client, 47, { id: 502216416 }, 'ws-test', 'zid', '', true)
      expect(client.write).toHaveBeenCalledTimes(1)
      expect(client.write).toHaveBeenCalledWith('sale.order.line', [1, 2],
        { [version >= 18 ? 'tax_ids' : 'tax_id']: [[6, 0, []]] })
      expect(lines.map(l => l.tax_ids)).toEqual([[], []])
    })

  it('also clears inherited VAT if enable_vat setting is absent and defaults disabled', async () => {
    settings.mockResolvedValue({ order: {} })
    const { client } = clientFor(19, [[5]])
    await ensureSaleOrderTaxes(client, 48, { id: 502216440 }, 'ws-test', 'zid', '', true)
    expect(client.write).toHaveBeenCalledWith('sale.order.line', [1], { tax_ids: [[6, 0, []]] })
  })

  it('does not perform an unnecessary Odoo write when zero-tax lines are already correct', async () => {
    settings.mockResolvedValue({ enable_vat: false })
    const { client } = clientFor(19, [[], []])
    await ensureSaleOrderTaxes(client, 47, { id: 502216416 }, 'ws-test', 'zid', '', true)
    expect(client.write).not.toHaveBeenCalled()
  })

  it('fails the event instead of marking it successful when Odoo rejects tax correction', async () => {
    settings.mockResolvedValue({ enable_vat: false })
    const { client } = clientFor(19, [[5]], false)
    await expect(ensureSaleOrderTaxes(client, 47, { id: 502216416 },
      'ws-test', 'zid', '', true)).rejects.toThrow('Odoo rejected the configured order taxes')
  })

  it('preserves an explicitly configured VAT regime instead of clearing its correct tax', async () => {
    settings.mockResolvedValue({ enable_vat: true, vat_saudi_tax_id: 5 })
    const { client } = clientFor(19, [[5]])
    await ensureSaleOrderTaxes(client, 47, {
      id: 502216416, shipping_address: { country: 'SA' },
    }, 'ws-test', 'zid', '', true)
    expect(client.write).not.toHaveBeenCalled()
  })
})
