import fs from 'fs'
import path from 'path'

import {
  classifiedSallaEvents,
  resolveEventOperation,
  resolveOperationForEvent,
} from '@/lib/event-operation'
import { normalizeOdooOperation } from '@/lib/sync-engine'

/**
 * Event → operation is the highest-consequence routing decision in the app.
 *
 * It used to be answered independently by two functions — the ingress gate
 * (`webhook-gate.mapEventToEntityAndOp`) and the writer
 * (`sync-engine.normalizeOdooOperation`) — which agreed by luck on the events
 * that had been tested and disagreed on the rest. The dangerous case:
 * `order.shipment.cancelled` substring-matched to `cancel` in BOTH places, so
 * cancelling a *shipment* wrote `{state:'cancel'}` on the whole `sale.order`.
 *
 * These tests pin the single source of truth (`src/lib/event-operation.ts`) and,
 * most importantly, that the gate and the writer can no longer drift apart.
 *
 * Sources:
 *  - https://docs.salla.dev/webhooks  (event catalogue + strategy)
 *  - https://docs.salla.dev/doc-433804  (order.status.updated payload shape)
 *  - Portal `salla_events action=list` for app 1691480817, read 2026-10-05
 */

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// The subscribed catalogue is parsed out of the source rather than imported:
// `salla-client.ts` pulls in axios and the Supabase client, and this suite must
// stay a pure unit test. Same approach as salla-webhook-auth.test.ts.
const SUBSCRIBED_EVENTS: string[] = Array.from(
  read('src/lib/salla-client.ts').match(
    /export const SALLA_DEFAULT_WEBHOOK_EVENTS = \[([\s\S]*?)\n\]/
  )![1].matchAll(/'([a-z]+\.[a-z._]+)'/g)
).map((m) => m[1])

const SUBSCRIBED = SUBSCRIBED_EVENTS

/** Prefix → entity, as standard_mapping_settings spells it. */
const EXPECTED_ENTITY: Array<[string, string]> = [
  ['order.', 'orders'],
  ['product.', 'products'],
  ['customer.', 'customers'],
  ['category.', 'categories'],
]

describe('Salla event catalogue ↔ classifier agreement', () => {
  it('classifies every subscribed Salla event explicitly, none by fallback', () => {
    const classified = new Set(classifiedSallaEvents())
    const missing = SUBSCRIBED.filter((e) => !classified.has(e))
    expect(missing).toEqual([])
  })

  it('has no subscription outside the verified Portal catalogue', () => {
    // Guards the failure mode where an invented slug silently persists in the
    // Portal but never errors — see AGENTS.md, Salla ingress.
    const classified = new Set(classifiedSallaEvents())
    for (const event of SUBSCRIBED) {
      expect(classified.has(event)).toBe(true)
    }
    // 29 published + documented-but-unsubscribed events (coupon/brand/tags/
    // otp/abandoned) — anything far above this means slugs were added ad hoc.
    expect(classified.size).toBeLessThanOrEqual(40)
  })

  it('never lets an Salla event resolve to nothing (no silent no-op writes)', () => {
    for (const event of SUBSCRIBED) {
      expect(resolveEventOperation(event, 'salla')).not.toBeNull()
      expect(resolveOperationForEvent(event, 'salla')).not.toBeNull()
    }
  })
})

describe('the gate and the writer can no longer disagree', () => {
  it('routes every subscribed event to the same operation on both paths', () => {
    for (const event of SUBSCRIBED) {
      const gated = resolveEventOperation(event, 'salla')!
      const written = normalizeOdooOperation(undefined, event, 'salla')
      expect({ event, written }).toEqual({ event, written: gated.operation })
    }
  })

  it('routes every subscribed event to the entity Mapping Center configures', () => {
    for (const event of SUBSCRIBED) {
      const expected = EXPECTED_ENTITY.find(([prefix]) => event.startsWith(prefix))
      expect(expected).toBeDefined()
      expect({ event, entity: resolveEventOperation(event, 'salla')!.entityType }).toEqual({
        event,
        entity: expected![1],
      })
    }
  })
})

describe('shipment cancellation must never cancel the order (regression)', () => {
  const SHIPMENT_EVENTS = [
    'order.shipment.creating',
    'order.shipment.created',
    'order.shipment.cancelled',
    'order.shipment.return.creating',
    'order.shipment.return.created',
    'order.shipment.return.cancelled',
  ]

  it('only order.cancelled maps to cancel', () => {
    const cancellers = SUBSCRIBED.filter(
      (e) => resolveOperationForEvent(e, 'salla') === 'cancel'
    )
    expect(cancellers).toEqual(['order.cancelled'])
  })

  it('treats every shipment-cancelled event as an update', () => {
    // A shipment is a child object: its payload is {id, reference_id,
    // shipping_number} with no items/status/customer. Cancelling the sale.order
    // on that signal destroys the order.
    for (const event of SHIPMENT_EVENTS.filter((e) => e.includes('cancelled'))) {
      expect(resolveOperationForEvent(event, 'salla')).toBe('update')
      expect(normalizeOdooOperation(undefined, event, 'salla')).toBe('update')
    }
  })

  it('makes order.shipment.created the only delivery signal', () => {
    // Full or partial Odoo delivery is driven from here and nowhere else.
    const deliveries = SUBSCRIBED.filter(
      (e) => resolveOperationForEvent(e, 'salla') === 'deliver'
    )
    expect(deliveries).toEqual(['order.shipment.created'])
  })

  it('keeps order.shipment.creating an update, not a create', () => {
    // "creating" is substring-ambiguous: it is neither "create" nor "updated",
    // so the heuristic used to fall through to `create` and fabricate orders.
    for (const event of ['order.shipment.creating', 'order.shipment.return.creating']) {
      expect(normalizeOdooOperation(undefined, event, 'salla')).toBe('update')
    }
  })
})

describe('events the heuristic used to misroute to create', () => {
  it.each([
    ['order.refunded', 'update'],
    ['product.quantity.low', 'update'],
    ['customer.login', 'update'],
    ['order.deleted', 'update'],
  ])('routes %s to %s', (event, expected) => {
    expect(normalizeOdooOperation(undefined, event, 'salla')).toBe(expected)
    expect(resolveOperationForEvent(event, 'salla')).toBe(expected)
  })

  it('keeps product.deleted a delete — products do have a delete branch', () => {
    expect(resolveOperationForEvent('product.deleted', 'salla')).toBe('delete')
    expect(normalizeOdooOperation(undefined, 'product.deleted', 'salla')).toBe('delete')
  })

  it('creates on the genuine create events', () => {
    for (const event of ['order.created', 'product.created', 'customer.created', 'category.created']) {
      expect(resolveOperationForEvent(event, 'salla')).toBe('create')
    }
  })
})

describe('Zid and Shopify keep their existing behaviour', () => {
  it('does not let the Salla table leak into other platforms', () => {
    // 'order.deleted' is update for Salla (no sale.order delete path) but must
    // stay delete for Zid, which does have one.
    expect(normalizeOdooOperation(undefined, 'order.deleted', 'zid')).toBe('delete')
    expect(normalizeOdooOperation(undefined, 'order.deleted', 'shopify')).toBe('delete')
    expect(normalizeOdooOperation(undefined, 'order.deleted', 'salla')).toBe('update')
  })

  it('keeps the Zid alias table authoritative', () => {
    expect(normalizeOdooOperation(undefined, 'zid:order.update')).toBe('update')
    expect(normalizeOdooOperation(undefined, 'zid:product.publish')).toBe('update')
    expect(normalizeOdooOperation(undefined, 'shopify:collections/delete')).toBe('delete')
    expect(normalizeOdooOperation(undefined, 'zid:something.unknown')).toBe('create')
  })

  it('still prefers an explicit operation over anything derived', () => {
    for (const platform of ['zid', 'salla', 'shopify'] as const) {
      expect(normalizeOdooOperation('cancel', 'order.shipment.cancelled', platform)).toBe('cancel')
    }
  })
})

describe('a newly published Salla event degrades instead of no-opping', () => {
  it('falls back to the heuristic when the table has no entry', () => {
    // Salla publishes events without notice. An unknown one must still route by
    // the old heuristic rather than becoming a silent no-op.
    expect(resolveEventOperation('order.something.created', 'salla')).toEqual({
      entityType: 'orders',
      operation: 'create',
    })
    expect(resolveEventOperation('product.whatever.updated', 'salla')).toEqual({
      entityType: 'products',
      operation: 'update',
    })
  })

  it('returns null for an event that maps to no synced entity', () => {
    expect(resolveEventOperation('app.store.updated', 'salla')).toBeNull()
    expect(resolveEventOperation('', 'salla')).toBeNull()
  })

  it('keeps product.category.updated on the product branch', () => {
    // "category" also appears inside product events; the branch order decides.
    expect(resolveEventOperation('product.category.updated', 'salla')).toEqual({
      entityType: 'products',
      operation: 'update',
    })
  })
})

/**
 * Source pins. The nested-payload fix lives inside a ~7000-line function and
 * cannot be reached by a unit test without a live Salla API, so it is pinned at
 * source level — the idiom already used by odoo-webhook-trust and
 * salla-webhook-auth. Each pin was checked to fail when the rule is reverted.
 */
describe('source pins', () => {
  it('has exactly one copy of the classification table', () => {
    // The bug was two independent implementations. A second hardcoded table, or
    // a leftover mapEventToEntityAndOp, reintroduces the drift.
    expect(read('src/lib/event-operation.ts')).toContain('const SALLA_EVENTS')
    expect(read('src/lib/webhook-gate.ts')).not.toContain('mapEventToEntityAndOp')
    expect(read('src/lib/sync-engine.ts')).not.toContain('mapEventToEntityAndOp')
  })

  it('has no inline event classifier left in sync-engine', () => {
    // There were THREE copies, not two. The third — inside
    // processFixedMappingFallback — is the one the actual Odoo write obeys, and
    // the fallback is what most Salla shipment events take because a custom
    // field mapping rarely matches them. It duplicated the substring ladder
    // verbatim, so removing the other two would still have left
    // order.shipment.cancelled writing {state:'cancel'}.
    //
    // Anchored on `normalizedEvent` so it matches the event ladder only. The
    // `verb.includes('cancel')` ternaries around sync-engine.ts:1738 are a
    // different concern — they translate a merchant's configured action name
    // ("cancel", "fulfill") in Mapping Center, not an inbound event slug — and
    // must not be "cleaned up" to satisfy this pin.
    const engine = read('src/lib/sync-engine.ts')
    expect(engine).not.toMatch(/normalizedEvent\.includes\('cancel'\) \? 'cancel'/)
    expect(engine).not.toMatch(/normalizedEvent\.includes\('deliver'\) \? 'deliver'/)
    // Every operation decision must go through the shared function.
    expect(engine).toContain(
      'const odooOperation: OdooOperation = normalizeOdooOperation(undefined, event, platform)'
    )
  })

  it('routes both consumers through the shared resolver', () => {
    expect(read('src/lib/webhook-gate.ts')).toContain('resolveEventOperation(event, storeType)')
    expect(read('src/lib/sync-engine.ts')).toContain('resolveOperationForEvent(event, platform)')
  })

  it('passes the resolved platform into the operation router', () => {
    // Without the platform the router cannot consult the Salla table at all,
    // silently restoring the substring behaviour.
    const engine = read('src/lib/sync-engine.ts')
    expect(engine).toContain(
      'normalizeOdooOperation(mapping.odoo_operation, event, mappingPlatform)'
    )
    expect(engine).toContain('normalizeOdooOperation(undefined, event, storeType)')
  })

  it('reads the nested data.order and prefers it for both id and merge', () => {
    const engine = read('src/lib/sync-engine.ts')
    expect(engine).toContain('(data as any)?.order')
    // The order branch merges the nested order LAST so the event's fresher
    // values win over our GET — and the thin envelope can no longer overwrite
    // the correct id with the status-record id.
    expect(engine).toContain('data = { ...full, ...orderSource }')
    // Customer and category have no nested form, so they keep `...data` — which
    // is exactly why a third `...data` merge (the old order branch) must not be
    // there. Counted rather than matched on formatting.
    expect(engine.match(/data = \{ \.\.\.full, \.\.\.data \}/g) ?? []).toHaveLength(2)
  })
})