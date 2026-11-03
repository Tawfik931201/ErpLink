import type { OdooClient } from '../../src/lib/odoo-client'
import { safeCreateOdooRecord } from '../../src/lib/sync-engine'

jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

describe('Odoo create uncertain transport outcome', () => {
  it.each(['ERP request timed out after 10 seconds', 'socket hang up', 'ECONNRESET'])('does not immediately recreate after %s', async message => {
    const create = jest.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(99)
    const client = { create } as unknown as OdooClient
    await expect(safeCreateOdooRecord(client, 'product.template', { name: 'Fixture', company_id: 1 }, {}))
      .rejects.toThrow(message)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('preserves the settings fallback following an explicit XML-RPC rejection', async () => {
    const fault = Object.assign(new Error('ValidationError: settings rejected'), { faultCode: 1 })
    const create = jest.fn().mockRejectedValueOnce(fault).mockResolvedValueOnce(99)
    const write = jest.fn().mockResolvedValue(true)
    const client = { create, write } as unknown as OdooClient
    await expect(safeCreateOdooRecord(client, 'product.template', { name: 'Fixture', company_id: 1 }, {})).resolves.toBe(99)
    expect(create.mock.calls[1]).toEqual(['product.template', { name: 'Fixture' }])
    expect(write).toHaveBeenCalledWith('product.template', [99], { company_id: 1 })
  })
})
