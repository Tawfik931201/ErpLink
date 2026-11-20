/* ERP Link browser push Service Worker (no secrets, no third-party SDK). */
/* global self, indexedDB */
const DB = 'erplink-browser-notifications'
const STORE = 'events'

function storeEvent(item) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({
        ...item, key: item.userId + ':' + item.workspaceId + ':' + item.id,
        read: false,
      })
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  })
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let message = {}
    try { message = event.data ? event.data.json() : {} } catch {}
    if (!message.id || !message.workspaceId || !message.userId) return
    await storeEvent(message).catch(() => {})
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const page of pages) page.postMessage({ type: 'ERPLINK_PUSH', item: message })
    await self.registration.showNotification(String(message.title || 'ERP Link'), {
      body: String(message.body || '').slice(0, 180),
      icon: '/icon.png',
      badge: '/favicon-32x32.png',
      tag: 'erplink-' + message.userId + '-' + message.workspaceId + '-' + message.id,
      data: { url: message.url || '/ar-sa/app/logs' },
    })
  })())
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const path = String(event.notification.data?.url || '/ar-sa/app/logs')
    const target = new URL(path, self.location.origin)
    // Do not permit cross-origin navigation from push payload.
    if (target.origin !== self.location.origin) return
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const page of pages) {
      if (new URL(page.url).origin === target.origin) {
        await page.focus()
        page.navigate(target.href)
        return
      }
    }
    await self.clients.openWindow(target.href)
  })())
})
