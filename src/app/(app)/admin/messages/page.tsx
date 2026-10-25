import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getContactMessages } from '@/app/actions/contact-messages'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { countNewContactMessages } from '@/lib/contact-messages'
import { resolveLanguage } from '@/lib/translations'

import ContactMessagesClient from './ContactMessagesClient'

export const metadata = { title: 'Messages - Admin' }

// Inbox data must never be served from a cache: a new message has to show up on
// refresh, and marking one read must not resurrect from a stale render.
export const dynamic = 'force-dynamic'

export default async function AdminMessagesPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)

  const [result, unread] = await Promise.all([
    getContactMessages({ status: 'all', limit: 50 }),
    countNewContactMessages(),
  ])

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <ContactMessagesClient
        initialRows={result.rows}
        initialTotal={result.total}
        newCount={unread}
        initialError={result.success ? null : result.error ?? 'load_failed'}
        lang={lang}
      />
    </div>
  )
}
