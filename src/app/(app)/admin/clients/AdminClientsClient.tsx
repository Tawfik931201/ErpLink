'use client'

import { Eye, Search } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { AdminClientRow } from '@/app/actions/subscription-actions'
import PaginationControls from '@/components/PaginationControls'
import { cn } from '@/lib/utils'

interface Props {
  rows: AdminClientRow[]
  lang: string
}

type Filter = 'all' | 'active' | 'expired' | 'none'

export default function AdminClientsClient({ rows, lang }: Props) {
  const isAr = lang === 'ar'
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const activeCount = rows.filter((r) => r.active_sub && !r.active_sub.isExpired).length
  const expiredCount = rows.filter((r) => r.active_sub && r.active_sub.isExpired).length
  const noneCount = rows.filter((r) => !r.active_sub).length
  const totalPaid = rows.reduce((s, r) => s + Number(r.total_paid), 0)

  const list = rows.filter((r) => {
    if (filter === 'active' && !(r.active_sub && !r.active_sub.isExpired)) return false
    if (filter === 'expired' && !(r.active_sub && r.active_sub.isExpired)) return false
    if (filter === 'none' && r.active_sub) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      r.name?.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      (r.phone ?? '').toLowerCase().includes(q) ||
      r.workspaces.some(
        (w) => w.name.toLowerCase().includes(q) || (w.subscription_number ?? '').toLowerCase().includes(q),
      )
    )
  })

  const PAGE_SIZE = 25
  useEffect(() => {
    setPage(1)
  }, [query, filter])
  const pagedList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const formatDate = (d: string | null | undefined) => {
    if (!d) return '—'
    try {
      return new Date(`${d}T00:00:00Z`).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return d
    }
  }

  const fmtMoney = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const statusInfo = (r: AdminClientRow) => {
    if (!r.active_sub) {
      return {
        text: isAr ? 'بدون اشتراك' : 'No subscription',
        cls: 'text-muted-foreground',
      }
    }
    if (r.active_sub.isExpired) {
      return { text: isAr ? 'منتهٍ' : 'Expired', cls: 'text-red-600' }
    }
    if (r.active_sub.daysRemaining <= 7) {
      return { text: isAr ? `ينتهي بعد ${r.active_sub.daysRemaining} يوم` : `Ends in ${r.active_sub.daysRemaining}d`, cls: 'text-amber-600' }
    }
    return { text: isAr ? 'نشط' : 'Active', cls: 'text-emerald-600' }
  }

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: isAr ? 'الكل' : 'All', count: rows.length },
    { key: 'active', label: isAr ? 'نشط' : 'Active', count: activeCount },
    { key: 'expired', label: isAr ? 'منتهي' : 'Expired', count: expiredCount },
    { key: 'none', label: isAr ? 'بدون اشتراك' : 'No subscription', count: noneCount },
  ]

  return (
    <div className="max-w-6xl mx-auto space-y-4" dir={dir}>
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          {isAr ? 'العملاء' : 'Clients'}
        </h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
          {isAr
            ? 'جميع عملاء المنصة — النشطون، المنتهية اشتراكاتهم، ومن لم يدفعوا بعد. اضغط على عرض كشف الحساب لتفاصيل كل الاشتراكات.'
            : 'All platform clients — active, expired, and unpaid. Click view statement for full subscription history.'}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border border-border bg-card p-4 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'إجمالي العملاء' : 'Total clients'}</p>
          <p className="text-xl font-bold font-mono tracking-tight text-foreground">{rows.length}</p>
        </div>
        <div className="border border-border bg-card p-4 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'نشط' : 'Active'}</p>
          <p className="text-xl font-bold font-mono tracking-tight text-emerald-600">{activeCount}</p>
        </div>
        <div className="border border-border bg-card p-4 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'منتهي / بدون اشتراك' : 'Expired / No sub.'}</p>
          <p className="text-xl font-bold font-mono tracking-tight text-red-600">{expiredCount + noneCount}</p>
        </div>
        <div className="border border-border bg-card p-4 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isAr ? 'إجمالي المدفوعات' : 'Total paid'}</p>
          <p className="text-xl font-bold font-mono tracking-tight text-foreground">{fmtMoney(totalPaid)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 bg-muted/40 rounded border border-border/50 w-fit">
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
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className={cn('absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground', isAr ? 'right-3' : 'left-3')} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAr ? 'البحث بالاسم، البريد، المساحة أو رقم الاشتراك...' : 'Search by name, email, workspace or sub #...'}
            className={cn(
              'w-full h-8 rounded border border-border bg-background text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
              isAr ? 'pl-3 pr-9' : 'pl-9 pr-3',
            )}
          />
        </div>
      </div>

      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground">{isAr ? 'سجل العملاء' : 'Clients List'}</span>
          <span className="text-[11px] text-muted-foreground">{list.length}</span>
        </div>

        {list.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs text-muted-foreground">
            <Eye className="h-5 w-5 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد نتائج مطابقة' : 'No matching clients'}
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'العميل' : 'Client'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الجوال' : 'Phone'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'مساحة العمل' : 'Workspace'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'بداية آخر اشتراك' : 'Last Sub. Start'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'نهاية الاشتراك' : 'End Date'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'إجمالي المدفوع' : 'Total Paid'}</th>
                  <th className="px-3 py-2 text-end font-medium">{isAr ? 'الإجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                {pagedList.map((r) => {
                  const st = statusInfo(r)
                  return (
                    <tr key={r.user_id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{r.name || '—'}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{r.email}</p>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap" dir="ltr">
                        {r.phone || '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.workspaces.map((ws) => (
                          <div key={ws.id} className="flex items-center gap-1.5">
                            <span className="font-medium text-foreground">{ws.name}</span>
                            {ws.subscription_number && (
                              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                {ws.subscription_number}
                              </span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.active_sub ? formatDate(r.active_sub.start_date) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {r.active_sub ? formatDate(r.active_sub.end_date) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('font-semibold', st.cls)}>{st.text}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-foreground">{fmtMoney(r.total_paid)}</td>
                      <td className="px-3 py-2.5 text-end">
                        <Link
                          href={`/admin/clients/${r.user_id}`}
                          className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors whitespace-nowrap"
                        >
                          <Eye className="h-3 w-3" />
                          {isAr ? 'عرض كشف الحساب' : 'View Statement'}
                        </Link>
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
