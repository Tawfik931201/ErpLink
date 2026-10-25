import { ArrowLeft, ArrowRight, FileQuestion } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getContactMessage } from '@/app/actions/contact-messages'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { resolveLanguage } from '@/lib/translations'

import MessageDetailClient from './message-detail-client'

export const metadata = { title: 'Message - Admin' }

// A record is read on demand and every status change must show up on reload.
export const dynamic = 'force-dynamic'

export default async function AdminMessagePage(props: { params: Promise<{ id: string }> }) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const { id } = await props.params

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const ar = lang === 'ar'

  const result = await getContactMessage(id)

  if (!result.success || !result.row) {
    const BackIcon = ar ? ArrowRight : ArrowLeft
    return (
      <div dir={ar ? 'rtl' : 'ltr'} className="space-y-4">
        <Link
          href="/admin/messages"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <BackIcon className="h-3.5 w-3.5" />
          {ar ? 'العودة إلى الرسائل' : 'Back to messages'}
        </Link>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <FileQuestion className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {ar ? 'الرسالة غير موجودة' : 'Message not found'}
          </p>
          <p className="mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
            {result.error === 'migration_missing'
              ? ar
                ? 'جدول الرسائل غير موجود بعد — طبّق الترحيل 20261025_contact_messages.sql.'
                : 'The messages table does not exist yet — apply migration 20261025_contact_messages.sql.'
              : ar
                ? 'الرابط لا يطابق أي رسالة محفوظة.'
                : 'This link does not match any saved message.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div dir={ar ? 'rtl' : 'ltr'}>
      <MessageDetailClient row={result.row} ar={ar} />
    </div>
  )
}
