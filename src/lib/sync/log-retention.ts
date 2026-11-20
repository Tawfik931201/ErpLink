/**
 * Retention is intentionally disabled: operational logs are preserved until
 * the central archive has been fully backfilled and verified. No age-based
 * deletion runs in production.
 */
export const SYNC_LOG_SUCCESS_RETENTION_HOURS = Number.POSITIVE_INFINITY
export const SYNC_LOG_FAILURE_RETENTION_DAYS = Number.POSITIVE_INFINITY

export async function cleanupExpiredLogs(): Promise<void> {
  // Deliberate no-op: never delete historical logs based only on age.
}
