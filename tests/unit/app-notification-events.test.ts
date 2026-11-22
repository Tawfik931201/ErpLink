import {
  publishAppNotification,
  subscribeAppNotifications,
  type AppNotificationEvent,
} from '@/lib/app-notification-events'

const event: AppNotificationEvent = {
  id: 'notification-1',
  title: 'طلب جديد',
  body: 'طلب #100',
  href: '/app/queue',
  status: 'received',
  event: 'order.created',
  created_at: '2026-11-22T10:00:00.000Z',
}

describe('in-memory app notification event bus', () => {
  it('publishes immediately only to listeners in the matching workspace', () => {
    const first = jest.fn()
    const otherWorkspace = jest.fn()
    const unsubscribe = subscribeAppNotifications('workspace-a', first)
    const unsubscribeOther = subscribeAppNotifications('workspace-b', otherWorkspace)

    publishAppNotification('workspace-a', event)

    expect(first).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledWith(event)
    expect(otherWorkspace).not.toHaveBeenCalled()

    unsubscribe()
    unsubscribeOther()
  })

  it('stops delivery after a listener unsubscribes', () => {
    const listener = jest.fn()
    const unsubscribe = subscribeAppNotifications('workspace-c', listener)
    unsubscribe()
    publishAppNotification('workspace-c', event)
    expect(listener).not.toHaveBeenCalled()
  })
})
