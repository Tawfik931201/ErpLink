'use client'

import { useEffect, useState } from 'react'

import {
  getDeadItems,
  getOrphanItems,
  getQueueItems,
  getQueueOverview,
  replayAllDeadItems,
  replayDeadItem,
  replayOrphanItems,
  retryFrozenItems,
  sendNowWorkspace,
  type QueueRow,
} from '@/app/actions/queue-dashboard'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Tab = 'pending' | 'frozen' | 'orphans' | 'dead'

const PLATFORM_AR: Record<string, string> = { zid: 'زد', salla: 'سلة', shopify: 'شوبيفاي', odoo: 'أودوو' }

function formatAge(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—'
  if (sec < 60) return `منذ ${sec} ث`
  const m = Math.round(sec / 60)
  if (m < 60) return `منذ ${m} د`
  return `منذ ${Math.round(m / 60)} س`
}

export default function QueueClient() {
  const { lang } = useLanguage()
  const ar = lang === 'ar'
  const [overview, setOverview] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('pending')
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [replaying, setReplaying] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  async function load() {
    setLoading(true)
    setNotice('')
    const [ov, items] = await Promise.all([getQueueOverview(), loadTab(tab, 0)])
    if (ov.success) setOverview(ov.overview)
    else setNotice(ov.error || '')
    setRows(items.rows)
    setTotal(items.total)
    setLoading(false)
  }

  async function loadTab(t: Tab, offset: number): Promise<{ rows: any[]; total: number }> {
    if (t === 'pending' || t === 'frozen') {
      const res = await getQueueItems({ kind: t, limit: 25, offset })
      if (!res.success) {
        setNotice(res.error || '')
        return { rows: [], total: 0 }
      }
      return { rows: res.rows || [], total: res.totalCount || 0 }
    }
    if (t === 'orphans') {
      const res = await getOrphanItems(25)
      if (!res.success) {
        setNotice(res.error || '')
        return { rows: [], total: 0 }
      }
      return { rows: res.rows || [], total: res.totalCount || 0 }
    }
    const res = await getDeadItems({ limit: 25, offset })
    if (!res.success) {
      setNotice(res.error || '')
      return { rows: [], total: 0 }
    }
    return { rows: res.rows || [], total: res.totalCount || 0 }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function switchTab(t: Tab) {
    setTab(t)
    setLoading(true)
    const items = await loadTab(t, 0)
    setRows(items.rows)
    setTotal(items.total)
    setLoading(false)
  }

  async function handleSendNow() {
    setSending(true)
    setNotice('')
    const res = await sendNowWorkspace()
    setSending(false)
    if (res.success && 'processed' in res) {
      setNotice(
        ar
          ? `تم: عولج ${res.processed} — نجح ${res.succeeded} وأُعيدت جدولة ${res.retried}.`
          : `Done: processed ${res.processed} — ${res.succeeded} succeeded, ${res.retried} rescheduled.`
      )
      load()
    } else {
      setNotice(res.error || '')
    }
  }

  async function handleRetryFrozen() {
    setRetrying(true)
    setNotice('')
    const res = await retryFrozenItems()
    setRetrying(false)
    if (res.success && 'revived' in res) {
      setNotice(ar ? `أُعيد ${res.revived} صفاً مجمداً إلى الطابور.` : `Revived ${res.revived} frozen rows.`)
      load()
    } else {
      setNotice(res.error || '')
    }
  }

  async function handleReplay(id: string) {
    if (!confirm(ar ? 'إعادة إرسال هذا الطلب إلى الطابور؟ استخدمه فقط لطلب غير مسجل في أودوو.' : 'Replay this item? Only for orders not registered in Odoo.')) return
    setReplaying(id)
    const res = await replayDeadItem(id)
    setReplaying(null)
    if (res.success) {
      setNotice(ar ? 'أُعيد الطلب إلى الطابور.' : 'Item replayed to the queue.')
      load()
    } else {
      setNotice(res.error || '')
    }
  }

  /** إعادة تشغيل كل صفوف الأرشيف دفعة واحدة (بدل صفاً صفاً). */
  async function handleReplayAllDead() {
    if (!confirm(ar ? 'إعادة إرسال كل الطلبات في الأرشيف إلى الطابور؟' : 'Replay every dead-lettered item to the queue?')) return
    setReplaying('all')
    const res = await replayAllDeadItems(100)
    setReplaying(null)
    if (res.success) {
      setNotice(ar ? `أُعيد ${res.replayed} طلباً إلى الطابور.` : `Replayed ${res.replayed} items to the queue.`)
      load()
    } else {
      setNotice(res.error || '')
    }
  }

  /** استرجاع الأيتام (وصلت قبل ربط المتجر). */
  async function handleReplayOrphans() {
    setReplaying('orphans')
    const res = await replayOrphanItems()
    setReplaying(null)
    if (res.success) {
      setNotice(ar ? `أُعيد ${res.replayed} حدثاً يتيم إلى الطابور.` : `Replayed ${res.replayed} orphaned events.`)
      load()
    } else {
      setNotice(res.error || '')
    }
  }

  const cards = [
    { key: 'pending', label: ar ? 'معلقة في الطابور' : 'Pending', value: overview?.pending },
    { key: 'frozen', label: ar ? 'مجمدة (تحتاج تدخلاً)' : 'Frozen (needs action)', value: overview?.frozen },
    { key: 'orphans', label: ar ? 'يتيمة (بلا ربط)' : 'Orphaned', value: overview?.orphans },
    { key: 'dead', label: ar ? 'في الأرشيف' : 'Dead-letter', value: overview?.dead },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">
            {ar ? 'طابور الإرسال إلى أودوو' : 'Odoo Send Queue'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {ar
              ? 'كل طلب وصلك من المتجر يظهر هنا حتى يُسجَّل في أودوو — لا شيء يضيع بصمت.'
              : 'Every store order appears here until registered in Odoo — nothing is lost silently.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSendNow} disabled={sending}>
            {sending ? (ar ? 'جارٍ الإرسال…' : 'Sending…') : (ar ? 'إرسال الآن' : 'Send now')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}>
            {ar ? 'تحديث' : 'Refresh'}
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground">
          {notice}
        </div>
      )}

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {cards.map(c => (
          <button
            key={c.key}
            onClick={() => switchTab(c.key as Tab)}
            className={cn(
              'rounded-lg border p-3 text-start transition-colors',
              tab === c.key ? 'border-foreground/30 bg-muted/50' : 'border-border'
            )}
          >
            <p className="text-[11px] text-muted-foreground">{c.label}</p>
            <p className="text-2xl font-bold text-foreground">{c.value ?? '—'}</p>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>
          {ar ? 'أقدم معلق: ' : 'Oldest pending: '}
          <b className="text-foreground">{formatAge(overview?.oldestPendingAgeSec)}</b>
        </span>
        <span>
          {ar ? 'تخطيات الاستلام (24 س): ' : 'Ingress skips (24h): '}
          <b className="text-foreground">{overview?.ingressSkipped24h ?? '—'}</b>
        </span>
        {(overview?.frozen ?? 0) > 0 && (
          <Button size="sm" variant="outline" onClick={handleRetryFrozen} disabled={retrying}>
            {retrying
              ? (ar ? 'جارٍ…' : 'Working…')
              : (ar ? `إعادة تشغيل المجمد (${overview.frozen})` : `Retry frozen (${overview.frozen})`)}
          </Button>
        )}
        {(overview?.orphans ?? 0) > 0 && (
          <Button size="sm" variant="outline" onClick={handleReplayOrphans} disabled={replaying === 'orphans'}>
            {replaying === 'orphans'
              ? (ar ? 'جارٍ…' : 'Working…')
              : (ar ? `استرجاع الأيتام (${overview.orphans})` : `Replay orphans (${overview.orphans})`)}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 text-xs">
        {(['pending', 'frozen', 'orphans', 'dead'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={cn(
              'rounded-full border px-3 py-1',
              tab === t ? 'border-foreground/40 bg-muted font-bold text-foreground' : 'border-border text-muted-foreground'
            )}
          >
            {t === 'pending' ? (ar ? 'معلقة' : 'Pending')
              : t === 'frozen' ? (ar ? 'مجمدة' : 'Frozen')
              : t === 'orphans' ? (ar ? 'يتيمة' : 'Orphans')
              : (ar ? 'الأرشيف' : 'Dead')}
            {' '}({t === 'pending' ? overview?.pending ?? '—' : t === 'frozen' ? overview?.frozen ?? '—' : t === 'orphans' ? overview?.orphans ?? '—' : overview?.dead ?? '—'})
          </button>
        ))}
        <span className="text-muted-foreground">{ar ? `الإجمالي: ${total}` : `Total: ${total}`}</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-start">
              <th className="p-2 text-start">{ar ? 'المنصة' : 'Platform'}</th>
              <th className="p-2 text-start">{ar ? 'الحدث' : 'Event'}</th>
              <th className="p-2 text-start">{ar ? 'الطلب' : 'Order'}</th>
              <th className="p-2 text-start">{ar ? 'المحاولات' : 'Retries'}</th>
              <th className="p-2 text-start">{ar ? 'السبب / الخطأ' : 'Reason / error'}</th>
              <th className="p-2 text-start">{ar ? 'التاريخ' : 'Date'}</th>
              {tab === 'dead' && <th className="p-2 text-start">{ar ? 'إجراء' : 'Action'}</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">{ar ? 'جارٍ التحميل…' : 'Loading…'}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">{ar ? 'لا عناصر — كل شيء مرسل.' : 'Empty — everything is sent.'}</td></tr>
            ) : (
              rows.map((r: any) => {
                const row = r as QueueRow & { received_at?: string; died_at?: string; dedup_key?: string; attempts?: number }
                return (
                  <tr key={row.id} className="border-b border-border/40">
                    <td className="p-2">{PLATFORM_AR[String(row.platform)] ?? row.platform ?? '—'}</td>
                    <td className="p-2 font-mono text-[10px]" dir="ltr">{row.event ?? '—'}</td>
                    <td className="p-2 font-mono" dir="ltr">{row.entity_id ?? '—'}</td>
                    <td className="p-2">{row.retry_count ?? row.attempts ?? '—'}{row.max_retries ? `/${row.max_retries}` : ''}</td>
                    <td className="p-2 max-w-[280px] truncate text-muted-foreground" title={row.error_message ?? ''}>
                      {row.error_message ?? '—'}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {(row.created_at ?? row.received_at ?? row.died_at ?? '').slice(0, 16).replace('T', ' ')}
                    </td>
                    {tab === 'dead' && (
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" onClick={() => handleReplay(row.id)} disabled={replaying === row.id}>
                            {replaying === row.id ? (ar ? 'جارٍ…' : '…') : (ar ? 'إعادة إرسال' : 'Replay')}
                          </Button>
                          {(overview?.dead ?? 0) > 1 && (
                            <Button size="sm" variant="outline" onClick={handleReplayAllDead} disabled={replaying === 'all'}>
                              {replaying === 'all'
                                ? (ar ? 'جارٍ…' : '…')
                                : (ar ? 'إعادة الكل' : 'Replay all')}
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
