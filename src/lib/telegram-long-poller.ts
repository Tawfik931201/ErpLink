import { decrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'
import { callTelegramApi, sendTelegramWelcomeRaw } from '@/lib/telegram-notifier'

interface BotPollerState {
  botId: string
  workspaceId: string
  botTokenEncrypted: string
  lastOffset: number
  failureCount: number
}

interface TelegramUpdate {
  update_id: number
  message?: {
    chat: { id: number | string }
    text?: string
  }
}

interface PollerGlobal {
  __telegramPollerStarted?: boolean
  __telegramPollerInterval?: NodeJS.Timeout
  __telegramPollerBots?: Map<string, BotPollerState>
  __telegramPollerLastRefresh?: number
}

const POLL_INTERVAL_MS = 5_000
const POLLER_REFRESH_MS = 30_000
const MAX_CONSECUTIVE_FAILURES = 5

const g = global as unknown as PollerGlobal

function getBotsMap(): Map<string, BotPollerState> {
  if (!g.__telegramPollerBots) g.__telegramPollerBots = new Map()
  return g.__telegramPollerBots
}

async function refreshBotsFromDb(): Promise<void> {
  try {
    const bots = getBotsMap()
    const liveKeys = new Set<string>()

    // 1. All registered bots (pending or linked)
    const { data: botRows, error: botErr } = await supabase
      .from('telegram_bots')
      .select('id, workspace_id, bot_token')

    if (botErr) {
      console.warn('[TelegramPoller] refresh bots failed:', botErr.message)
    } else {
      for (const row of botRows || []) {
        const key = row.id
        liveKeys.add(key)
        if (!bots.has(key)) {
          bots.set(key, {
            botId: row.id,
            workspaceId: row.workspace_id,
            botTokenEncrypted: row.bot_token,
            lastOffset: 0,
            failureCount: 0,
          })
        }
      }
    }

    // 2. Pending link codes (have a bot_id reference)
    const { data: codeRows, error: codeErr } = await supabase
      .from('telegram_bot_codes')
      .select('bot_id, expires_at')

    if (codeErr) {
      console.warn('[TelegramPoller] refresh codes failed:', codeErr.message)
    } else {
      const now = Date.now()
      for (const row of codeRows || []) {
        if (!row.bot_id) continue
        const expiresAt = new Date(row.expires_at)
        if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < now) continue
        // Ensure the referenced bot is being polled
        const { data: refBot } = await supabase
          .from('telegram_bots')
          .select('id, workspace_id, bot_token')
          .eq('id', row.bot_id)
          .maybeSingle()
        if (!refBot) continue
        const key = refBot.id
        liveKeys.add(key)
        if (!bots.has(key)) {
          bots.set(key, {
            botId: refBot.id,
            workspaceId: refBot.workspace_id,
            botTokenEncrypted: refBot.bot_token,
            lastOffset: 0,
            failureCount: 0,
          })
        }
      }
    }

    // 3. Drop bots not found in DB
    for (const key of [...bots.keys()]) {
      if (!liveKeys.has(key)) bots.delete(key)
    }
  } catch (err: any) {
    console.warn('[TelegramPoller] refreshBotsFromDb exception:', err?.message ?? err)
  }
}

async function handleStartCommand(
  botTokenPlain: string,
  botId: string,
  text: string,
  chatId: string | number
): Promise<void> {
  // Strip "/start" prefix or take the full message — look for a 6-char code
  // anywhere in the text. This supports:
  //   /start ABC123
  //   /start ABC123 hi
  //   ABC123
  //   abc123
  //   hi abc123 please
  const cleaned = text.replace(/^\/start(@\w+)?\s*/i, '').trim()
  const codeMatch = cleaned.match(/\b[A-Z0-9]{6}\b/i)
  const code = codeMatch ? codeMatch[0].toUpperCase() : ''

  // Nothing that looks like a code — send help message
  if (!code) {
    await callTelegramApi(botTokenPlain, 'sendMessage', {
      chat_id: chatId,
      text: [
        '👋 مرحباً',
        '',
        'هذا البوت مربوط بـ ERP Link.',
        'لربط المحادثة، افتح إعدادات الإشعارات في التطبيق،',
        'أنشئ كود ربط، ثم أرسل الكود فقط هنا في هذه المحادثة.',
      ].join('\n'),
    })
    return
  }

  // Lookup the code
  const { data: codeRow, error: codeErr } = await supabase
    .from('telegram_bot_codes')
    .select('code, workspace_id, bot_id, chat_id, expires_at')
    .eq('code', code)
    .maybeSingle()

  if (codeErr || !codeRow) {
    await callTelegramApi(botTokenPlain, 'sendMessage', {
      chat_id: chatId,
      text: '❌ كود الربط غير صحيح أو منتهي الصلاحية. أعد إنشاء كود جديد من التطبيق.',
    })
    return
  }

  const expiresAt = new Date(codeRow.expires_at)
  if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    await callTelegramApi(botTokenPlain, 'sendMessage', {
      chat_id: chatId,
      text: '❌ انتهت صلاحية كود الربط. أعد إنشاء كود جديد من التطبيق.',
    })
    return
  }

  // Upsert chat subscription
  const { error: upsertErr } = await supabase.from('telegram_bot_chats').upsert(
    {
      bot_id: botId,
      workspace_id: codeRow.workspace_id,
      chat_id: String(chatId),
      chat_label: codeRow.chat_id || null,
      linked_at: new Date().toISOString(),
    },
    { onConflict: 'bot_id,chat_id' }
  )

  if (upsertErr) {
    console.warn('[TelegramPoller] upsert telegram_bot_chats failed:', upsertErr.message)
    await callTelegramApi(botTokenPlain, 'sendMessage', {
      chat_id: chatId,
      text: '⚠️ تعذر إتمام الربط بسبب خطأ في قاعدة البيانات. حاول لاحقاً.',
    })
    return
  }

  // Mark bot as linked
  await supabase
    .from('telegram_bots')
    .update({ status: 'linked', linked_at: new Date().toISOString() })
    .eq('id', botId)

  // Delete the used code
  await supabase.from('telegram_bot_codes').delete().eq('code', code)

  // Send welcome
  await sendTelegramWelcomeRaw(botTokenPlain, String(chatId))
}

async function handleUpdate(
  botTokenPlain: string,
  botId: string,
  update: TelegramUpdate
): Promise<void> {
  const text = (update.message?.text || '').trim()
  const chatId = update.message?.chat?.id
  if (!text || chatId === undefined) return

  // Accept either an explicit /start command OR any message that contains
  // a 6-character alphanumeric token (the link code format).
  const looksLikeStart = /^\/start/i.test(text)
  const looksLikeCode = /\b[A-Z0-9]{6}\b/i.test(text)

  if (looksLikeStart || looksLikeCode) {
    await handleStartCommand(botTokenPlain, botId, text, chatId)
  }
}

async function pollOneBot(state: BotPollerState): Promise<void> {
  let botTokenPlain: string
  try {
    botTokenPlain = decrypt(state.botTokenEncrypted)
  } catch {
    state.failureCount += 1
    return
  }

  const response = await callTelegramApi(botTokenPlain, 'getUpdates', {
    offset: state.lastOffset + 1,
    timeout: 0,
    allowed_updates: ['message'],
  })

  if (!response.ok) {
    state.failureCount += 1
    if (state.failureCount === MAX_CONSECUTIVE_FAILURES) {
      console.warn(`[TelegramPoller] Bot ${state.botId} hit ${MAX_CONSECUTIVE_FAILURES} consecutive failures`)
    }
    return
  }

  state.failureCount = 0

  let maxUpdateId = state.lastOffset
  for (const update of (response as any).result || []) {
    if (update.update_id <= state.lastOffset) continue
    try {
      await handleUpdate(botTokenPlain, state.botId, update)
    } catch (err: any) {
      console.warn('[TelegramPoller] handleUpdate failed:', err?.message ?? err)
    }
    if (update.update_id > maxUpdateId) maxUpdateId = update.update_id
  }
  state.lastOffset = maxUpdateId
}

async function pollAllOnce(): Promise<void> {
  const bots = getBotsMap()
  for (const [, state] of bots.entries()) {
    try {
      await pollOneBot(state)
    } catch (err: any) {
      console.warn('[TelegramPoller] pollOneBot exception:', err?.message ?? err)
    }
  }
}

export function startTelegramPoller(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (g.__telegramPollerStarted) return
  g.__telegramPollerStarted = true

  console.info('[TelegramPoller] Started Telegram long-poller')

  void refreshBotsFromDb().then(pollAllOnce)
  g.__telegramPollerLastRefresh = Date.now()

  g.__telegramPollerInterval = setInterval(async () => {
    if (Date.now() - (g.__telegramPollerLastRefresh || 0) > POLLER_REFRESH_MS) {
      await refreshBotsFromDb()
      g.__telegramPollerLastRefresh = Date.now()
    }
    void pollAllOnce()
  }, POLL_INTERVAL_MS)
}

/**
 * Forces an immediate re-read of bots/codes from the DB. Useful right after
 * a new bot is added or a new link code is generated, so the poller
 * starts polling the new token without waiting for the 30-second refresh.
 */
export async function forceRefreshTelegramPoller(): Promise<void> {
  startTelegramPoller()
  await refreshBotsFromDb()
  g.__telegramPollerLastRefresh = Date.now()
}

export function stopTelegramPoller(): void {
  if (g.__telegramPollerInterval) clearInterval(g.__telegramPollerInterval)
  g.__telegramPollerInterval = undefined
  g.__telegramPollerStarted = false
}
