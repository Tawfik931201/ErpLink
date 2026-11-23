import fs from 'fs'
import path from 'path'

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), 'src/lib', name), 'utf8')

describe('idle Supabase API ingest budget', () => {
  it('sends Telegram only when a durable notification is enqueued or recovered on boot', () => {
    const code = read('telegram-outbox.ts')
    expect(code).not.toContain('hasLinkedTelegramBot()')
    expect(code).not.toContain('setInterval(() =>')
    expect(code).toContain('scheduleTelegramOutboxWake(args.availableAt?.getTime() ?? Date.now())')
    expect(code).toContain('if (next === null) return')
  })

  it('does not scan link codes when no Telegram bots are registered', () => {
    const code = read('telegram-long-poller.ts')
    expect(code).toContain('POLLER_IDLE_REFRESH_MS = 120_000')
    expect(code).toContain("if (!botErr && (botRows?.length ?? 0) === 0)")
    expect(code).toContain('bots.clear()')
  })

  it('uses an adaptive idle queue poll, rather than polling every ten seconds forever', () => {
    const code = read('sync-queue-runner.ts')
    expect(code).toContain("envInterval('SYNC_QUEUE_IDLE_INTERVAL_MS', 120_000, 30_000)")
    expect(code).toContain('scheduleDrain(busy ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS)')
    expect(code).toContain('export function wakeQueueRunnerAt(')
    expect(code).not.toContain('g.__syncQueueRunnerInterval = setInterval(')
    expect(code).toContain('Math.min(2_147_483_647, Math.max(0, dueAt - Date.now()))')
  })

  it('does not repeatedly claim queue families blocked by unknown ERP outcomes', () => {
    const code = read('sync-queue.ts')
    expect(code).toContain('const UNKNOWN_BLOCKER_TTL_MS = 60_000')
    expect(code).toContain("getUnknownBlockedExecutionKeys()")
    expect(code).toContain(".eq('outcome_unknown', true)")
    expect(code).toContain('blocked.has(item.execution_key)')
    expect(code).toContain('if (blocked && blocked.size > 0)')
    expect(code).toContain('if (error) return null')
    // DB is still the source of truth for safety; no automated unknown release.
    expect(code).toContain("supabase.rpc('claim_sync_job'")
  })

  it('coalesces and throttles lease recovery without skipping errors', () => {
    const code = read('sync-queue.ts')
    expect(code).toContain('const LEASE_RECOVERY_INTERVAL_MS = 60_000')
    expect(code).toContain('if (leaseRecoveryInFlight) return leaseRecoveryInFlight')
    expect(code).toContain('lastLeaseRecoveryAt = Date.now()')
    expect(code).toContain('if (!(await recoverExpiredLeases()))')
    expect(code).not.toContain("const expired = await supabase.rpc('expire_sync_job_leases')")
  })

  it('wakes after a durable enqueue, never before the receipt is stored', () => {
    const code = read('sync-queue.ts')
    const scope = code.slice(code.indexOf('export async function enqueueWebhookEvent'),
      code.indexOf('// ─── Processing', code.indexOf('export async function enqueueWebhookEvent')))
    const receipt = scope.indexOf('const dispatched = await dispatchWebhookReceipt(')
    const wake = scope.indexOf('wakeQueueRunnerAt(nextRetryAt)')
    expect(receipt).toBeGreaterThan(-1)
    expect(wake).toBeGreaterThan(receipt)
  })
})
