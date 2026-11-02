import QueueDetailClient from './queue-detail-client'

export const metadata = { title: 'Queue item — ErpLink' }

/**
 * سجلّ الطابور له عنوان URL خاص به (`/app/queue/<id>`) تماماً كصفحة السجل
 * (`/app/logs/<id>`): الضغط على صف في القائمة يفتح هذه الصفحة.
 *
 * `kind` مجرد تلميح من القائمة (أي جدول كان الصف منه) — الصفحة تبحث في
 * الجداول الأخرى أيضاً، ففتح الرابط مباشرة يعمل.
 */
export default async function QueueItemPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ kind?: string; p?: string }>
}) {
  const { id } = await props.params
  const search = await props.searchParams
  const offsetHint = Number.parseInt(search?.p ?? '', 10)

  return (
    <QueueDetailClient
      id={id}
      initialKind={search?.kind}
      initialOffset={Number.isFinite(offsetHint) && offsetHint > 0 ? offsetHint : 0}
    />
  )
}
