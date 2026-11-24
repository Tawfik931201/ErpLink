'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@clerk/nextjs'

type Notice = {
  id: string; userId: string; workspaceId: string; title: string; body: string
  event?: string; createdAt?: string; url?: string; key?: string; read?: boolean
}
const DB = 'erplink-browser-notifications'
const STORE = 'events'

async function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function cache(items: Notice[]) {
  if (!items.length) return
  const database = await db()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite')
      const objectStore = tx.objectStore(STORE)
      for (const item of items) {
        const key = item.userId + ':' + item.workspaceId + ':' + item.id
        const get = objectStore.get(key)
        get.onsuccess = () => {
          objectStore.put({ ...item, key, read: Boolean(get.result?.read) })
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally { database.close() }
}
async function cached(userId: string, workspaceId: string): Promise<Notice[]> {
  const database = await db()
  try {
    const all = await new Promise<Notice[]>((resolve, reject) => {
      const req = database.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as Notice[])
      req.onerror = () => reject(req.error)
    })
    return all.filter(n => n.userId === userId && n.workspaceId === workspaceId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 100)
  } finally { database.close() }
}
async function markRead(item: Notice) {
  const database = await db()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ ...item, read: true })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally { database.close() }
}
function keyBytes(base64url: string): Uint8Array {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - base64url.length % 4) % 4))
  return Uint8Array.from(raw, char => char.charCodeAt(0))
}

export default function BrowserNotifications() {
  const { isSignedIn, isLoaded } = useAuth()
  const [scope, setScope] = useState<{ userId: string; workspaceId: string; publicKey: string | null } | null>(null)
  const [items, setItems] = useState<Notice[]>([])
  const [opened, setOpened] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async (ctx: { userId: string; workspaceId: string }) => {
    try {
      const local = await cached(ctx.userId, ctx.workspaceId)
      setItems(local)
      if (document.visibilityState !== 'visible') return
      const last = local[0]?.createdAt
      const url = '/api/browser-notifications/feed' + (last ? '?after=' + encodeURIComponent(last) : '')
      const resp = await fetch(url, { cache: 'no-store' })
      if (!resp.ok) return
      const feed = await resp.json()
      if (feed.userId !== ctx.userId || feed.workspaceId !== ctx.workspaceId) return
      await cache(feed.items || [])
      setItems(await cached(ctx.userId, ctx.workspaceId))
    } catch (error) { console.warn('[notifications] cache refresh failed', error) }
  }, [])

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    let active = true
    async function boot() {
      try {
        const resp = await fetch('/api/browser-notifications/subscription', { cache: 'no-store' })
        if (!resp.ok) return
        const data = await resp.json()
        if (!active) return
        setScope(data)
        await refresh(data)
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration('/erp-push-sw.js')
          const subscription = await registration?.pushManager.getSubscription()
          if (subscription) {
            // Rebind a shared browser to the currently authenticated user/workspace.
            const sync = await fetch('/api/browser-notifications/subscription', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(subscription.toJSON()),
            })
            if (active && sync.ok) setEnabled(true)
          } else if (active) setEnabled(false)
        }
      } catch (error) { console.warn('[notifications] boot failed', error) }
    }
    void boot()
    return () => { active = false }
  }, [refresh, isLoaded, isSignedIn])

  useEffect(() => {
    if (!isLoaded || isSignedIn !== false) return
    setScope(null)
    setItems([])
    setEnabled(false)
    // Stop push delivery to a browser after local sign-out and purge local history.
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistration('/erp-push-sw.js')
        .then(reg => reg?.pushManager.getSubscription())
        .then(push => push?.unsubscribe())
        .catch(() => {})
    }
    if ('indexedDB' in window) indexedDB.deleteDatabase(DB)
  }, [isLoaded, isSignedIn])

  useEffect(() => {
    if (!scope || !isSignedIn) return
    const load = () => { if (document.visibilityState === 'visible') void refresh(scope) }
    const timer = window.setInterval(load, 60_000)
    document.addEventListener('visibilitychange', load)
    navigator.serviceWorker?.addEventListener('message', load)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', load)
      navigator.serviceWorker?.removeEventListener('message', load)
    }
  }, [scope, refresh, isSignedIn])

  const subscribe = async () => {
    if (!scope || !scope.publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMessage('هذا المتصفح لا يدعم الخدمة أو لم تُضبط مفاتيح Web Push على الخادم.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('لم يتم السماح بإشعارات Chrome.')
      const registration = await navigator.serviceWorker.register('/erp-push-sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      let push = await registration.pushManager.getSubscription()
      if (!push) push = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(scope.publicKey) as BufferSource,
      })
      const response = await fetch('/api/browser-notifications/subscription', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(push.toJSON()),
      })
      if (!response.ok) throw new Error('فشل حفظ اشتراك الإشعارات على الخادم.')
      setEnabled(true)
      setMessage('تم تفعيل إشعارات سطح المكتب لهذا الجهاز.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر تفعيل الإشعارات.')
    } finally { setBusy(false) }
  }

  const unsubscribe = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/erp-push-sw.js')
      const push = await reg?.pushManager.getSubscription()
      if (push) {
        const response = await fetch('/api/browser-notifications/subscription', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: push.endpoint }),
        })
        if (!response.ok) throw new Error('تعذر إيقاف الاشتراك على الخادم.')
        await push.unsubscribe()
      }
      setEnabled(false)
      setMessage('تم إيقاف إشعارات هذا الجهاز.')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'تعذر إيقاف الإشعارات.')
    } finally { setBusy(false) }
  }

  if (!scope || !isSignedIn) return null
  const unread = items.filter(n => !n.read).length
  return (
    <div className="fixed bottom-5 left-5 z-[80] font-sans" dir="rtl">
      {opened && (
        <div className="mb-2 max-h-[65vh] w-[min(92vw,380px)] overflow-auto rounded-xl border border-gray-200 bg-white p-3 text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <div className="mb-3 flex items-center justify-between gap-2">
            <strong>إشعارات ERP Link</strong>
            <button type="button" onClick={() => setOpened(false)} aria-label="إغلاق">✕</button>
          </div>
          <div className="mb-3 flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void (enabled ? unsubscribe() : subscribe())}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white disabled:opacity-50">
              {enabled ? 'إيقاف إشعارات Chrome' : 'تفعيل إشعارات Chrome'}
            </button>
            <span className="text-xs text-gray-500">{enabled ? 'مفعّلة' : 'غير مفعّلة'}</span>
          </div>
          {message && <p className="mb-2 text-xs">{message}</p>}
          {items.length === 0 && <p className="py-6 text-center text-sm text-gray-500">لا توجد إشعارات بعد</p>}
          {items.map(item => (
            <button key={item.key || item.id} type="button" className="w-full border-t border-gray-100 p-3 text-right hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              onClick={async () => {
                await markRead(item)
                setItems(await cached(scope.userId, scope.workspaceId))
                const target = new URL(item.url || '/ar-sa/app/logs', location.origin)
                if (target.origin === location.origin) location.assign(target.pathname + target.search)
              }}>
              <span className={item.read ? 'text-sm' : 'text-sm font-bold'}>{item.title}</span>
              <span className="block text-xs text-gray-500">{item.body}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" aria-label={`الإشعارات، ${unread} غير مقروء`} onClick={() => setOpened(p => !p)}
        className="relative flex h-12 w-12 items-center justify-center rounded-full bg-emerald-700 text-2xl text-white shadow-lg">
        🔔
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  )
}
