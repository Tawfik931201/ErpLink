import fs from 'fs'
import path from 'path'

const mockAuth = jest.fn()
const mockProcessSingleMapping = jest.fn()
const mockProcessWebhookEvent = jest.fn()

jest.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

jest.mock('../../src/lib/users', () => ({
  getOrCreateDbUser: jest.fn(async (userId: string) => ({
    id: userId,
    active_workspace_id: 'ws-123',
  })),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
}))

jest.mock('../../src/lib/sync-engine', () => ({
  processSingleMapping: (...args: any[]) => mockProcessSingleMapping(...args),
  processWebhookEvent: (...args: any[]) => mockProcessWebhookEvent(...args),
}))

import { retrySyncLog } from '@/app/actions/sync-logs'

import { supabase } from '../mocks/supabase'

function readStripped(relativePath: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('retrySyncLog — handles null field_mapping_id without Postgres UUID errors', () => {
  beforeEach(() => {
    supabase.reset()
    mockAuth.mockReset()
    mockProcessSingleMapping.mockReset()
    mockProcessWebhookEvent.mockReset()
    mockAuth.mockResolvedValue({ userId: 'user-1' })
  })

  it('safely retries a Standard Mapping log where field_mapping_id is null via processWebhookEvent', async () => {
    // 1. Mock log retrieval with field_mapping_id: null
    supabase.setMockResponder((table: string, op: string) => {
      if (table === 'sync_logs' && op === 'select') {
        return {
          data: {
            id: 'log-uuid-1',
            workspace_id: 'ws-123',
            event: 'order.create',
            store_id: 'store-99',
            field_mapping_id: null,
            payload: { id: 101, total: 250 },
            status: 'failed',
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    // Mock successful processWebhookEvent
    mockProcessWebhookEvent.mockResolvedValue({
      processed: 1,
      success: 1,
      failed: 0,
      skipped: 0,
      records: [
        {
          mappingId: 'fixed_zid_order',
          mappingName: 'Fixed Mapping: zid_order',
          model: 'sale.order',
          status: 'success',
          message: 'Order synced successfully',
          odooRecordId: 42,
        },
      ],
    })

    const res = await retrySyncLog('log-uuid-1')

    expect(res.success).toBe(true)
    expect(res.status).toBe('success')

    // Proves field_mappings was NOT queried with id = null (which triggers Postgres 22P02: invalid input syntax for type uuid: "null")
    const fieldMappingQueries = supabase.calls.filter((c) => c.table === 'field_mappings')
    expect(fieldMappingQueries).toHaveLength(0)

    // Proves processWebhookEvent was invoked with the event and payload
    expect(mockProcessWebhookEvent).toHaveBeenCalledTimes(1)
    expect(mockProcessWebhookEvent).toHaveBeenCalledWith(
      'order.create',
      'store-99',
      { id: 101, total: 250 },
      undefined,
      true,
      'ws-123'
    )

    // Proves the existing log was updated in place
    const updates = supabase.calls.filter((c) => c.table === 'sync_logs' && c.op === 'update')
    expect(updates.length).toBeGreaterThan(0)
    expect(updates[0].args[0]).toMatchObject({
      status: 'success',
      odoo_record_id: 42,
      trigger_type: 'manual',
    })
  })

  it('retries custom mapping via processSingleMapping when field_mapping_id is a valid UUID', async () => {
    const validUuid = '11111111-2222-3333-4444-555555555555'

    supabase.setMockResponder((table: string, op: string) => {
      if (table === 'sync_logs' && op === 'select') {
        return {
          data: {
            id: 'log-uuid-2',
            workspace_id: 'ws-123',
            event: 'product.update',
            store_id: 'store-99',
            field_mapping_id: validUuid,
            payload: { id: 202, name: 'T-Shirt' },
            status: 'failed',
          },
          error: null,
        }
      }
      if (table === 'field_mappings' && op === 'select') {
        return {
          data: {
            id: validUuid,
            workspace_id: 'ws-123',
            name: 'Custom Product Mapping',
            odoo_model: 'product.template',
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    mockProcessSingleMapping.mockResolvedValue({
      mappingId: validUuid,
      mappingName: 'Custom Product Mapping',
      model: 'product.template',
      status: 'success',
      message: 'Product synced successfully',
      odooRecordId: 77,
    })

    const res = await retrySyncLog('log-uuid-2')

    expect(res.success).toBe(true)
    expect(res.status).toBe('success')

    // Proves field_mappings was queried with the UUID
    const fieldMappingQueries = supabase.calls.filter((c) => c.table === 'field_mappings')
    expect(fieldMappingQueries.length).toBeGreaterThan(0)

    // Proves processSingleMapping was called
    expect(mockProcessSingleMapping).toHaveBeenCalledTimes(1)
    expect(mockProcessSingleMapping).toHaveBeenCalledWith(
      expect.objectContaining({ id: validUuid }),
      'product.update',
      'store-99',
      { id: 202, name: 'T-Shirt' },
      'manual',
      'log-uuid-2'
    )
  })

  it('returns failure when processWebhookEvent records status is failed', async () => {
    supabase.setMockResponder((table: string, op: string) => {
      if (table === 'sync_logs' && op === 'select') {
        return {
          data: {
            id: 'log-uuid-3',
            workspace_id: 'ws-123',
            event: 'order.create',
            store_id: 'store-99',
            field_mapping_id: null,
            payload: { id: 303 },
            status: 'failed',
          },
          error: null,
        }
      }
      return { data: null, error: null }
    })

    mockProcessWebhookEvent.mockResolvedValue({
      processed: 1,
      success: 0,
      failed: 1,
      skipped: 0,
      records: [
        {
          mappingId: 'fixed_zid_order',
          mappingName: 'Fixed Mapping: zid_order',
          model: 'sale.order',
          status: 'failed',
          message: 'Odoo partner not found',
        },
      ],
    })

    const res = await retrySyncLog('log-uuid-3')

    expect(res.success).toBe(false)
    expect(res.status).toBe('failed')
    expect(res.error).toBe('Odoo partner not found')
  })

  it('source pin: checks UUID before querying field_mappings', () => {
    const code = readStripped('src/app/actions/sync-logs.ts')
    expect(code).toMatch(/isUuid\s*=\s*typeof log\.field_mapping_id === 'string'/)
    expect(code).toMatch(/if \(isUuid\)/)
    expect(code).toContain('processWebhookEvent(')
  })
})
