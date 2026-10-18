/**
 * Workspace archive / restore — tied to subscription state.
 *
 * A workspace is "archived" when its `archived_at` column is set. Archiving
 * happens automatically when a workspace's latest active subscription expires
 * (no other non-expired active subscription remains on that workspace).
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
 * Archive all workspaces whose latest active subscription has expired and no
 * other non-expired active subscription remains.
 *
 * Called periodically from the in-process sync-queue runner (every 6h by
 * default, configurable via `WORKSPACE_ARCHIVE_INTERVAL_MS`). The query is
 * intentionally simple and bounded (2000 rows max per pass) so it runs
 * comfortably on shared hosting.
 *
 * Returns the number of workspaces archived (for logging / metrics).
 */
export async function archiveExpiredWorkspaces(): Promise<{ archived: number; error?: string }> {
  const todayDate = today()

  // 1. Find active subscriptions that are already expired.
  const { data: expiredSubs, error: expiredErr } = await supabase
    .from('subscriptions')
    .select('workspace_id')
    .eq('status', 'active')
    .lt('end_date', todayDate)
    .limit(2000)

  if (expiredErr) return { archived: 0, error: expiredErr.message }

  const candidateIds = Array.from(new Set((expiredSubs ?? []).map((s) => s.workspace_id)))
  if (candidateIds.length === 0) return { archived: 0 }

  // 2. Among those, find workspaces that are NOT yet archived.
  const { data: unarchived, error: wsErr } = await supabase
    .from('workspaces')
    .select('id')
    .in('id', candidateIds)
    .is('archived_at', null)
    .limit(2000)

  if (wsErr) return { archived: 0, error: wsErr.message }

  const toCheck = (unarchived ?? []).map((w) => w.id)
  if (toCheck.length === 0) return { archived: 0 }

  // 3. Exclude workspaces that still have a NON-expired active subscription.
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

  // 4. Archive them.
  const { error: upErr } = await supabase
    .from('workspaces')
    .update({ archived_at: new Date().toISOString() })
    .in('id', targets)

  if (upErr) return { archived: 0, error: upErr.message }

  return { archived: targets.length }
}
