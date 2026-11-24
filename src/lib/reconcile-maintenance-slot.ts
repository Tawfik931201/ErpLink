/**
 * Cross-process, durable reconciliation throttle.
 *
 * Hostinger may run several independent Node workers and an external cron.
 * A process-local setInterval guard does not prevent every worker from calling
 * the Zid API and reading the same Supabase configuration simultaneously.
 *
 * The RPC uses an atomic INSERT ... ON CONFLICT DO UPDATE WHERE to allow only
 * one claiming worker per slot per interval across the whole deployment.
 *
 * Backward-compatible: if the additive DB migration is not installed yet,
 * keep the pre-existing reconciliation behavior rather than silently skipping
 * recovery of missing webhooks. Once installed it is fail-open on transport
 * errors too; ordinary webhook retry and idempotency remain authoritative.
 */
import { supabase } from './supabase'

export type ZidMaintenanceKind = 'orders' | 'categories'

let warned = false

export function maintenanceIntervalSeconds(milliseconds: number): number {
  return Math.max(60, Math.min(3600,
    Number.isFinite(milliseconds) ? Math.ceil(milliseconds / 1000) : 600))
}

export async function claimZidMaintenanceSlot(kind: ZidMaintenanceKind, intervalMs = 600_000): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('claim_erp_maintenance_slot', {
      p_name: kind === 'orders' ? 'zid_orders_reconcile_v1' : 'zid_category_delete_audit_v1',
      p_interval_seconds: maintenanceIntervalSeconds(intervalMs),
    })
    if (!error) return data === true
    if (!warned) {
      warned = true
      // Never serialize provider credentials or response payloads.
      console.warn('[Reconciliation] Distributed maintenance lease unavailable; falling back to prior schedule:', error.code)
    }
    return true
  } catch {
    if (!warned) {
      warned = true
      console.warn('[Reconciliation] Lease RPC transport unavailable; retaining the prior recovery schedule')
    }
    return true
  }
}
