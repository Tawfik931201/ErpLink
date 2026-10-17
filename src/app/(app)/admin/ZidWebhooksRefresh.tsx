'use client'

import { useState } from 'react'

interface StoreReport {
  merchantId: string
  storeId: string | null
  removed: number
  registered: number
  failed: number
  listFailed: boolean
  status: 'refreshed' | 'failed'
  error?: string
}

interface RefreshResponse {
  ok?: boolean
  credential?: string
  error?: string
  stores?: StoreReport[]
}

/**
 * One-shot migration control: Zid stores the Basic credential on the webhook
 * row, so an existing store only starts authenticating after its webhooks are
 * deleted and re-created. Safe to run again — it is idempotent per store.
 */
export function ZidWebhooksRefresh({ isAr }: { isAr: boolean }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RefreshResponse | null>(null)

  async function run() {
    setRunning(true)
    setResult(null)
    try {
      const response = await fetch('/api/admin/zid-webhooks/refresh', { method: 'POST' })
      const body = (await response.json().catch(() => ({}))) as RefreshResponse
      if (!response.ok && !body.stores) body.error = body.error || `HTTP ${response.status}`
      setResult(body)
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : 'Network error' })
    } finally {
      setRunning(false)
    }
  }

  const stores = result?.stores ?? []

  return (
    <div className="border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {isAr ? 'ويب هوك زد' : 'Zid webhooks'}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
          {isAr
            ? 'يعيد إنشاء ويب هوك زد لكل المتاجر مع مصادقة Basic. نفّذها مرة واحدة بعد نشر تحديث المصادقة، ثم تابع عدّاد "Unauthenticated delivery" في سجل الخادم حتى يتوقف.'
            : 'Re-creates every linked store’s Zid webhooks with Basic Auth. Run once after deploying the auth change, then watch the "Unauthenticated delivery" counter in the server log until it stops.'}
        </p>
      </div>

      <button
        type="button"
        onClick={run}
        disabled={running}
        className="border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
      >
        {running
          ? isAr
            ? 'جارٍ التنفيذ…'
            : 'Running…'
          : isAr
            ? 'إعادة تسجيل الويب هوك'
            : 'Re-register webhooks'}
      </button>

      {result && (
        <div className="space-y-1.5 text-[11px]">
          {result.error ? (
            <p className="text-red-600">{result.error}</p>
          ) : (
            <>
              <p className={result.ok ? 'text-emerald-600' : 'text-amber-600'}>
                {result.ok
                  ? isAr
                    ? 'تمت إعادة التسجيل لكل المتاجر.'
                    : 'All stores refreshed.'
                  : isAr
                    ? 'اكتملت العملية مع وجود متاجر فاشلة — راجع التفاصيل.'
                    : 'Finished with failures — see details.'}
              </p>
              <ul className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                {stores.map((store) => (
                  <li key={store.merchantId}>
                    {store.storeId ?? store.merchantId}: {store.status} —{' '}
                    {isAr ? 'محذوف' : 'removed'} {store.removed}, {isAr ? 'مُنشأ' : 'registered'}{' '}
                    {store.registered}
                    {store.failed > 0 ? `, ${isAr ? 'فشل' : 'failed'} ${store.failed}` : ''}
                    {store.listFailed ? ` (${isAr ? 'تعذّر الجرد' : 'list failed'})` : ''}
                    {store.error ? ` — ${store.error}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}