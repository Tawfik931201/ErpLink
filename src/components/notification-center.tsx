'use client'
import { useCallback, useEffect, useState } from 'react'
import { Bell, BellOff, X } from 'lucide-react'

type Entry = { id: string; title: string; body: string; href: string; status: string; created_at: string }
type ResponseData = { notifications: Entry[]; endpoints: string[]; vapidPublicKey: string }
const endpoint = '/api/notifications'
const publicKeyBytes = (text: string): Uint8Array => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
export default function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Entry[]>([])
  const [enabled, setEnabled] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastSeen, setLastSeen] = useState('')
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (!res.ok) return
      const data: ResponseData = await res.json()
      setItems(data.notifications)
      setConfigured(!!data.vapidPublicKey)
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/notification-sw.js')
        const current = await reg?.pushManager.getSubscription()
        setEnabled(!!current && data.endpoints.includes(current.endpoint))
      }
    } catch { /* notification UI must not disrupt ERP */ }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    if (open) {
      void refresh()
      const seen = items[0]?.created_at
      if (seen) { setLastSeen(seen); try { localStorage.setItem('erp-notifications-last-seen', seen) } catch {} }
    } else {
      try { setLastSeen(localStorage.getItem('erp-notifications-last-seen') || '') } catch {}
    }
  }, [open])
  const toggle = async () => {
    if (!configured || busy || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    setBusy(true); setError('')
    try {
      const registration = await navigator.serviceWorker.register('/notification-sw.js', { scope: '/' })
      const existing = await registration.pushManager.getSubscription()
      if (enabled) {
        if (existing) {
          const response = await fetch(endpoint, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: existing.endpoint }),
          })
          if (!response.ok) throw new Error('تعذر حذف الاشتراك')
          await existing.unsubscribe()
        }
        setEnabled(false)
      } else {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') throw new Error('الرجاء السماح بالإشعارات من إعدادات المتصفح')
        const configResponse = await fetch(endpoint, { cache: 'no-store' })
        if (!configResponse.ok) throw new Error('تعذر قراءة إعدادات الإشعارات')
        const config: ResponseData = await configResponse.json()
        const subscription = existing || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKeyBytes(config.vapidPublicKey) as BufferSource,
        })
        const result = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(subscription.toJSON()),
        })
        if (!result.ok) throw new Error('تعذر تسجيل هذا الجهاز')
        setEnabled(true)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'حدث خطأ') }
    finally { setBusy(false) }
  }
  const unread = items.filter(item => !lastSeen || item.created_at > lastSeen).length
  return (
    <div className="relative">
      <button type="button" aria-label="الإشعارات" aria-expanded={open} onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 hover:bg-secondary" title="الإشعارات">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{Math.min(unread, 30)}</span>}
      </button>
      {open && <div className="absolute top-full left-0 z-[100] mt-2 md:bottom-full md:top-auto md:mb-3 md:mt-0 max-h-[65vh] w-[min(350px,90vw)] overflow-y-auto rounded-xl border border-border bg-background p-3 shadow-xl" dir="rtl">
        <div className="mb-3 flex items-center justify-between">
          <strong className="text-sm">الإشعارات</strong>
          <button aria-label="إغلاق" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
        </div>
        <button type="button" disabled={busy || !configured} onClick={toggle}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border p-2 text-xs disabled:opacity-50">
          {enabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {enabled ? 'إيقاف إشعارات سطح المكتب' : 'تفعيل إشعارات Chrome'}
        </button>
        {!configured && <p className="mb-2 text-xs text-muted-foreground">إشعارات المتصفح تحتاج إعداد مفاتيح Web Push على الخادم.</p>}
        {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
        {items.length === 0 && <p className="p-3 text-xs text-muted-foreground">لا توجد إشعارات حتى الآن.</p>}
        {items.map(item => <a key={item.id} href={item.href} className="block border-b border-border py-2 text-xs hover:bg-secondary/40">
          <strong>{item.title}</strong><p className="mt-1 text-muted-foreground">{item.body}</p>
          <time className="mt-1 block text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString('ar-EG')}</time>
        </a>)}
      </div>}
    </div>
  )
}
