/* Dedicated notification service worker. No caching or interception of ERP requests. */
self.addEventListener('push', event => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { payload = {} }
  const title = String(payload.title || 'ERP Link').slice(0, 120)
  const body = String(payload.body || 'لديك إشعار جديد').slice(0, 240)
  const href = typeof payload.href === 'string' && payload.href.startsWith('/app/') && !payload.href.startsWith('//')
    ? payload.href : '/app/dashboard'
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: String(payload.tag || '').slice(0, 200),
    icon: '/favicon.ico',
    data: { href },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const href = event.notification.data && event.notification.data.href
  const url = new URL(typeof href === 'string' && href.startsWith('/app/') ? href : '/app/dashboard', self.location.origin)
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(open => {
    const match = open.find(client => client.url.startsWith(self.location.origin + '/app/'))
    if (match) return match.focus().then(() => match.navigate(url.href))
    return clients.openWindow(url.href)
  }))
})
