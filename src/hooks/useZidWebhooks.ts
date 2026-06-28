/**
 * useZidWebhooks.ts
 *
 * React hook that opens an SSE connection to /api/webhooks/zid/stream.
 * Every incoming Zid webhook event is:
 *   1. Logged to the browser console  (visible in DevTools → Console)
 *   2. Returned as state for the UI to display
 */

'use client'

import { useEffect, useRef, useState } from 'react'

export interface ZidWebhookNotification {
  id: string
  event: string
  store_id: number
  data: Record<string, unknown>
  timestamp: string
  receivedAt: string
}

interface UseZidWebhooksOptions {
  /** Maximum notifications to keep in memory (default: 50) */
  maxHistory?: number
}

export function useZidWebhooks({ maxHistory = 50 }: UseZidWebhooksOptions = {}) {
  const [notifications, setNotifications] = useState<ZidWebhookNotification[]>([])
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/webhooks/zid/stream')
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      console.log(
        '%c[Zid Webhooks] ✅ SSE connected — listening for webhook events',
        'color: #22c55e; font-weight: bold;'
      )
    }

    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data as string)

        // Ignore keep-alive pings and connection confirmations
        if (raw.type === 'connected') {
          console.log('%c[Zid Webhooks] 🔗 ' + raw.message, 'color: #6366f1;')
          return
        }

        const notification: ZidWebhookNotification = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ...raw,
        }

        // ── Console output (terminal المتصفح) ─────────────────────────────
        const eventLabel = notification.event
        const productName =
          (notification.data?.name as string) ||
          (notification.data?.name_ar as string) ||
          (notification.data?.id as string) ||
          'غير معروف'

        switch (notification.event) {
          case 'product.created':
            console.log(
              `%c🆕 [Zid Webhook] منتج جديد تم إنشاؤه`,
              'color: #22c55e; font-size: 14px; font-weight: bold;'
            )
            console.log(`   📦 الاسم   : ${productName}`)
            console.log(`   🏪 المتجر  : ${notification.store_id}`)
            console.log(`   🕐 الوقت   : ${new Date(notification.receivedAt).toLocaleString('ar-SA')}`)
            console.log('   📋 البيانات الكاملة:', notification.data)
            break

          case 'product.updated':
            console.log(
              `%c✏️ [Zid Webhook] تم تحديث منتج`,
              'color: #f59e0b; font-size: 14px; font-weight: bold;'
            )
            console.log(`   📦 الاسم   : ${productName}`)
            console.log(`   🏪 المتجر  : ${notification.store_id}`)
            console.log('   📋 البيانات الكاملة:', notification.data)
            break

          case 'product.deleted':
            console.log(
              `%c🗑️ [Zid Webhook] تم حذف منتج`,
              'color: #ef4444; font-size: 14px; font-weight: bold;'
            )
            console.log(`   📦 الاسم   : ${productName}`)
            console.log(`   🏪 المتجر  : ${notification.store_id}`)
            break

          case 'order.created':
            console.log(
              `%c🛒 [Zid Webhook] طلب جديد`,
              'color: #6366f1; font-size: 14px; font-weight: bold;'
            )
            console.log(`   📋 البيانات:`, notification.data)
            break

          default:
            console.log(
              `%c📡 [Zid Webhook] حدث: ${eventLabel}`,
              'color: #94a3b8; font-size: 13px;'
            )
            console.log('   📋 البيانات:', notification.data)
        }

        // Add to state (cap history)
        setNotifications((prev) => [notification, ...prev].slice(0, maxHistory))
      } catch (err) {
        console.warn('[Zid Webhooks] Failed to parse SSE message', err)
      }
    }

    es.onerror = () => {
      setConnected(false)
      console.warn('%c[Zid Webhooks] ⚠️ SSE connection error — will reconnect...', 'color: #f59e0b;')
    }

    return () => {
      es.close()
      esRef.current = null
      setConnected(false)
    }
  }, [maxHistory])

  const clearNotifications = () => setNotifications([])

  return { notifications, connected, clearNotifications }
}
