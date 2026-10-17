/**
 * Tests for the season retry profile + per-workspace circuit breaker (P3-1).
 *
 * The merchant accepts late delivery (up to ~30min) but not silent loss.
 * The normal backoff (5/10/20/40/…) blows past that window on its first
 * retries; season mode (1/2/4/8/15) fits five fair chances inside it.
 * The circuit breaker parks one dead client's items instead of letting them
 * burn the shared worker slots and slow every other client.
 */

import fs from 'fs'
import path from 'path'

import { computeBackoffMinutes } from '@/lib/sync-queue'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8')
}

describe('computeBackoffMinutes', () => {
  it('normal profile starts at 5 minutes and doubles to the 360 cap', () => {
    expect(computeBackoffMinutes(1)).toBe(5)
    expect(computeBackoffMinutes(2)).toBe(10)
    expect(computeBackoffMinutes(3)).toBe(20)
    expect(computeBackoffMinutes(10)).toBe(360)
  })

  it('season profile fits five retries inside ~30 minutes', () => {
    const seq = [1, 2, 3, 4, 5].map((n) => computeBackoffMinutes(n, { season: true }))
    expect(seq).toEqual([1, 2, 4, 8, 15])
    expect(seq.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30)
  })

  it('season caps at 15 instead of 360', () => {
    expect(computeBackoffMinutes(10, { season: true })).toBe(15)
  })

  it('rate-limit/connection errors keep the floor in both profiles', () => {
    expect(computeBackoffMinutes(1, { rateLimited: true })).toBe(5)
    expect(computeBackoffMinutes(1, { connRefused: true, season: true })).toBe(1)
  })
})

describe('circuit breaker wiring (source pins)', () => {
  const queue = readSrc('lib', 'sync-queue.ts')

  it('every failure passes through the breaker hook', () => {
    // incrementRetry is the single funnel for all failure paths
    expect(queue).toContain('await noteWorkspaceFailure(item.workspace_id, errorMessage)')
  })

  it('success resets the consecutive-failure counter', () => {
    expect(queue).toContain('noteWorkspaceSuccess(item.workspace_id)')
  })

  it('parking only touches rows due before the cooldown ends (far backoff untouched)', () => {
    // Due-only: the parking predicate compares rows due NOW, never relative
    // to the cooldown time — the old `untilIso` form also matched rows leased
    // by another worker (future next_retry_at) and overwrote their lease,
    // delivering the same webhook twice.
    expect(queue).toContain(".lte('next_retry_at', new Date(now).toISOString())")
  })

  it('threshold and cooldown are tunable without code changes', () => {
    expect(queue).toContain('SYNC_CB_THRESHOLD')
    expect(queue).toContain('SYNC_CB_COOLDOWN_MIN')
    expect(queue).toContain('getCircuitBreakerState')
  })
})
