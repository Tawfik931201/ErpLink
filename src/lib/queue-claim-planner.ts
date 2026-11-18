/**
 * Build a claim wave whose members can all start immediately.
 * Claiming more than the per-workspace or per-product execution capacity
 * leaves extra rows leased while they wait, risking expiry before execution.
 */
interface ClaimCandidate {
  workspace_id?: string | null
  platform?: string | null
  store_id?: string | null
  event: string
  payload: Record<string, unknown>
}

export function productFamilyKey(item: ClaimCandidate): string | null {
  if (!/^(product[._]|product$)/i.test(item.event || '')) return null
  const payload = item.payload ?? {}
  const nested = payload.data && typeof payload.data === 'object'
    ? payload.data as Record<string, unknown> : {}
  const parent = payload.parent && typeof payload.parent === 'object'
    ? payload.parent as Record<string, unknown> : {}
  const product = payload.product && typeof payload.product === 'object'
    ? payload.product as Record<string, unknown> : {}
  const family = payload.parent_id ?? parent.id ?? product.parent_id ??
    payload.id ?? payload.product_id ?? nested.id ?? nested.product_id
  if (family === null || family === undefined || family === '') return null
  return [item.workspace_id || 'unknown', item.platform || 'unknown',
    item.store_id || 'unknown', String(family)].join('|')
}

export function selectQueueClaimWave<T extends ClaimCandidate>(
  pending: T[], concurrency: number, maxPerWorkspace: number
): { selected: T[]; remaining: T[] } {
  const selected: T[] = []
  const remaining: T[] = []
  const runningWorkspace = new Map<string, number>()
  const runningFamily = new Set<string>()
  const limit = Math.max(1, Math.floor(concurrency))
  const perWorkspace = Math.max(1, Math.floor(maxPerWorkspace))
  for (const item of pending) {
    const workspace = item.workspace_id || 'unknown'
    const family = productFamilyKey(item)
    if (selected.length >= limit ||
      (runningWorkspace.get(workspace) ?? 0) >= perWorkspace ||
      (family !== null && runningFamily.has(family))) {
      remaining.push(item)
      continue
    }
    selected.push(item)
    runningWorkspace.set(workspace, (runningWorkspace.get(workspace) ?? 0) + 1)
    if (family !== null) runningFamily.add(family)
  }
  return { selected, remaining }
}
