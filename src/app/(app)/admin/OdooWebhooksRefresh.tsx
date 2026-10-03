'use client'

import { useState } from 'react'

interface StockReport {
  status: 'refreshed' | 'skipped' | 'failed'
  automationId?: number
  error?: string
}

interface MappingReport {
  mappingId: string
  model: string | null
  status: 'refreshed' | 'failed'
  error?: string
}

interface WorkspaceReport {
  workspaceId: string
  stock: StockReport
  mappings: MappingReport[]
  status: 'refreshed' | 'failed'
}

interface RefreshResponse {
  ok?: boolean
  refreshed?: number
  failed?: number
  error?: string
  workspaces?: WorkspaceReport[]
}

/**
 * One-shot migration control: the destination URL lives in each customer's Odoo
 * database, so an action registered without the derived secret only starts
 * authenticating once it is re-registered. New mappings and stock sync get the
 * secret automatically — this is for the actions that already exist.
 */
export function OdooWebhooksRefresh({ isAr }: { isAr: boolean }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RefreshResponse | null>(null)

  async function run() {
    setRunning(true)
    setResult(null)
    try {
      const response = await fetch('/api/admin/odoo-webhooks/refresh', { method: 'POST' })
      const body = (await response.json().catch(() => ({}))) as RefreshResponse
      if (!response.ok && !body.workspaces) body.error = body.error || `HTTP ${response.status}`
      setResult(body)
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : 'Network error' })
    } finally {
      setRunning(false)
    }
  }

  const workspaces = result?.workspaces ?? []

  return (
    <div className="border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {isAr ? 'ويب هوك أودو' : 'Odoo webhooks'}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
          {isAr
            ? 'يعيد إنشاء الإجراءات الآلية في أودو لكل مساحة عمل مع سر مشتق، فيعود المخزون وتعديلات المنتجات من أودو إلى المتجر. نفّذها مرة واحدة بعد نشر تحديث المصادقة، ثم تابع عدّاد "Unauthenticated delivery" في سجل الخادم حتى يتوقف.'
            : 'Re-creates every workspace’s Odoo Automated Actions with the derived secret, which is what restores stock and record push from Odoo to the stores. Run once after deploying the auth change, then watch the "Unauthenticated delivery" counter in the server log until it stops.'}
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
            ? 'إعادة تسجيل الإجراءات الآلية'
            : 'Re-register automated actions'}
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
                    ? 'تمت إعادة التسجيل لكل مساحات العمل.'
                    : 'All workspaces refreshed.'
                  : isAr
                    ? 'اكتملت العملية مع وجود مساحات فاشلة — راجع التفاصيل.'
                    : 'Finished with failures — see details.'}
              </p>
              <ul className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                {workspaces.map((workspace) => (
                  <li key={workspace.workspaceId}>
                    {workspace.workspaceId.slice(0, 8)}: {workspace.status} —{' '}
                    {isAr ? 'مخزون' : 'stock'} {workspace.stock.status}
                    {workspace.stock.automationId ? ` #${workspace.stock.automationId}` : ''}
                    {workspace.stock.error ? ` (${workspace.stock.error})` : ''},{' '}
                    {isAr ? 'خريطة' : 'mappings'} {workspace.mappings.length}
                    {workspace.mappings.some((m) => m.status === 'failed')
                      ? `, ${isAr ? 'فشل' : 'failed'} ${workspace.mappings.filter((m) => m.status === 'failed').length}`
                      : ''}
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