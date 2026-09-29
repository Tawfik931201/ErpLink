/**
 * Jest replacement for `@/lib/supabase`.
 *
 * Any test that imports a module which transitively reaches the real Supabase
 * client gets this instead. Every chainable call returns `this` and every
 * terminal call resolves to an empty result, so no socket is ever opened.
 * Tests that care about DB behaviour should assert on the arguments recorded
 * on `.calls`, not on a live database.
 */

type Recorded = { table: string; op: string; args: unknown[] }

const calls: Recorded[] = []

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}

  const chainMethods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'in', 'is', 'not', 'or', 'filter', 'order', 'limit', 'range',
    'single', 'maybeSingle', 'match',
  ]

  for (const method of chainMethods) {
    builder[method] = (...args: unknown[]) => {
      if (['select', 'insert', 'update', 'upsert', 'delete'].includes(method)) {
        calls.push({ table, op: method, args })
      }
      return builder
    }
  }

  // Terminal operations: no network, empty result.
  const empty = async () => ({ data: null, error: null, count: null })
  for (const method of ['then', 'catch', 'finally', 'execute']) {
    builder[method] = empty
  }

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
