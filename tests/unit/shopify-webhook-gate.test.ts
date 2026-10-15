import fs from 'fs'
import path from 'path'

import {
  classifiedShopifyEvents,
  resolveEventOperation,
  resolveOperationForEvent,
} from '@/lib/event-operation'
import { SHOPIFY_CORE_TOPICS } from '@/lib/shopify-client'
import { normalizeOdooOperation } from '@/lib/sync-engine'

/**
 * Shopify ingress pins (review 2026-10-11).
 *
 * Two gate↔engine disagreements were found and fixed in
 * `src/lib/event-operation.ts` (SHOPIFY_EVENTS table, consulted only when
 * platform === 'shopify' — Zid and Salla keep the heuristic byte-for-byte):
 *
 * 1. `collections/*` matched no heuristic branch, so the gate returned null
 *    (= allow unconditionally) and disabling Categories in Standard Mapping
 *    never blocked a collection webhook at ingress, while the engine did
 *    respect it later. Silent disagreement.
 * 2. `orders/delete` fell through to `update` in the gate while the engine
 *    routes it to `cancel` (EVENT_ALIASES → order.cancel), so the gate
 *    checked the wrong operation against enabled_actions.
 *
 * Plus a source pin for `listShopifyCollections`: Shopify has no unified
 * collections listing REST endpoint (only custom/smart collections), and the
 * old single-endpoint call 404'd, breaking Data Transfer category pulls.
 */

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('shopify gate classifications', () => {
  it('routes collections/* to categories (create/update/delete)', () => {
    expect(resolveEventOperation('collections/create', 'shopify')).toEqual({
      entityType: 'categories',
      operation: 'create',
    })
    expect(resolveEventOperation('collections/update', 'shopify')).toEqual({
      entityType: 'categories',
      operation: 'update',
    })
    expect(resolveEventOperation('collections/delete', 'shopify')).toEqual({
      entityType: 'categories',
      operation: 'delete',
    })
  })

  it('routes orders/delete to cancel, matching the engine', () => {
    expect(resolveEventOperation('orders/delete', 'shopify')).toEqual({
      entityType: 'orders',
      operation: 'cancel',
    })
    expect(resolveOperationForEvent('orders/delete', 'shopify')).toBe('cancel')
    expect(normalizeOdooOperation(undefined, 'orders/delete', 'shopify')).toBe('cancel')
  })

  it('exposes the explicit table for the pinning test', () => {
    const classified = new Set(classifiedShopifyEvents())
    for (const event of [
      'collections/create',
      'collections/update',
      'collections/delete',
      'orders/delete',
    ]) {
      expect(classified.has(event)).toBe(true)
    }
  })
})

describe('shopify gate and writer agree on every core topic', () => {
  it.each([...SHOPIFY_CORE_TOPICS])(
    'routes %s to the same operation on both paths',
    (topic) => {
      const gate = resolveOperationForEvent(topic, 'shopify')
      const engine = normalizeOdooOperation(undefined, topic, 'shopify')
      expect(gate).not.toBeNull()
      expect(gate).toBe(engine)
    }
  )
})

describe('shopify topics with no synced entity resolve to null', () => {
  // Precondition for the route's `no_entity_mapping` skip: carts, checkouts,
  // inventory and refunds have Standard toggles and real webhooks, but no
  // preset and no mapping-centre entry — the classifier must keep returning
  // null for them so the skip (not the queue) handles them.
  it.each([
    'carts/create',
    'carts/update',
    'checkouts/create',
    'checkouts/update',
    'checkouts/delete',
    'inventory_levels/update',
    'inventory_items/create',
    'inventory_items/update',
    'inventory_items/delete',
    'refunds/create',
  ])('resolves %s to null', (topic) => {
    expect(resolveEventOperation(topic, 'shopify')).toBeNull()
  })

  it('still classifies every core topic (no over-skipping)', () => {
    for (const topic of [...SHOPIFY_CORE_TOPICS]) {
      expect(resolveEventOperation(topic, 'shopify')).not.toBeNull()
    }
  })
})

describe('shopify explicit table does not leak into other platforms', () => {
  it('keeps the heuristic for zid/salla/unscoped callers', () => {
    // collections/* classified only for shopify; elsewhere the heuristic
    // still returns null (allowed through, engine performs no write).
    expect(resolveEventOperation('collections/create', 'zid')).toBeNull()
    expect(resolveEventOperation('collections/create', 'salla')).toBeNull()
    expect(resolveEventOperation('collections/create')).toBeNull()
    // orders/delete stays an update outside shopify (engine alias table is
    // what makes it a cancel, and only the shopify gate path was fixed).
    expect(resolveOperationForEvent('orders/delete', 'zid')).toBe('update')
    expect(resolveOperationForEvent('orders/delete')).toBe('update')
  })
})

describe('listShopifyCollections endpoints (source pins)', () => {
  const client = read('src/lib/shopify-client.ts')

  it('never calls a unified collections listing endpoint', () => {
    // Checked to fail on the old code, which built `/collections.json?...`.
    // The doc comment above names no such path, and 'custom_collections.json'
    // cannot false-positive (underscore, not slash, precedes 'collections').
    expect(client).not.toContain('/collections.json')
  })

  it('reads both custom and smart collections', () => {
    expect(client).toContain('custom_collections.json')
    expect(client).toContain('smart_collections.json')
  })
})
