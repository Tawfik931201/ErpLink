'use client'

import { useEffect, useRef, useState } from 'react'

import { checkPendingTickets } from '@/app/actions/tickets'
import { restartTicketUnreadStream, subscribeTicketUnreadStream } from '@/lib/ticket-unread-live-client'

/**
 * The red badge indicates real unread support messages, not merely the latest
 * message author. Read cursors live in Odoo, and the sidebar uses no polling.
 */
export function PendingTicketsBadge() {
  const [unreadCount, setUnreadCount] = useState(0)
  const sequenceRef = useRef(0)

  useEffect(() => {
    let active = true
    let queued: ReturnType<typeof setTimeout> | undefined
 
    async function refresh() {
      const seq = ++sequenceRef.current
      try {
        const result = await checkPendingTickets()
        if (active && seq === sequenceRef.current && result.success) {
          setUnreadCount(result.unreadCount ?? 0)
        }
      } catch { /* a cosmetic badge must never disrupt the app */ }
    }
    function schedule() {
      if (document.visibilityState === 'hidden') {
        return
      }
      if (queued) clearTimeout(queued)
      // Odoo sends the webhook around transaction commit. A brief debounce
      // avoids fetching the old unread state or counting bursts twice.
      queued = setTimeout(() => { void refresh() }, 800)
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        schedule()
      }
    }
    function onTicketAdded() {
      restartTicketUnreadStream()
      schedule()
    }
    void refresh()
    const unsubscribe = subscribeTicketUnreadStream(schedule)
    window.addEventListener('erp-ticket-read', schedule)
    window.addEventListener('erp-tickets-changed', onTicketAdded)
    window.addEventListener('focus', onVisibility)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      if (queued) clearTimeout(queued)
      unsubscribe()
      window.removeEventListener('erp-ticket-read', schedule)
      window.removeEventListener('erp-tickets-changed', onTicketAdded)
      window.removeEventListener('focus', onVisibility)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  if (unreadCount <= 0) return null
  const label = unreadCount > 99 ? '99+' : String(unreadCount)
  return (
    <span
      role="status"
      aria-label={unreadCount + ' unread support messages'}
      className="ms-1 inline-flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-extrabold leading-none text-white shadow-sm shadow-red-600/20"
    >
      {label}
    </span>
  )
}
