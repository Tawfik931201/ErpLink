import {
  hasNewerSuccessfulProductVersion, isStaleZidProductEvent, zidProductVersion,
} from '@/lib/zid/product-version-fence'
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { supabaseAdmin } from '@/lib/sync-runtime'

jest.mock('@/lib/erp-execution-target', () => ({
  getErpExecutionScope: jest.fn(),
}))
jest.mock('@/lib/sync-runtime', () => ({
  supabaseAdmin: { from: jest.fn() },
}))

const from = supabaseAdmin.from as jest.Mock
const scope = getErpExecutionScope as jest.Mock

function history(rows: Array<{ payload: unknown }>, error: unknown = null) {
  const builder: Record<string, jest.Mock> = {}
  for (const method of ['select', 'eq', 'order']) {
    builder[method] = jest.fn(() => builder)
  }
  builder.limit = jest.fn(async () => ({ data: rows, error }))
  from.mockReturnValue(builder)
  return builder
}

describe('durable Zid product source-version fence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    scope.mockReturnValue({
      workspaceId: 'ws-test', storeId: '3172448', platform: 'zid',
      erpConnectionId: 'connection-1', connectionGeneration: 'generation-1',
    })
  })

  it('rejects a delayed publish behind a successful newer update', () => {
    const obsolete = { id: 'p1', price: 301, updated_at: '2026-11-18T00:54:35.079Z' }
    const newSuccess = { payload: { id: 'p1', price: 501, updated_at: '2026-11-18T00:55:38.509Z' } }
    expect(hasNewerSuccessfulProductVersion(obsolete, [newSuccess])).toBe(true)
  })

  it('accepts the first write, newer write and equal version timestamps', () => {
    const current = { updated_at: '2026-11-18T00:55:38.509Z' }
    expect(hasNewerSuccessfulProductVersion(current, [])).toBe(false)
    expect(hasNewerSuccessfulProductVersion(current, [{ payload: { updated_at: '2026-11-18T00:54:35Z' } }])).toBe(false)
    expect(hasNewerSuccessfulProductVersion(current, [{ payload: { updated_at: current.updated_at } }])).toBe(false)
    expect(zidProductVersion({ data: current })).toBe(Date.parse(current.updated_at))
  })

  it('only compares valid versions and ignores unknown payload shapes', () => {
    const incoming = { updated_at: '2026-11-18T00:55:38Z' }
    expect(hasNewerSuccessfulProductVersion(incoming, [
      { payload: 'not-a-product' }, { payload: null },
      { payload: { updated_at: 'invalid-date' } },
    ])).toBe(false)
  })

  it('scopes comparison to workspace, store, ERP generation, product and success', async () => {
    const builder = history([{ payload: { updated_at: '2026-11-18T00:55:38Z' } }])
    expect(await isStaleZidProductEvent(
      'ws-test', '3172448', 'p1', { updated_at: '2026-11-18T00:54:35Z' }
    )).toBe(true)
    expect(from).toHaveBeenCalledWith('sync_logs')
    expect(builder.eq.mock.calls).toEqual(expect.arrayContaining([
      ['workspace_id', 'ws-test'], ['store_id', '3172448'],
      ['zid_entity_id', 'p1'], ['platform', 'zid'],
      ['erp_connection_id', 'connection-1'], ['connection_generation', 'generation-1'],
      ['status', 'success'],
    ]))
  })

  it('fails closed when history cannot be queried and rejects unpinned scope', async () => {
    history([], { message: 'db down' })
    await expect(isStaleZidProductEvent(
      'ws-test', '3172448', 'p1', { updated_at: '2026-11-18T00:54:35Z' }
    )).rejects.toThrow('lookup unavailable')
    scope.mockReturnValue({ workspaceId: 'different-tenant' })
    await expect(isStaleZidProductEvent(
      'ws-test', '3172448', 'p1', { updated_at: '2026-11-18T00:54:35Z' }
    )).rejects.toThrow('pinned ERP destination')
  })

  it('does not block unversioned events just because they lack timestamps', async () => {
    expect(await isStaleZidProductEvent('ws-test', '3172448', 'p1', { id: 'p1' })).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })
})
