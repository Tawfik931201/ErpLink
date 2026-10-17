'use client'

import { useCallback, useEffect, useState } from 'react'

interface CounterRow {
  platform: string
  count: number
  updated_at: string
}

interface LegacyStatus {
  ok?: boolean
  legacyCounters?: CounterRow[]
  orphans?: number
  error?: string
}

interface ReplayResult {
  replayed?: number
  duplicate?: number
  unlinked?: number
  skipped?: number
  failed?: number
  scanned?: number
  error?: string
}

const PLATFORM_LABELS: Record<string, { ar: string; en: string }> = {
  odoo: { ar: 'أودو', en: 'Odoo' },
  zid: { ar: 'زد', en: 'Zid' },
  salla: { ar: 'سلة', en: 'Salla' },
  shopify: { ar: 'شوبيفاي', en: 'Shopify' },
}

/**
 * Webhook migration watch: durable legacy-delivery counters, the orphan
 * receipt count, and the two admin actions that close the migration
 *
 * - "Replay orphans" re-enqueues receipts saved while a store was unlinked
 *   (uninstall/sentinel events are never replayed, by design).
 * - "Reset counters" zeroes the durable legacy counters so "hits zero"
 *   becomes a trustworthy silence signal after the refresh routes ran.
 */
export function WebhookOps({ isAr }: { isAr: boolean }) {
  const [status, setStatus] = useState<LegacyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<'replay' | 'reset' | null>(null)
  const [response, setResponse] = useState<ReplayResult | ResetResult | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/webhook-legacy-status', { cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as LegacyStatus
      if (!res.ok && !body.error) body.error = `HTTP ${res.status}`
      setStatus(body)
    } catch (error) {
      setStatus({ error: error instanceof Error ? error.message : 'Network error' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function replay() {
    setRunning('replay')
    setConfirmReset(false)
    try {
      const res = await fetch('/api/admin/webhook-orphans/replay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 25 }),
      })
      setResponse((await res.json().catch(() => ({}))) as ReplayResult)
    } catch (error) {
      setResponse({ error: error instanceof Error ? error.message : 'Network error' })
    } finally {
      setRunning(null)
      void refresh()
    }
  }

  async function resetCounter(platform: string) {
    setRunning('reset')
    try {
      const res = await fetch('/api/admin/webhook-legacy-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(platform === 'all' ? {} : { platform }),
      })
      setResponse(
        (await res.json().catch(() => ({}))) as { ok?: boolean; reset?: string; error?: string }
      )
    } catch (error) {
      setResponse({ error: error instanceof Error ? error.message : 'Network error' })
    } finally {
      setRunning(null)
      setConfirmReset(false)
      void refresh()
    }
  }

  const counters = status?.legacyCounters ?? []

  return (
    <div className="border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {isAr ? 'مراقبة الويب هوك (هجرة المصادقة)' : 'Webhook migration watch'}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
          {isAr
            ? 'عدّادات التسليمات غير المصادقة (دائمة في DB)، وعدد الأيتام المنتظرين الاسترداد اليدوي. بعد تشغيل مسارات refresh وتصفير العدادات، بقاء العدّاد صفراً في فترة هدوء يعني أن قلب STRICT_WEBHOOK_AUTH آمن.'
            : 'Durable counters of unauthenticated (legacy) deliveries, plus the orphan receipts awaiting manual recovery. After running the refresh routes and a reset, a counter staying at zero through a quiet window means flipping STRICT_WEBHOOK_AUTH is safe.'}
        </p>
      </div>

      {loading && !counters.length ? (
        <p className="text-[11px] text-muted-foreground">{isAr ? 'جارٍ التحديث…' : 'Loading…'}</p>
      ) : status?.error ? (
        <p className="text-[11px] text-red-600">{status.error}</p>
      ) : (
        <ul className="space-y-1 text-[11px] font-mono">
          {counters.map((c) => {
            const label = PLATFORM_LABELS[c.platform]
            const dead = c.count === 0
            return (
              <li key={c.platform} className="flex items-baseline justify-between gap-2">
                <span className={dead ? 'text-emerald-600' : 'text-amber-600'}>
                  {label ? (isAr ? label.ar : label.en) : c.platform}
                </span>
                <span className="text-muted-foreground">
                  legacy:{' '}
                  <span className="text-foreground">{c.count}</span>
                  {' — '}
                  {dead
                    ? isAr
                      ? 'هادئ — آمن'
                      : 'quiet — safe'
                    : isAr
                      ? 'لا يزال يصل — شغّل refresh ثم راقب'
                      : 'still arriving — run refresh, keep watching'}
                </span>
              </li>
            )
          })}
          {!counters.length && (
            <li className="text-emerald-600">{isAr ? 'لا عدّادات — لا تسليمات legacy وصلت.' : 'No counters — zero legacy deliveries ever.'}</li>
          )}
          <li className="flex items-baseline justify-between gap-2 border-t border-border pt-1">
            <span>{isAr ? 'أيتام بندري' : 'Orphan receipts'}</span>
            <span className={(status?.orphans ?? 0) === 0 ? 'text-emerald-600' : 'text-amber-600'}>
              {status?.orphans ?? 0}
            </span>
          </li>
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={replay}
          disabled={running !== null}
          className="border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {running === 'replay'
            ? isAr
              ? 'جارٍ التنفيذ…'
              : 'Running…'
            : isAr
              ? 'إعادة دفع الأيتام'
              : 'Replay orphans'}
        </button>
        <button
          type="button"
          onClick={() => setConfirmReset((v) => !v)}
          disabled={running !== null}
          className="border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
        >
          {isAr ? 'تصفير العدادات…' : 'Reset counters…'}
        </button>
        <button
          type="button"
          onClick={refresh}
          disabled={running !== null}
          className="border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          {isAr ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {confirmReset && (
        <div className="border border-border p-2 space-y-1.5">
          <p className="text-[11px] text-muted-foreground">
            {isAr
              ? 'تصفير يجعل الإشارة الصفر صادقاً بعد refresh. لا تؤثر على التسليم الأصلاً.'
              : 'Reset makes "zero" a truthful silence signal after refresh. It never touches ingestion.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PLATFORM_LABELS) as string[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => resetCounter(p)}
                disabled={running !== null}
                className="border border-border px-2 py-1 text-[10px] font-medium hover:bg-accent disabled:opacity-50"
              >
                {isAr ? PLATFORM_LABELS[p].ar : PLATFORM_LABELS[p].en}
              </button>
            ))}
            <button
              type="button"
              onClick={() => resetCounter('all')}
              disabled={running !== null}
              className="border border-border px-2 py-1 text-[10px] font-medium hover:bg-accent disabled:opacity-50"
            >
              {isAr ? 'الكل' : 'All'}
            </button>
          </div>
        </div>
      )}

      {response && (
        <div className="text-[11px] space-y-0.5">
          {response.error ? (
            <p className="text-red-600">{response.error}</p>
          ) : (
            <p className="text-emerald-600">
              {isAr ? 'تم.' : 'Done.'}
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                {JSON.stringify(response)}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface ResetResult {
  ok?: boolean
  reset?: string
  error?: string
}
