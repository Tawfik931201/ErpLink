/**
 * The `/app/logs` instant search rule, kept pure and import-free so it can be
 * unit-tested without a database (the action file is `'use server'`).
 *
 * Search is a case-insensitive exact substring match on a single generated
 * column `search_text` that concatenates all searchable fields:
 *   event, zid_entity_id, odoo_model, store_id, error_message,
 *   odoo_record_id, field_mapping_id, payload::text
 *
 * This matches the PayloadViewer's client-side behaviour exactly:
 *   JSON.stringify(payload).toLowerCase().includes(query)
 *
 * Using a single column + trigram GIN index avoids PostgREST's `or()` filter
 * parser issues with `%` wildcards, and is faster (one index scan).
 *
 * The two escaping rules remain:
 * 1. `,` `(` `)` are structural in PostgREST filters — never passed through.
 * 2. `%` `_` `*` are wildcards in ILIKE — typing them must not widen the match.
 *
 * They are replaced by a space instead of being dropped: `1,2` becomes `1 2`.
 */

/** PostgREST/ILIKE structural or wildcard characters — never passed through. */
const UNSAFE_CHARS = /[(),*%_\\]/g

export type SyncLogSearchFilter =
  /** Nothing typed (blank/whitespace) — no search predicate at all. */
  | { kind: 'none' }
  /** Typed, but nothing searchable survived sanitising — must match zero rows. */
  | { kind: 'empty' }
  /** The PostgREST filter to apply (single column ilike). */
  | { kind: 'match'; column: string; operator: string; value: string }

/** Whitespace-collapsed, wildcard-free needle for the ILIKE filter. */
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

  // Single column filter — matches the generated search_text column exactly.
  // Uses %needle% for substring matching (case-insensitive via ilike).
  return {
    kind: 'match',
    column: 'search_text',
    operator: 'ilike',
    value: `%${needle}%`,
  }
}