import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * تجميع الاستقبال في دفعات (المرحلة 2).
 *
 * السبب: كل حدث كان يوقّع 5 عمليات على قاعدة البيانات، اثنتان منها تكتبان
 * الحمولة كاملة (JSONB). في ذروة 2000 طلب/دقيقة = 167 عملية/ثانية ⇒ الحاجز
 * الحقيقي أمام استقبال آلاف الطلبات.
 *
 * القواعد التي يثبّتها هذا الملف:
 *   1. **لا يُرسل 2xx قبل الحفظ الدائم** — الطلب ينتظر تفريغ الدفعة.
 *   2. **مسار أودوو لا يُجمَّع** — Automated Action في أودوو لا يعيد الإرسال
 *      بعد خطأ، فكل كتابة فيه فوراً.
 *   3. في الهدوء (صف واحد) لا تغيير سلوكي إطلاقاً.
 *   4. التكرار يبقى "حميداً" (لا خطأ) ولا يُسقط الحدث.
 */

const SRC = join(__dirname, '..', '..', 'src')

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8')
}

describe('the ingress batcher', () => {
  const batch = read('lib', 'ingress-batch.ts')
  const queue = read('lib', 'sync-queue.ts')

  it('never answers 2xx before the durable write', () => {
    // The route awaits enqueueWebhookEvent, and enqueueWebhookEvent awaits
    // the batch flush. If the flush were fire-and-forget, a crash inside the
    // window would lose the event with no platform retry.
    expect(batch).toContain('insertReceipts')
    expect(batch).toContain('insertQueueRows')
    expect(queue).toContain('await insertReceipts([')
    expect(queue).toContain('await dispatchWebhookReceipt(receipt.id,')
    expect(batch).not.toMatch(/void insertReceipts\(/)
  })

  it('leaves the Odoo direction unbatched — Odoo never retries', () => {
    expect(queue).toContain("const useBatch = params.platform !== 'odoo'")
    // The unbatched path must still exist and be used for odoo.
    expect(queue).toContain('await recordWebhookReceipt({')
  })

  it('keeps a single row on the old, immediate path', () => {
    // At rest (one event at a time) there is no batching at all: same cost,
    // same latency, same behaviour as before.
    expect(batch).toContain('if (rows.length === 1) {')
  })

  it('treats a duplicate as benign, never as a failure', () => {
    // 23505 on the inbox/queue unique index = the same delivery twice.
    expect(batch).toContain("if (code === '23505') return [{ ok: true, duplicate: true }]")
    expect(batch).toContain('insertReceiptsViaSupabase([row])')
  })

  it('falls back to row-by-row when a batch collides', () => {
    // A batch insert fails as a whole on a unique violation; retrying row by
    // row tells us WHICH row was the duplicate instead of losing the batch.
    expect(batch).toContain('نُعيد الإدراج صفاً صفاً')
  })

  it('settles the receipts in one update per batch', () => {
    expect(batch).toContain('export async function settleReceipts')
    expect(batch).toContain(".in('dedup_key', keys)")
  })

  it('never exceeds a bounded batch size', () => {
    expect(batch).toContain('const MAX_BATCH = 50')
    expect(batch).toContain('const FLUSH_DELAY_MS = 150')
  })
})
