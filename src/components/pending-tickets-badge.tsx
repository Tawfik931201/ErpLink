'use client'

import { useEffect, useState } from 'react'

import { checkPendingTickets } from '@/app/actions/tickets'

export function PendingTicketsBadge() {
  const [hasPending, setHasPending] = useState(false)

  useEffect(() => {
    checkPendingTickets().then((res) => {
      if (res.success && res.hasPending) {
        setHasPending(true)
      }
    }).catch(() => {
      // fail silently — badge is purely cosmetic
    })
  }, [])

  if (!hasPending) return null

  return (
    <span className="relative flex h-2 w-2 shrink-0 ml-1 mr-1">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
    </span>
  )
}
