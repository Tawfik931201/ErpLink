/**
 * Pins the `/app/logs` list behaviour added on 2026-11-02, updated 2026-11-03:
 *
 *   - The instant search box filters server-side across the whole workspace, not
 *     just the 20 rows on screen, and the typed text is *data*: a comma must not
 *     append a PostgREST filter branch and a `%` must not match everything.
 *   - Input that is only punctuation matches nothing, rather than silently
 *     returning the whole workspace (which reads as "the search was ignored").
 *   - Search uses a SINGLE generated column `search_text` (trigram GIN index)
 *     with exact substring matching (ILIKE), matching the PayloadViewer's
 *     client-side behaviour: JSON.stringify(payload).toLowerCase().includes(query).
 *   - No more PostgREST `or()` parser errors with % wildcards.
 *   - Column visibility is a browser preference persisted under a versioned key,
 *     with sensible defaults and a guard against hiding every column.
 *   - The refresh button does not rotate (the table shows loading state instead).
 */

import fs from 'fs'
import path from 'path'

import {
  sanitizeSyncLogSearch,
  syncLogSearchFilter,
} from '../../src/lib/sync-log-search'

const CLIENT_PATH = path.join(process.cwd(), 'src/app/(app)/app/logs/logs-client.tsx')

function readClient(): string {
  const raw = fs.readFileSync(CLIENT_PATH, 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('sync-log instant search', () => {
  it('treats blank input as "no filter at all"', () => {
    expect(syncLogSearchFilter('')).toEqual({ kind: 'none' })
    expect(syncLogSearchFilter('   ')).toEqual({ kind: 'none' })
    expect(syncLogSearchFilter(undefined)).toEqual({ kind: 'none' })
    expect(syncLogSearchFilter(null)).toEqual({ kind: 'none' })
  })

  it('matches exact substring on single search_text column (trigram index)', () => {
    const filter = syncLogSearchFilter('ORD-12')
    expect(filter.kind).toBe('match')
    if (filter.kind !== 'match') return

    expect(filter.column).toBe('search_text')
    expect(filter.operator).toBe('ilike')
    expect(filter.value).toBe('%ORD-12%')
  })

  it('keeps Arabic and spaces intact', () => {
    expect(sanitizeSyncLogSearch('  طلب جديد  ')).toBe('طلب جديد')
  })

  it('strips PostgREST structure so typed text cannot append a branch', () => {
    expect(sanitizeSyncLogSearch('abc,status.eq.success')).toBe('abc status.eq.success')
    const filter = syncLogSearchFilter('abc,status.eq.success')
    expect(filter.kind).toBe('match')
    if (filter.kind !== 'match') return
    expect(filter.value).toBe('%abc status.eq.success%')
  })

  it('strips ILIKE wildcards so "%" cannot match everything', () => {
    expect(sanitizeSyncLogSearch('%%%')).toBe('')
    expect(syncLogSearchFilter('%%%')).toEqual({ kind: 'empty' })
    expect(sanitizeSyncLogSearch('ord_1')).toBe('ord 1')
    expect(sanitizeSyncLogSearch('a\\b')).toBe('a b')
    expect(sanitizeSyncLogSearch('a*b')).toBe('a b')
  })

  it('collapses runs of whitespace', () => {
    expect(sanitizeSyncLogSearch('  a    b  ')).toBe('a b')
  })

  it('never lets a genuine needle keep a structural character', () => {
    const filter = syncLogSearchFilter('(a)(b),c*')
    expect(filter.kind).toBe('match')
    if (filter.kind !== 'match') return
    // The filter wraps the sanitised needle with % for ILIKE substring match.
    // The needle itself (without the wrapping %) must be clean.
    expect(filter.value).toBe('%a b c%')
    const needle = filter.value.slice(1, -1) // strip wrapping %
    expect(needle).not.toMatch(/[(),*\\%_]/)
  })
})

describe('/app/logs column picker', () => {
  it('persists the choice in browser storage under a versioned key', () => {
    const src = readClient()
    expect(src).toMatch(/erplink\.logs\.columns\.v1/)
    expect(src).toMatch(/localStorage\.setItem\(COLUMNS_STORAGE_KEY/)
    expect(src).toMatch(/localStorage\.getItem\(COLUMNS_STORAGE_KEY\)/)
  })

  it('offers every field the record page shows, but not error_message', () => {
    const src = readClient()
    for (const key of [
      'status',
      'event',
      'entity',
      'model',
      'trigger',
      'entityItemId',
      'odooRecordId',
      'mapping',
      'storeId',
      'logId',
      'time',
      'autoDelete',
    ]) {
      expect(src).toMatch(new RegExp(`key: '${key}'`))
    }
    expect(src).not.toMatch(/key: 'errorMessage'|key: 'error_message'/)
  })

  it('refuses to hide the last visible column', () => {
    expect(readClient()).toMatch(/if \(prev\.length === 1\) return prev/)
  })

  it('ignores scroll events originating inside the popup menu itself', () => {
    const src = readClient()
    expect(src).toMatch(/columnsMenuRef\.current\.contains\(event\.target/)
  })

  it('never persists an empty column set', () => {
    expect(readClient()).toMatch(/if \(visibleColumns\.length === 0\) return/)
  })
})

describe('/app/logs toolbar', () => {
  it('no longer carries a separate status filter (the chips are it)', () => {
    const src = readClient()
    expect(src).not.toMatch(/log\.filterByStatus/)
    expect(src).toMatch(/applyStatusPreset/)
  })

  it('searches as the merchant types, debounced', () => {
    const src = readClient()
    expect(src).toMatch(/const SEARCH_DEBOUNCE_MS = \d+/)
    expect(src).toMatch(/setTimeout\(\(\) => setAppliedSearch\(/)
    expect(src).toMatch(/search: appliedSearch/)
  })

  it('does not spin the refresh icon', () => {
    const src = readClient()
    const refreshBlock = src.slice(src.indexOf("t('log.refresh')") - 400, src.indexOf("t('log.refresh')"))
    expect(refreshBlock).toContain('RefreshCw')
    expect(refreshBlock).not.toContain('animate-spin')
  })

  it('self-check: the spinner detector does notice a spinning icon', () => {
    const spinning = `<RefreshCw className="h-3 w-3 me-1 animate-spin" />\n{t('log.refresh')}`
    expect(spinning.slice(0, spinning.indexOf("t('log.refresh')"))).toContain('animate-spin')
  })
})