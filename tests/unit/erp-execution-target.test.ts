import { resolveEntityLinkId } from '../../src/lib/entity-links'
import { connectionGeneration, resolveExecutionTarget, validateExecutionTarget, withErpTarget, getErpExecutionScope, resolveOwnedStorePlatform } from '../../src/lib/erp-execution-target'
import type { CommercePlatform } from '../../src/lib/erp-execution-target'
import { supabase } from '../mocks/supabase'

const connections = ['a', 'b', 'c'].map((id, i) => ({ id: `erp-${id}`, workspace_id: `ws-${id}`, url: `https://${id}.example`, username: `user-${id}`, password: `cipher-${id}`, db_name: `db-${id}`, erp_type: i === 2 ? 'erpnext' : 'odoo', status: 'connected' }))
beforeEach(() => {
  supabase.reset()
  supabase.addMock('erp_connections', connections)
  supabase.addMock('erp_workspace_bindings', connections.map(connection => ({ workspace_id: connection.workspace_id, erp_connection_id: connection.id, erp_type: connection.erp_type, url: connection.url, db_name: connection.db_name })))
  supabase.addMock('merchant_tokens', [{ workspace_id: 'ws-a', merchant_id: 'a' }, { workspace_id: 'ws-c', merchant_id: 'c' }])
  supabase.addMock('salla_tokens', [{ workspace_id: 'ws-b', merchant_id: 'b' }])
})

it('keeps three concurrent tenant targets and async scopes separate', async () => {
  const observations = await Promise.all(['a', 'b', 'c'].map(async id => {
    const platform: CommercePlatform = id === 'b' ? 'salla' : 'zid'
    const target = await resolveExecutionTarget(`ws-${id}`, platform, id)
    const connection = await validateExecutionTarget(`ws-${id}`, platform, id, target)
    return withErpTarget({ ...target, platform, workspaceId: `ws-${id}`, storeId: id, eventId: `event-${id}` }, async () => {
      await Promise.resolve()
      return [getErpExecutionScope()?.erpConnectionId, connection.username, connection.erp_type]
    })
  }))
  expect(observations).toEqual([['erp-a', 'user-a', 'odoo'], ['erp-b', 'user-b', 'odoo'], ['erp-c', 'user-c', 'erpnext']])
})

it('rejects another tenant connection, forged store workspace, deleted connection and rotation', async () => {
  const target = await resolveExecutionTarget('ws-a', 'zid', 'a')
  await expect(validateExecutionTarget('ws-a', 'zid', 'a', { ...target, erpConnectionId: 'erp-b' })).rejects.toThrow('outside workspace')
  await expect(resolveExecutionTarget('ws-a', 'salla', 'b')).rejects.toThrow('Store does not belong')
  supabase.addMock('erp_connections', [{ ...connections[0], password: 'rotated' }])
  await expect(validateExecutionTarget('ws-a', 'zid', 'a', target)).rejects.toThrow('generation changed')
  const rotated = await resolveExecutionTarget('ws-a', 'zid', 'a')
  expect(rotated.connectionGeneration).not.toBe(target.connectionGeneration)
  supabase.addMock('erp_connections', [])
  await expect(validateExecutionTarget('ws-a', 'zid', 'a', target)).rejects.toThrow('missing')
})

it('rejects unpinned jobs and disabled connections', async () => {
  await expect(validateExecutionTarget('ws-a', 'zid', 'a', { erpConnectionId: '', connectionGeneration: '' })).rejects.toThrow('Unpinned')
  supabase.addMock('erp_connections', [{ ...connections[0], status: 'disabled' }])
  await expect(resolveExecutionTarget('ws-a', 'zid', 'a')).rejects.toThrow('active')
})

it.each(['url', 'db_name', 'id'])('uses a replacement %s for new store events after the mapping switch', async field => {
  const oldTarget = await resolveExecutionTarget('ws-a', 'zid', 'a')
  const replacement = { ...connections[0], [field]: `replacement-${field}` }
  supabase.addMock('erp_connections', [replacement])
  const switchDestination = jest.spyOn(supabase, 'rpc')
    .mockResolvedValue({ data: true, error: null } as never)
  try {
    await expect(validateExecutionTarget('ws-a', 'zid', 'a', oldTarget)).rejects.toThrow()
    expect(switchDestination).not.toHaveBeenCalled()
    await expect(resolveExecutionTarget('ws-a', 'zid', 'a')).resolves.toEqual({
      erpConnectionId: replacement.id, connectionGeneration: connectionGeneration(replacement),
    })
    expect(switchDestination).toHaveBeenCalledWith('switch_erp_mapping_destination', {
      p_workspace_id: 'ws-a', p_connection_id: replacement.id,
      p_erp_type: 'odoo', p_url: replacement.url, p_db_name: replacement.db_name,
    })
  } finally {
    switchDestination.mockRestore()
  }
})

it('binds a new workspace once and rereads the winner without updating an existing resource', async () => {
  let saved: Record<string, unknown> | null = null
  supabase.setMockResponder((table, op) => {
    if (table !== 'erp_workspace_bindings') return undefined
    if (op === 'select') return { data: saved, error: null }
    const inserted = supabase.calls.find(c => c.table === table && c.op === 'insert')
    saved = inserted?.args[0] as Record<string, unknown>
    return { data: null, error: null }
  })
  const target = await resolveExecutionTarget('ws-a', 'zid', 'a')
  expect(target.erpConnectionId).toBe('erp-a')
  expect(saved).toMatchObject({ erp_connection_id: 'erp-a', url: 'https://a.example', db_name: 'db-a' })
  expect(saved).not.toHaveProperty('password')
  await resolveExecutionTarget('ws-a', 'zid', 'a')
  expect(supabase.calls.filter(c => c.table === 'erp_workspace_bindings' && c.op === 'insert')).toHaveLength(1)
  expect(supabase.calls.some(c => c.table === 'erp_workspace_bindings' && c.op === 'update')).toBe(false)
})

it('resolves outbound Zid from owned tokens regardless of product.create naming and rejects ambiguous IDs', async () => {
  expect(await resolveOwnedStorePlatform('ws-a', 'a')).toBe('zid')
  expect(await resolveOwnedStorePlatform('ws-b', 'b')).toBe('salla')
  supabase.addMock('salla_tokens', [{ workspace_id: 'ws-a', merchant_id: 'a' }])
  await expect(resolveOwnedStorePlatform('ws-a', 'a')).rejects.toThrow('ambiguous')
})

it('excludes stale connection generations and unpinned legacy entity links', async () => {
  const key = { workspaceId: 'ws-a', platform: 'zid' as const, storeId: 'a', odooModel: 'sale.order', storeEntityId: '1', erpConnectionId: 'erp-a', connectionGeneration: connectionGeneration(connections[0]) }
  supabase.addMock('odoo_entity_links', [
    { workspace_id: 'ws-a', platform: 'zid', store_id: 'a', odoo_model: 'sale.order', store_entity_id: '1', erp_connection_id: 'erp-a', connection_generation: 'old', odoo_record_id: 1 },
    { workspace_id: 'ws-a', platform: 'zid', store_id: 'a', odoo_model: 'sale.order', store_entity_id: '1', erp_connection_id: 'erp-b', connection_generation: key.connectionGeneration, odoo_record_id: 2 },
  ])
  expect(await resolveEntityLinkId(key)).toBeNull()
  expect(await resolveEntityLinkId({ ...key, erpConnectionId: undefined, connectionGeneration: undefined })).toBeNull()
})
