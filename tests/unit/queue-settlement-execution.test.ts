import { processWebhookEvent } from '../../src/lib/sync-engine'
import { processSyncQueue, processWorkspaceQueue } from '../../src/lib/sync-queue'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/sync-engine', () => ({ processWebhookEvent: jest.fn(), cleanupExpiredLogs: jest.fn() }))
jest.mock('../../src/lib/stock-sync-engine', () => ({ processOdooStockEvent: jest.fn() }))
jest.mock('../../src/lib/erp-execution-target', () => ({
  validateExecutionTarget: jest.fn().mockResolvedValue({}),
  withErpTarget: (_scope: unknown, work: () => Promise<unknown>) => work(),
}))
jest.mock('../../src/lib/webhook-inbox', () => ({ pruneProcessedInbox: jest.fn() }))
jest.mock('../../src/lib/telegram-outbox', () => ({ pruneTelegramOutbox: jest.fn() }))
jest.mock('../../src/lib/queue-archive-prune', () => ({ pruneExpiredQueueArchives: jest.fn() }))

// Models conditional REST mutations and atomic RPC calls, never a real DB.
// SQL integration coverage remains a separate requirement.
describe('durable queue claims and fencing (offline execution)', () => {
  const originalFrom = supabase.from
  const originalRpc = supabase.rpc
  let jobs: Array<Record<string, any>>
  let sequence: number
  const worker = processWebhookEvent as jest.Mock
  const fixture = (i: number) => ({ id: `job-${i}`, workspace_id: `ws-${i % 3}`,
    store_id: `store-${i % 3}`, platform: i % 2 ? 'salla' : 'zid', event: 'order.create',
    payload: { id: i }, retry_count: 0, max_retries: 5, outcome_unknown: false,
    lease_token: null, lease_expires_at: null, erp_connection_id: `erp-${i % 3}`,
    connection_generation: `generation-${i % 3}`, next_retry_at: '2020-01-01T00:00:00.000Z',
    created_at: '2020-01-01T00:00:00.000Z', updated_at: '2020-01-01T00:00:00.000Z' })

  beforeEach(() => {
    jobs = []; sequence = 0
    worker.mockReset().mockResolvedValue({ ok: true })
    supabase.rpc = (async (name: string, args: any) => {
      if (name === 'expire_sync_job_leases') {
        for (const job of jobs) if (job.lease_token && Date.parse(job.lease_expires_at) <= Date.now()) {
          Object.assign(job, { outcome_unknown: true, next_retry_at: null, lease_token: null, lease_expires_at: null })
        }
        return { data: 0, error: null }
      }
      if (name === 'mark_sync_job_started') {
        const job = jobs.find(j => j.id === args.p_job_id)
        if (!job || job.lease_token !== args.p_lease_token || job.outcome_unknown ||
            Date.parse(job.lease_expires_at) <= Date.now()) return { data: 0, error: null }
        job.processing_started_at ??= new Date().toISOString()
        job.lease_expires_at = new Date(Date.now() + args.p_lease_seconds * 1000).toISOString()
        return { data: 1, error: null }
      }
      if (name !== 'claim_sync_job') throw new Error(`Unexpected RPC ${name}`)
      const job = jobs.find(j => j.id === args.p_job_id)
      if (!job || job.lease_token || job.outcome_unknown || !job.next_retry_at ||
        (!args.p_force && Date.parse(job.next_retry_at) > Date.now())) return { data: [], error: null }
      Object.assign(job, { lease_token: `lease-${++sequence}`, lease_expires_at: new Date(Date.now() + 900000).toISOString() })
      return { data: [{ ...job }], error: null }
    }) as unknown as typeof supabase.rpc
    supabase.from = ((table: string) => {
      let op = 'select'; let values: Record<string, unknown> = {}; let limit = Infinity
      const predicates: Array<(r: any) => boolean> = []
      const builder: any = {
        select() { return builder }, update(v: Record<string, unknown>) { op = 'update'; values = v; return builder },
        delete() { op = 'delete'; return builder }, upsert() { op = 'upsert'; return builder },
        eq(k: string, v: unknown) { predicates.push(r => r[k] === v); return builder },
        is(k: string, v: unknown) { predicates.push(r => r[k] === v); return builder },
        not(k: string, _o: string, v: unknown) { predicates.push(r => r[k] !== v); return builder },
        lte(k: string, v: string) { predicates.push(r => r[k] <= v); return builder },
        gt(k: string, v: string) { predicates.push(r => r[k] > v); return builder },
        lt(k: string, v: string) { predicates.push(r => r[k] < v); return builder },
        in(k: string, v: unknown[]) { predicates.push(r => v.includes(r[k])); return builder },
        order() { return builder }, limit(n: number) { limit = n; return builder }, maybeSingle() { return builder },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          const matched = table === 'sync_queue' ? jobs.filter(r => predicates.every(p => p(r))).slice(0, limit) : []
          if (op === 'update') matched.forEach(r => Object.assign(r, values))
          if (op === 'delete') jobs = jobs.filter(r => !matched.includes(r))
          return Promise.resolve({ data: matched.map(r => ({ ...r })), error: null }).then(resolve, reject)
        },
      }
      return builder
    }) as typeof supabase.from
  })
  afterEach(() => { supabase.from = originalFrom; supabase.rpc = originalRpc })

  it.each([100, 1000])('processes %i distinct accepted jobs without duplicate execution or wrong pinned arguments', async count => {
    jobs = Array.from({ length: count }, (_, i) => fixture(i))
    await processSyncQueue(count)
    expect(worker).toHaveBeenCalledTimes(count)
    expect(jobs).toHaveLength(0)
    expect(new Set(worker.mock.calls.map(c => c[6])).size).toBe(count)
    for (const call of worker.mock.calls) {
      const id = call[2].id as number
      expect(call[1]).toBe(`store-${id % 3}`)
      expect(call[5]).toBe(`ws-${id % 3}`)
      expect(call[7]).toEqual({ erpConnectionId: `erp-${id % 3}`, connectionGeneration: `generation-${id % 3}` })
    }
  })

  it('Send Now bypasses backoff but never steals another worker lease', async () => {
    jobs = [fixture(0), fixture(3)]
    jobs[0].lease_token = 'another-worker'
    jobs[0].lease_expires_at = new Date(Date.now() + 900000).toISOString()
    jobs[1].next_retry_at = new Date(Date.now() + 3600000).toISOString()
    await Promise.all([processWorkspaceQueue('ws-0', 50, true), processWorkspaceQueue('ws-0', 50, true)])
    expect(worker).toHaveBeenCalledTimes(1)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].lease_token).toBe('another-worker')
  })

  it('retries a failed lease recovery rather than trusting a previous failed timestamp', async () => {
    const original = supabase.rpc
    let attempts = 0
    supabase.rpc = (async (name: string, args: any) => {
      if (name === 'expire_sync_job_leases') {
        attempts++
        return { data: null, error: { message: 'database temporarily unavailable' } }
      }
      return original(name as any, args)
    }) as typeof supabase.rpc
    const originalNow = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(originalNow + 180_000)
    try {
      jobs = [fixture(0)]
      await processSyncQueue(1)
      await processSyncQueue(1)
      expect(attempts).toBe(2)
      expect(worker).not.toHaveBeenCalled()
      expect(jobs).toHaveLength(1)
    } finally {
      spy.mockRestore()
      supabase.rpc = original
    }
  })

  it('parks an expired worker lease once the scheduled recovery interval arrives', async () => {
    // processSyncQueue coalesces successful expiry RPCs across calls for 60s.
    // Advance the wall clock beyond that window instead of assuming a new RPC
    // on every batch; unknown outcomes must still be quarantined on recovery.
    const now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    try {
      jobs = [fixture(0)]
      Object.assign(jobs[0], { lease_token: 'dead-worker', processing_started_at: '2020-01-01T00:00:00.000Z', lease_expires_at: '2020-01-01T00:00:00.000Z' })
      await processSyncQueue(1)
      expect(worker).not.toHaveBeenCalled()
      expect(jobs[0].outcome_unknown).toBe(true)
    } finally {
      clock.mockRestore()
    }
  })

  it('fences late success from a worker whose lease token was superseded', async () => {
    jobs = [fixture(0)]
    worker.mockImplementation(async () => { jobs[0].lease_token = 'superseding-token'; return { ok: true } })
    await processWorkspaceQueue('ws-0', 1)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].lease_token).toBe('superseding-token')
  })

  it('parks ERP uncertainty and releases its lease without automatic retry', async () => {
    jobs = [fixture(0)]
    worker.mockResolvedValue({ ok: false, message: 'ERP_OUTCOME_UNKNOWN: response lost' })
    await processWorkspaceQueue('ws-0', 1)
    expect(jobs[0]).toMatchObject({ outcome_unknown: true, next_retry_at: null, lease_token: null })
    await processWorkspaceQueue('ws-0', 1, true)
    expect(worker).toHaveBeenCalledTimes(1)
  })

  it('releases a definitive failure for backoff retry using its claim token', async () => {
    jobs = [fixture(0)]
    worker.mockResolvedValue({ ok: false, message: 'Validation rejected before write' })
    await processWorkspaceQueue('ws-0', 1)
    expect(jobs[0]).toMatchObject({ retry_count: 1, outcome_unknown: false, lease_token: null })
    expect(Date.parse(jobs[0].next_retry_at)).toBeGreaterThan(Date.now())
  })

  it('fences a late failure from changing a superseding worker lease', async () => {
    jobs = [fixture(0)]
    worker.mockImplementation(async () => {
      jobs[0].lease_token = 'superseding-token'
      return { ok: false, message: 'Validation rejected before write' }
    })
    await processWorkspaceQueue('ws-0', 1)
    expect(jobs[0]).toMatchObject({ retry_count: 0, lease_token: 'superseding-token' })
  })

  it('quarantines a timeout and preserves that decision when the original remote call finishes late', async () => {
    jest.useFakeTimers()
    try {
      jobs = [fixture(0)]
      let complete!: (value: unknown) => void
      worker.mockImplementation(() => new Promise(resolve => { complete = resolve }))
      const running = processWorkspaceQueue('ws-0', 1)
      for (let i = 0; i < 30 && !complete; i++) await Promise.resolve()
      expect(complete).toBeDefined()
      await jest.advanceTimersByTimeAsync(120001)
      await running
      expect(jobs[0]).toMatchObject({ outcome_unknown: true, next_retry_at: null, lease_token: null })
      complete({ ok: true })
      await Promise.resolve()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].outcome_unknown).toBe(true)
    } finally { jest.useRealTimers() }
  })
})
