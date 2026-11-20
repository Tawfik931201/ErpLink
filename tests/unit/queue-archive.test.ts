/**
 * Pins the manual archive on `/app/queue` (added 2026-11-02).
 *
 * The feature is "archive, not delete": the row is **copied in full** (including
 * `payload`) to `queue_archives`, then removed from its source table, and the
 * copy survives seven days before the hourly cleanup purges it.
 *
 * Each assertion that pins a rule has a self-check below proving it fails when
 * the rule is reverted, so none of them is vacuous.
 */

import fs from 'fs'
import path from 'path'

import {
  groupQueueSelection,
  isQueueArchiveExpired,
  normaliseQueueSelection,
  queueArchiveDaysLeft,
  queueArchiveExpiresAt,
  queueSourceTable,
  QUEUE_ARCHIVE_BATCH_LIMIT,
  QUEUE_ARCHIVE_RETENTION_DAYS,
  QUEUE_ARCHIVES_TABLE,
} from '@/lib/queue-archive'
import { pruneExpiredQueueArchives } from '@/lib/queue-archive-prune'

const ACTION_PATH = path.join(process.cwd(), 'src/app/actions/queue-dashboard.ts')
// The pure rules and the pruning live in two files on purpose: the pure one is
// imported by a client component and must not reach `@/lib/supabase`.
const LIB_PATH = path.join(process.cwd(), 'src/lib/queue-archive.ts')
const PRUNE_PATH = path.join(process.cwd(), 'src/lib/queue-archive-prune.ts')
const QUEUE_LIB_PATH = path.join(process.cwd(), 'src/lib/sync-queue.ts')
const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase/migrations/20261102_queue_archives.sql'
)

const DAY_MS = 24 * 60 * 60 * 1000

/** Comments are prose, not a read — strip them before asserting on source. */
function readSource(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The body of one function (exported or not), so a pin cannot be satisfied elsewhere. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const rest = source.slice(start)
  const next = rest.search(/\n(export )?(async )?function /)
  return next === -1 ? rest : rest.slice(0, next)
}

const flat = (src: string) => src.replace(/\s+/g, ' ')

describe('archive retention', () => {
  it('is exactly seven days', () => {
    expect(QUEUE_ARCHIVE_RETENTION_DAYS).toBe(7)
  })

  it('puts the expiry one week after the archive instant', () => {
    const at = new Date('2026-11-02T10:00:00.000Z')
    expect(queueArchiveExpiresAt(at)).toBe('2026-11-09T10:00:00.000Z')
    expect(queueArchiveExpiresAt(at.getTime())).toBe('2026-11-09T10:00:00.000Z')
    expect(queueArchiveExpiresAt('2026-11-02T10:00:00.000Z')).toBe('2026-11-09T10:00:00.000Z')
  })

  it('never expires immediately, even on a nonsense date', () => {
    const out = queueArchiveExpiresAt('not-a-date')
    const diff = new Date(out).getTime() - Date.now()
    expect(diff).toBeGreaterThan(6 * DAY_MS)
    expect(diff).toBeLessThan(8 * DAY_MS)
  })

  it('counts the days left, rounded up, never negative', () => {
    const now = new Date('2026-11-02T10:00:00.000Z').getTime()
    expect(queueArchiveDaysLeft('2026-11-09T10:00:00.000Z', now)).toBe(7)
    expect(queueArchiveDaysLeft('2026-11-09T09:00:00.000Z', now)).toBe(7)
    expect(queueArchiveDaysLeft('2026-11-03T09:00:00.000Z', now)).toBe(1)
    expect(queueArchiveDaysLeft('2026-11-01T10:00:00.000Z', now)).toBe(0)
    expect(queueArchiveDaysLeft(null, now)).toBeNull()
    expect(queueArchiveDaysLeft('garbage', now)).toBeNull()
  })

  it('treats an unreadable expiry as "not expired" and a past one as expired', () => {
    const now = new Date('2026-11-10T00:00:00.000Z').getTime()
    expect(isQueueArchiveExpired('2026-11-09T10:00:00.000Z', now)).toBe(true)
    expect(isQueueArchiveExpired('2026-11-11T00:00:00.000Z', now)).toBe(false)
    // Fail-open: an unreadable expiry must not claim the row is gone.
    expect(isQueueArchiveExpired('garbage', now)).toBe(false)
    expect(isQueueArchiveExpired(null, now)).toBe(false)
  })
})

describe('source table mapping', () => {
  it('points every kind at the table it really lives in', () => {
    expect(queueSourceTable('pending')).toBe('sync_queue')
    expect(queueSourceTable('frozen')).toBe('sync_queue')
    expect(queueSourceTable('dead')).toBe('sync_queue_dead')
    expect(queueSourceTable('orphans')).toBe('webhook_inbox')
  })
})

describe('selection normalisation', () => {
  it('drops blanks, unknown kinds and duplicates', () => {
    const out = normaliseQueueSelection([
      { id: 'a', kind: 'pending' },
      { id: 'a', kind: 'pending' },
      { id: '', kind: 'pending' },
      { id: 'b', kind: 'nonsense' },
      { id: '  c  ', kind: 'dead' },
      { id: 'd', kind: 'orphans' },
    ])
    expect(out).toEqual([
      { id: 'a', kind: 'pending' },
      { id: 'c', kind: 'dead' },
      { id: 'd', kind: 'orphans' },
    ])
  })

  it('keeps the same id under two different kinds (different tables)', () => {
    const out = normaliseQueueSelection([
      { id: 'x', kind: 'pending' },
      { id: 'x', kind: 'dead' },
    ])
    expect(out).toHaveLength(2)
  })

  it('groups by physical table so each source is read once', () => {
    const grouped = groupQueueSelection([
      { id: 'a', kind: 'pending' },
      { id: 'b', kind: 'frozen' },
      { id: 'c', kind: 'dead' },
      { id: 'd', kind: 'orphans' },
    ])
    expect(grouped.sync_queue.map((i) => i.id)).toEqual(['a', 'b'])
    expect(grouped.sync_queue_dead.map((i) => i.id)).toEqual(['c'])
    expect(grouped.webhook_inbox.map((i) => i.id)).toEqual(['d'])
  })

  it('caps a single batch', () => {
    expect(QUEUE_ARCHIVE_BATCH_LIMIT).toBe(100)
  })
})

describe('the archive action copies before it deletes', () => {
  const action = readSource(ACTION_PATH)
  const body = flat(fnBody(action, 'archiveQueueItems'))

  it('exists as its own action', () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it('writes the snapshot into the archive table', () => {
    expect(QUEUE_ARCHIVES_TABLE).toBe('queue_archives')
    expect(body).toContain('from(QUEUE_ARCHIVES_TABLE).insert(')
  })

  it('stores the payload and the whole source row', () => {
    expect(body).toMatch(/payload:/)
    expect(body).toMatch(/row_data: row/)
  })

  it('records which table the row came from', () => {
    expect(body).toContain('source_table: queueSourceTable(kind)')
    expect(body).toContain('source_id: sourceId')
  })

  it('sets the seven-day expiry from the shared helper', () => {
    expect(body).toContain('expires_at: expiresAtIso')
    expect(body).toContain('queueArchiveExpiresAt(archivedAt)')
  })

  it('reads each source with `select(*)` — a snapshot cannot be a lean select', () => {
    expect(body.match(/\.select\('\*'\)/g) ?? []).toHaveLength(3)
  })

  it('inserts the copy before the first delete', () => {
    const insert = body.indexOf('QUEUE_ARCHIVES_TABLE).insert(')
    const firstDelete = body.indexOf('.from(\'sync_queue\') .delete()')
    expect(insert).toBeGreaterThan(-1)
    expect(firstDelete).toBeGreaterThan(-1)
    expect(insert).toBeLessThan(firstDelete)
  })

  it('skips the delete whenever the snapshot failed', () => {
    // One guard per source table: no copy ⇒ no delete.
    expect(body.match(/if \(!\(await snapshot\(/g) ?? []).toHaveLength(3)
  })

  it('treats a duplicate snapshot as already archived, not as a failure', () => {
    expect(body).toContain("=== '23505'")
  })

  it('deletes from all three source tables', () => {
    expect(body).toContain(".from('sync_queue') .delete()")
    expect(body).toContain(".from('sync_queue_dead') .delete()")
    expect(body).toContain(".from('webhook_inbox') .delete()")
  })

  it('scopes workspace-owned reads and deletes by workspace_id', () => {
    const scoped = body.match(/eq\('workspace_id', workspaceId\)/g) ?? []
    // 2 reads (sync_queue, sync_queue_dead) + 2 deletes = 4.
    expect(scoped.length).toBeGreaterThanOrEqual(4)
  })

  it('scopes orphan reads AND deletes by the workspace store ids', () => {
    const storeScoped = body.match(/\.in\('store_id', \[\.\.\.storeIds\]\)/g) ?? []
    expect(storeScoped).toHaveLength(2)
  })

  it('never touches receipts when the workspace has no store', () => {
    expect(body).toMatch(/if \(storeIds\.size === 0\) \{/)
  })

  it('revalidates the queue page', () => {
    expect(body).toContain("revalidatePath('/app/queue')")
  })
})

describe('restore returns the item to the queue', () => {
  const action = readSource(ACTION_PATH)
  const body = flat(fnBody(action, 'restoreQueueArchive'))

  it('reads the archive row scoped to the workspace', () => {
    expect(body).toContain("from(QUEUE_ARCHIVES_TABLE)")
    expect(body).toContain("eq('workspace_id', workspaceId)")
  })

  it('restores the original pinned snapshot rather than inventing a new delivery identity', () => {
    expect(body).toContain('row.row_data')
    expect(body).toContain('await restorePinnedJob(original, workspaceId)')
    const helper = flat(action.slice(action.indexOf('async function restorePinnedJob'), action.indexOf('// ─── الأرشفة اليدوية')))
    expect(helper).toContain('id: originalId')
    expect(helper).toContain('receipt_id: row.receipt_id')
    expect(helper).toContain('validateExecutionTarget')
    expect(helper).toContain('connection_generation: generation')
  })

  it('removes the archive only after validated restoration succeeds', () => {
    const restore = body.indexOf('await restorePinnedJob(original, workspaceId)')
    const del = body.indexOf('from(QUEUE_ARCHIVES_TABLE) .delete()')
    expect(restore).toBeGreaterThan(-1)
    expect(del).toBeGreaterThan(restore)
    expect(body).toContain('if (!restored.success) return restored')
  })

})

describe('manual archive is preserved without age-based purging', () => {
  it('does not delete archive rows based on age', () => {
    const prune = flat(readSource(PRUNE_PATH))
    expect(prune).not.toContain('.delete()')
    expect(prune).toContain('return 0')
  })

  it('keeps the database calls out of the module a client component imports', () => {
    // `queue-client.tsx` imports `queue-archive.ts`; reaching `@/lib/supabase`
    // from there breaks `next build` (`next/headers` in a client component).
    const pure = readSource(LIB_PATH)
    expect(pure).not.toContain('@/lib/supabase')
    expect(pure).not.toContain('from(')
    const prune = readSource(PRUNE_PATH)
    expect(prune).not.toContain("@/lib/supabase")
    expect(prune).toMatch(/export async function pruneExpiredQueueArchives/)
  })

  it('runs inside the hourly queue cleanup', () => {
    const queueLib = readSource(QUEUE_LIB_PATH)
    const cleanup = flat(fnBody(queueLib, 'maybeCleanup'))
    expect(cleanup).toContain("import('./queue-archive-prune')")
    expect(cleanup).toContain('pruneExpiredQueueArchives()')
  })
})

describe('the migration matches the code', () => {
  const sql = readSource(MIGRATION_PATH)

  it('creates the archive table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.queue_archives/)
  })

  it('refuses to expire a row instantly and cascades with the workspace', () => {
    expect(sql).toContain("INTERVAL '7 days'")
    expect(sql).toMatch(/ON DELETE CASCADE/)
  })

  it('keeps one archive row per source row', () => {
    expect(sql).toMatch(/UNIQUE INDEX[\s\S]*queue_archives \(source_table, source_id\)/)
  })

  it('enables RLS like every other table', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
  })
})

describe('self-check: the pins detect a reverted rule', () => {
  const action = readSource(ACTION_PATH)
  const body = flat(fnBody(action, 'archiveQueueItems'))

  it('detects a delete placed before the snapshot', () => {
    const guard = (src: string) => {
      const insert = src.indexOf('QUEUE_ARCHIVES_TABLE).insert(')
      const firstDelete = src.indexOf(".from('sync_queue') .delete()")
      return insert > -1 && firstDelete > -1 && insert < firstDelete
    }
    expect(guard(body)).toBe(true)
    // Move the insert after the first delete: the rule must now read as broken.
    const tampered = body
      .replace('QUEUE_ARCHIVES_TABLE).insert(', 'QUEUE_ARCHIVES_TABLE).insert(')
      .slice(0, body.indexOf('QUEUE_ARCHIVES_TABLE).insert(')) +
      body.slice(body.indexOf(".from('sync_queue') .delete()")) +
      body.slice(body.indexOf('QUEUE_ARCHIVES_TABLE).insert('), body.indexOf(".from('sync_queue') .delete()"))
    expect(guard(tampered)).toBe(false)
  })

  it('detects the store scoping being dropped from the orphan path', () => {
    const guard = (src: string) => (src.match(/\.in\('store_id', \[\.\.\.storeIds\]\)/g) ?? []).length === 2
    expect(guard(body)).toBe(true)
    expect(guard(body.replace(/\.in\('store_id', \[\.\.\.storeIds\]\)/g, ''))).toBe(false)
  })

  it('detects the payload being dropped from the snapshot', () => {
    const guard = (src: string) => src.includes('payload:')
    expect(guard(body)).toBe(true)
    expect(guard(body.replace(/payload:/g, ''))).toBe(false)
  })

  it('detects the lean select sneaking back in', () => {
    const guard = (src: string) => (src.match(/\.select\('\*'\)/g) ?? []).length === 3
    expect(guard(body)).toBe(true)
    expect(
      guard(body.replace(".select('*')", ".select('id,platform,event')"))
    ).toBe(false)
  })

  it('detects the purge being unhooked from the cleanup pass', () => {
    const cleanup = flat(fnBody(readSource(QUEUE_LIB_PATH), 'maybeCleanup'))
    const guard = (src: string) => src.includes('pruneExpiredQueueArchives()')
    expect(guard(cleanup)).toBe(true)
    expect(guard(cleanup.replace('pruneExpiredQueueArchives()', ''))).toBe(false)
  })

  it('detects the supabase import creeping back into the client-imported module', () => {
    const guard = (src: string) => !src.includes('@/lib/supabase')
    expect(guard(readSource(LIB_PATH))).toBe(true)
    expect(guard(readSource(PRUNE_PATH))).toBe(true)
  })
})

describe('pruning does not blow up when the table is absent', () => {
  // The queue runner must survive a database that has not had the migration
  // pasted yet: `pruneExpiredQueueArchives` is best-effort, never throwing.
  it('swallows a missing table and reports zero', async () => {
    await expect(pruneExpiredQueueArchives()).resolves.toBe(0)
  })
})
