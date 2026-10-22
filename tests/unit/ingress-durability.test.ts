import { readFileSync } from 'fs'
import { join } from 'path'

import { buildSkipMessage } from '@/lib/webhook-skip-log'
import {
  buildDedupeKey,
  extractFieldMappingId,
} from '@/lib/sync-queue'

/**
 * سدّ الفقد الصامت (المرحلة 4).
 *
 * العيوب التي يصلحها هذا الملف:
 *   1. سبعة فروع SKIP في مسار أودوو ← المتجر كانت **بلا أي سجل** ⇒ الصف
 *      يُحذف من الطابور كـ«نجاح» والحدث يختفي. وأخطرها: رفض الحذف لغياب
 *      المفتاح ⇒ **العميل لا يعرف** أن منتجه حُذف في أودوو وبقي في متجره.
 *   2. مسار الـpreset كان يرجّع `null` بلا سجل — نفس المشكلة.
 *   3. فشل قراءة تفاصيل الطلب من زد كان **يُبتلع** ⇒ نكتب في أودوو طلباً
 *      **بلا بنود** (لا منتجات) ويبدو ناجحاً.
 *   4. الدمج (coalescing) كان يخلط خريطتين على نفس سجل أودوو ⇒ كتابة إحداهما
 *      تُسقط بصمت.
 *   5. مسار الإنقاذ (drain) كان يرث max_retries افتراضي (3) بدل 5.
 */

const SRC = join(__dirname, '..', '..', 'src')

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8')
}

describe('the Odoo → store skips leave a trace', () => {
  const odoo = read('app', 'api', 'webhooks', 'odoo', 'route.ts')

  it('logs every skip reason it can reach', () => {
    // Seven branches: direction off, wrong ERP type, no field mappings,
    // deletion refused (unauthenticated), deletion without values, deletion
    // without a match value, empty match field.
    for (const reason of [
      'odoo_direction_disabled',
      'odoo_erp_type_unsupported',
      'odoo_no_field_mappings',
      'odoo_deletion_unauthenticated',
      'odoo_deletion_no_values',
      'odoo_deletion_no_match_value',
      'odoo_empty_match_field',
    ]) {
      expect(odoo).toContain(`reason: '${reason}'`)
    }
  })

  it('keeps the skip outcome itself unchanged', () => {
    // The fix must add visibility, NOT change what happens to the event:
    // a skip is still a skip (the row is dropped, not retried).
    const logOdooSkip = odoo.slice(odoo.indexOf('async function logOdooSkip'))
    expect(logOdooSkip).toContain('logWebhookSkip')
    // The helper never throws and never changes the outcome.
    expect(logOdooSkip).toContain('catch {')
  })

  it('names the deletion refusal explicitly — that is the one a merchant feels', () => {
    const msg = buildSkipMessage('odoo_deletion_unauthenticated')
    expect(msg).toContain('odoo_deletion_unauthenticated')
    expect(msg).toContain('الحذف')
    // The message must tell the merchant what to do about it.
    expect(msg).toContain('أعد تسجيل')
  })

  it('gives every new reason a readable Arabic and English text', () => {
    for (const reason of [
      'odoo_direction_disabled',
      'odoo_erp_type_unsupported',
      'odoo_no_field_mappings',
      'odoo_deletion_unauthenticated',
      'odoo_deletion_no_values',
      'odoo_deletion_no_match_value',
      'odoo_empty_match_field',
    ] as const) {
      const msg = buildSkipMessage(reason)
      expect(msg).toContain(`[${reason}]`)
      expect(msg.length).toBeGreaterThan(reason.length + 10)
    }
  })
})

describe('the standard-mapping preset skip leaves a trace', () => {
  const engine = read('lib', 'sync-engine.ts')

  it('logs the blocked preset instead of returning null in silence', () => {
    const idx = engine.indexOf('if (!presetCheck.allowed) {')
    expect(idx).toBeGreaterThan(-1)
    const window = engine.slice(idx, idx + 1200)
    expect(window).toContain('logWebhookSkip')
    expect(window).toContain("reason: 'disabled_in_settings'")
  })
})

describe('a Zid order is never synced without its line items', () => {
  const engine = read('lib', 'sync-engine.ts')

  it('fails the task instead of writing a partial order', () => {
    const idx = engine.indexOf('Failed to fetch full Zid order details')
    expect(idx).toBeGreaterThan(-1)
    const window = engine.slice(idx, idx + 1200)
    // The task must FAIL so the queue retries it — not "continue with the
    // minimal payload", which wrote an order with no products at all.
    expect(window).toContain("status: 'failed'")
    expect(window).toContain('result.failed += 1')
    expect(window).toContain('return result')
    expect(window).not.toContain('sync will continue with minimal payload')
  })
})

describe('the coalescing identity distinguishes two Odoo mappings', () => {
  it('scopes the Odoo key by the field mapping', () => {
    const a = buildDedupeKey({
      platform: 'odoo',
      event: 'odoo.model.sync',
      storeId: 'store-1',
      entityId: '42',
      fieldMappingId: 'map-a',
    })
    const b = buildDedupeKey({
      platform: 'odoo',
      event: 'odoo.model.sync',
      storeId: 'store-1',
      entityId: '42',
      fieldMappingId: 'map-b',
    })
    // Two mappings on the same Odoo record must NOT collapse into one row —
    // each writes with its own field set.
    expect(a).not.toBe(b)
  })

  it('leaves the store → Odoo direction untouched', () => {
    const key = buildDedupeKey({
      platform: 'zid',
      event: 'order.updated',
      storeId: 'store-1',
      entityId: '42',
    })
    expect(key).toBe('zid:order.updated:store-1:42')
  })

  it('reads the mapping id out of the payload', () => {
    expect(extractFieldMappingId({ field_mapping_id: 'map-a' })).toBe('map-a')
    expect(extractFieldMappingId({})).toBe('')
    expect(extractFieldMappingId({ field_mapping_id: '' })).toBe('')
  })

  it('uses the scoped key in both coalescing passes', () => {
    const queue = read('lib', 'sync-queue.ts')
    // The enqueue-time merge.
    expect(queue).toContain('extractFieldMappingId(rowPayload) !== newMappingId')
    // The in-batch merge.
    expect(queue).toContain('fieldMappingId: extractFieldMappingId(item.payload ?? {})')
  })
})

describe('the rescue path (inbox drain)', () => {
  const inbox = read('lib', 'webhook-inbox.ts')
  const runner = read('lib', 'sync-queue-runner.ts')

  it('gives a re-driven row the full retry budget', () => {
    // Without this, a rescued event inherited the column default (3) and died
    // earlier than every other row in the queue.
    expect(inbox).toContain('max_retries: SYNC_QUEUE_MAX_RETRIES')
    expect(inbox).toContain('const SYNC_QUEUE_MAX_RETRIES = 5')
  })

  it('keeps the retry budget identical to the main queue', () => {
    const queue = read('lib', 'sync-queue.ts')
    const queueValue = queue.match(/SYNC_QUEUE_MAX_RETRIES\s*=\s*(\d+)/)?.[1]
    const inboxValue = inbox.match(/const SYNC_QUEUE_MAX_RETRIES = (\d+)/)?.[1]
    expect(inboxValue).toBe(queueValue)
  })

  it('drains faster than 50 records a minute', () => {
    const batch = runner.match(/WEBHOOK_INBOX_DRAIN_BATCH = (\d+)/)?.[1]
    expect(Number(batch)).toBeGreaterThanOrEqual(100)
  })
})
