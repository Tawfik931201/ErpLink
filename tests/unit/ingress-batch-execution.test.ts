import {
  insertQueueRows,
  insertReceipts,
  resetIngressBatches,
} from '../../src/lib/ingress-batch'
import { supabase } from '../mocks/supabase'

describe.each(['receipts', 'queue'] as const)('%s durable batch execution', (kind) => {
  let saved: Map<string, Record<string, unknown>>
  let failure: 'reject' | 'database' | null
  let release: (() => void) | undefined
  let barrier: Promise<void> | undefined

  const write = (keys: string[]) => kind === 'receipts'
    ? insertReceipts(keys.map((key) => ({
      dedupKey: key, platform: 'zid', storeId: `store-${key}`, workspaceId: `ws-${key}`,
      event: 'order.created', payload: { id: key },
    })))
    : insertQueueRows(keys.map((key) => ({
      dedup_key: key, platform: 'salla', store_id: `store-${key}`, workspace_id: `ws-${key}`,
      event: 'order.created', payload: { id: key }, retry_count: 0, max_retries: 5,
      next_retry_at: new Date(0).toISOString(),
    })))

  beforeEach(() => {
    jest.useFakeTimers()
    saved = new Map()
    failure = null
    barrier = undefined
    release = undefined
    jest.spyOn(supabase, 'from').mockImplementation(() => {
      let rows: Record<string, unknown>[] = []
      let single = false
      const query = {
        insert(value: Record<string, unknown> | Record<string, unknown>[]) {
          rows = Array.isArray(value) ? value : [value]
          return query
        },
        select() { return query },
        maybeSingle() { single = true; return query },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return (async () => {
            if (barrier) await barrier
            if (failure === 'reject') throw new Error('simulated transport failure')
            if (failure === 'database') return { data: null, error: { code: '08006', message: 'DB unavailable' } }
            if (rows.some((row) => saved.has(String(row.dedup_key)))) {
              return { data: null, error: { code: '23505', message: 'duplicate' } }
            }
            const data = rows.map((row) => {
              const id = String(row.dedup_key)
              saved.set(id, { ...row })
              return { id }
            })
            return { data: single ? data[0] : data, error: null }
          })().then(resolve, reject)
        },
      }
      return query as never
    })
  })

  afterEach(() => {
    resetIngressBatches()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('waits for every durable row before resolving the caller', async () => {
    barrier = new Promise<void>((resolve) => { release = resolve })
    let completed = false
    const pending = write(['a', 'b', 'c']).then((result) => { completed = true; return result })
    await jest.advanceTimersByTimeAsync(150)
    expect(completed).toBe(false)
    expect(saved.size).toBe(0)
    release!()
    const outcomes = await pending
    expect(outcomes).toHaveLength(3)
    expect(outcomes.map((outcome) => outcome.id)).toEqual(['a', 'b', 'c'])
  })

  it.each([100, 1000, 10000])('retains all outcomes and tenant data for %i concurrent mocked writes', async (count) => {
    const keys = Array.from({ length: count }, (_, index) => String(index))
    const requests = []
    for (let index = 0; index < count; index += 73) requests.push(write(keys.slice(index, index + 73)))
    await jest.runAllTimersAsync()
    const outcomes = (await Promise.all(requests)).flat()
    expect(outcomes).toHaveLength(count)
    expect(outcomes.every((outcome) => outcome.ok && !outcome.duplicate)).toBe(true)
    expect(outcomes.map((outcome) => outcome.id)).toEqual(keys)
    expect(saved.size).toBe(count)
    for (const key of keys) expect(saved.get(key)).toMatchObject({
      workspace_id: `ws-${key}`, store_id: `store-${key}`, payload: { id: key },
    })
  })

  it('preserves individual duplicate and new outcomes after a batch collision', async () => {
    await write(['existing'])
    const pending = write(['existing', 'new'])
    await jest.runAllTimersAsync()
    expect(await pending).toEqual([
      { ok: true, duplicate: true }, { ok: true, duplicate: false, id: 'new' },
    ])
    expect(saved.size).toBe(2)
  })

  it('keeps concurrent single-event callers immediate and isolated', async () => {
    const outcomes = (await Promise.all(Array.from({ length: 1000 }, (_, index) => write([String(index)])))).flat()
    expect(jest.getTimerCount()).toBe(0)
    expect(outcomes).toHaveLength(1000)
    expect(new Set(outcomes.map((row) => row.id)).size).toBe(1000)
    expect(saved.size).toBe(1000)
  })

  it('settles an immediate transport rejection as failure and accepts an empty batch', async () => {
    failure = 'reject'
    expect(await write(['one'])).toEqual([
      expect.objectContaining({ ok: false, duplicate: false }),
    ])
    expect(await write([])).toEqual([])
    expect(saved.size).toBe(0)
  })

  it.each(['database', 'reject'] as const)('returns one explicit failure per row on %s failure', async (mode) => {
    failure = mode
    const pending = write(['a', 'b'])
    await jest.runAllTimersAsync()
    expect(await pending).toEqual([
      expect.objectContaining({ ok: false, duplicate: false }),
      expect.objectContaining({ ok: false, duplicate: false }),
    ])
    expect(saved.size).toBe(0)
    failure = null
    const recovered = write(['a', 'b'])
    await jest.runAllTimersAsync()
    expect((await recovered).every((row) => row.ok)).toBe(true)
    expect(saved.size).toBe(2)
  })
})
