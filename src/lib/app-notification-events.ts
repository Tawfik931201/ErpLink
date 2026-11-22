export type AppNotificationEvent = {
  id: string
  title: string
  body: string
  href: string
  status: string
  event: string
  created_at: string
}

type Listener = (notification: AppNotificationEvent) => void
type Registry = Map<string, Set<Listener>>

// Hostinger's persistent Node process shares this registry between webhook
// requests and authenticated SSE responses. No Supabase Realtime or DB writes.
const runtime = globalThis as typeof globalThis & {
  __erpAppNotificationListeners?: Registry
}

function listeners(): Registry {
  if (!runtime.__erpAppNotificationListeners) {
    runtime.__erpAppNotificationListeners = new Map<string, Set<Listener>>()
  }
  return runtime.__erpAppNotificationListeners
}

export function publishAppNotification(workspaceId: string, notification: AppNotificationEvent): void {
  if (!workspaceId || !notification?.id) return
  for (const listener of listeners().get(workspaceId) ?? []) {
    try { listener(notification) } catch (error) {
      console.warn('[Notifications] Live listener failed:', error)
    }
  }
}

export function subscribeAppNotifications(workspaceId: string, listener: Listener): () => void {
  const registry = listeners()
  let subscribers = registry.get(workspaceId)
  if (!subscribers) {
    subscribers = new Set<Listener>()
    registry.set(workspaceId, subscribers)
  }
  subscribers.add(listener)
  return () => {
    subscribers?.delete(listener)
    if (subscribers?.size === 0) registry.delete(workspaceId)
  }
}
