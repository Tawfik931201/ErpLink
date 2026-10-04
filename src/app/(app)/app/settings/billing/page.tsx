import { cookies } from 'next/headers'

import { getMyWorkspaceBillingDetails } from '@/app/actions/subscription-actions'
import { resolveLanguage } from '@/lib/translations'

import BillingClient from './BillingClient'

export const metadata = { title: 'Subscriptions & Billing' }

export default async function BillingSettingsPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
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
