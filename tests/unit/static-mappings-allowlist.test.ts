/**
 * Regression tests for the table allowlist in src/app/actions/static-mappings.ts.
 *
 * `MappingTable` is a TypeScript union, which is erased at runtime, while the
 * action arguments come straight from the browser. Before the allowlist, any
 * signed-in user could name a different table (`subscriptions`,
 * `workspace_members`, …) and read or write it through the service-role client,
 * which bypasses RLS entirely. These tests pin that boundary.
 */

import fs from 'fs'
import path from 'path'

const mockAuth = jest.fn()

jest.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}))

// A relative specifier, not the `@/` alias: jest.mock() does not resolve the
// tsconfig path alias even though a static import of it does.
jest.mock('../../src/lib/users', () => ({
  getOrCreateDbUser: jest.fn(async (userId: string) => ({
    id: userId,
    active_workspace_id: 'ws-1',
  })),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

// Imported by path, not by the `@/lib/supabase` alias: TypeScript would resolve
// the alias to the real client, which has no `calls`. Jest resolves it to this
// same file for the action module (see the moduleNameMapper note in
// jest.config.js), so both imports share one instance — asserted below, because
// silently getting two different mocks would make every assertion vacuous.
import {
  deleteStaticMapping,
  getStaticMappings,
  saveStaticMapping,
} from '@/app/actions/static-mappings'

import { supabase } from '../mocks/supabase'

const ALLOWED = [
  'payment_method_mappings',
  'shipping_method_mappings',
  'warehouse_mappings',
  'currency_mappings',
  'tax_mappings',
  'payment_term_mappings',
  'pricelist_mappings',
] as const

const FORBIDDEN = [
  'subscriptions',
  'subscription_payments',
  'workspace_members',
  'users',
  'merchant_tokens',
  'audit_logs',
  'workspaces',
  'erp_connections',
  // Not a real table, but a caller could still try it.
  'pg_tables',
]

beforeEach(() => {
  supabase.reset()
  mockAuth.mockReset()
  mockAuth.mockResolvedValue({ userId: 'user-1' })
  // Every rejection path in the actions logs; that noise drowns the report.
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the allowlist is the real boundary', () => {
  it('the action under test really is talking to this mock', async () => {
    // Guards the guard: if the mapper ever stops substituting, the assertions
    // below would be recording into a throwaway instance while the action hit
    // the real database. This fails loudly instead.
    supabase.reset()
    await getStaticMappings('tax_mappings')
    expect(supabase.calls.length).toBeGreaterThan(0)
  })

  it('lists exactly the seven mapping tables', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/actions/static-mappings.ts'),
      'utf8'
    )
    const block = source.match(/ALLOWED_TABLES[^=]*=\s*\[([\s\S]*?)\]/)
    expect(block).not.toBeNull()
    const listed = (block![1].match(/'([a-z_]+)'/g) || []).map((s: string) => s.replace(/'/g, ''))
    expect(listed.sort()).toEqual([...ALLOWED].sort())
  })
})

describe('getStaticMappings', () => {
  it('rejects a table outside the allowlist and never queries it', async () => {
    for (const table of FORBIDDEN) {
      supabase.reset()
      const res = await getStaticMappings(table as never)
      expect(res.success).toBe(false)
      expect(res.error).toBe('Invalid table')
      // The decisive assertion: the forbidden table was never touched at all.
      expect(supabase.calls).toHaveLength(0)
    }
  })

  it('accepts every allowlisted table and scopes the read to the workspace', async () => {
    for (const table of ALLOWED) {
      supabase.reset()
      const res = await getStaticMappings(table)
      expect(res.success).toBe(true)
      expect(supabase.calls[0].table).toBe(table)
      expect(supabase.calls[0].filters).toContainEqual(['workspace_id', 'ws-1'])
    }
  })

  it('requires a signed-in user', async () => {
    mockAuth.mockResolvedValue({ userId: null })
    const res = await getStaticMappings('tax_mappings')
    expect(res.success).toBe(false)
    expect(res.error).toBe('Unauthorized')
    expect(supabase.calls).toHaveLength(0)
  })
})

describe('saveStaticMapping', () => {
  it('rejects a table outside the allowlist before any write', async () => {
    const res = await saveStaticMapping('subscriptions' as never, { amount_paid: 0 })
    expect(res.success).toBe(false)
    expect(res.error).toBe('Invalid table')
    expect(supabase.calls).toHaveLength(0)
  })

  it('always overwrites workspace_id with the caller own workspace', async () => {
    await saveStaticMapping('tax_mappings', {
      workspace_id: 'someone-elses-workspace',
      odoo_tax_id: 7,
    })
    const upsert = supabase.calls.find(c => c.op === 'upsert')
    expect(upsert).toBeDefined()
    const payload = upsert!.args[0] as Record<string, unknown>
    expect(payload.workspace_id).toBe('ws-1')
    // The legitimate value still came through.
    expect(payload.odoo_tax_id).toBe(7)
  })

  it('overwrites platform with the requested value', async () => {
    await saveStaticMapping('tax_mappings', { platform: 'shopify' }, 'salla')
    const upsert = supabase.calls.find(c => c.op === 'upsert')
    expect((upsert!.args[0] as Record<string, unknown>).platform).toBe('salla')
  })

  it('refuses to update a row the workspace does not own', async () => {
    // The mock returns no existing row, which is what another workspace's id
    // looks like from here.
    const res = await saveStaticMapping('tax_mappings', { id: 'row-of-another-workspace' })
    expect(res.success).toBe(false)
    expect(res.error).toBe('Mapping not found in this workspace')
    // Crucially, the ownership check runs before the upsert.
    expect(supabase.calls.some(c => c.op === 'upsert')).toBe(false)
  })

  it('scopes the ownership lookup to the caller workspace', async () => {
    await saveStaticMapping('tax_mappings', { id: 'some-id' })
    const lookup = supabase.calls[0]
    expect(lookup.op).toBe('select')
    expect(lookup.filters).toContainEqual(['workspace_id', 'ws-1'])
  })

  it('requires a signed-in user', async () => {
    mockAuth.mockResolvedValue({ userId: null })
    const res = await saveStaticMapping('tax_mappings', {})
    expect(res.success).toBe(false)
    expect(supabase.calls).toHaveLength(0)
  })
})

describe('deleteStaticMapping', () => {
  it('rejects a table outside the allowlist before any delete', async () => {
    const res = await deleteStaticMapping('users' as never, 'some-user-id')
    expect(res.success).toBe(false)
    expect(res.error).toBe('Invalid table')
    expect(supabase.calls).toHaveLength(0)
  })

  it('scopes the delete to the row id and the caller workspace', async () => {
    const res = await deleteStaticMapping('warehouse_mappings', 'row-1')
    expect(res.success).toBe(true)
    const del = supabase.calls.find(c => c.op === 'delete')
    expect(del).toBeDefined()
    expect(del!.filters).toContainEqual(['id', 'row-1'])
    expect(del!.filters).toContainEqual(['workspace_id', 'ws-1'])
  })

  it('requires a signed-in user', async () => {
    mockAuth.mockResolvedValue({ userId: null })
    const res = await deleteStaticMapping('warehouse_mappings', 'row-1')
    expect(res.success).toBe(false)
    expect(supabase.calls).toHaveLength(0)
  })
})
