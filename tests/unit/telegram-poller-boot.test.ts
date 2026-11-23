import fs from 'fs'
import path from 'path'

import { extractLinkCode } from '@/lib/telegram/link-code'

/**
 * Why this file exists: the Telegram poller used to be started *only* as a side
 * effect of two server actions (`addBotToken`, `generateChatLinkCode`). Nothing
 * in `src/instrumentation.ts` started it, so after any restart or deploy the
 * poller did not exist at all, `getUpdates` was never called, and a customer
 * sending `/start 8WRVXQ` got silence from the bot and an endless "waiting for
 * link…" in the app. The token validated fine the whole time, because that check
 * is a direct `getMe` call from the action — nothing to do with the poller.
 *
 * The pin below is deliberately source-level: it fails if the boot wiring is
 * removed again, and it fails if the failure paths go quiet, since "silently
 * does nothing" is what made this take a full support round-trip to diagnose.
 */
const ROOT = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('the Telegram poller is actually running', () => {
  const instrumentation = read('src/instrumentation.ts')

  it('is started at boot, not by a user action', () => {
    expect(instrumentation).toContain("import('@/lib/telegram-long-poller')")
    expect(instrumentation).toContain('startTelegramPoller()')

    // Same deployment gate as the sync queue runner: long polling needs a
    // long-lived Node process, which is why the VERCEL check wraps both.
    const pollerStart = instrumentation.indexOf('startTelegramPoller()')
    expect(pollerStart).toBeGreaterThan(-1)
    expect(instrumentation.lastIndexOf('if (!process.env.VERCEL)', pollerStart)).toBeGreaterThan(-1)
  })

  it('does not read registered bots on boot when no link code is pending', () => {
    const poller = read('src/lib/telegram-long-poller.ts')
    const startup = poller.slice(poller.indexOf('export function startTelegramPoller'), poller.indexOf('export async function forceRefreshTelegramPoller'))
    expect(startup.indexOf(".from('telegram_bot_codes')")).toBeGreaterThan(-1)
    expect(startup.indexOf(".from('telegram_bot_codes')")).toBeLessThan(startup.indexOf('await refreshBotsFromDb()'))
    expect(startup).toContain('if (!codeRow?.expires_at) return')
    expect(startup).not.toContain('setInterval(() =>')
    expect(poller).toContain('ensurePollTimer()')
    expect(poller).toContain('stopPollInterval()')
  })

  it('never survives only as a side effect of a server action', () => {
    // The actions may still nudge it, but that is an optimisation, not the
    // reason it runs. If this ever becomes the only start path again, the
    // "link works until the next deploy" bug returns.
    const actions = read('src/app/actions/telegram-settings.ts')
    expect(actions).toContain('forceRefreshTelegramPoller')

    const poller = read('src/lib/telegram-long-poller.ts')
    expect(poller).toContain('startTelegramPoller')
  })
})

describe('a failing poller says so', () => {
  const poller = read('src/lib/telegram-long-poller.ts')

  it('logs a token it cannot decrypt', () => {
    // Silent `catch {}` here is indistinguishable from a quiet bot, and the one
    // real cause is a token encrypted with a retired ENCRYPTION_KEY.
    expect(poller).toMatch(/decrypt\(state\.botTokenEncrypted\)[\s\S]{0,400}console\.warn/)
    expect(poller).not.toMatch(/catch\s*\{\s*state\.failureCount/)
  })

  it("logs Telegram's own error text when getUpdates fails", () => {
    // 409 means two pollers on one token and 401 a revoked token; without the
    // description the operator sees only a counter.
    expect(poller).toContain('getUpdates failed')
    expect(poller).toContain('response.description')
  })

  it('logs the updates it receives, so ' + "'nothing arrived'" + ' is distinguishable from ' + "'nothing matched'", () => {
    expect(poller).toContain('sent link code')
    expect(poller).toContain('ignoring update')
  })
})

describe('the link flow', () => {
  const poller = read('src/lib/telegram-long-poller.ts')

  it('parses the code with the tested helper, not an inline copy', () => {
    expect(poller).toContain("from '@/lib/telegram/link-code'")
    expect(poller).toContain('extractLinkCode(text)')
    // An inline regex here would drift from the tested rule.
    expect(poller).not.toMatch(/match\(\/\\b\[A-Z0-9\]\{6\}/)
  })

  it('reads the customer-facing example', () => {
    expect(extractLinkCode('/start 8WRVXQ')).toBe('8WRVXQ')
  })
})