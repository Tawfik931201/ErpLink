/**
 * أرشفة عناصر الطابور — قواعد خالصة فقط: لا قاعدة بيانات، ولا استيراد غير
 * مباشر يصل إلى `next/headers`.
 *
 * ⚠️ **هذا الملف يُستورد من مكوّن عميل** (`queue-client.tsx` يعرض عدد الأيام
 * المتبقية). إضافة `import { supabase } from '@/lib/supabase'` هنا — كما كان
 * الحال — تجعل `queue-client.tsx` يسحب `@/lib/auth` ثم `next/headers`، فيفشل
 * `next build` بـ "You're importing a component that needs next/headers".
 * لذلك انتقل `pruneExpiredQueueArchives` إلى `./queue-archive-prune` (خادم فقط).
 *
 * لماذا ملف عادي وليس داخل `src/app/actions/queue-dashboard.ts`: ملفات
 * `'use server'` لا تُصدّر إلا دوال غير متزامنة، وهذه المعادلات تُستدعى في
 * الواجهة أيضاً (عدد الأيام المتبقية، تجميع المحدَّد بحسب الجدول).
 *
 * القاعدة: **الأرشفة نسخٌ ثم حذف**، ولذلك `queueSourceTable()` هي الخريطة
 * الوحيدة بين "نوع الصف" و"الجدول الذي يُقرأ منه ويُحذف".
 */

import type { QueueKind } from '@/lib/queue-item'

/** الجدول الذي يستقبل النسخة المؤرشفة. */
export const QUEUE_ARCHIVES_TABLE = 'queue_archives'

/** مدة بقاء الصف المؤرشف قبل الحذف النهائي التلقائي. */
export const QUEUE_ARCHIVE_RETENTION_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** جدول المصدر لكل نوع صف. `pending` و`frozen` في نفس الجدول. */
export function queueSourceTable(kind: QueueKind): 'sync_queue' | 'sync_queue_dead' | 'webhook_inbox' {
  switch (kind) {
    case 'pending':
    case 'frozen':
      return 'sync_queue'
    case 'dead':
      return 'sync_queue_dead'
    case 'orphans':
      return 'webhook_inbox'
  }
}

/**
 * تاريخ الانتهاء = لحظة الأرشفة + 7 أيام.
 *
 * `archivedAt` يقبل ما يُعيده `new Date()` أو `Date.now()` أو نص ISO، فتستخدمه
 * الواجهة لعرض "يُحذف بعد N أيام" بنفس الحساب الذي يستخدمه الخادم.
 */
export function queueArchiveExpiresAt(
  archivedAt: Date | string | number = Date.now(),
  retentionDays: number = QUEUE_ARCHIVE_RETENTION_DAYS
): string {
  const base = archivedAt instanceof Date ? archivedAt.getTime() : new Date(archivedAt).getTime()
  if (!Number.isFinite(base)) return new Date(Date.now() + retentionDays * DAY_MS).toISOString()
  return new Date(base + retentionDays * DAY_MS).toISOString()
}

/**
 * كم يوماً بقي قبل الحذف النهائي — `null` عند تاريخ غير صالح، و`0` عند
 * انتهاء المدة (لا أرقام سالبة في الواجهة).
 */
export function queueArchiveDaysLeft(
  expiresAt: string | null | undefined,
  now: number = Date.now()
): number | null {
  if (!expiresAt) return null
  const end = new Date(expiresAt).getTime()
  if (!Number.isFinite(end)) return null
  const diff = end - now
  if (diff <= 0) return 0
  return Math.ceil(diff / DAY_MS)
}

/** هل انتهت مدة الصف المؤرشف فعلاً؟ */
export function isQueueArchiveExpired(
  expiresAt: string | null | undefined,
  now: number = Date.now()
): boolean {
  return queueArchiveDaysLeft(expiresAt, now) === 0
}

export interface QueueSelectionItem {
  id: string
  kind: string
}

/**
 * تطبيع المحدَّد قبل الكتابة: لا معرّفات فارغة، ولا أنواع مجهولة، ولا تكرار
 * (نفس الصف مرتين = نسختان في الأرشيف ثم محاولة حذف ثانية تفشل).
 *
 * الترتيب محفوظ كما اختاره المستخدم، والتكرار يُسقط أول ظهور فقط.
 */
export function normaliseQueueSelection(items: readonly QueueSelectionItem[]): Array<{
  kind: QueueKind
  id: string
}> {
  const seen = new Set<string>()
  const out: Array<{ kind: QueueKind; id: string }> = []
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id.trim() : ''
    if (!id) continue
    const kind = item?.kind
    if (kind !== 'pending' && kind !== 'frozen' && kind !== 'dead' && kind !== 'orphans') continue
    const key = `${kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id })
  }
  return out
}

/** تجميع المحدَّد بحسب الجدول، حتى تُقرأ كل مجموعة باستعلام واحد. */
export function groupQueueSelection(
  items: readonly QueueSelectionItem[]
): Record<'sync_queue' | 'sync_queue_dead' | 'webhook_inbox', Array<{ kind: QueueKind; id: string }>> {
  const grouped = {
    sync_queue: [] as Array<{ kind: QueueKind; id: string }>,
    sync_queue_dead: [] as Array<{ kind: QueueKind; id: string }>,
    webhook_inbox: [] as Array<{ kind: QueueKind; id: string }>,
  }
  for (const item of normaliseQueueSelection(items)) {
    grouped[queueSourceTable(item.kind)].push(item)
  }
  return grouped
}

/** سقف الأرشفة في ضغطة واحدة — نفس سقف بقية أزرار الشاشة (100). */
export const QUEUE_ARCHIVE_BATCH_LIMIT = 100
