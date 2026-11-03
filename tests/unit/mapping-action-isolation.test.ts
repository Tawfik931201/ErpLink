jest.mock('../../src/lib/auth', () => ({ getActiveUserId: async () => 'user-a' }))
jest.mock('../../src/lib/users', () => ({ getOrCreateDbUser: async () => ({ id: 'user-a', active_workspace_id: 'ws-a' }) }))
jest.mock('../../src/lib/odoo-webhook', () => ({ registerOdooWebhook: jest.fn(), unregisterOdooWebhook: jest.fn() }))
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))

import { deleteFieldMapping, saveFieldMapping } from '../../src/app/actions/field-mappings'
import { registerOdooWebhook, unregisterOdooWebhook } from '../../src/lib/odoo-webhook'
import { supabase } from '../mocks/supabase'

describe('mapping action resource ownership', () => {
  beforeEach(() => {
    supabase.reset()
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())
  it('rejects foreign edit before registering or removing any provider action', async () => {
    supabase.addMock('field_mappings', [{ id: 'foreign', workspace_id: 'ws-b', odoo_webhook_id: 99 }])
    const result = await saveFieldMapping({ id: 'foreign', name: 'attack', action: 'product.create', odooModel: 'product.template', mappings: {}, syncDirection: 'erp_to_store' })
    expect(result.success).toBe(false)
    expect(registerOdooWebhook).not.toHaveBeenCalled()
    expect(unregisterOdooWebhook).not.toHaveBeenCalled()
    expect(supabase.calls).toHaveLength(1)
    expect(supabase.calls[0].filters).toContainEqual(['workspace_id', 'ws-a'])
  })
  it('does not use a foreign connection referenced by an owned mapping during deletion', async () => {
    supabase.addMock('field_mappings', [{ id: 'own', workspace_id: 'ws-a', odoo_webhook_id: 99, erp_connection_id: 'erp-b' }])
    supabase.addMock('erp_connections', [{ id: 'erp-b', workspace_id: 'ws-b', password: 'never-decrypt' }])
    await deleteFieldMapping('own')
    expect(unregisterOdooWebhook).not.toHaveBeenCalled()
    const connectionRead = supabase.calls.find(c => c.table === 'erp_connections')
    expect(connectionRead?.filters).toEqual([['id', 'erp-b'], ['workspace_id', 'ws-a']])
  })
})
