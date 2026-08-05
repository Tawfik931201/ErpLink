import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAllSubscriptions, getActiveAffiliates } from '@/app/actions/subscription-actions'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import type { Language } from '@/lib/translations'

import AdminSubscriptionsClient from './AdminSubscriptionsClient'

export const metadata = { title: 'Subscriptions — Admin' }

export default async function AdminSubscriptionsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language

  const [subsRes, affiliatesRes] = await Promise.all([
    getAllSubscriptions(),
    getActiveAffiliates(),
  ])

  return (
    <AdminSubscriptionsClient
      rows={subsRes.success ? subsRes.rows : []}
      error={subsRes.success ? null : subsRes.error}
      affiliates={affiliatesRes.success ? affiliatesRes.affiliates : []}
      lang={lang}
    />
  )
}
