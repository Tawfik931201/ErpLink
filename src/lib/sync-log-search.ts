/**
 * The `/app/logs` instant search rule, kept pure and import-free so it can be
 * unit-tested without a database (the action file is `'use server'`).
 *
 * Search is a case-insensitive exact substring match across the whole log row,
 * matching the behaviour of the PayloadViewer in the detail page.
 *
 * The query is a single PostgREST `or(...)` of ILIKE branches on the text
 * representation of each searchable column:
 *
 *   - `payload::text.ilike.%<needle>%` — exact substring inside the JSON payload
 *   - `error_message.ilike.%<needle>%` — exact substring inside error messages
 *   - `event.ilike.%<needle>%` — event name
 *   - `zid_entity_id.ilike.%<needle>%` — store-side entity ID
 *   - `odoo_model.ilike.%<needle>%` — ERP model name
 *   - `store_id.ilike.%<needle>%` — store identifier
 *
 * This avoids the `plfts` full-text search (which does stemming, stop-word
 * removal, and normalization) and instead does literal substring matching,
 * which is what users expect when typing an order name, SKU, phone number, etc.
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

/** Columns the substring (ILIKE) search matches. Order is the display order. */
export const SYNC_LOG_SEARCH_COLUMNS = [
  'payload::text',     // JSON payload as text — exact substring like PayloadViewer
  'error_message',     // Error/skip message text
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

  // All branches use the sanitised needle for exact substring matching (ILIKE).
  // This matches the PayloadViewer client-side behaviour: JSON.stringify(payload).toLowerCase().includes(query)
  const branches: string[] = SYNC_LOG_SEARCH_COLUMNS.map(
    (column) => `${column}.ilike.%${needle}%`
  )

  return {
    kind: 'match',
    expression: branches.join(','),
  }
}