import { readFileSync } from 'fs'
import { join } from 'path'

const source = (...segments: string[]) => readFileSync(join(__dirname, '..', '..', ...segments), 'utf8')

describe('durable browser notification independence', () => {
  it('records a newly received webhook before any Odoo processing', () => {
    const inbox = source('src', 'lib', 'webhook-inbox.ts')
    expect(inbox).toContain("eventKey: 'arrival:'")
    expect(inbox).toContain("status: 'received'")
    expect(inbox).toContain('return { ok: true, id:')
  })
  it('keeps sync results in a best-effort notification channel', () => {
    const sync = source('src', 'lib', 'sync', 'notifications.ts')
    expect(sync).toContain('notifySyncResult')
    expect(sync).toContain('recordAppNotification')
    expect(sync).toContain('catch {')
  })
  it('enforces workspace-scoped reads and subscription writes', () => {
    const route = source('src', 'app', 'api', 'notifications', 'route.ts')
    expect(route).toContain('getActiveWorkspaceId')
    expect(route).toContain(".eq('workspace_id', p.workspaceId)")
    expect(route).toContain(".eq('user_id', p.userId)")
    expect(route).toContain('originAllowed(req)')
  })
  it('accepts both WEB_PUSH_CONTACT and the documented WEB_PUSH_SUBJECT alias', () => {
    const sender = source('src', 'lib', 'browser-push.ts')
    const route = source('src', 'app', 'api', 'notifications', 'route.ts')
    expect(sender).toContain('process.env.WEB_PUSH_SUBJECT')
    expect(sender).toContain('pushContact()')
    expect(route).toContain('pushConfigured()')
    expect(route).toContain('pushReady:')
  })
  it('never intercepts or caches Odoo traffic in the browser worker', () => {
    const worker = source('public', 'notification-sw.js')
    expect(worker).toContain("addEventListener('push'")
    expect(worker).toContain("addEventListener('notificationclick'")
    expect(worker).not.toContain("addEventListener('fetch'")
  })
  it('runs push independently of the Odoo worker only when configured', () => {
    const boot = source('src', 'instrumentation.ts')
    expect(boot).toContain('startSyncQueueRunner()')
    // Push switched to event-driven recovery before this security change.
    // Startup must recover durable outbox messages without periodic polling.
    expect(boot).toContain('startBrowserPushRecovery()')
    expect(boot).not.toContain('setInterval(() => {\n            void drainBrowserPush()')
  })
  it('does not give public clients direct access to notification tables', () => {
    const migration = source('supabase', 'migrations', '20261120_browser_push_notifications.sql')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL')
  })
})
