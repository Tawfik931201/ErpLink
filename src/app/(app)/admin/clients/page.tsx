import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getAllClients } from '@/app/actions/subscription-actions'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { resolveLanguage } from '@/lib/translations'

import AdminClientsClient from './AdminClientsClient'

export const metadata = { title: 'Clients — Admin' }

export default async function AdminClientsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)

  const { rows } = await getAllClients()

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <AdminClientsClient rows={rows} lang={lang} />
    </div>
  )
}
