/**
 * Workspace archive / restore — tied to subscription state.
 *
 * A workspace is "archived" when its `archived_at` column is set. Archiving
 * happens automatically in two cases:
 *   1. A workspace's latest active subscription expired and no other
 *      non-expired active subscription remains on that workspace.
 *   2. A workspace has NO non-expired active subscription and its free trial
 *      has run out — the trial is `workspaces.created_at` + `TRIAL_DAYS`
 *      (see `src/lib/workspace-trial.ts`). This is what "closes" a workspace
 *      that never subscribed; the trial replaces the old "mid-signup, leave
 *      it alone forever" carve-out.
 * Unarchiving happens automatically whenever the admin registers or extends a
 * subscription that is currently valid.
 *
 * ⚠️ This module must be server-side only (uses `supabase` service-role client).
 * It must NOT be imported into a 'use server' module — Next.js requires every
 * export from a 'use server' module to be an async function, and these helpers
 * are async, so they're safe to call from server actions. Keep this file as a
 * normal module so it can also be imported by `sync-queue-runner.ts`.
 */

import { supabase } from '@/lib/supabase'
import { TRIAL_DAYS } from '@/lib/workspace-trial'

/** Today's date as a YYYY-MM-DD string (UTC). */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Archive a single workspace (idempotent). Only sets `archived_at` if it is
 * currently NULL — safe to call repeatedly. No-op if the column does not yet
 * exist in the database (migration not applied) — the error is swallowed
 * because archiving is a convenience, not a correctness requirement.
 */
export async function archiveWorkspace(workspaceId: string): Promise<void> {
  try {
    await supabase
      .from('workspaces')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', workspaceId)
      .is('archived_at', null)
  } catch {
    // Column may not exist yet (migration pending) — ignore.
  }
}

/**
 * Unarchive a workspace (idempotent). Clears `archived_at`. Called whenever a
 * new valid subscription is registered or extended. No-op if the column does
 * not exist yet.
 */
export async function unarchiveWorkspace(workspaceId: string): Promise<void> {
  try {
    await supabase
      .from('workspaces')
      .update({ archived_at: null })
      .eq('id', workspaceId)
  } catch {
    // Column may not exist yet (migration pending) — ignore.
  }
}

/**
 * Check if a workspace is currently archived. Returns false if the column
 * does not exist yet or on any error — the caller treats "unknown" as
 * "not archived" so the app keeps working before the migration is applied.
 */
export async function isWorkspaceArchived(workspaceId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('archived_at')
      .eq('id', workspaceId)
      .maybeSingle()

    if (error || !data) return false
    return data.archived_at != null
  } catch {
    return false
  }
}

/**
 * Archive every workspace that should be closed, in one bounded pass:
 *   1. workspaces whose latest active subscription expired (no non-expired
 *      active subscription remains), and
 *   2. workspaces that never subscribed and whose 7-day free trial has run out
 *      (`created_at` older than `TRIAL_DAYS`; NULL/unparseable `created_at` is
 *      never a candidate — unknown age fails open).
 *
 * Called periodically from the in-process sync-queue runner (every 6h by
 * default, configurable via `WORKSPACE_ARCHIVE_INTERVAL_MS`). Both queries are
 * intentionally simple and bounded (2000 rows max per pass) so the pass runs
 * comfortably on shared hosting.
 *
 * If the `archived_at` column does not exist yet (migration not applied) the
 * pass is a silent no-op — that matches `archiveWorkspace` / `isWorkspaceArchived`,
 * and avoids a recurring error line before the migration is pasted.
 *
 * Returns the number of workspaces archived (for logging / metrics).
 */
export async function archiveExpiredWorkspaces(): Promise<{ archived: number; error?: string }> {
  const todayDate = today()

  // Candidate source A: active subscriptions that are already expired.
  const { data: expiredSubs, error: expiredErr } = await supabase
    .from('subscriptions')
    .select('workspace_id')
    .eq('status', 'active')
    .lt('end_date', todayDate)
    .limit(2000)

  if (expiredErr) return { archived: 0, error: expiredErr.message }

  // Candidate source B: workspaces past the free-trial window. `lt` never
  // matches NULL, so a missing created_at is excluded by construction.
  const trialCutoff = new Date(Date.now() - TRIAL_DAYS * 86_400_000).toISOString()
  const { data: trialWorkspaces, error: trialErr } = await supabase
    .from('workspaces')
    .select('id')
    .lt('created_at', trialCutoff)
    .is('archived_at', null)
    .limit(2000)

  // Missing column (migration pending) → silent no-op; any other error is real.
  if (trialErr) {
    if (isMissingArchiveColumn(trialErr)) return { archived: 0 }
    return { archived: 0, error: trialErr.message }
  }

  const candidateIds = Array.from(
    new Set([
      ...(expiredSubs ?? []).map((s) => s.workspace_id),
      ...(trialWorkspaces ?? []).map((w) => w.id),
    ]),
  )
  if (candidateIds.length === 0) return { archived: 0 }

  // Still unarchived among the candidates.
  const { data: unarchived, error: wsErr } = await supabase
    .from('workspaces')
    .select('id')
    .in('id', candidateIds)
    .is('archived_at', null)
    .limit(2000)

  if (wsErr) {
    if (isMissingArchiveColumn(wsErr)) return { archived: 0 }
    return { archived: 0, error: wsErr.message }
  }

  const toCheck = (unarchived ?? []).map((w) => w.id)
  if (toCheck.length === 0) return { archived: 0 }

  // Exclude workspaces that still have a NON-expired active subscription —
  // a live paying workspace must never be closed by the trial rule.
  const { data: aliveSubs } = await supabase
    .from('subscriptions')
    .select('workspace_id')
    .in('workspace_id', toCheck)
    .eq('status', 'active')
    .gte('end_date', todayDate)
    .limit(2000)

  const alive = new Set((aliveSubs ?? []).map((s) => s.workspace_id))
  const targets = toCheck.filter((id) => !alive.has(id))
  if (targets.length === 0) return { archived: 0 }

  // Archive them.
  const { error: upErr } = await supabase
    .from('workspaces')
    .update({ archived_at: new Date().toISOString() })
    .in('id', targets)

  if (upErr) {
    if (isMissingArchiveColumn(upErr)) return { archived: 0 }
    return { archived: 0, error: upErr.message }
  }

  return { archived: targets.length }
}

/** True when the error means the `workspaces.archived_at` column is absent. */
function isMissingArchiveColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42703') return true
  const message = error.message ?? ''
  return /archived_at/i.test(message) && /does not exist|column/i.test(message)
}
