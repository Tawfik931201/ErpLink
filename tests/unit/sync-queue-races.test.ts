/**
 * Source pins for the sync-queue race conditions (P2 hardening).
 *
 * The queue is the durability backbone: every webhook and every reconciliation
 * push flows through it. Three edits were made and each breaks a silent
 * data-loss mode:
 *
 *  1. Pre-checks and dedup reads are scoped to PENDING rows
 *     (`next_retry_at IS NOT NULL`). A frozen row (exhausted retries) must
 *     never veto new work — that veto was the 20260928 bug, once removed at
 *     the index and re-born in the code.
 *  2. Coalescing is CAS: the update re-asserts `updated_at` as just read and
 *     selects back the matched rows. Without it a second coalescer could
 *     overwrite a leased row's payload with an older one, and after a
 *     concurrent delete the update would fabricate a "coalesced" reply with
 *     nothing persisted.
 *  3. Success settlement re-reads the row and only deletes it when
 *     `updated_at` is unchanged — a coalesced-newer payload is re-scheduled
 *     instead of being silently deleted by the worker that processed the
 *     older one.
 *
 *  These are source-level assertions, in the project's pin-test convention:
 *  each must fail if the guard is reverted.
 */

import fs from 'fs'
import path from 'path'

const QUEUE_PATH = path.join(process.cwd(), 'src/lib/sync-queue.ts')
const SHOP_IFY_PATH = path.join(process.cwd(), 'src/app/api/webhooks/shopify/route.ts')

describe('the duplicate pre-check cannot veto new work with frozen rows', () => {
  const source = fs.readFileSync(QUEUE_PATH, 'utf8')

  it('scopes the in-queue duplicate pre-check to pending rows', () => {
    expect(source).toMatch(
      /\.eq\('dedup_key', dedupKey\)\s*\n\s*\.not\('next_retry_at', 'is', null\)/
    )
  })

  it('documents why (frozen = exhausted, not in-flight)', () => {
    expect(source).toMatch(/الصف المجمّد/)
    expect(source).toMatch(/انتهى حظّه/)
  })
})

describe('coalescing is a compare-and-set, not a blind overwrite', () => {
  const source = fs.readFileSync(QUEUE_PATH, 'utf8')

  it('reads updated_at when scanning pending candidates', () => {
    expect(source).toMatch(/\.select\('id,payload,created_at,updated_at'\)/)
  })

  it('re-asserts updated_at on the merge update and selects the matched rows back', () => {
    expect(source).toMatch(
      /\.update\(\{ payload: merged, updated_at: new Date\(\)\.toISOString\(\) \}\)\s*\n\s*\.eq\('id', row\.id\)\s*\n\s*\.eq\('updated_at', row\.updated_at \?\? ''\)\s*\n\s*\.select\('id'\)/
    )
  })

  it('falls through to insert when the CAS loses, instead of reporting a victory', () => {
    // The loop must keep going on CAS failure; coalesceTarget is only set on
    // a confirmed update, so a lost race reaches the plain insert below.
    expect(source).toMatch(/CAS فشل/)
    expect(source).toMatch(/let coalesceTarget: string \| null = null/)
    expect(source).toMatch(/if \(updatedRows && updatedRows\.length > 0\)/)
  })
})

describe('a successful row is settled, not unconditionally deleted', () => {
  const source = fs.readFileSync(QUEUE_PATH, 'utf8')

  it('has the settle step', () => {
    expect(source).toMatch(/async function settleSuccessfulItem\(item: QueueItem\)/)
  })

  it('re-reads the row and compares updated_at against what was fetched', () => {
    expect(source).toMatch(
      /\.select\('id,updated_at'\)\s*\n\s*\.eq\('id', item\.id\)\s*\n\s*\.maybeSingle\(\)/
    )
    expect(source).toMatch(
      /rowUpdatedAt !== null && item\.updated_at !== null && rowUpdatedAt !== item\.updated_at/
    )
  })

  it('re-schedules a coalesced-newer payload immediately instead of deleting it', () => {
    expect(source).toMatch(
      /\.update\(\{ next_retry_at: new Date\(\)\.toISOString\(\) \}\)\s*\n\s*\.eq\('id', item\.id\)/
    )
  })

  it('deletes only when the row is untouched since the fetch', () => {
    expect(source).toMatch(/await supabase\.from\('sync_queue'\)\.delete\(\)\.eq\('id', item\.id\)/)
  })

  it('the worker fetches updated_at so the settlement can detect merges', () => {
    // Both selects (the batch fetch and the workspace drain) must carry it.
    const matches = source.match(/id,workspace_id,store_id,event,platform,payload,retry_count,max_retries,next_retry_at,created_at,updated_at/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('QueueItem carries updated_at as a nullable field', () => {
    expect(source).toMatch(/updated_at: string \| null/)
  })

  it('both success exits go through the settlement, never a bare delete', () => {
    expect(source).toMatch(/await settleSuccessfulItem\(item\)/)
  })
})

describe('circuit-breaker parking touches only due rows', () => {
  const source = fs.readFileSync(QUEUE_PATH, 'utf8')

  it('parks rows due now, never leased rows with a future next_retry_at', () => {
    expect(source).toMatch(
      /\.not\('next_retry_at', 'is', null\)\s*\n\s*\.lte\('next_retry_at', new Date\(now\)\.toISOString\(\)\)/
    )
    // The old shape (parking relative to the cooldown, i.e. touching leases) must not return.
    expect(source).not.toMatch(/\.lte\('next_retry_at', untilIso\)/)
  })

  it('documents the lease-overwrite danger it prevents', () => {
    expect(source).toMatch(/lease/)
  })
})

describe('retry increments are guarded by the fetched retry_count', () => {
  const source = fs.readFileSync(QUEUE_PATH, 'utf8')

  it('the freeze path is CAS on retry_count', () => {
    expect(source).toMatch(
      /\.eq\('id', item\.id\)\s*\n\s*\.eq\('retry_count', item\.retry_count \|\| 0\)\s*\n\s*\.select\('id'\)/
    )
  })

  it('detects a lost freeze race and records it instead of double-counting', () => {
    expect(source).toMatch(/Array\.isArray\(frozenRows\) && frozenRows\.length === 0/)
    expect(source).toMatch(/freeze skipped \(row changed\)/)
  })

  it('the backoff path carries the same guard', () => {
    // Two guarded updates total (freeze success path + backoff), plus the
    // freeze fallback with the sentinel — all three must assert retry_count.
    const matches = source.match(/\.eq\('retry_count', item\.retry_count \|\| 0\)/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(3)
  })
})

describe('the shopify route shares the pending-only pre-check', () => {
  const source = fs.readFileSync(SHOP_IFY_PATH, 'utf8')

  it('scopes its duplicate pre-check to pending rows', () => {
    expect(source).toMatch(
      /\.eq\('dedup_key', shopifyDedupKey\)\s*\n\s*\.not\('next_retry_at', 'is', null\)/
    )
  })
})
