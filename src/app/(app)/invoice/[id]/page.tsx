import { redirect } from 'next/navigation'

import { getSubscriptionForInvoice } from '@/app/actions/subscription-actions'

import InvoiceClient from './InvoiceClient'

interface Props {
  params: Promise<{
    id: string
  }>
}

export const metadata = { title: 'Invoice — ErpLink' }

export default async function InvoicePage(props: Props) {
  const params = await props.params
  const res = await getSubscriptionForInvoice(params.id)

  if (!res.success || !res.subscription) {
    redirect('/app/dashboard')
  }

  return <InvoiceClient subscription={res.subscription} />
}
