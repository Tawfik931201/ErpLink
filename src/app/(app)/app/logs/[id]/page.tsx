import { ArrowLeft, ArrowRight, FileQuestion } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { getSyncLogById } from '@/app/actions/sync-logs'
import { resolveLanguage } from '@/lib/translations'

import LogDetailClient from './log-detail-client'

export const metadata = { title: 'Sync Log — ErpLink' }

export default async function LogDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const ar = lang === 'ar'

  const res = await getSyncLogById(id)

  if (!res.success || !res.log) {
    const BackIcon = ar ? ArrowRight : ArrowLeft
    return (
      <div className="space-y-4">
        <Link
          href="/app/logs"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى السجلات' : 'Back to logs'}
        </Link>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {ar ? 'السجل غير موجود' : 'Log not found'}
          </p>
          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
            {res.error ||
              (ar
                ? 'قد يكون هذا السجل قد حُذف تلقائياً بعد انتهاء مدة الاحتفاظ به.'
                : 'This log may have been purged automatically after its retention window.')}
          </p>
        </div>
      </div>
    )
  }

  return <LogDetailClient log={res.log} />
}
