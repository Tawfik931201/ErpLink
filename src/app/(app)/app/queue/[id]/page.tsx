import QueueDetailClient from './queue-detail-client'

export const metadata = { title: 'Queue item — ErpLink' }

/**
 * سجلّ الطابور له عنوان URL خاص به (`/app/queue/<id>`) تماماً كصفحة السجل
 * (`/app/logs/<id>`): الضغط على صف في القائمة يفتح هذه الصفحة.
 *
 * `kind` مجرد تلميح من القائمة (أي جدول كان الصف منه) — الإجراء يجرّب الجداول
 * الثلاثة بالترتيب، ففتح الرابط مباشرة دون تلميح يعمل أيضاً.
 */
export default async function QueueItemPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ kind?: string }>
}) {
  const { id } = await props.params
  const search = await props.searchParams

  return <QueueDetailClient id={id} initialKind={search?.kind} />
}
