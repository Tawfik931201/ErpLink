import type { OdooClient } from '../../src/lib/odoo-client'
import { safeWriteOdooRecord } from '../../src/lib/odoo/records'

describe('safeWriteOdooRecord Odoo compatibility fallback', () => {
  it('prunes a removed field reported as an Odoo 20 KeyError and retries the same record', async () => {
    const client = {
      write: jest.fn()
        .mockRejectedValueOnce(new Error("XML-RPC fault: KeyError: 'company_registry'"))
        .mockResolvedValueOnce(true),
    } as unknown as OdooClient

    await expect(safeWriteOdooRecord(client, 'res.partner', 11, {
      name: 'ERPTEST Company',
      vat: '310123456700004',
      company_registry: '1010203040',
    }, {})).resolves.toBe(true)

    expect(client.write).toHaveBeenNthCalledWith(1, 'res.partner', [11], {
      name: 'ERPTEST Company',
      vat: '310123456700004',
      company_registry: '1010203040',
    })
    expect(client.write).toHaveBeenNthCalledWith(2, 'res.partner', [11], {
      name: 'ERPTEST Company',
      vat: '310123456700004',
    })
  })

  it('continues pruning multiple removed fields one at a time', async () => {
    const client = {
      write: jest.fn()
        .mockRejectedValueOnce(new Error("KeyError: 'company_type'"))
        .mockRejectedValueOnce(new Error("KeyError: 'company_registry'"))
        .mockResolvedValueOnce(true),
    } as unknown as OdooClient

    await expect(safeWriteOdooRecord(client, 'res.partner', 12, {
      name: 'ERPTEST',
      company_type: 'company',
      company_registry: '1010203040',
    }, {})).resolves.toBe(true)

    expect((client.write as jest.Mock).mock.calls).toHaveLength(3)
    expect(client.write).toHaveBeenLastCalledWith('res.partner', [12], { name: 'ERPTEST' })
  })
})
