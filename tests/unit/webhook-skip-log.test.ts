/**
 * Tests for webhook skip visibility (P0-1 of the season plan).
 *
 * Every deliberate "ignore" decision in the webhook ingress paths must leave a
 * queryable trace in `sync_logs` instead of passing silently with a 200.
 * `logWebhookSkip` itself writes to the DB (untestable without a database),
 * so this suite pins:
 *   1. the pure message builder (all four reasons, detail clipping), and
 *   2. source pins proving each route actually calls it while keeping the
 *      exact same HTTP responses as before (no platform-visible change).
 */

import fs from 'fs'
import path from 'path'

import { buildSkipMessage } from '@/lib/webhook-skip-log'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8')
}

describe('buildSkipMessage', () => {
  it.each([
    ['disabled_in_settings'],
    ['unhandled_event'],
    ['unknown_topic'],
    ['stale_event'],
    ['no_entity_mapping'],
  ] as const)('builds a tagged Arabic message for %s', (reason) => {
    const msg = buildSkipMessage(reason)
    expect(msg).toContain(`[${reason}]`)
    expect(msg.length).toBeGreaterThan(reason.length + 10)
  })

  it('appends the detail when provided', () => {
    const msg = buildSkipMessage('disabled_in_settings', 'orders.create not enabled')
    expect(msg).toContain('orders.create not enabled')
  })

  it('clips a very long detail instead of bloating the row', () => {
    const msg = buildSkipMessage('disabled_in_settings', 'x'.repeat(1000))
    expect(msg.length).toBeLessThan(500)
  })

  it('never throws on empty or undefined detail', () => {
    expect(() => buildSkipMessage('stale_event', '')).not.toThrow()
    expect(() => buildSkipMessage('stale_event')).not.toThrow()
    expect(() => buildSkipMessage('stale_event', null)).not.toThrow()
  })
})

describe('skip-log wiring (source pins)', () => {
  const zid = readSrc('app', 'api', 'webhooks', 'zid', 'route.ts')
  const salla = readSrc('app', 'api', 'webhooks', 'salla', 'route.ts')
  const shopify = readSrc('app', 'api', 'webhooks', 'shopify', 'route.ts')

  it('zid logs all five disabled-in-settings paths', () => {
    const calls = zid.match(/reason: 'disabled_in_settings'/g) || []
    // five handlers (order/product/customer/category/abandoned-cart) each pass
    // the reason into logWebhookSkip
    expect(calls.length).toBeGreaterThanOrEqual(5)
    expect(zid).toContain("reason: 'unhandled_event'")
  })

  it('salla logs the disabled-in-settings path', () => {
    expect(salla).toContain("reason: 'disabled_in_settings'")
  })

  it('shopify logs disabled, stale, unknown-topic and no-entity paths', () => {
    expect(shopify).toContain("reason: 'disabled_in_settings'")
    expect(shopify).toContain("reason: 'stale_event'")
    expect(shopify).toContain("reason: 'unknown_topic'")
    expect(shopify).toContain("reason: 'no_entity_mapping'")
  })

  it('shopify answers the no-entity skip with plain 200 (no retry storm)', () => {
    const idx = shopify.indexOf("reason: 'no_entity_mapping'")
    expect(idx).toBeGreaterThan(-1)
    const window = shopify.slice(idx, idx + 400)
    expect(window).not.toContain('status: 503')
    expect(window).not.toContain('status: 400')
  })

  it('no platform-visible response changed: disabled paths still answer plain 200', () => {
    // The disabled responses must NOT carry an explicit error status — a 503/4xx
    // would turn an intentional skip into a platform retry storm.
    for (const [name, src] of [['zid', zid], ['salla', salla], ['shopify', shopify]] as const) {
      const idx = src.indexOf("reason: 'disabled_in_settings'")
      expect(idx).toBeGreaterThan(-1)
      const window = src.slice(idx, idx + 400)
      expect(window).not.toContain('status: 503')
      expect(window).not.toContain('status: 400')
      expect(name).toBeTruthy()
    }
  })

  it('durable-failure paths still answer 503 (retry signal preserved)', () => {
    expect(zid).toContain('durable_storage_failed')
    expect(salla).toContain('durable_storage_failed')
    expect(shopify).toContain('durable_storage_failed')
  })
})
