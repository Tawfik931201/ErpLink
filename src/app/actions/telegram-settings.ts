'use server'

import { randomBytes } from 'crypto'

import { revalidatePath } from 'next/cache'

import { getActiveWorkspaceId } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'
import { forceRefreshTelegramPoller } from '@/lib/telegram-long-poller'
import { clearTelegramCache } from '@/lib/telegram-notifier'

function authError() {
  return { success: false, error: 'Unauthorized' }
}

function generateLinkCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

function botTokenLooksValid(token: string): boolean {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token.trim())
}

// ─── Bot Tokens ───────────────────────────────────────────────────────────────

export async function getBotTokens() {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { data, error } = await supabase
      .from('telegram_bots')
      .select('id, bot_username, label, status, created_at, linked_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (error) return { success: false, error: error.message }

    return { success: true, bots: data || [] }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load bots' }
  }
}

export async function addBotToken(token: string, label?: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const trimmed = (token || '').trim()
    if (!botTokenLooksValid(trimmed)) {
      return {
        success: false,
        error: 'صيغة توكن البوت غير صحيحة. تأكد من نسخ التوكن كاملاً من @BotFather.',
      }
    }

    // Validate token via getMe
    const meRes = await fetch(`https://api.telegram.org/bot${trimmed}/getMe`)
    if (!meRes.ok) {
      return {
        success: false,
        error: 'تعذر التواصل مع تيليجرام بهذا التوكن. تحقق من صحته.',
      }
    }
    let meJson: any
    try { meJson = await meRes.json() } catch { meJson = null }
    if (!meJson?.ok) {
      return {
        success: false,
        error: 'تيليجرام رفض التوكن. تأكد من صحة التوكن.',
      }
    }

    const encrypted = encrypt(trimmed)
    const botUsername: string = meJson?.result?.username || ''

    const { data, error } = await supabase
      .from('telegram_bots')
      .insert({
        workspace_id: workspaceId,
        bot_token: encrypted,
        bot_username: botUsername,
        label: label || null,
        status: 'pending',
      })
      .select('id, bot_username, label, status, created_at')
      .maybeSingle()

    if (error) {
      if (error.code === '23505') {
        return { success: false, error: 'هذا البوت مضاف مسبقاً لهذا المساحة.' }
      }
      return { success: false, error: 'تعذر حفظ البوت. حاول مرة أخرى.' }
    }

    await forceRefreshTelegramPoller()
    clearTelegramCache(workspaceId)
    revalidatePath('/dashboard/settings/notifications')

    return { success: true, bot: data }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to add bot' }
  }
}

export async function deleteBotToken(id: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { error } = await supabase
      .from('telegram_bots')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId)

    if (error) return { success: false, error: error.message }

    clearTelegramCache(workspaceId)
    revalidatePath('/dashboard/settings/notifications')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete bot' }
  }
}

// ─── Chat Subscriptions ───────────────────────────────────────────────────────

export async function getSubscriptions(botId?: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    let query = supabase
      .from('telegram_bot_chats')
      .select(`
        id,
        bot_id,
        chat_id,
        chat_label,
        language,
        notify_mode,
        enabled,
        workspace_filter,
        mapping_filter,
        created_at,
        linked_at,
        bot:telegram_bots (bot_username, label)
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (botId) query = query.eq('bot_id', botId)

    const { data, error } = await query
    if (error) return { success: false, error: error.message }

    const subscriptions = (data || []).map((r: any) => ({
      ...r,
      bot: Array.isArray(r.bot) ? r.bot[0] ?? null : r.bot,
    }))

    return { success: true, subscriptions }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load subscriptions' }
  }
}

export async function generateChatLinkCode(botId: string, chatLabel: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    // Verify bot belongs to this workspace
    const { data: bot } = await supabase
      .from('telegram_bots')
      .select('id, bot_username')
      .eq('id', botId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!bot) return { success: false, error: 'البوت غير موجود.' }

    const code = generateLinkCode()

    await supabase
      .from('telegram_bot_codes')
      .delete()
      .eq('bot_id', botId)

    const { error } = await supabase.from('telegram_bot_codes').insert({
      code,
      workspace_id: workspaceId,
      bot_id: botId,
      chat_id: chatLabel, // store label temporarily
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })

    if (error) return { success: false, error: 'تعذر إنشاء كود الربط.' }

    await forceRefreshTelegramPoller()

    return {
      success: true,
      code,
      botUsername: bot.bot_username ?? null,
      botLink: bot.bot_username ? `https://t.me/${bot.bot_username}?start=${code}` : null,
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to generate code' }
  }
}

export async function updateSubscription(
  id: string,
  prefs: {
    language?: 'ar' | 'en'
    notify_mode?: 'success' | 'failure' | 'both'
    enabled?: boolean
    workspace_filter?: string[]
    mapping_filter?: string[]
  }
) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const payload: Record<string, unknown> = {}
    if (prefs.language === 'ar' || prefs.language === 'en') payload.language = prefs.language
    if (['success', 'failure', 'both'].includes(prefs.notify_mode || '')) payload.notify_mode = prefs.notify_mode
    if (typeof prefs.enabled === 'boolean') payload.enabled = prefs.enabled
    if (prefs.workspace_filter) payload.workspace_filter = JSON.stringify(prefs.workspace_filter)
    if (prefs.mapping_filter) payload.mapping_filter = JSON.stringify(prefs.mapping_filter)

    const { error } = await supabase
      .from('telegram_bot_chats')
      .update(payload)
      .eq('id', id)
      .eq('workspace_id', workspaceId)

    if (error) return { success: false, error: error.message }

    clearTelegramCache(workspaceId)
    revalidatePath('/dashboard/settings/notifications')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to update subscription' }
  }
}

export async function deleteSubscription(id: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { error } = await supabase
      .from('telegram_bot_chats')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId)

    if (error) return { success: false, error: error.message }

    clearTelegramCache(workspaceId)
    revalidatePath('/dashboard/settings/notifications')
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete subscription' }
  }
}

// ─── Poll link status (UI helper) ─────────────────────────────────────────────

export async function pollChatLinkStatus(botId: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { data, error } = await supabase
      .from('telegram_bot_chats')
      .select('id, chat_id, chat_label, linked_at')
      .eq('workspace_id', workspaceId)
      .eq('bot_id', botId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return { success: false, error: error.message }

    return {
      success: true,
      linked: !!data,
      subscription: data ?? null,
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to poll' }
  }
}

// ─── Test message ─────────────────────────────────────────────────────────────

export async function sendTestTelegramMessage(subscriptionId: string) {
  try {
    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return authError()

    const { data: sub } = await supabase
      .from('telegram_bot_chats')
      .select('chat_id, language, bot:telegram_bots!inner (bot_token)')
      .eq('id', subscriptionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!sub) return { success: false, error: 'لم يتم العثور على الاشتراك.' }

    const encryptedToken = (Array.isArray(sub.bot) ? sub.bot[0]?.bot_token : (sub.bot as any)?.bot_token)
    if (!encryptedToken) return { success: false, error: 'البوت غير متاح.' }

    const { decrypt } = await import('@/lib/crypto')
    let tokenPlain = ''
    try { tokenPlain = decrypt(encryptedToken) } catch {
      return { success: false, error: 'تعذر فك تشفير توكن البوت.' }
    }

    const lang = sub.language === 'en' ? 'en' : 'ar'
    const testText = lang === 'en'
      ? '🧪 Test message from ERP Link.\n✅ Notifications are working correctly.'
      : '🧪 رسالة تجريبية من ERP Link.\n✅ الإشعارات تعمل بشكل صحيح.'

    const res = await fetch(`https://api.telegram.org/bot${tokenPlain}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: sub.chat_id,
        text: testText,
      }),
    })

    if (!res.ok) {
      return { success: false, error: 'تعذر إرسال الرسالة. تحقق من صلاحية البوت.' }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to send test' }
  }
}
