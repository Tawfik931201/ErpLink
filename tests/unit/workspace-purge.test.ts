/**
 * Workspace purge pins (season plan add-on: deleting a workspace must delete
 * everything belonging to it).
 *
 * The old deleteWorkspace removed only the workspace row, trusting FK
 * cascades — but whole tables have no FK at all (sync_logs, field_mappings,
 * erp_connections were created outside migrations) and webhook_inbox is
 * ON DELETE SET NULL, so a deleted workspace left logs, queues, tokens and
 * settings orphaned forever. purgeWorkspaceData deletes everything
 * explicitly before the row goes. Pinned here:
 *   1. the FK-less/dangling tables are all in the purge list,
 *   2. audit_logs is deliberately excluded (append-only, no workspace key),
 *   3. deleteWorkspace purges BEFORE deleting the row and clears every
 *      user's active pointer (not just the deleter's).
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  // normalize CRLF: route/action files use Windows line endings
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8').replace(/\r/g, '')
}

// Tables that provably lack a cascading FK (created outside migrations, or
// SET NULL): if any of these is missing from the purge list, deleting a
// workspace leaks its rows forever.
const MUST_PURGE = [
  'sync_queue',
  'webhook_inbox',
  'sync_queue_dead',
  'sync_logs',
  'data_transfers',
  'custom_odoo_fields',
  'field_mappings',
  'fixed_mappings',
  'product_mappings',
  'category_mappings',
  'standard_mapping_settings',
  'subscriptions',
  'merchant_tokens',
  'salla_tokens',
  'shopify_tokens',
  'erp_connections',
  'telegram_bots',
  'telegram_bot_chats',
  'telegram_bot_codes',
  'workspace_members',
  'workspace_invitations',
]

describe('purgeWorkspaceData inventory', () => {
  const purge = readSrc('lib', 'workspace-purge.ts')

  it.each(MUST_PURGE)('purges %s explicitly', (table) => {
    expect(purge).toContain(`'${table}'`)
  })

  it('deliberately excludes the append-only audit trail', () => {
    expect(purge).not.toContain("'audit_logs'")
    expect(purge).toContain('audit_logs')
  })

  it('clears every active-workspace pointer, not just the deleter', () => {
    expect(purge).toContain('active_workspace_id')
  })

  it('unregisters platform webhooks best-effort before deleting tokens', () => {
    expect(purge).toContain('unregisterAllZidWebhooks')
    expect(purge).toContain('unregisterSallaWebhooks')
    expect(purge).toContain('unregisterShopifyWebhooks')
  })
})

describe('deleteWorkspace wiring', () => {
  const actions = readSrc('app', 'actions', 'workspaces.ts')

  it('purges before deleting the workspace row', () => {
    const selectIdx = actions.indexOf(".from('workspaces')")
    const purgeIdx = actions.indexOf('purgeWorkspaceData(id)')
    const rowDeleteIdx = actions.indexOf(".from('workspaces')\n      .delete()")
    expect(selectIdx).toBeGreaterThan(-1)
    expect(purgeIdx).toBeGreaterThan(-1)
    expect(rowDeleteIdx).toBeGreaterThan(-1)
    // ownership check → full purge → row delete, in that order
    expect(selectIdx).toBeLessThan(purgeIdx)
    expect(purgeIdx).toBeLessThan(rowDeleteIdx)
  })
})
