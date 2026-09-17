import type { Metadata } from 'next'

import { getClientTickets } from '@/app/actions/tickets'

import TicketsClient from './tickets-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Support Tickets — ErpLink',
  description: 'إدارة وتتبع تذاكر الدعم الفني الخاصة بك في أودو (Support Tickets)',
}

export default async function SupportTicketsPage() {
  const result = await getClientTickets()

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300">
      <TicketsClient
        initialTickets={result.success && result.tickets ? result.tickets : []}
        success={result.success}
        error={result.success ? null : result.error}
      />
    </div>
  )
}
