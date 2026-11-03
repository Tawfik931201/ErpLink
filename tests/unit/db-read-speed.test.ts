import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Read-speed guard (dashboard connection review, 2026-10-10).
 *
 * The app talks to the database ONLY through `@supabase/supabase-js`
 * (PostgREST over fetch — no Prisma, no ORM, no pg pool). With that design
 * the bottleneck under concurrent load is never connection count; it is
 * transfer size (select('*')), unbounded lists (no limit), and repeated
 * identical reads (no cache). This test pins the fixes so a later edit
 * cannot silently reintroduce the slow shapes:
 *
 *   1. Head-count queries must select a narrow column, never `*`.
 *   2. The three dashboard chart/stat reads must go through the single-flight
 *      ttlCache (50 concurrent loads collapse to one upstream query set).
 *   3. List queries must carry a hard row cap.
 *   4. The per-request user lookup must fetch only the columns callers read.
 *   5. The admin client list must scope subscriptions to the page's
 *      workspaces instead of a global select('*') limit 10000.
 *   6. The read-speed migration must exist with the expected indexes.
 *
 * Static scan on purpose: the rules are about source shape, and every pin
 * below was checked to fail when its rule is reverted.
 */

const SRC = (...parts: string[]) => join(__dirname, '..', '..', 'src', ...parts)
const MIGRATION = join(
  __dirname,
  '..',
  '..',
  'supabase',
  'migrations',
  '20261010_app_read_speed.sql'
)

function src(...parts: string[]): string {
  return readFileSync(SRC(...parts), 'utf8')
}

describe('dashboard head counts stay narrow', () => {
  const dashboard = () => src('app', 'actions', 'dashboard.ts')

  it("never counts with select('*')", () => {
    expect(dashboard()).not.toMatch(/\.select\('\*',\s*\{\s*count:/)
  })

  it('counts with select(\'id\')', () => {
    const matches = dashboard().match(/\.select\('id',\s*\{\s*count:\s*'exact',\s*head:\s*true\s*\}\)/g)
    // getDashboardStats (4) + getQueueOverview-style counts live elsewhere;
    // dashboard.ts itself holds 5 head counts (3x sync_logs, data_transfers, field_mappings).
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(5)
  })
})

describe('dashboard hot reads are cached single-flight', () => {
  const dashboard = () => src('app', 'actions', 'dashboard.ts')

  it.each(['dash:stats:', 'dash:events:', 'dash:activity:'])(
    'uses a ttlCache key starting with %s',
    (prefix) => {
      expect(dashboard()).toContain(prefix)
    }
  )

  it('never caches a failure (drops the key on !success)', () => {
    const occurrences = dashboard().match(/if\s*\(!res\.success\)\s*ttlCache\.delete\(key\)/g)
    expect(occurrences).not.toBeNull()
    expect(occurrences!.length).toBe(3)
  })

  it('clamps the activity window and caps its rows', () => {
    const code = dashboard()
    expect(code).toContain('safeDays')
    expect(code).toMatch(/\.limit\(5000\)/)
  })

  it('caps client-supplied limits on recent lists', () => {
    expect(dashboard()).toContain('safeLimit')
  })
})

describe('list queries carry hard caps', () => {
  it('getTransfers is bounded', () => {
    expect(src('app', 'actions', 'transfers.ts')).toMatch(/\.limit\(100\)/)
  })

  it('event distribution is bounded', () => {
    expect(src('app', 'actions', 'dashboard.ts')).toMatch(/\.limit\(2000\)/)
  })
})

describe('per-request user lookup stays lean', () => {
  it("getOrCreateDbUser never selects '*'", () => {
    const code = src('lib', 'users.ts')
    expect(code).not.toContain("select('*')")
    expect(code).toContain('active_workspace_id')
  })

  it('never selects users.phone (2026-10-10 outage: the column does not exist in all environments)', () => {
    // `phone` lives only in migration 20260805, which was never applied in
    // some environments. Selecting it fails EVERY lookup with
    // "column users.phone does not exist" and takes the whole app down,
    // because this lookup runs inside every server action. Verified live
    // 2026-10-10: id, email, name, active_workspace_id, created_at exist.
    const code = src('lib', 'users.ts')
    expect(code).not.toMatch(/\.select\([^)]*phone[^)]*\)/)
    expect(code).toContain('LEAN_USER_COLUMNS')
  })
})

describe('first-login user creation is race-safe', () => {
  // The dashboard fires ~9 parallel server actions plus a client fetch, so a
  // brand-new user's first load routinely runs two creations concurrently. A
  // plain insert made the loser crash the page with "Could not create
  // database user" (unique violation). The fix is upsert+ignoreDuplicates
  // with a re-select, pinned here so a revert fails loudly.
  const code = () => src('lib', 'users.ts')

  it('creates with upsert on id conflict, ignoring duplicates', () => {
    expect(code()).toContain("onConflict: 'id'")
    expect(code()).toContain('ignoreDuplicates: true')
  })

  it('never uses a bare insert for user creation', () => {
    expect(code()).not.toMatch(/\.insert\(\s*\[/)
  })

  it('re-reads the row after the upsert (returns the race winner)', () => {
    const lean = (code().match(/\.select\(LEAN_USER_COLUMNS\)/g) ?? [])
    // lookup + post-upsert re-read
    expect(lean.length).toBe(2)
  })

  it('logs the error code, not just the opaque object', () => {
    expect(code()).toContain('code:')
  })
})

describe('admin client list is scoped and paginatable', () => {
  const subs = () => src('app', 'actions', 'subscription-actions.ts')

  it('accepts pagination params', () => {
    expect(subs()).toMatch(/getAllClients\(params\?:\s*\{\s*limit\?:\s*number;\s*offset\?:\s*number\s*\}\)/)
  })

  it("scopes subscriptions to the page's workspaces with a lean select", () => {
    const code = subs()
    expect(code).toContain(".in('workspace_id', wsIds.length ? wsIds : ['__none__'])")
    expect(code).not.toMatch(/\.from\('subscriptions'\)\s*\.select\('\*'\)\s*\.limit\(10000\)/)
  })

  it('never selects users.phone (same 2026-10-10 outage — column may not exist)', () => {
    const code = subs()
    expect(code).toContain(".select('id, email, name, created_at', { count: 'exact' })")
    expect(code).not.toMatch(/\.from\('users'\)\s*\.select\('[^']*phone[^']*'/);
  })
})

describe('retry path fetches lean log columns', () => {
  it("retrySyncLog never selects '*' for the log", () => {
    const code = src('app', 'actions', 'sync-logs.ts')
      expect(code).toContain("'id,event,store_id,payload,field_mapping_id,erp_connection_id,connection_generation,platform'")
  })
})

describe('read-speed migration exists with the expected indexes', () => {
  const sql = () => readFileSync(MIGRATION, 'utf8')

  it.each([
    'idx_data_transfers_workspace_created',
    'idx_data_transfers_workspace_status_created',
    'idx_field_mappings_workspace',
    'idx_subscriptions_workspace_status_end',
    'idx_subscriptions_workspace_created',
    'idx_sync_queue_workspace_created',
    'idx_sync_queue_dead_workspace_died',
    'idx_webhook_inbox_orphans',
    'idx_erp_connections_workspace',
    'idx_workspaces_user_created',
    'idx_users_created',
  ])('defines %s', (index) => {
    expect(sql()).toContain(index)
  })

  it('is defensive (to_regclass guards, IF NOT EXISTS)', () => {
    const text = sql()
    expect(text).toContain('to_regclass')
    expect(text).toContain('IF NOT EXISTS')
  })
})
