import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAllSubscriptions } from '@/app/actions/subscription-actions'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { resolveLanguage } from '@/lib/translations'

import AdminSubscriptionsClient from './AdminSubscriptionsClient'

export const metadata = { title: 'Subscriptions — Admin' }

export default async function AdminSubscriptionsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)

  const subsRes = await getAllSubscriptions()

  return (
    <AdminSubscriptionsClient
      rows={subsRes.success ? subsRes.rows : []}
      error={subsRes.success ? null : subsRes.error}
      lang={lang}
    />
  )
}
