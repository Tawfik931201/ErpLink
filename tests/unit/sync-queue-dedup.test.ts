import { extractEntityId, fingerprintPayload } from '@/lib/sync-queue'

/**
 * Guards the two rules that caused a live production data-loss bug (see
 * AGENTS.md → Sync Reliability):
 *
 *   1. `dedup_key` must identify the EVENT/DELIVERY, never the RECORD.
 *      A record-scoped key makes every later update look like a duplicate and
 *      silently drops real changes.
 *   2. An exact redelivery of the same content must collapse to one fingerprint.
 *
 * Source under test: src/lib/sync-queue.ts
 */

describe('fingerprintPayload', () => {
  it('is stable for the same content', () => {
    const payload = { order_id: 'A-1', total: 100 }
    expect(fingerprintPayload(payload)).toBe(fingerprintPayload({ order_id: 'A-1', total: 100 }))
  })

  it('ignores key order', () => {
    // This is why sortKeys() exists: JSON.stringify preserves insertion order,
    // so without canonicalisation an identical payload could hash differently.
    const a = { order_id: 'A-1', total: 100, status: 'new' }
    const b = { status: 'new', total: 100, order_id: 'A-1' }
    expect(fingerprintPayload(a)).toBe(fingerprintPayload(b))
  })

  it('changes when a field genuinely changes (the anti-data-loss rule)', () => {
    const before = { order_id: 'A-1', total: 100 }
    const after = { order_id: 'A-1', total: 250 }
    expect(fingerprintPayload(before)).not.toBe(fingerprintPayload(after))
  })

  it('is NOT a record identity: two edits of one record get two fingerprints', () => {
    const first = { order_id: 'A-1', status: 'new' }
    const second = { order_id: 'A-1', status: 'ready' }
    expect(fingerprintPayload(first)).not.toBe(fingerprintPayload(second))
  })

  it('sorts nested objects too', () => {
    const a = { order: { id: 1, lines: [{ sku: 'X', qty: 2 }] } }
    const b = { order: { lines: [{ qty: 2, sku: 'X' }], id: 1 } }
    expect(fingerprintPayload(a)).toBe(fingerprintPayload(b))
  })

  it('preserves array order (arrays are data, not keys)', () => {
    const a = { lines: [{ sku: 'X' }, { sku: 'Y' }] }
    const b = { lines: [{ sku: 'Y' }, { sku: 'X' }] }
    expect(fingerprintPayload(a)).not.toBe(fingerprintPayload(b))
  })

  it('returns a short fixed-length hex string', () => {
    expect(fingerprintPayload({ a: 1 })).toMatch(/^[0-9a-f]{16}$/)
  })

  it('degrades to "nohash" rather than throwing on a circular payload', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    expect(fingerprintPayload(circular)).toBe('nohash')
  })
})

describe('extractEntityId', () => {
  it('reads a top-level id', () => {
    expect(extractEntityId({ id: 'zid-1' })).toBe('zid-1')
  })

  it('reads from the nested data object', () => {
    expect(extractEntityId({ data: { id: 'zid-2' } })).toBe('zid-2')
  })

  it('coerces numeric ids to strings', () => {
    expect(extractEntityId({ order_id: 55 })).toBe('55')
  })

  it('prefers a quant id for stock events so repeated stock updates coalesce', () => {
    expect(extractEntityId({ quant_id: 900 })).toBe('quant:900')
  })

  it('builds a composite stock key from product + location', () => {
    const key = extractEntityId({ product_id: 12, location_id: 3 })
    expect(key).toBe('p12:l3')
  })

  it('falls back to the Odoo record id when the platform sent nothing else', () => {
    expect(extractEntityId({ odooRecordId: 77 })).toBe('77')
  })

  it('ignores empty strings so it does not coalesce on a blank id', () => {
    expect(extractEntityId({ order_id: '', uuid: 'real-uuid' })).toBe('real-uuid')
  })

  it('returns an empty string when nothing identifies the event', () => {
    expect(extractEntityId({})).toBe('')
    expect(extractEntityId({ unrelated: 'value' })).toBe('')
  })
})
