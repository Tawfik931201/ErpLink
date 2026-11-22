import fs from 'fs'
import path from 'path'

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), 'src/lib', name), 'utf8')

describe('idle Supabase API ingest budget', () => {
  it('does not query the Telegram outbox while no linked bot exists', () => {
    const code = read('telegram-outbox.ts')
    expect(code).toContain("from('telegram_bots')")
    expect(code).toContain("eq('status', 'linked')")
    expect(code).toContain("if (!await hasLinkedTelegramBot()) return")
    expect(code).toContain('telegramBotPresenceUntil')
  })

  it('does not scan link codes when no Telegram bots are registered', () => {
    const code = read('telegram-long-poller.ts')
    expect(code).toContain('POLLER_IDLE_REFRESH_MS = 120_000')
    expect(code).toContain("if (!botErr && (botRows?.length ?? 0) === 0)")
    expect(code).toContain('bots.clear()')
  })

  it('uses an adaptive idle queue poll, rather than polling every ten seconds forever', () => {
    const code = read('sync-queue-runner.ts')
    expect(code).toContain("envInterval('SYNC_QUEUE_IDLE_INTERVAL_MS', 60_000, 15_000)")
    expect(code).toContain('scheduleDrain(busy ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS)')
    expect(code).toContain('export function wakeQueueRunnerAt(')
    expect(code).not.toContain('g.__syncQueueRunnerInterval = setInterval(')
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
