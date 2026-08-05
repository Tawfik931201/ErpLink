import { cookies } from 'next/headers'
import { getMyWorkspaceBillingDetails } from '@/app/actions/subscription-actions'
import type { Language } from '@/lib/translations'
import BillingClient from './BillingClient'

export const metadata = { title: 'Subscriptions & Billing' }

export default async function BillingSettingsPage() {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const res = await getMyWorkspaceBillingDetails()

  return (
    <BillingClient
      lang={lang}
      initialWorkspace={res.success ? res.workspace : null}
      initialSubscriptions={res.success ? res.subscriptions : []}
      error={res.success ? null : res.error}
    />
  )
}
