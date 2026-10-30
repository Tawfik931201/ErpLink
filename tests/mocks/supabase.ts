/**
 * Jest replacement for `@/lib/supabase`.
 *
 * Any test that imports a module which transitively reaches the real Supabase
 * client gets this instead. Every chainable call returns `this` and every
 * terminal call resolves to an empty result, so no socket is ever opened.
 * Tests that care about DB behaviour should assert on the arguments recorded
 * on `.calls`, not on a live database.
 */

type Recorded = {
  table: string
  op: string
  args: unknown[]
  /** Filters applied after the operation, e.g. `['workspace_id', 'ws-1']`. */
  filters: Array<[string, unknown]>
}

const calls: Recorded[] = []

let mockResponder: ((table: string, op: string) => any) | null = null
const mockTables: Record<string, any[]> = {}

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  let isSingle = false
  let isMaybeSingle = false

  const chainMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'in', 'is', 'not', 'or', 'filter', 'order', 'limit', 'range',
    'single', 'maybeSingle', 'match',
  ]

  // The op most recently opened on this builder. Filters are recorded against
  // it so a test can assert a row was scoped to the caller's workspace.
  let current: Recorded | null = null

  for (const method of chainMethods) {
    builder[method] = (...args: unknown[]) => {
      if (['select', 'insert', 'update', 'upsert', 'delete'].includes(method)) {
        current = { table, op: method, args, filters: [] }
        calls.push(current)
      } else if (method === 'single') {
        isSingle = true
      } else if (method === 'maybeSingle') {
        isMaybeSingle = true
      } else if (current && ['eq', 'neq', 'match'].includes(method)) {
        // `match` takes a single object; the rest take (column, value).
        if (method === 'match' && args[0] && typeof args[0] === 'object') {
          for (const [k, v] of Object.entries(args[0] as Record<string, unknown>)) {
            current.filters.push([k, v])
          }
        } else {
          current.filters.push([args[0] as string, args[1]])
        }
      }
      return builder
    }
  }

  function getSettled() {
    if (mockResponder) {
      const r = mockResponder(table, current?.op ?? 'select')
      if (r !== undefined) return r
    }
    if (mockTables[table]) {
      let rows = mockTables[table]
      if (current && current.filters.length > 0) {
        rows = rows.filter((r) =>
          current!.filters.every(([col, val]) => r[col] === val)
        )
      }
      if (isSingle) {
        return {
          data: rows[0] || null,
          error: rows[0] ? null : { message: 'Row not found' },
          count: rows.length,
        }
      }
      if (isMaybeSingle) {
        return { data: rows[0] || null, error: null, count: rows.length }
      }
      return { data: rows, error: null, count: rows.length }
    }
    return { data: null, error: null, count: null }
  }

  // Terminal operations: no network, empty result.
  builder.execute = async () => getSettled()
  builder.then = (
    onFulfilled?: ((value: any) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null
  ) => {
    const res = getSettled()
    return Promise.resolve(res).then(onFulfilled, onRejected)
  }
  builder.catch = (onRejected?: ((reason: unknown) => unknown) | null) =>
    Promise.resolve(getSettled()).catch(onRejected)
  builder.finally = (onFinally?: (() => void) | null) =>
    Promise.resolve(getSettled()).finally(onFinally)

  return builder
}

export const supabase = {
  calls,
  from(table: string) {
    return makeBuilder(table)
  },
  rpc: async () => ({ data: null, error: null }),
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
  },
  addMock(table: string, data: any[]) {
    mockTables[table] = data
  },
  setMockResponder(fn: ((table: string, op: string) => any) | null) {
    mockResponder = fn
  },
  reset() {
    calls.length = 0
    mockResponder = null
    for (const k of Object.keys(mockTables)) delete mockTables[k]
  },
}

export default supabase
