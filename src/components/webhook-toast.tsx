'use client'

/**
 * WebhookToast.tsx
 *
 * Client component that:
 * - Opens an SSE connection via useZidWebhooks
 * - Shows a beautiful toast notification in the UI whenever a Zid event arrives
 * - Also ensures every event is logged to the browser console (done by the hook)
 */

import { useEffect, useState } from 'react'

import { useZidWebhooks, type ZidWebhookNotification } from '@/hooks/useZidWebhooks'

interface ToastItem {
  id: string
  notification: ZidWebhookNotification
}

const EVENT_CONFIG: Record<string, { icon: string; color: string; label: string; bg: string }> = {
  'product.created': { icon: '🆕', color: '#22c55e', label: 'منتج جديد', bg: '#052e16' },
  'product.updated': { icon: '✏️', color: '#f59e0b', label: 'تحديث منتج', bg: '#1c1400' },
  'product.deleted': { icon: '🗑️', color: '#ef4444', label: 'حذف منتج', bg: '#1c0000' },
  'order.created': { icon: '🛒', color: '#6366f1', label: 'طلب جديد', bg: '#0f0b2e' },
  'order.updated': { icon: '📦', color: '#8b5cf6', label: 'تحديث طلب', bg: '#12082e' },
  'customer.created': { icon: '👤', color: '#06b6d4', label: 'عميل جديد', bg: '#00131a' },
}

function getConfig(event: string) {
  return (
    EVENT_CONFIG[event] ?? { icon: '📡', color: '#94a3b8', label: event, bg: '#111827' }
  )
}

function getProductName(data: Record<string, unknown>): string {
  return (
    (data?.name as string) ||
    (data?.name_ar as string) ||
    `#${data?.id ?? '—'}`
  )
}

export function WebhookToast() {
  const { notifications, connected } = useZidWebhooks()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [seen, setSeen] = useState<Set<string>>(new Set())

  // When new notification arrives, show a toast
  useEffect(() => {
    const latest = notifications[0]
    if (!latest || seen.has(latest.id)) return

    setSeen((prev) => new Set([...prev, latest.id]))
    const item: ToastItem = { id: latest.id, notification: latest }
    setToasts((prev) => [item, ...prev].slice(0, 5))

    // Auto-dismiss after 6 seconds
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== item.id))
    }, 6000)

    return () => clearTimeout(timer)
  }, [notifications, seen])

  return (
    <>
      {/* SSE connection status indicator */}
      <div
        style={{
          position: 'fixed',
          bottom: '12px',
          left: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '999px',
          background: connected ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${connected ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          fontSize: '11px',
          color: connected ? '#86efac' : '#fca5a5',
          zIndex: 9999,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: connected ? '#22c55e' : '#ef4444',
            boxShadow: connected ? '0 0 6px #22c55e' : '0 0 6px #ef4444',
            animation: connected ? 'pulse 2s infinite' : 'none',
          }}
        />
        {connected ? 'Zid Webhooks متصل' : 'Zid Webhooks منقطع'}
      </div>

      {/* Toast stack */}
      <div
        style={{
          position: 'fixed',
          top: '70px',
          right: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 9998,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => {
          const cfg = getConfig(t.notification.event)
          const name = getProductName(t.notification.data)

          return (
            <div
              key={t.id}
              style={{
                minWidth: '280px',
                maxWidth: '340px',
                padding: '14px 16px',
                borderRadius: '12px',
                background: cfg.bg,
                border: `1px solid ${cfg.color}33`,
                boxShadow: `0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px ${cfg.color}22`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                animation: 'slideInRight 0.3s ease',
                direction: 'rtl',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              <span style={{ fontSize: '22px', lineHeight: 1 }}>{cfg.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    color: cfg.color,
                    marginBottom: '3px',
                  }}
                >
                  {cfg.label}
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#e2e8f0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {name}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                  متجر #{t.notification.store_id} •{' '}
                  {new Date(t.notification.receivedAt).toLocaleTimeString('ar-SA')}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  )
}
