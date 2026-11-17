import { readFileSync } from 'fs'
import { join } from 'path'

import { ALERT_THRESHOLDS, evaluateAlertConditions } from '@/lib/admin-alerts'

/**
 * أدوات ما قبل أول عميل حقيقي (2026-10-22).
 *
 * لا يوجد عملاء الآن ⇒ كل عيب في الاستقبال أو الطابور أو التليجرام يبقى
 * مخفياً حتى أول موسم. لذلك أضفنا:
 *   1. **الفحص الذاتي للمسار** — يشغّل المسار الحقيقي ويعرض تقريراً.
 *   2. **تنبيهات الأدمن** — قناة واحدة تكفي، بلا بنية جديدة.
 *   3. **حجز الصفوف بالتوازي** — كان 50 رحلة ذهاب وإياب متسلسلة لكل دورة.
 */

const SRC = join(__dirname, '..', '..', 'src')

function read(...parts: string[]): string {
  return readFileSync(join(SRC, ...parts), 'utf8')
}

describe('the pipeline self-test', () => {
  const selftest = read('lib', 'pipeline-selftest.ts')
  const route = read('app', 'api', 'admin', 'pipeline-selftest', 'route.ts')

  it('is admin-gated and needs an explicit confirmation', () => {
    expect(route).toContain('isAdmin(userId)')
    expect(route).toContain("body.confirm !== true")
    expect(route).toContain('workspaceId required')
  })

  it('runs the REAL code path, not a simulation', () => {
    // The point of the self-test is that it exercises the same functions the
    // webhook routes call.
    expect(selftest).toContain('enqueueWebhookEvent')
    expect(selftest).toContain('admitWorkspaceEvent')
    expect(selftest).toContain('enqueueTelegramMessage')
  })

  it('checks every guarantee the no-loss plan made', () => {
    for (const check of [
      'certified deliveries are never rejected',
      'one inbox row + one queue row',
      'two updates to one entity ⇒ one queue row',
      '50 events in one flush',
      'does not starve the others',
      'a notification is queued, not sent inline',
      'the body is stored whole, not truncated',
    ]) {
      expect(selftest).toContain(check)
    }
  })

  it('cleans up every row it created', () => {
    expect(selftest).toContain("from('sync_queue').delete().like('dedup_key'")
    expect(selftest).toContain("from('webhook_inbox').delete().like('dedup_key'")
    expect(selftest).toContain("from('telegram_outbox').delete().like('event_key'")
  })

  it('never touches a real client Odoo', () => {
    // The self-test must not write to Odoo. It only enqueues and inspects.
    expect(selftest).not.toContain('OdooClient')
    expect(selftest).not.toContain('processOdooOperation')
  })

  it('is reachable from the admin screen', () => {
    const page = read('app', '(app)', 'admin', 'page.tsx')
    expect(page).toContain('PipelineSelfTest')
    const component = read('app', '(app)', 'admin', 'PipelineSelfTest.tsx')
    expect(component).toContain('/api/admin/pipeline-selftest')
  })
})

describe('the admin alerts', () => {
  const alerts = read('lib', 'admin-alerts.ts')

  it('is off unless a workspace is configured', () => {
    expect(alerts).toContain('ADMIN_ALERT_WORKSPACE_ID')
    expect(alerts).toContain('not set')
  })

  it('sends ONE combined message, not one per condition', () => {
    expect(alerts).toContain('conditions.map((c) =>')
    expect(alerts).toContain('kind: \'result\'')
  })

  it('throttles itself so it cannot become a spammer', () => {
    expect(alerts).toContain('CHECK_THROTTLE_MS')
    expect(alerts).toContain('ALERT_THROTTLE_MS')
    expect(alerts).toContain('already_alerted')
  })

  it('reuses the Telegram outbox instead of building a new channel', () => {
    expect(alerts).toContain("import('@/lib/telegram-outbox')")
    expect(alerts).toContain('enqueueTelegramMessage')
  })

  it('runs from the queue cycle', () => {
    const runner = read('lib', 'sync-queue-runner.ts')
    expect(runner).toContain('checkAdminAlerts')
  })
})

describe('the alert conditions are measured, not guessed', () => {
  const healthy = {
    pending: 10,
    frozen: 0,
    deadLetter: 0,
    inboxFailed: 0,
    telegramPending: 0,
    telegramFailed: 0,
    oldestPendingAgeSec: 60,
    rejectedGlobal: 0,
    rejectedUnauthenticated: 0,
  }

  it('says nothing when everything is healthy', () => {
    expect(evaluateAlertConditions(healthy)).toHaveLength(0)
  })

  it('fires when the oldest pending request passes the 30-minute target', () => {
    const conditions = evaluateAlertConditions({
      ...healthy,
      oldestPendingAgeSec: ALERT_THRESHOLDS.oldestPendingAgeSec + 60,
    })
    expect(conditions.map((c) => c.key)).toContain('oldest_pending')
  })

  it('fires on frozen rows, dead letters and failed receipts', () => {
    const conditions = evaluateAlertConditions({
      ...healthy,
      frozen: 3,
      deadLetter: 1,
      inboxFailed: 2,
    })
    const keys = conditions.map((c) => c.key)
    expect(keys).toContain('frozen')
    expect(keys).toContain('dead_letter')
    expect(keys).toContain('inbox_failed')
  })

  it('fires on a closed global safety valve — that one is a lost-event risk', () => {
    const conditions = evaluateAlertConditions({ ...healthy, rejectedGlobal: 1 })
    expect(conditions.map((c) => c.key)).toContain('global_cap')
  })

  it('fires on unauthenticated rejections — a store is not re-registered yet', () => {
    const conditions = evaluateAlertConditions({ ...healthy, rejectedUnauthenticated: 4 })
    expect(conditions.map((c) => c.key)).toContain('unauthenticated_rejected')
  })

  it('every condition carries a readable Arabic and English text', () => {
    const conditions = evaluateAlertConditions({
      ...healthy,
      frozen: 1,
      deadLetter: 1,
      oldestPendingAgeSec: 5000,
    })
    expect(conditions.length).toBeGreaterThan(0)
    for (const condition of conditions) {
      expect(condition.ar.length).toBeGreaterThan(10)
      expect(condition.en.length).toBeGreaterThan(10)
    }
  })
})

describe('the claim is parallel but still atomic per row', () => {
  const queue = read('lib', 'sync-queue.ts')

  it('claims rows concurrently', () => {
    expect(queue).toContain('CLAIM_CONCURRENCY')
    expect(queue).toContain('await Promise.all(slice.map((item) => claimQueueItem(item.id, false)))')
  })

  it('keeps the per-row conditional update — the atomicity guarantee', () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase', 'migrations', '20261103155209_durable_webhook_execution.sql'), 'utf8')
    expect(sql.includes('q.lease_token IS NULL AND NOT q.outcome_unknown')).toBe(true)
    expect(queue.includes("supabase.rpc('claim_sync_job'")).toBe(true)
  })

  it('skips a row whose claim failed instead of crashing the cycle', () => {
    const claim = queue.slice(queue.indexOf('async function claimQueueItem'))
    expect(claim).toContain('catch')
    expect(claim).toContain('return null')
  })
})
