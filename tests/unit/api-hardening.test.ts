import { checkRateLimit, resetRateLimits } from '../../src/lib/rate-limit'
import {
  validateOrderLines,
  validatePrice,
  validateQuantity,
  validateStatus,
} from '../../src/lib/platform-validation'
import { isStrictWebhookAuth, isWebhookBodyTooLarge } from '../../src/lib/webhook-strict'

describe('api hardening (OWASP review 2026-10-08)', () => {
  beforeEach(() => resetRateLimits())

  test('rate limit allows N then blocks', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('k1', 5, 60_000).allowed).toBe(true)
    }
    expect(checkRateLimit('k1', 5, 60_000).allowed).toBe(false)
  })

  test('strict webhook auth defaults off, honours true/1', () => {
    const prev = process.env.STRICT_WEBHOOK_AUTH
    delete process.env.STRICT_WEBHOOK_AUTH
    expect(isStrictWebhookAuth()).toBe(false)
    process.env.STRICT_WEBHOOK_AUTH = 'true'
    expect(isStrictWebhookAuth()).toBe(true)
    process.env.STRICT_WEBHOOK_AUTH = '1'
    expect(isStrictWebhookAuth()).toBe(true)
    if (prev === undefined) delete process.env.STRICT_WEBHOOK_AUTH
    else process.env.STRICT_WEBHOOK_AUTH = prev
  })

  test('webhook body guard rejects >1MB', () => {
    expect(isWebhookBodyTooLarge('x'.repeat(10))).toBe(false)
    expect(isWebhookBodyTooLarge('x'.repeat(1_000_001))).toBe(true)
  })

  test('platform validation pins bad money/qty/status', () => {
    expect(validatePrice(-1).ok).toBe(false)
    expect(validatePrice(Number.POSITIVE_INFINITY).ok).toBe(false)
    expect(validatePrice(99.5).ok).toBe(true)
    expect(validateQuantity(Number.NaN).ok).toBe(false)
    expect(validateQuantity(3).ok).toBe(true)
    expect(validateStatus('paid').ok).toBe(true)
    expect(validateStatus('<script>').ok).toBe(false)
  })

  test('order lines with broken price are rejected, missing items pass (thin payload)', () => {
    expect(validateOrderLines(undefined).ok).toBe(true)
    expect(validateOrderLines([{ price: 10, quantity: 2 }]).ok).toBe(true)
    expect(validateOrderLines([{ price: -5, quantity: 1 }]).ok).toBe(false)
    expect(validateOrderLines([{ price: 'abc', quantity: 1 }]).ok).toBe(false)
  })
})
