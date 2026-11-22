'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, BellOff, X } from 'lucide-react'

type Entry = { id: string; title: string; body: string; href: string; status: string; created_at: string }
type ResponseData = { notifications: Entry[]; endpoints: string[]; vapidPublicKey: string; pushReady: boolean; subscriptionCount: number; workspaceId: string }
const endpoint = '/api/notifications'

// Share one live connection between the desktop and mobile bell components.
const liveListeners = new Map<string, Set<(entry: Entry) => void>>()
const liveReadyListeners = new Map<string, Set<() => void>>()
let liveSource: EventSource | null = null
let liveWorkspace: string | null = null
let liveReady = false

function subscribeToLiveNotifications(workspaceId: string, listener: (entry: Entry) => void, onReady: () => void) {
  let subscribers = liveListeners.get(workspaceId)
  if (!subscribers) {
    subscribers = new Set()
    liveListeners.set(workspaceId, subscribers)
  }
  subscribers.add(listener)
  let readySubscribers = liveReadyListeners.get(workspaceId)
  if (!readySubscribers) {
    readySubscribers = new Set()
    liveReadyListeners.set(workspaceId, readySubscribers)
  }
  readySubscribers.add(onReady)
  if (liveWorkspace !== workspaceId || !liveSource) {
    liveSource?.close()
    liveWorkspace = workspaceId
    liveReady = false
    liveSource = new EventSource('/api/notifications/stream?workspaceId=' + encodeURIComponent(workspaceId))
    liveSource.addEventListener('ready', () => {
      liveReady = true
      for (const callback of liveReadyListeners.get(workspaceId) ?? []) callback()
    })
    liveSource.addEventListener('notification', event => {
      try {
        const entry = JSON.parse((event as MessageEvent).data) as Entry
        if (!entry?.id) return
        for (const callback of liveListeners.get(workspaceId) ?? []) callback(entry)
      } catch (error) {
        console.warn('[notifications] invalid live event', error)
      }
    })
  } else if (liveReady) {
    onReady()
  }
  return () => {
    subscribers?.delete(listener)
    readySubscribers?.delete(onReady)
    if (readySubscribers?.size === 0) liveReadyListeners.delete(workspaceId)
    if (subscribers?.size === 0) liveListeners.delete(workspaceId)
    if (liveWorkspace === workspaceId && !liveListeners.has(workspaceId)) {
      liveSource?.close()
      liveSource = null
      liveWorkspace = null
      liveReady = false
    }
  }
}
const publicKeyBytes = (text: string): Uint8Array => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}
export default function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ top: 12, left: 12, width: 350, maxHeight: 400 })
  const [items, setItems] = useState<Entry[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastSeen, setLastSeen] = useState('')
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (!res.ok) { setError('تعذر التحقق من إعدادات الإشعارات على الخادم.'); return }
      const data: ResponseData = await res.json()
      setItems(data.notifications)
      setWorkspaceId(data.workspaceId || '')
      setConfigured(Boolean(data.pushReady && data.vapidPublicKey))
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/notification-sw.js')
        const current = await reg?.pushManager.getSubscription()
        setEnabled(!!current && data.endpoints.includes(current.endpoint))
      }
    } catch { /* notification UI must not disrupt ERP */ }
  }, [])
  useEffect(() => {
    if (!workspaceId || typeof window === 'undefined' || !('EventSource' in window)) return
    return subscribeToLiveNotifications(workspaceId, entry => {
      setItems(current => [
        entry,
        ...current.filter(item => item.id !== entry.id),
      ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 30))
    })
  }, [workspaceId])

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
        if (!result.ok) {
          const details = await result.json().catch(() => null)
          throw new Error(result.status === 503
            ? 'الخادم غير جاهز لتسجيل الجهاز. راجع مفاتيح VAPID وإعدادات Hostinger.'
            : `تعذر تسجيل هذا الجهاز (HTTP ${result.status}): ${details?.error || 'خطأ غير معروف'}`)
        }
        setEnabled(true)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'حدث خطأ') }
    finally { setBusy(false) }
  }
  const showPanel = () => {
    if (open) { setOpen(false); return }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const margin = 12
      const width = Math.min(350, window.innerWidth - margin * 2)
      const rtl = getComputedStyle(triggerRef.current!).direction === 'rtl'
      // RTL sidebar sits on the right, so the menu grows toward the page.
      const desiredLeft = rtl ? rect.right - width : rect.left
      const left = Math.max(margin, Math.min(desiredLeft, window.innerWidth - width - margin))
      const roomBelow = window.innerHeight - rect.bottom - margin * 2
      const roomAbove = rect.top - margin * 2
      const below = roomBelow >= Math.min(300, window.innerHeight * .5) || roomBelow >= roomAbove
      const top = below ? rect.bottom + 8 : Math.max(margin, rect.top - Math.min(460, roomAbove) - 8)
      setPosition({
        top, left, width,
        maxHeight: Math.max(140, Math.min(460, below ? window.innerHeight - top - margin : rect.top - top - 8)),
      })
    }
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)
        && !triggerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const onViewportChange = () => setOpen(false)
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open])
  const unread = items.filter(item => !lastSeen || item.created_at > lastSeen).length
  return (
    <div className="relative">
      <button ref={triggerRef} type="button" aria-label="الإشعارات" aria-expanded={open} aria-haspopup="dialog" onClick={showPanel}
        className="relative rounded-lg p-2 hover:bg-secondary" title="الإشعارات">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{Math.min(unread, 30)}</span>}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={panelRef} role="dialog" aria-label="مركز الإشعارات"
          className="fixed z-[1000] overflow-y-auto overscroll-contain rounded-xl border border-border bg-background p-3 shadow-2xl"
          style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
          dir="rtl">
        <div className="mb-3 flex items-center justify-between">
          <strong className="text-sm">الإشعارات</strong>
          <button aria-label="إغلاق" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
        </div>
        <button type="button" disabled={busy || !configured} onClick={toggle}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-border p-2 text-xs disabled:opacity-50">
          {enabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {enabled ? 'إيقاف إشعارات سطح المكتب' : 'تفعيل إشعارات سطح المكتب'}
        </button>
        {!configured && <p className="mb-2 text-xs text-muted-foreground">خدمة إرسال الإشعارات غير جاهزة على الخادم: تحقق من WEB_PUSH_VAPID_PUBLIC_KEY وWEB_PUSH_VAPID_PRIVATE_KEY وWEB_PUSH_CONTACT (أو WEB_PUSH_SUBJECT)، ثم أعد تشغيل التطبيق.</p>}
        {configured && !enabled && <p className="mb-2 text-xs text-amber-600">Chrome قد يسمح بالإشعارات، لكن هذا الجهاز غير مسجل حاليًا للاستقبال. اضغط «تفعيل إشعارات Chrome» لإكمال الاشتراك.</p>}
        {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
        {items.length === 0 && <p className="p-3 text-xs text-muted-foreground">لا توجد إشعارات حتى الآن.</p>}
        {items.map(item => <a key={item.id} href={item.href} className="block border-b border-border py-2 text-xs hover:bg-secondary/40">
          <strong>{item.title}</strong><p className="mt-1 text-muted-foreground">{item.body}</p>
          <time className="mt-1 block text-[10px] text-muted-foreground">{new Date(item.created_at).toLocaleString('ar-EG')}</time>
        </a>)}
      </div>, document.body)}
    </div>
  )
}
