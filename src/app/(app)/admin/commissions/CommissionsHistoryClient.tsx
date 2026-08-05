'use client'

import { AlertCircle, Receipt } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { CommissionHistoryRow } from '@/app/actions/partner-admin'
import PaginationControls from '@/components/PaginationControls'
import { cn } from '@/lib/utils'

interface Props {
  rows: CommissionHistoryRow[]
  error: string | null
  lang: string
}

export default function CommissionsHistoryClient({ rows, error, lang }: Props) {
  const isAr = lang === 'ar'
  const [filter, setFilter] = useState<'all' | 'approved' | 'void' | 'paid'>('all')
  const [page, setPage] = useState(1)

  const list = rows.filter((r) => {
    if (filter === 'approved') return r.status === 'approved' && !r.paid_in_payout_id
    if (filter === 'paid') return !!r.paid_in_payout_id
    if (filter === 'void') return r.status === 'void'
    return true
  })

  const PAGE_SIZE = 20
  useEffect(() => {
    setPage(1)
  }, [filter])
  const pagedList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const fmtMoney = (n: number | string) =>
    `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try {
      return new Date(d).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return d
    }
  }

  const statusInfo = (r: CommissionHistoryRow) => {
    if (r.status === 'void') {
      return { text: isAr ? 'ملغاة' : 'Void', cls: 'text-red-600' }
    }
    if (r.paid_in_payout_id) {
      return { text: isAr ? 'مصروفة' : 'Paid', cls: 'text-emerald-600' }
    }
    return { text: isAr ? 'معتمدة (غير مصروفة)' : 'Approved', cls: 'text-foreground' }
  }

  const filters: { key: typeof filter; label: string; count: number }[] = [
    { key: 'all', label: isAr ? 'الكل' : 'All', count: rows.length },
    {
      key: 'approved',
      label: isAr ? 'غير مصروفة' : 'Unpaid',
      count: rows.filter((r) => r.status === 'approved' && !r.paid_in_payout_id).length,
    },
    { key: 'paid', label: isAr ? 'مصروفة' : 'Paid', count: rows.filter((r) => !!r.paid_in_payout_id).length },
    { key: 'void', label: isAr ? 'ملغاة' : 'Void', count: rows.filter((r) => r.status === 'void').length },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 p-1 bg-muted/40 rounded border border-border/50 w-fit">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'px-3 py-1.5 rounded text-[11px] font-medium transition-colors',
              filter === f.key ? 'bg-card text-foreground border border-border' : 'text-muted-foreground',
            )}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-3 border border-border bg-card p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-xs text-foreground">{isAr ? 'خطأ في تحميل البيانات' : 'Failed to load data'}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground">{isAr ? 'سجل العمولات' : 'Commissions History'}</span>
          <span className="text-[11px] text-muted-foreground">{list.length}</span>
        </div>

        {list.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs text-muted-foreground">
            <Receipt className="h-5 w-5 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد عمولات' : 'No commissions found'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'الأفلييت' : 'Affiliate'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'العميل / المساحة' : 'Client / Workspace'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'المبلغ الإجمالي' : 'Gross'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'النسبة' : 'Rate'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'العمولة' : 'Commission'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'التاريخ' : 'Date'}</th>
                    <th className="px-3 py-2 text-start font-medium">{isAr ? 'المصدر' : 'Source'}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedList.map((r) => {
                    const st = statusInfo(r)
                    return (
                      <tr key={r.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                        <td className="px-3 py-2.5">
                          {r.partner_name ? (
                            <Link
                              href={`/admin/partners/${r.partner_id}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {r.partner_name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-foreground">{r.client_email || '—'}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{r.workspace_name || '—'}</p>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-muted-foreground">{fmtMoney(r.gross_amount)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{Math.round(Number(r.commission_rate) * 100)}%</td>
                        <td className="px-3 py-2.5 font-mono font-semibold text-foreground">{fmtMoney(r.commission_amount)}</td>
                        <td className="px-3 py-2.5">
                          <span className={cn('font-semibold whitespace-nowrap', st.cls)}>{st.text}</span>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(r.created_at)}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {r.source === 'manual'
                            ? isAr ? 'يدوي' : 'Manual'
                            : isAr ? 'تلقائي' : 'Auto'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <PaginationControls
              page={page}
              pageSize={PAGE_SIZE}
              total={list.length}
              onPageChange={setPage}
              isAr={isAr}
            />
          </>
        )}
      </div>
    </div>
  )
}
