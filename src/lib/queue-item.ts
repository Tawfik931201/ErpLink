/**
 * قواعد قراءة صفّ واحد من الطابور — منطق خالص بلا اعتماد على قاعدة البيانات
 * أو على عميل أودوو، حتى يُختبر وحده (نفس أسلوب `subscription-dates.ts`).
 *
 * `'use server'` لا يسمح بتصدير غير الدوال غير المتزامنة، فالمعادلات هنا لا
 * يمكن أن تعيش داخل `src/app/actions/queue-dashboard.ts`.
 */

/** الجداول الثلاثة التي يسكنها صفّ الطابور. */
export type QueueKind = 'pending' | 'frozen' | 'orphans' | 'dead'

export const QUEUE_KINDS: QueueKind[] = ['pending', 'frozen', 'orphans', 'dead']

export const isQueueKind = (value: string | null | undefined): value is QueueKind =>
  value === 'pending' || value === 'frozen' || value === 'orphans' || value === 'dead'

/** مصدر القراءة الفعلي: `sync_queue` (معلقة/مجمدة) أو الأرشيف أو الإيصالات. */
export type QueueItemSource = 'queue' | 'dead' | 'inbox'

const FULL_ORDER: QueueItemSource[] = ['queue', 'dead', 'inbox']

/**
 * ترتيب المحاولات عند فتح سجلّ برقمه.
 *
 * `pending` و`frozen` في نفس الجدول (`sync_queue`)، فالتلميح بينهما لا يغيّر
 * الترتيب — الحالة الحقيقية تُقرأ من `next_retry_at` بعد الجلب.
 */
export function queueItemLookupOrder(hint?: string | null): QueueItemSource[] {
  if (hint === 'dead') return ['dead', 'queue', 'inbox']
  if (hint === 'orphans') return ['inbox', 'queue', 'dead']
  if (hint === 'pending' || hint === 'frozen') return ['queue', 'dead', 'inbox']
  return [...FULL_ORDER]
}

/**
 * `sync_queue` يحمل الحالتين: الصف المستنفد يُجمَّد بـ`next_retry_at` فارغ أو
 * بالقيمة الحارسة، والباقي معلّق. نفس القاعدة التي يستخدمها `getQueueOverview`.
 */
export function queueItemKindFromNextRetry(
  nextRetryAt: string | null | undefined,
  frozenSentinel: string
): 'pending' | 'frozen' {
  if (!nextRetryAt || nextRetryAt === frozenSentinel) return 'frozen'
  return 'pending'
}

/**
 * هل تستحق الحمولة العرض؟ `null`/`undefined`/`{}` تعني «لا يوجد ما يُقرأ»
 * (الصفوف القديمة قد تكون بلا حمولة)، وأي محتوى آخر يُعرض كما هو.
 */
export function hasQueuePayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) return false
  if (typeof payload === 'string') return payload.trim() !== ''
  if (Array.isArray(payload)) return payload.length > 0
  if (typeof payload === 'object') return Object.keys(payload as Record<string, unknown>).length > 0
  return true
}
