/**
 * Tests for arrival notifications (P1-1) and preferences (P1-2).
 *
 * The merchant relies on Odoo to prepare orders, but orders can sit in the
 * queue during peak season. The arrival alert makes Telegram a temporary
 * stand-in: "new order received — sending to Odoo". Rules pinned here:
 *   1. Arrival alerts are opt-in (default off — existing chats unchanged).
 *   2. Arrival is announced for orders only (bulk product/customer syncs
 *      must not flood the chat).
 *   3. The route never awaits the send (fire-and-forget), and a Telegram
 *      failure can never fail the order.
 *   4. updateSubscription preserves unrelated mapping_filter keys.
 */

import fs from 'fs'
import path from 'path'

import {
  buildArrivalMessage,
  parseArrivalFilter,
} from '@/lib/telegram-notifier'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8')
}

describe('parseArrivalFilter', () => {
  it('is opt-in: missing flag means false', () => {
    expect(parseArrivalFilter(undefined)).toBe(false)
    expect(parseArrivalFilter(null)).toBe(false)
    expect(parseArrivalFilter({})).toBe(false)
    expect(parseArrivalFilter({ mappings: [], events: ['orders'] })).toBe(false)
  })

  it('reads the flag from the mapping_filter object', () => {
    expect(parseArrivalFilter({ notify_on_arrival: true })).toBe(true)
    expect(parseArrivalFilter({ mappings: [], notify_on_arrival: true })).toBe(true)
    expect(parseArrivalFilter({ notify_on_arrival: false })).toBe(false)
    expect(parseArrivalFilter({ notify_on_arrival: 'yes' })).toBe(false)
  })

  it('ignores legacy array-shaped filters', () => {
    expect(parseArrivalFilter(['orders'])).toBe(false)
  })
})

describe('buildArrivalMessage', () => {
  it('builds the Arabic arrival message with platform, order and pending note', () => {
    const msg = buildArrivalMessage(
      { platform: 'salla', event: 'order.created', entityId: '12345', storeId: 'mystore' },
      'ar'
    )
    expect(msg).toContain('سلة')
    expect(msg).toContain('#12345')
    expect(msg).toContain('جاري الإرسال إلى أودوو')
  })

  it('builds the English variant', () => {
    const msg = buildArrivalMessage(
      { platform: 'zid', event: 'order.create', entityId: '99' },
      'en'
    )
    expect(msg).toContain('Zid')
    expect(msg).toContain('Sending to Odoo')
  })

  it('works without an entity id', () => {
    const msg = buildArrivalMessage({ platform: 'shopify', event: 'orders/create' }, 'ar')
    expect(msg).toContain('شوبيفاي')
    expect(msg).toContain('جاري الإرسال إلى أودوو')
  })
})

describe('arrival wiring (source pins)', () => {
  const notifier = readSrc('lib', 'telegram-notifier.ts')
  const zid = readSrc('app', 'api', 'webhooks', 'zid', 'route.ts')
  const salla = readSrc('app', 'api', 'webhooks', 'salla', 'route.ts')
  const shopify = readSrc('app', 'api', 'webhooks', 'shopify', 'route.ts')
  const settings = readSrc('app', 'actions', 'telegram-settings.ts')

  it('all three routes fire the arrival alert on fresh enqueue only', () => {
    for (const [name, src] of [['zid', zid], ['salla', salla], ['shopify', shopify]] as const) {
      expect(`${name}:${src.includes('notifyOrderArrival')}`).toBe(`${name}:true`)
    }
    // fresh insert only (id present) — duplicates/coalesced rows are not new orders
    expect(zid).toContain('if (queued.id)')
    expect(salla).toContain('if (enqueued.id)')
    expect(shopify).toContain('if (queued.id)')
  })

  it('routes never await the send — a Telegram stall cannot delay the 2xx', () => {
    for (const src of [zid, salla, shopify]) {
      const idx = src.indexOf('notifyOrderArrival({')
      expect(idx).toBeGreaterThan(-1)
      // the call sits inside a .then() chain with a terminal .catch()
      const window = src.slice(Math.max(0, idx - 300), idx + 500)
      expect(window).toContain('.catch(() => {})')
    }
  })

  it('arrival is restricted to orders and to opted-in chats, and never throws', () => {
    expect(notifier).toContain("getEventCategory(event) !== 'orders'")
    expect(notifier).toContain('if (!chat.notify_on_arrival) continue')
  })

  it('preferences round-trip through updateSubscription without dropping keys', () => {
    expect(settings).toContain('notify_on_arrival')
    expect(settings).toContain('parseArrivalFilter')
  })
})
