'use client'

import * as Popover from '@radix-ui/react-popover'
import * as Select from '@radix-ui/react-select'
import {
  Bell,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MessageCircle,
  Plus,
  Save,
  Send,
  Trash2,
  X,
  ChevronDown,
  ChevronUp,
  Check,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { getFieldMappings } from '@/app/actions/field-mappings'
import {
  addBotToken,
  deleteBotToken,
  generateChatLinkCode,
  getBotTokens,
  getSubscriptions,
  pollChatLinkStatus,
  sendTestTelegramMessage,
  updateSubscription,
  deleteSubscription,
} from '@/app/actions/telegram-settings'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

interface Bot {
  id: string
  bot_username: string | null
  label: string | null
  status: string
  created_at: string
  linked_at: string | null
}

interface ChatSub {
  id: string
  bot_id: string
  chat_id: string
  chat_label: string | null
  language: string
  notify_mode: string
  enabled: boolean
  workspace_filter: unknown
  mapping_filter: unknown
  created_at: string
  linked_at: string
  bot: { bot_username: string | null; label: string | null } | null
}

interface FieldMapping {
  id: string
  name: string
}

const MODE_OPTIONS = [
  { id: 'success' as const, ar: 'الناجحة فقط', en: 'Successful only' },
  { id: 'failure' as const, ar: 'الفاشلة فقط', en: 'Failed only' },
  { id: 'both' as const, ar: 'كلا الحالتين', en: 'Both outcomes' },
]

// ─── Dropdown Components ─────────────────────────────────────────────────────

function DropdownSingleSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string }[]
  placeholder?: string
  disabled?: boolean
}) {
  const current = options.find(o => o.id === value)
  return (
    <Select.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <Select.Trigger
        className={cn(
          'w-full inline-flex items-center justify-between gap-2 rounded-lg border-none bg-secondary px-3 py-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Select.Value placeholder={placeholder}>{current?.label ?? placeholder}</Select.Value>
        <Select.Icon>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[10rem] rounded-lg border border-border bg-popover text-popover-foreground overflow-hidden"
        >
          <Select.Viewport className="p-1">
            {options.map(opt => (
              <Select.Item
                key={opt.id}
                value={opt.id}
                className="relative flex items-center gap-2 px-2 py-1.5 text-xs font-bold rounded-lg cursor-pointer text-foreground data-[highlighted]:bg-secondary data-[highlighted]:outline-none"
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
                <Select.ItemIndicator className="ms-auto">
                  <Check className="h-3.5 w-3.5 text-foreground" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}

function DropdownMultiSelect({
  selected,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  selected: string[]
  onChange: (next: string[]) => void
  options: { id: string; label: string }[]
  placeholder: string
  disabled?: boolean
}) {
  const isAll = selected.length === 0 || selected.length === options.length
  const triggerLabel = isAll
    ? placeholder
    : selected.length > 1
      ? `${selected.length} ${placeholder}`
      : (options.find(o => selected.includes(o.id))?.label ?? placeholder)

  return (
    <Popover.Root>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          'w-full inline-flex items-center justify-between gap-2 rounded-lg border-none bg-secondary px-3 py-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <span className={cn('truncate', isAll && 'text-muted-foreground')}>
          {triggerLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-64 max-h-72 overflow-auto rounded-lg border border-border bg-popover text-popover-foreground p-1"
        >
          <div className="px-2 py-1.5 flex items-center justify-between border-b border-border mb-1">
            <span className="text-[10px] font-bold text-muted-foreground">{selected.length} / {options.length}</span>
            <button
              onClick={(e) => {
                e.preventDefault()
                if (isAll) onChange(options.map(o => o.id))
                else onChange([])
              }}
              className="text-[10px] font-bold text-foreground hover:underline"
            >
              {isAll ? (selected.length === options.length ? 'All selected' : 'Select all') : 'Clear'}
            </button>
          </div>
          {options.length === 0 && (
            <p className="px-2 py-2 text-[10px] text-muted-foreground">
              لا توجد خيارات
            </p>
          )}
          {options.map(opt => {
            const checked = selected.includes(opt.id)
            return (
              <div
                key={opt.id}
                onClick={() => {
                  const next = checked
                    ? selected.filter(x => x !== opt.id)
                    : [...selected, opt.id]
                  onChange(next)
                }}
                className="flex items-center gap-2 px-2 py-1.5 text-xs font-bold rounded-lg cursor-pointer hover:bg-secondary"
              >
                <span className={cn(
                  'h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                  checked ? 'bg-foreground border-foreground text-background' : 'border-border'
                )}>
                  {checked && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="truncate">{opt.label}</span>
              </div>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export default function NotificationsSettingsPage() {
  const { lang } = useLanguage()
  const [bots, setBots] = useState<Bot[]>([])
  const [subs, setSubs] = useState<ChatSub[]>([])
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [loading, setLoading] = useState(true)

  // Pending edits per subscription (kept local until Save is clicked)
  type Draft = {
    language?: 'ar' | 'en'
    notify_mode?: 'success' | 'failure' | 'both'
    enabled?: boolean
    mapping_filter?: string[]
  }
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const setDraftField = (id: string, patch: Draft) =>
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  const clearDraft = (id: string) =>
    setDrafts(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  const getDraftValue = (id: string, key: keyof Draft, fallback: any) => {
    const d = drafts[id]
    if (d && key in d) return d[key] as any
    return fallback
  }
  const isDirty = (id: string) => Object.keys(drafts[id] || {}).length > 0

  // New bot form
  const [showNewBot, setShowNewBot] = useState(false)
  const [newBotToken, setNewBotToken] = useState('')
  const [newBotLabel, setNewBotLabel] = useState('')
  const [addingBot, setAddingBot] = useState(false)
  const [addBotError, setAddBotError] = useState('')

  // Link chat
  const [linkingBotId, setLinkingBotId] = useState<string | null>(null)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkResult, setLinkResult] = useState<{ code: string; botUsername: string | null; botLink: string | null } | null>(null)
  const [linking, setLinking] = useState(false)

  // Edit inline
  const [savingSub, setSavingSub] = useState<string | null>(null)
  const [deletingSub, setDeletingSub] = useState<string | null>(null)
  const [deletingBot, setDeletingBot] = useState<string | null>(null)
  const [testingSub, setTestingSub] = useState<string | null>(null)

  const [deleteSubTarget, setDeleteSubTarget] = useState<string | null>(null)
  const [deleteBotTarget, setDeleteBotTarget] = useState<string | null>(null)

  // Expanded bots
  const [expandedBots, setExpandedBots] = useState<Set<string>>(new Set())

  const [copyHint, setCopyHint] = useState('')
  const [activePolling, setActivePolling] = useState(false)

  async function refresh() {
    setLoading(true)
    const [botsRes, subsRes, mapsRes] = await Promise.all([
      getBotTokens(),
      getSubscriptions(),
      getFieldMappings(),
    ])
    if (botsRes.success) setBots(botsRes.bots || [])
    if (subsRes.success) setSubs(subsRes.subscriptions || [])
    if (mapsRes.success) setMappings(mapsRes.mappings || [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  // Poll after generating code
  useEffect(() => {
    if (!linkResult || !linkingBotId) return
    const subAlready = subs.find(s => s.bot_id === linkingBotId)
    if (subAlready) { setActivePolling(false); return }

    setActivePolling(true)
    let cancelled = false
    const interval = setInterval(async () => {
      if (cancelled) return
      const res = await pollChatLinkStatus(linkingBotId)
      if (cancelled) return
      if (res.success && res.linked) {
        clearInterval(interval)
        setActivePolling(false)
        setLinkResult(null)
        setLinkingBotId(null)
        refresh()
      }
    }, 3000)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      setActivePolling(false)
    }, 10 * 60 * 1000)

    return () => { cancelled = true; clearInterval(interval); clearTimeout(timeout) }
  }, [linkResult, linkingBotId, subs])

  async function handleAddBot() {
    if (!newBotToken.trim()) return
    setAddingBot(true)
    setAddBotError('')
    const res = await addBotToken(newBotToken, newBotLabel || undefined)
    setAddingBot(false)
    if (res.success) {
      setNewBotToken('')
      setNewBotLabel('')
      setShowNewBot(false)
      refresh()
    } else {
      setAddBotError(res.error || '')
    }
  }

  async function handleGenerateLink(botId: string) {
    if (!linkLabel.trim()) return
    setLinking(true)
    setLinkResult(null)
    const res = await generateChatLinkCode(botId, linkLabel)
    setLinking(false)
    if (res.success) {
      setLinkResult({ code: res.code!, botUsername: res.botUsername ?? null, botLink: res.botLink ?? null })
    }
  }

  async function handleSaveSub(id: string) {
    const draft = drafts[id]
    if (!draft || Object.keys(draft).length === 0) return
    setSavingSub(id)
    const res = await updateSubscription(id, draft)
    setSavingSub(null)
    if (res.success) {
      clearDraft(id)
      refresh()
    }
  }

  async function handleCancelSub(id: string) {
    clearDraft(id)
  }

  async function handleDeleteSub(id: string) {
    setDeleteSubTarget(id)
  }

  async function handleDeleteSubConfirm() {
    if (!deleteSubTarget) return
    setDeletingSub(deleteSubTarget)
    await deleteSubscription(deleteSubTarget)
    setDeletingSub(null)
    setDeleteSubTarget(null)
    refresh()
  }

  async function handleDeleteBot(id: string) {
    setDeleteBotTarget(id)
  }

  async function handleDeleteBotConfirm() {
    if (!deleteBotTarget) return
    setDeletingBot(deleteBotTarget)
    await deleteBotToken(deleteBotTarget)
    setDeletingBot(null)
    setDeleteBotTarget(null)
    refresh()
  }

  async function handleTest(id: string) {
    setTestingSub(id)
    await sendTestTelegramMessage(id)
    setTestingSub(null)
  }

  function toggleBot(id: string) {
    setExpandedBots(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function copyCode(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopyHint(text)
      setTimeout(() => setCopyHint(''), 1500)
    })
  }

  // Utils
  function parseFilter(val: unknown): string[] {
    if (!val) return []
    if (Array.isArray(val)) return val.map(String)
    if (typeof val === 'string') { try { return JSON.parse(val) } catch { return [] } }
    return []
  }

  const subsForBot = (botId: string) => subs.filter(s => s.bot_id === botId)

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Bell className="h-4.5 w-4.5 text-foreground" />
            <span>{lang === 'ar' ? 'إشعارات تيليجرام' : 'Telegram Notifications'}</span>
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1">
            {lang === 'ar'
              ? 'إدارة بوتات تيليجرام والقنوات المرتبطة لإشعارات المزامنة.'
              : 'Manage Telegram bots and linked chats for sync notifications.'}
          </p>
        </div>
        <Button
          onClick={() => setShowNewBot(!showNewBot)}
          className="bg-foreground text-background font-bold"
        >
          <Plus className="h-4 w-4" />
          {lang === 'ar' ? 'بوت جديد' : 'New Bot'}
        </Button>
      </div>

      {/* New bot form */}
      {showNewBot && (
        <div className="rounded-xl border border-border bg-secondary/10 p-4 space-y-3">
          <label className="text-xs font-bold text-muted-foreground">
            {lang === 'ar' ? 'توكن البوت من @BotFather' : 'Bot token from @BotFather'}
          </label>
          <input
            type="text"
            value={newBotToken}
            onChange={(e) => setNewBotToken(e.target.value)}
            placeholder="123456789:AAEb..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-foreground"
            dir="ltr"
          />
          <input
            type="text"
            value={newBotLabel}
            onChange={(e) => setNewBotLabel(e.target.value)}
            placeholder={lang === 'ar' ? 'تسمية (اختياري)' : 'Label (optional)'}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-foreground"
          />
          <div className="flex gap-2">
            <Button
              onClick={handleAddBot}
              disabled={addingBot || !newBotToken.trim()}
              className="bg-foreground text-background font-bold"
            >
              {addingBot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {lang === 'ar' ? 'حفظ' : 'Save'}
            </Button>
            <Button variant="outline" onClick={() => setShowNewBot(false)}>
              {lang === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
          </div>
          {addBotError && (
            <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-2.5">
              {addBotError}
            </div>
          )}
        </div>
      )}

      {/* Bot list */}
      {bots.length === 0 && !showNewBot && (
        <div className="rounded-xl border border-border bg-secondary/5 p-8 text-center text-sm text-muted-foreground">
          {lang === 'ar'
            ? 'لا توجد بوتات بعد. أضف بوتاً جديداً للبدء.'
            : 'No bots yet. Add a new bot to get started.'}
        </div>
      )}

      {bots.map(bot => {
        const chatSubs = subsForBot(bot.id)
        const isExpanded = expandedBots.has(bot.id)

        return (
          <div key={bot.id} className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Bot header */}
            <button
              onClick={() => toggleBot(bot.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-secondary/5 transition-colors text-start"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <MessageCircle className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {bot.label || bot.bot_username || `@${bot.bot_username}` || bot.id.slice(0, 8)}
                  </p>
                  {bot.bot_username && (
                    <p className="text-[10px] text-muted-foreground">@{bot.bot_username}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                    bot.status === 'linked'
                      ? 'bg-muted border-border text-foreground'
                      : 'bg-secondary border-border text-muted-foreground'
                )}>
                  {bot.status === 'linked'
                    ? (lang === 'ar' ? 'مربوط' : 'Linked')
                    : (lang === 'ar' ? 'قيد الانتظار' : 'Pending')}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {chatSubs.length} {lang === 'ar' ? 'محادثة' : 'chat'}
                  {chatSubs.length !== 1 ? 's' : ''}
                </span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
                {/* Chat subscriptions */}
                {chatSubs.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">
                    {lang === 'ar' ? 'لا توجد محادثات مرتبطة.' : 'No linked chats.'}
                  </p>
                )}

                {chatSubs.map(sub => {
                  const mapFilter = getDraftValue(sub.id, 'mapping_filter', parseFilter(sub.mapping_filter))
                  const dirty = isDirty(sub.id)

                  return (
                    <div key={sub.id} className={cn(
                      'rounded-lg border bg-secondary/5 p-3 space-y-2 transition-colors',
                      dirty ? 'border-border bg-muted/50' : 'border-border'
                    )}>
                      {/* Chat header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-bold text-foreground">
                            {sub.chat_label || `Chat #${sub.chat_id.slice(-4)}`}
                          </p>
                          <span className="text-[10px] font-mono text-muted-foreground" dir="ltr">
                            ****{String(sub.chat_id).slice(-4)}
                          </span>
                          {dirty && (
                            <span className="text-[10px] font-bold text-foreground">
                              • {lang === 'ar' ? 'تعديلات غير محفوظة' : 'unsaved'}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleTest(sub.id)}
                            disabled={testingSub === sub.id}
                            title={lang === 'ar' ? 'رسالة تجريبية' : 'Test message'}
                            className="h-7 w-7 p-0"
                          >
                            {testingSub === sub.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteSub(sub.id)}
                            disabled={deletingSub === sub.id}
                            title={lang === 'ar' ? 'حذف' : 'Delete'}
                            className="h-7 w-7 p-0 text-destructive"
                          >
                            {deletingSub === sub.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                        </div>
                      </div>

                      {/* Language */}
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground">
                          {lang === 'ar' ? 'لغة الرسائل' : 'Message language'}
                        </p>
                        <DropdownSingleSelect
                          value={getDraftValue(sub.id, 'language', sub.language as 'ar' | 'en')}
                          onChange={(v) => setDraftField(sub.id, { language: v })}
                          options={[
                            { id: 'ar', label: 'العربية' },
                            { id: 'en', label: 'English' },
                          ]}
                        />
                      </div>

                      {/* Notify mode */}
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground">
                          {lang === 'ar' ? 'نوع الإشعارات' : 'Notify on'}
                        </p>
                        <DropdownSingleSelect
                          value={getDraftValue(
                            sub.id,
                            'notify_mode',
                            sub.notify_mode as 'success' | 'failure' | 'both'
                          )}
                          onChange={(v) => setDraftField(sub.id, { notify_mode: v })}
                          options={MODE_OPTIONS.map(o => ({
                            id: o.id,
                            label: lang === 'ar' ? o.ar : o.en,
                          }))}
                        />
                      </div>

                      {/* Enabled toggle */}
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={getDraftValue(sub.id, 'enabled', sub.enabled)}
                          onChange={(e) => setDraftField(sub.id, { enabled: e.target.checked })}
                          className="rounded border-border"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {lang === 'ar' ? 'الإشعارات مفعّلة' : 'Notifications enabled'}
                        </span>
                      </label>

                      {/* Mapping filter — multi-select dropdown */}
                      {mappings.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">
                            {lang === 'ar' ? 'تصفية حسب القواعد' : 'Filter by mappings'}
                          </p>
                          <DropdownMultiSelect
                            selected={mapFilter}
                            onChange={(next) => setDraftField(sub.id, { mapping_filter: next })}
                            options={mappings.map(m => ({ id: m.id, label: m.name }))}
                            placeholder={lang === 'ar' ? 'كل القواعد' : 'All mappings'}
                          />
                        </div>
                      )}

                      {/* Save / Cancel — visible only when there are pending edits */}
                      {dirty && (
                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCancelSub(sub.id)}
                            disabled={savingSub === sub.id}
                            className="h-7 text-[11px]"
                          >
                            <X className="h-3 w-3" />
                            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => handleSaveSub(sub.id)}
                            disabled={savingSub === sub.id}
                            className="h-7 bg-foreground text-background font-bold text-[11px]"
                          >
                            {savingSub === sub.id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Save className="h-3 w-3" />}
                            {lang === 'ar' ? 'حفظ التعديلات' : 'Save changes'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Link chat form */}
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-bold text-foreground mb-2">
                    {lang === 'ar' ? 'ربط محادثة جديدة' : 'Link a new chat'}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={linkingBotId === bot.id ? linkLabel : ''}
                      onChange={(e) => { setLinkingBotId(bot.id); setLinkLabel(e.target.value) }}
                      onFocus={() => setLinkingBotId(bot.id)}
                      placeholder={lang === 'ar' ? 'تسمية المحادثة' : 'Chat label'}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-foreground"
                    />
                    <Button
                      onClick={() => handleGenerateLink(bot.id)}
                      disabled={linking || !linkLabel.trim() || linkingBotId !== bot.id}
                      size="sm"
                      className="bg-foreground text-background font-bold"
                    >
                      {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (lang === 'ar' ? 'إنشاء كود' : 'Generate')}
                    </Button>
                  </div>

                  {/* Show code result */}
                  {linkResult && linkingBotId === bot.id && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3 space-y-2">
                      <p className="text-[11px] font-bold text-foreground">
                        {lang === 'ar' ? 'كود الربط (صالح 10 دقائق):' : 'Link code (10 min):'}
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded bg-secondary px-3 py-2 text-sm font-mono font-bold tracking-widest text-center" dir="ltr">
                          /start {linkResult.code}
                        </code>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => copyCode(`/start ${linkResult.code}`)}>
                          {copyHint === `/start ${linkResult.code}` ? <CheckCircle2 className="h-4 w-4 text-foreground" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      {linkResult.botLink && (
                        <a href={linkResult.botLink} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-[11px] font-bold text-foreground hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" />
                          {lang === 'ar' ? 'افتح البوت' : 'Open bot'}
                        </a>
                      )}
                      <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                        {lang === 'ar'
                          ? 'افتح البوت وأرسل له الكود فقط (يمكنك أيضاً استخدام /start CODE).'
                          : 'Open the bot and just send it the code (you can also use /start CODE).'}
                      </p>
                      {activePolling && (
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {lang === 'ar' ? 'في انتظار التأكيد في تيليجرام...' : 'Waiting for Telegram confirmation...'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Delete bot */}
                <div className="border-t border-border pt-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteBot(bot.id)}
                    disabled={deletingBot === bot.id}
                    className="text-destructive text-[10px]"
                  >
                    {deletingBot === bot.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    {lang === 'ar' ? 'حذف البوت' : 'Delete bot'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      <ConfirmDialog
        open={!!deleteSubTarget}
        onOpenChange={(open) => { if (!open) setDeleteSubTarget(null) }}
        title={lang === 'ar' ? 'حذف المحادثة' : 'Delete Chat'}
        description={lang === 'ar' ? 'هل أنت متأكد من حذف هذه المحادثة؟' : 'Are you sure you want to delete this chat?'}
        onConfirm={handleDeleteSubConfirm}
      />

      <ConfirmDialog
        open={!!deleteBotTarget}
        onOpenChange={(open) => { if (!open) setDeleteBotTarget(null) }}
        title={lang === 'ar' ? 'حذف البوت' : 'Delete Bot'}
        description={lang === 'ar' ? 'هل أنت متأكد من حذف هذا البوت وكل محادثاته؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you sure you want to delete this bot and all its chats? This action cannot be undone.'}
        onConfirm={handleDeleteBotConfirm}
      />
    </div>
  )
}
