import { redirect } from 'next/navigation'

import { getSubscriptionForInvoice } from '@/app/actions/subscription-actions'

import InvoiceClient from './InvoiceClient'

interface Props {
  params: {
    id: string
  }
}

export const metadata = { title: 'Invoice — ErpLink' }

export default async function InvoicePage({ params }: Props) {
  const res = await getSubscriptionForInvoice(params.id)

  if (!res.success || !res.subscription) {
    redirect('/app/dashboard')
  }

  return <InvoiceClient subscription={res.subscription} />
}
