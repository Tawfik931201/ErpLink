/**
 * Terminal webhooks routes: every persisted receipt must be recoverable.
 *
 * Before this hardening, four terminal branches consumed an event and
 * returned without persisting anything:
 *   - invalid JSON (salla, zid, shopify signed deliveries)
 *   - structurally invalid order payloads (missing line items)
 *   - a missing store/merchant identity
 *   - unknown events (zid)
 * The response code was kept (correct — the platform cannot fix these by
 * retrying), but "kept 400 with nothing written" is silent data loss with a
 * polite status code. Now each branch first writes an ORPHAN receipt into
 * `webhook_inbox` with a null workspace and a steady event-derived dedup key.
 *
 * Also pinned:
 *  - `parseSallaTimestampMs` (real unit tests, not source pins): numeric
 *    epoch seconds and milliseconds, digit-only strings, ISO strings, and
 *    NaN on garbage. The old `new Date(String(raw))` returned NaN for the
 *    numeric shapes and silently disabled the staleness check.
 *  - the orphan-replay admin route never replays uninstall-shaped or
 *    sentinel events, and resolves the workspace per platform with the
 *    store_id-first rule for Zid.
 *  - the shopify stale path persists the late delivery, and the merge path
 *    falls through to a plain enqueue when its update raced away — a silent
 *    `merged:true` with zero rows is no longer possible.
 */

import fs from 'fs'
import path from 'path'

import { parseSallaTimestampMs } from '../../src/lib/salla/webhook-auth'

const SALLA_ROUTE_PATH = path.join(process.cwd(), 'src/app/api/webhooks/salla/route.ts')
const ZID_ROUTE_PATH = path.join(process.cwd(), 'src/app/api/webhooks/zid/route.ts')
const SHOP_ROUTE_PATH = path.join(process.cwd(), 'src/app/api/webhooks/shopify/route.ts')
const REPLAY_PATH = path.join(process.cwd(), 'src/app/api/admin/webhook-orphans/replay/route.ts')

describe('parseSallaTimestampMs — the staleness comparator needs real numbers', () => {
  it('reads numeric epoch seconds', () => {
    expect(parseSallaTimestampMs(1737000000)).toBe(1737000000_000)
  })

  it('reads numeric epoch milliseconds untouched', () => {
    expect(parseSallaTimestampMs(1_737_000_000_000)).toBe(1_737_000_000_000)
  })

  it('reads digit-only strings in both scales', () => {
    expect(parseSallaTimestampMs('1737000000')).toBe(1737000000_000)
    expect(parseSallaTimestampMs('1737000000000')).toBe(1737000000000)
  })

  it('reads ISO strings', () => {
    expect(parseSallaTimestampMs('2025-01-16T05:00:00Z')).toBe(Date.parse('2025-01-16T05:00:00Z'))
  })

  it('returns NaN for garbage and empty values — never a wrong timestamp', () => {
    expect(Number.isNaN(parseSallaTimestampMs('not a date'))).toBe(true)
    expect(Number.isNaN(parseSallaTimestampMs(undefined))).toBe(true)
    expect(Number.isNaN(parseSallaTimestampMs(null))).toBe(true)
    expect(Number.isNaN(parseSallaTimestampMs({} as unknown))).toBe(true)
  })
})

const sallaSource = () => fs.readFileSync(SALLA_ROUTE_PATH, 'utf8')
const zidSource = () => fs.readFileSync(ZID_ROUTE_PATH, 'utf8')
const shopSource = () => fs.readFileSync(SHOP_ROUTE_PATH, 'utf8')

describe('salla: nothing exits without a durable receipt', () => {
  it('malformed JSON is stored as an orphan before the 400', () => {
    expect(sallaSource()).toMatch(/salla:malformed:/)
  })

  it('structurally invalid order payloads are stored as orphans', () => {
    expect(sallaSource()).toMatch(/salla:invalid-lines:/)
  })

  it('a missing merchant identity is stored as an orphan', () => {
    expect(sallaSource()).toMatch(/salla:no-merchant:/)
  })

  it('failures persisting the receipt upgrade the answer to 503', () => {
    // 400 was only ever correct with the receipt on disk; without it the
    // delivery is lost forever and the platform MUST retry.
    const orphanBlocks = sallaSource().match(/if \(!stored\.ok\)/g)
    expect(orphanBlocks).not.toBeNull()
    expect(orphanBlocks!.length).toBeGreaterThanOrEqual(3)
  })

  it('stale deliveries use the numeric-tolerant parser and stay not-enqueued', () => {
    expect(sallaSource()).toMatch(/parseSallaTimestampMs/)
    expect(sallaSource()).not.toMatch(/new Date\(String\(createdAtRaw\)\)/)
  })
})

describe('zid: nothing exits without a durable receipt', () => {
  it('malformed JSON, invalid lines, missing store, and unknown events are all stored', () => {
    const source = zidSource()
    expect(source).toMatch(/zid:malformed:/)
    expect(source).toMatch(/zid:invalid-lines:/)
    expect(source).toMatch(/zid:no-store:/)
    expect(source).toMatch(/zid:unknown:/)
  })

  it('the store_id guess is refused for unauthenticated deliveries', () => {
    // Forged store_id guessing must not survive unauthenticated callers.
    const source = zidSource()
    expect(source).toMatch(/!isUnauthenticated/)
    expect(source).toMatch(/التخمين من الصف الوحيد في merchant_tokens يُقبل فقط للتسليمات/)
    expect(source).toMatch(/guess refused\./)
  })

  it('token resolution is store_id first, merchant_id fallback — never an OR', () => {
    const source = zidSource()
    expect(source).toMatch(/async function resolveZidTokenRow/)
    expect(source).toMatch(/\.eq\('store_id', storeStr\)/)
    expect(source).toMatch(/\.eq\('merchant_id', storeStr\)/)
    expect(source).not.toMatch(/\.or\('store_id\.eq/)
  })

  it('token resolution is shared by the workspace lookup AND uninstall deletion', () => {
    const matches = zidSource().match(/resolveZidTokenRow\(/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(3)
  })
})

describe('shopify: nothing exits without a durable receipt', () => {
  it('malformed JSON on a signed delivery is stored before the 400', () => {
    expect(shopSource()).toMatch(/shopify:malformed:/)
  })

  it('stale deliveries are persisted, not discarded', () => {
    expect(shopSource()).toMatch(/shopify:stale:/)
  })

  it('the stale answer stays 2xx and never enqueues the late event', () => {
    expect(shopSource()).toMatch(/reason: 'stale_event'/)
  })

  it('the merge is verified: rows matched back, else fall through to enqueue', () => {
    const source = shopSource()
    // The merge update must select what it matched and stamp updated_at so
    // settlement can notice a coalesced-newer payload...
    expect(source).toMatch(
      /\.update\(\{\s*\n\s*payload: enrichedPayload,\s*\n\s*[\s\S]*?updated_at: new Date\(\)\.toISOString\(\),\s*[\s\S]*?\}\)\s*\n\s*\.eq\('id', mergeRowId\)\s*\n\s*\.select\('id'\)/
    )
    // ...and a lost merge must fall through instead of replying merged:true.
    expect(source).toMatch(/merge update fell through to enqueue/)
    expect(source).toMatch(/if \(mergeErr \|\| \(Array\.isArray\(mergedRows\) && mergedRows\.length === 0\)\)/)
  })
})

describe('the orphan replay route', () => {
  it('is admin-gated on both verbs', () => {
    const source = fs.readFileSync(REPLAY_PATH, 'utf8')
    expect(source).toMatch(/isAdmin\(userId\)/)
    expect(source).toMatch(/export async function POST/)
    expect(source).toMatch(/export async function GET/)
  })

  it('never replays uninstall-shaped events', () => {
    const source = fs.readFileSync(REPLAY_PATH, 'utf8')
    expect(source).toMatch(/isUninstallEvent/)
  })

  it('never replays sentinel events that a queue job cannot act on', () => {
    const source = fs.readFileSync(REPLAY_PATH, 'utf8')
    expect(source).toMatch(/invalid_json/)
    expect(source).toMatch(/unknown_event/)
  })

  it('resolves workspaces per platform via tokens tables', () => {
    const source = fs.readFileSync(REPLAY_PATH, 'utf8')
    expect(source).toMatch(/shopify_tokens/)
    expect(source).toMatch(/salla_tokens/)
    expect(source).toMatch(/merchant_tokens/)
  })
})
