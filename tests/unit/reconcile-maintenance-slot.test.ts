import { claimZidMaintenanceSlot, maintenanceIntervalSeconds } from '../../src/lib/reconcile-maintenance-slot'
import { supabase } from '../../src/lib/supabase'

jest.mock('../../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}))

const rpc = supabase.rpc as jest.Mock

beforeEach(() => rpc.mockReset())

it('bounds maintenance intervals without permitting a tight background loop', () => {
  expect(maintenanceIntervalSeconds(0)).toBe(60)
  expect(maintenanceIntervalSeconds(600_000)).toBe(600)
  expect(maintenanceIntervalSeconds(9_000_000)).toBe(3600)
  expect(maintenanceIntervalSeconds(Number.NaN)).toBe(600)
})

it('claims the right independently namespaced slot for each Zid recovery job', async () => {
  rpc.mockResolvedValue({ data: true, error: null })
  expect(await claimZidMaintenanceSlot('orders', 600_000)).toBe(true)
  expect(await claimZidMaintenanceSlot('categories', 600_000)).toBe(true)
  expect(rpc.mock.calls).toEqual([
    ['claim_erp_maintenance_slot', { p_name: 'zid_orders_reconcile_v1', p_interval_seconds: 600 }],
    ['claim_erp_maintenance_slot', { p_name: 'zid_category_delete_audit_v1', p_interval_seconds: 600 }],
  ])
})

it('skips the redundant cycle when another process owns that slot', async () => {
  rpc.mockResolvedValue({ data: false, error: null })
  expect(await claimZidMaintenanceSlot('orders')).toBe(false)
})

it('preserves reconciliation if the additive DB migration is not yet installed', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
  expect(await claimZidMaintenanceSlot('orders')).toBe(true)
})
