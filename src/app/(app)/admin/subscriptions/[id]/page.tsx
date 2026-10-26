import { ArrowLeft, ArrowRight, FileQuestion } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getSubscriptionDetail } from '@/app/actions/subscription-actions'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { resolveLanguage } from '@/lib/translations'

import SubscriptionDetailClient from './subscription-detail-client'

export const metadata = { title: 'Subscription - Admin' }

// Every action on the record (extend / cancel) writes to the database, so the
// page must re-read on navigation instead of serving a cached statement.
export const dynamic = 'force-dynamic'

export default async function AdminSubscriptionPage(props: { params: Promise<{ id: string }> }) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const { id } = await props.params

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const ar = lang === 'ar'

  const result = await getSubscriptionDetail(id)

  if (!result.success || !result.detail) {
    const BackIcon = ar ? ArrowRight : ArrowLeft
    return (
      <div dir={ar ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl space-y-4">
        <Link
          href="/admin/subscriptions"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى الاشتراكات' : 'Back to subscriptions'}
        </Link>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {ar ? 'الاشتراك غير موجود' : 'Subscription not found'}
          </p>
          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
            {ar
              ? 'الرابط لا يطابق أي اشتراك محفوظ. تحقق من المعرّف أو ارجع إلى القائمة.'
              : 'This link does not match any saved subscription. Check the id or return to the list.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div dir={ar ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl">
      <SubscriptionDetailClient detail={result.detail} ar={ar} />
    </div>
  )
}
