/**
 * The `/app/logs` instant search rule, kept pure and import-free so it can be
 * unit-tested without a database (the action file is `'use server'`).
 *
 * Search is a case-insensitive match across the whole log row, not just the
 * columns the list can show. A merchant typing an order name wants every log
 * that mentions it — and an order name usually lives inside the `payload`
 * JSON or the `error_message`, neither of which the list selects. So the
 * query is a single PostgREST `or(...)` of:
 *
 *   - `search_vector.plfts.<needle>` — full-text over the GIN-indexed
 *     `search_vector` column, which every write path keeps in sync
 *     (migration `20261103_sync_logs_search_vector.sql`). This is what reaches
 *     into `payload` and `error_message`.
 *   - `event.ilike` / `zid_entity_id.ilike` / `odoo_model.ilike` /
 *     `store_id.ilike` — substring fallback for the four columns the list
 *     renders, in case the full-text normaliser strips something (digits,
 *     underscores, Arabic stems).
 *
 * The two escaping rules are the whole point of this module:
 *
 * 1. `,` `(` `)` are structural in a PostgREST `or` expression. A merchant who
 *    types `,status.eq.success` must not be able to append a filter branch —
 *    the typed text is data, never syntax.
 * 2. `%` and `_` are ILIKE wildcards, and `*` is the PostgREST wildcard alias.
 *    Typing `%` must not silently match every row, and `\` must not be able to
 *    swallow the next character.
 *
 * Because the same characters are the ones a merchant is most likely to type by
 * accident, they are replaced by a space instead of being dropped: `1,2` becomes
 * `1 2`, which is a truthful (if narrow) search rather than a silent widening.
 */

/** Columns the substring (ILIKE) half of the search matches. */
export const SYNC_LOG_SEARCH_COLUMNS = [
  'event',
  'zid_entity_id',
  'odoo_model',
  'store_id',
] as const

/** PostgREST/ILIKE structural or wildcard characters — never passed through. */
const UNSAFE_CHARS = /[(),*%_\\]/g

export type SyncLogSearchFilter =
  /** Nothing typed (blank/whitespace) — no search predicate at all. */
  | { kind: 'none' }
  /** Typed, but nothing searchable survived sanitising — must match zero rows. */
  | { kind: 'empty' }
  /** The PostgREST `or(...)` expression to apply. */
  | { kind: 'match'; expression: string }

/** Whitespace-collapsed, wildcard-free needle for the ILIKE branches. */
export function sanitizeSyncLogSearch(input: string): string {
  return input
    .trim()
    .replace(UNSAFE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Turn raw search input into the filter the query should apply.
 *
 * `{ kind: 'empty' }` is deliberately distinct from `{ kind: 'none' }`: input
 * that was only punctuation (`,,,` or `%`) cannot match anything, and returning
 * the whole workspace instead would look like the search box was ignored.
 */
export function syncLogSearchFilter(input: string | null | undefined): SyncLogSearchFilter {
  if (typeof input !== 'string' || input.trim() === '') return { kind: 'none' }

  const needle = sanitizeSyncLogSearch(input)
  if (!needle) return { kind: 'empty' }

  // Both branches use the sanitised needle — plainto_tsquery works fine with it
  // and this prevents commas in the input from being interpreted as branch
  // separators in PostgREST's `or(...)` expression.
  const branches: string[] = [`search_vector.plfts.${needle}`]
  for (const column of SYNC_LOG_SEARCH_COLUMNS) {
    branches.push(`${column}.ilike.%${needle}%`)
  }

  return {
    kind: 'match',
    expression: branches.join(','),
  }
}