/**
 * Cross-process maintenance coalescing. The slot RPC is an atomic
 * INSERT...ON CONFLICT update with a time cutoff, restricted to service_role.
 * Invalid/unavailable responses fail *open*, preserving recovery and retries.
 */
import { supabase } from './supabase'

export type ZidMaintenanceKind = 'orders' | 'categories'

let warned = false

export function maintenanceIntervalSeconds(milliseconds: number, bufferSeconds = 0): number {
  const base = Math.max(60, Math.min(3600,
    Number.isFinite(milliseconds) ? Math.ceil(milliseconds / 1000) : 600))
  return Math.max(30, base - bufferSeconds)
}

async function claimMaintenanceSlot(name: string, intervalMs: number, bufferSeconds = 0): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('claim_erp_maintenance_slot', {
      p_name: name,
      p_interval_seconds: maintenanceIntervalSeconds(intervalMs, bufferSeconds),
    })
    if (!error && typeof data === 'boolean') return data
    if (!warned) {
      warned = true
      console.warn('[Maintenance] Distributed lease unavailable; preserving previous recovery schedule:', error?.code || 'invalid_result')
    }
    return true
  } catch {
    if (!warned) {
      warned = true
      console.warn('[Maintenance] Lease RPC transport unavailable; retaining prior recovery schedule')
    }
    return true
  }
}

export function claimZidMaintenanceSlot(kind: ZidMaintenanceKind, intervalMs = 600_000): Promise<boolean> {
  return claimMaintenanceSlot(kind === 'orders'
    ? 'zid_orders_reconcile_v1' : 'zid_category_delete_audit_v1', intervalMs)
}

/**
 * Coalesce ONLY scheduled idle queue scans. Never use this for the
 * event-driven wake path, startup recovery, active backlog or manual cron.
 * A 5-second safety margin absorbs Node timer skew so minor jitter (< 120s)
 * does not cause Postgres to reject the slot and cause a 240-second delay.
 */
export function claimIdleQueueDrainSlot(intervalMs = 120_000): Promise<boolean> {
  return claimMaintenanceSlot('queue_idle_drain_v1', intervalMs, 5)
}
