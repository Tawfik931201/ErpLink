import { readFileSync } from 'fs'
import { join } from 'path'

import {
  TELEGRAM_ARRIVAL_DELAY_MS,
  decideOutboxAction,
  nextAttemptDelayMs,
} from '@/lib/telegram-outbox'

/**
 * صندوق صادر التليجرام.
 *
 * العيب الذي يصلحه هذا الملف: الإشعار كان يُرسل بـ`callTelegramApi` من داخل
 * عامل المزامنة — 429 من تليجرام كان **يُبتلع بلا إعادة محاولة** (الرسالة
 * تضيع)، و`fetch` بلا مهلة كان يحتجز عامل المزامنة إلى الأبد (10 تعليقات
 * كانت تُوقف الطابور كله). وتضخيم الرسائل كان يجعل حدثاً واحداً ⇒ رسالة
 * وصول + (1 + N) رسالة نتيجة.
 */

const SRC = join(__dirname, '..', '..', 'src')

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8')
}

describe('the outbox conflict decision', () => {
  it('inserts when nothing is pending for the event', () => {
    expect(decideOutboxAction(null, 1)).toBe('insert')
    expect(decideOutboxAction(undefined, 2)).toBe('insert')
  })

  it('skips a message of equal or lower priority — one message per event', () => {
    // وصول (0) موجود ⇒ نتيجة (1) تستبدله. نتيجة (1) ⇒ أخرى (1) تُهمل.
    expect(decideOutboxAction(1, 1)).toBe('skip')
    expect(decideOutboxAction(2, 1)).toBe('skip')
    expect(decideOutboxAction(2, 2)).toBe('skip')
  })

  it('lets a failure replace a pending success — failures are never swallowed', () => {
    // وصول (0) موجود ⇒ النتيجة (1) تستبدله (النتيجة أهم من الوصول).
    expect(decideOutboxAction(0, 1)).toBe('replace')
    // نجاح (1) موجود ⇒ فشل (2) يستبدله.
    expect(decideOutboxAction(1, 2)).toBe('replace')
  })
})

describe('the outbox retry schedule', () => {
  it('backs off exponentially and caps at 15 minutes', () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000)
    expect(nextAttemptDelayMs(2)).toBe(120_000)
    expect(nextAttemptDelayMs(3)).toBe(240_000)
    expect(nextAttemptDelayMs(10)).toBe(15 * 60_000)
  })

  it('obeys the retry_after the platform asked for', () => {
    expect(nextAttemptDelayMs(1, 7_000)).toBe(7_000)
    expect(nextAttemptDelayMs(5, 30_000)).toBe(30_000)
  })
})

describe('the Telegram outbox wiring', () => {
  it('never calls the Telegram API from the sync-result path', () => {
    const notifier = read('lib', 'telegram-notifier.ts')
    const syncResult = notifier.slice(
      notifier.indexOf('export async function notifySyncResult'),
      notifier.indexOf('export function botTokenFingerprint')
    )
    // The sync path must WRITE to the outbox, not send. A direct send here
    // is what made a 429 lose the message.
    expect(syncResult).not.toContain('callTelegramApi(')
    expect(syncResult).toContain('enqueueTelegramMessage')
  })

  it('never calls the Telegram API from the arrival path either', () => {
    const notifier = read('lib', 'telegram-notifier.ts')
    const arrival = notifier.slice(notifier.indexOf('export async function notifyOrderArrival'))
    expect(arrival).not.toContain('callTelegramApi(')
    expect(arrival).toContain('enqueueTelegramMessage')
  })

  it('keeps the direct-send path only for the two immediate replies', () => {
    const notifier = read('lib', 'telegram-notifier.ts')
    // The link confirmation and the "test message" button are answers the
    // user is waiting for right now — they stay direct.
    expect(notifier).toContain('sendTelegramWelcomeRaw')
    const settings = read('app', 'actions', 'telegram-settings.ts')
    expect(settings).toContain('sendMessage')
  })

  it('gives the Telegram HTTP call a timeout', () => {
    const outbox = read('lib', 'telegram-outbox.ts')
    // Without a timeout, a hung api.telegram.org holds the sender forever.
    expect(outbox).toContain('AbortController')
    expect(outbox).toContain('signal: controller.signal')
    expect(outbox).toContain('SEND_TIMEOUT_MS')
  })

  it('honours the retry_after Telegram sends on a 429', () => {
    const outbox = read('lib', 'telegram-outbox.ts')
    expect(outbox).toContain('retry_after')
    expect(outbox).toContain('retryAfterMs')
  })

  it('starts the sender from instrumentation, not from a request', () => {
    const instrumentation = read('instrumentation.ts')
    expect(instrumentation).toContain('startTelegramOutboxRunner')
  })
})

describe('one message per request', () => {
  it('shares one event key between the arrival alert and the sync result', () => {
    // The arrival fires at ingress and the result after the sync — they must
    // land on the SAME key, or the client gets two messages per order.
    const zid = read('app', 'api', 'webhooks', 'zid', 'route.ts')
    expect(zid).toContain('eventKey: queued.id ? `queue:${queued.id}` : null')

    const salla = read('app', 'api', 'webhooks', 'salla', 'route.ts')
    expect(salla).toContain('eventKey: enqueued.id ? `queue:${enqueued.id}` : null')

    const shopify = read('app', 'api', 'webhooks', 'shopify', 'route.ts')
    expect(shopify).toContain('eventKey: queued.id ? `queue:${queued.id}` : null')
  })

  it('carries the queue row id into the sync result', () => {
    const engine = read('lib', 'sync-engine.ts')
    expect(engine).toContain('queueItemId ? `queue:${queueItemId}` : null')

    const queue = read('lib', 'sync-queue.ts')
    // The worker must hand the row id down, else the result has no key.
    const call = queue.slice(queue.indexOf('processWebhookEvent('))
    expect(call.slice(0, 600)).toContain('item.id')
  })

  it('delays the arrival alert so the result can cancel it', () => {
    const notifier = read('lib', 'telegram-notifier.ts')
    expect(notifier).toContain('TELEGRAM_ARRIVAL_DELAY_MS')
    expect(TELEGRAM_ARRIVAL_DELAY_MS).toBeGreaterThan(0)
  })
})

describe('the outbox table', () => {
  it('is declared with a partial unique index on the event key', () => {
    const migration = readFileSync(
      join(__dirname, '..', '..', 'supabase', 'migrations', '20261022_telegram_outbox.sql'),
      'utf8'
    )
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.telegram_outbox')
    expect(migration).toContain('uq_telegram_outbox_pending_event')
    // The index must be partial (pending only) — a settled row must not veto
    // a later notification for the same event.
    expect(migration).toMatch(/uq_telegram_outbox_pending_event[\s\S]{0,200}status = 'pending'/)
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
  })
})
