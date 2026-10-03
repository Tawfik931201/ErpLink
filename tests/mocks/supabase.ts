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

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}

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

  // Terminal operations: no network, empty result.
  //
  // `then` must INVOKE the resolve callback that `await` hands it. An
  // `async () => value` here is not enough: `await builder` calls
  // `builder.then(resolve, reject)` and settles only when `resolve` is called,
  // so a builder that just returned a value of its own hung forever. No test
  // noticed until one actually awaited a query.
  const settled = { data: null, error: null, count: null }
  builder.execute = async () => settled
  builder.then = (
    onFulfilled?: ((value: typeof settled) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null
  ) => Promise.resolve(settled).then(onFulfilled, onRejected)
  builder.catch = (onRejected?: ((reason: unknown) => unknown) | null) =>
    Promise.resolve(settled).catch(onRejected)
  builder.finally = (onFinally?: (() => void) | null) =>
    Promise.resolve(settled).finally(onFinally)

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
  reset() {
    calls.length = 0
  },
}

export default supabase
