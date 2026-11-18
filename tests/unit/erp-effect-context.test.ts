import { runErpCreateEffect, withErpCreateIdentity, withErpExecutionContext } from '../../src/lib/erp-effect-context'
import { withErpTarget } from '../../src/lib/erp-execution-target'
import type { OdooClient } from '../../src/lib/odoo-client'
import { createPreparedOrderCustomer } from '../../src/lib/orders/customer-create'
import { safeCreateOdooRecord } from '../../src/lib/sync-engine'

jest.mock('../../src/lib/sync-runtime', () => ({ supabaseAdmin: {}, logSync: jest.fn() }))

jest.mock('../../src/lib/supabase', () => {
  const rows = new Map<string, Record<string, unknown>>()
  const faults = { insert: false, update: false }
  return { supabase: { rows, faults, from: () => {
    let action = 'select'; let data: Record<string, unknown> = {}; const filters: Array<[string, unknown]> = []
    const builder = {
      insert: (value: Record<string, unknown>) => { action = 'insert'; data = value; return builder },
      update: (value: Record<string, unknown>) => { action = 'update'; data = value; return builder },
      select: () => builder,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder },
      maybeSingle: () => builder,
      then: (resolve: (value: unknown) => unknown) => {
        if ((action === 'insert' && faults.insert) || (action === 'update' && faults.update)) return Promise.resolve({ data: null, error: { code: 'DB_UNAVAILABLE' } }).then(resolve)
        if (action === 'insert') {
          const key = String(data.operation_key)
          if (rows.has(key)) return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve)
          rows.set(key, { ...data }); return Promise.resolve({ data: null, error: null }).then(resolve)
        }
        const row = [...rows.values()].find(item => filters.every(([key, value]) => item[key] === value))
        if (action === 'update' && row) Object.assign(row, data)
        return Promise.resolve({ data: row || null, error: null }).then(resolve)
      },
    }
    return builder
  } } }
})

const context = { workspaceId: 'workspace-a', platform: 'zid', storeId: 'store-a', erpConnectionId: 'erp-a', eventId: 'event-a', storeEntityId: 'entity-a', rootModel: 'sale.order' }
const effect = (operation: () => Promise<number>, values = { name: 'Order' }) => runErpCreateEffect('sale.order', values, operation, error => !!(error as { faultCode?: number })?.faultCode, Number)
const rows = () => (jest.requireMock('../../src/lib/supabase').supabase.rows as Map<string, Record<string, unknown>>)
const faults = () => (jest.requireMock('../../src/lib/supabase').supabase.faults as { insert: boolean; update: boolean })

describe('durable ERP create reservations', () => {
  beforeEach(() => { rows().clear(); faults().insert = false; faults().update = false })

  it('reuses one related customer reservation across two different orders', async () => {
    const remote = jest.fn(async () => 77)
    const client = { create: (_model: string, values: Record<string, unknown>) => runErpCreateEffect('res.partner', values, remote, () => false, Number) }
    const scope = { workspaceId: context.workspaceId, platform: 'zid' as const, storeId: context.storeId, erpConnectionId: context.erpConnectionId, connectionGeneration: 'v1', eventId: 'order.create' }
    const pending = { sourceId: 'customer-77', values: { name: 'Buyer', ref: 'buyer@example.test' } }
    const run = (order: string) => withErpTarget(scope, () => withErpExecutionContext({ ...context, storeEntityId: order }, () => createPreparedOrderCustomer(client, pending)))
    expect(await run('order-1')).toBe(77)
    expect(await run('order-2')).toBe(77)
    expect(remote).toHaveBeenCalledTimes(1)
  })

  it('does not contact ERP if the durable reservation cannot be stored', async () => {
    faults().insert = true
    const create = jest.fn(async () => 42)
    await expect(withErpExecutionContext(context, () => effect(create))).rejects.toThrow('reservation unavailable')
    expect(create).not.toHaveBeenCalled()
  })

  it('blocks replay when remote creation succeeds but result persistence fails', async () => {
    faults().update = true
    const create = jest.fn(async () => 42)
    await expect(withErpExecutionContext(context, () => effect(create))).rejects.toThrow('unknown outcome')
    faults().update = false
    await expect(withErpExecutionContext(context, () => effect(create))).rejects.toThrow('unknown outcome')
    expect(create).toHaveBeenCalledTimes(1)
    expect([...rows().values()][0].status).toBe('in_progress')
  })

  it('prevents a second external create after remote commit then lost reply, even with changed payload', async () => {
    const create = jest.fn(async () => { throw new Error('socket hang up after commit') })
    await expect(withErpExecutionContext(context, () => effect(create))).rejects.toThrow('unknown outcome')
    await expect(withErpExecutionContext(context, () => effect(create, { name: 'Changed' }))).rejects.toThrow('unknown outcome')
    expect(create).toHaveBeenCalledTimes(1)
    expect([...rows().values()][0].status).toBe('uncertain')
  })

  it('does not settle successfully when a relation helper swallows an uncertain create', async () => {
    await expect(withErpExecutionContext(context, async () => {
      try { await effect(async () => { throw new Error('timeout') }) } catch { /* Existing best-effort helpers may swallow. */ }
      return 'apparently successful'
    })).rejects.toThrow('unknown outcome')
  })

  it('allows only one create during 100 concurrent duplicate executions', async () => {
    const create = jest.fn(async () => 42)
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => withErpExecutionContext(context, () => effect(create))))
    expect(create).toHaveBeenCalledTimes(1)
    expect(results.filter(result => result.status === 'fulfilled').length).toBeGreaterThan(0)
    expect([...rows().values()][0]).toMatchObject({ status: 'succeeded', remote_id: '42' })
  })

  it('reuses a persisted result after restart/context recreation and changed main values', async () => {
    const create = jest.fn(async () => 42)
    await withErpExecutionContext(context, () => effect(create))
    expect(await withErpExecutionContext(context, () => effect(create, { name: 'Changed' }))).toBe(42)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('does not recreate an uncertain business effect after credential rotation', async () => {
    const create = jest.fn(async () => { throw new Error('response lost after commit') })
    await expect(withErpExecutionContext({ ...context, connectionGeneration: 'old-key' }, () => effect(create))).rejects.toThrow('unknown outcome')
    await expect(withErpExecutionContext({ ...context, connectionGeneration: 'new-key' }, () => effect(create))).rejects.toThrow('unknown outcome')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps separate tenants/connections and explicit product variant identities distinct', async () => {
    let nextId = 1
    const create = jest.fn(async () => nextId++)
    await Promise.all(['a', 'b', 'c'].map(suffix => withErpExecutionContext({ ...context, workspaceId: `workspace-${suffix}`, erpConnectionId: `erp-${suffix}` }, () => effect(create))))
    await withErpExecutionContext(context, async () => {
      await withErpCreateIdentity('variant-1', () => effect(create))
      await withErpCreateIdentity('variant-2', () => effect(create))
    })
    expect(create).toHaveBeenCalledTimes(5)
    expect(rows().size).toBe(5)
  })

  it('never reuses the original sale.order ID as a negative return and isolates repeated partial returns', async () => {
    let next = 80
    const remote = jest.fn(async () => next++)
    const root = () => effect(remote)
    const negative = (snapshot: string) => withErpCreateIdentity(
      'return-negative:S00080:' + snapshot,
      () => effect(remote, { name: 'RET:S00080' })
    )
    const originalId = await withErpExecutionContext(context, root)
    const firstReturn = await withErpExecutionContext(context, () => negative('one-received'))
    const replayed = await withErpExecutionContext(context, () => negative('one-received'))
    const secondPartial = await withErpExecutionContext(context, () => negative('two-received'))
    expect([originalId, firstReturn, replayed, secondPartial]).toEqual([80, 81, 81, 82])
    expect(remote).toHaveBeenCalledTimes(3)
    expect(rows().size).toBe(3)
  })

  it('permits retry following a confirmed ERP rejection', async () => {
    const fault = Object.assign(new Error('Rejected'), { faultCode: 1 })
    const create = jest.fn().mockRejectedValueOnce(fault).mockResolvedValueOnce(42)
    await expect(withErpExecutionContext(context, () => effect(create))).rejects.toThrow('Rejected')
    await expect(withErpExecutionContext(context, () => effect(create))).resolves.toBe(42)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('safeCreate keeps parent and two same-model product variants separate across a price-change replay', async () => {
    let nextId = 10
    const remote = jest.fn(async () => nextId++)
    const client = { create: (model: string, values: Record<string, unknown>) => runErpCreateEffect(model, values, remote, () => false, Number) } as unknown as OdooClient
    const sync = (price: number) => withErpExecutionContext({ ...context, rootModel: 'product.template' }, async () => [
      await safeCreateOdooRecord(client, 'product.template', { name: 'Parent', list_price: price }, {}),
      await safeCreateOdooRecord(client, 'product.template', { name: 'Small', list_price: price }, {}, 'variant:small'),
      await safeCreateOdooRecord(client, 'product.template', { name: 'Large', list_price: price }, {}, 'variant:large'),
    ])
    expect(await sync(10)).toEqual([10, 11, 12])
    expect(await sync(20)).toEqual([10, 11, 12])
    expect(remote).toHaveBeenCalledTimes(3)
  })
})
