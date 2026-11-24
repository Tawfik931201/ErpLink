'use client'

import { useCallback, useEffect, useState } from 'react'

interface SelfTestStep {
  name: string
  passed: boolean
  detail: string
  durationMs: number
}

interface SelfTestReport {
  success?: boolean
  runId?: string
  totalMs?: number
  steps?: SelfTestStep[]
  notes?: string[]
  error?: string
}

/**
 * الفحص الذاتي للمسار — أهم أداة قبل أول عميل حقيقي.
 *
 * لا يوجد عملاء الآن، فكل عيب في الاستقبال أو الطابور أو التليجرام يبقى
 * مخفياً حتى أول موسم. هذا الفحص **يشغّل المسار بالكود الحقيقي** على بيانات
 * وهمية، ويعرض تقريراً خطوة بخطوة، وينظّف كل ما أنشأه.
 *
 * ⚠️ شغّله على مساحة **إدارية** — لا على مساحة عميل.
 */
export function PipelineSelfTest({ isAr }: { isAr: boolean }) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([])
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<SelfTestReport | null>(null)

  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/workspaces', { cache: 'no-store' })
      const body = (await res.json().catch(() => ({}))) as {
        workspaces?: Array<{ id: string; name: string }>
      }
      if (body.workspaces) setWorkspaces(body.workspaces)
    } catch {
      // غير حرج — يكفي لصق المعرّف يدوياً.
    }
  }, [])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  async function run() {
    if (!workspaceId) return
    setRunning(true)
    setReport(null)
    try {
      const res = await fetch('/api/admin/pipeline-selftest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, confirm: true }),
      })
      setReport((await res.json().catch(() => ({}))) as SelfTestReport)
    } catch (error) {
      setReport({ error: error instanceof Error ? error.message : 'Network error' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          {isAr ? 'الفحص الذاتي للمسار' : 'Pipeline self-test'}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
          {isAr
            ? 'يشغّل مسار الويب هوك كاملاً (بوابة ⇒ حفظ ⇒ طابور ⇒ تليجرام) على بيانات وهمية، ثم ينظّف كل ما أنشأه. شغّله على مساحة إدارية — لا على مساحة عميل. هذا هو ما يثبت أن كل شيء يعمل قبل أول عميل حقيقي.'
            : 'Runs the whole webhook path (gate ⇒ durable write ⇒ queue ⇒ Telegram) against dummy data, then cleans up everything it created. Run it on an admin workspace, never a client one.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className="border border-border bg-background px-2 py-1.5 text-[11px] text-foreground w-full sm:w-auto max-w-full"
        >
          <option value="">{isAr ? '— اختر مساحة إدارية —' : '— pick an admin workspace —'}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          placeholder="workspace id"
          dir="ltr"
          className="border border-border bg-background px-2 py-1.5 text-[11px] font-mono text-foreground w-full sm:w-auto max-w-full"
        />
        <button
          type="button"
          onClick={run}
          disabled={running || !workspaceId}
          className="border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50 w-full sm:w-auto"
        >
          {running ? (isAr ? 'جارٍ…' : 'Running…') : isAr ? 'شغّل الفحص' : 'Run the test'}
        </button>
      </div>

      {report && (
        <div className="space-y-1 text-[11px]">
          {report.error ? (
            <p className="text-red-600">{report.error}</p>
          ) : (
            <>
              <p className={report.success ? 'text-emerald-600' : 'text-amber-600'}>
                {report.success
                  ? isAr
                    ? 'كل الخطوات نجحت.'
                    : 'Every step passed.'
                  : isAr
                    ? 'هناك خطوة فاشلة — التفاصيل بالأسفل.'
                    : 'A step failed — see below.'}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  {report.runId} · {report.totalMs}ms
                </span>
              </p>
              <ul className="space-y-0.5 font-mono text-[10px]">
                {(report.steps ?? []).map((s) => (
                  <li key={s.name} className="flex items-baseline justify-between gap-2">
                    <span className={s.passed ? 'text-foreground' : 'text-red-600'}>
                      {s.passed ? '√' : '×'} {s.name}
                    </span>
                    <span className="text-muted-foreground">
                      {s.detail} ({s.durationMs}ms)
                    </span>
                  </li>
                ))}
              </ul>
              {(report.notes ?? []).map((n) => (
                <p key={n} className="text-amber-600">
                  {n}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
