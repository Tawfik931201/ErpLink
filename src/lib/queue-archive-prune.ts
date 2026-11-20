/**
 * Queue archives are retained indefinitely. Never prune by expires_at.
 * Active queue processing and retry policies are unaffected.
 */
export async function pruneExpiredQueueArchives(_now: number = Date.now()): Promise<number> {
  return 0
}
