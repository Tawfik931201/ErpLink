'use client'

import {
  CalendarPlus,
  Loader2,
  AlertCircle,
  Search,
  XCircle,
  ExternalLink,
  MoreHorizontal,
  ChevronDown,
  CheckCircle2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import {
  registerSubscription,
  extendSubscription,
  cancelSubscription,
  searchUsersByEmail,
  type AdminSubscriptionRow,
  type UserPick,
} from '@/app/actions/subscription-actions'
import PaginationControls from '@/components/PaginationControls'
import { cn } from '@/lib/utils'

import { formatMoney, formatSubDate, subscriptionStateMeta } from './subscription-ui'

// --- Filter Components ---
interface FilterSelectProps {
  label: string
  icon?: React.ReactNode
  buttonRef: React.RefObject<HTMLDivElement | null>
  isOpen: boolean
  onToggle: () => void
  triggerText: string
  minWidth?: string
  children: React.ReactNode
}
function FilterSelect({
  label,
  icon,
  buttonRef,
  isOpen,
  onToggle,
  triggerText,
  minWidth = 'min-w-[120px]',
  children,
}: FilterSelectProps) {
  return (
    <div className="flex items-center gap-1.5 relative select-none" ref={buttonRef}>
      {icon}
      <span className="text-[11px] font-bold text-muted-foreground me-1 shrink-0">{label}</span>
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'text-xs bg-muted/60 hover:bg-muted border border-border/70 px-3 py-1.5',
            'focus:outline-none focus:ring-1 focus:ring-primary/30 font-semibold flex items-center gap-2',
            'select-none justify-between text-start transition-colors',
            minWidth
          )}
        >
          <span className="truncate max-w-[150px]">{triggerText}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
        {isOpen && (
          <div className="absolute z-50 mt-1.5 w-56 bg-card border border-border/70 py-1.5 shadow-card animate-in fade-in scale-in duration-150 max-h-60 overflow-y-auto">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
function CheckRow({ checked, onChange, danger = false, children }: { checked: boolean; onChange: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-xs font-medium cursor-pointer text-muted-foreground select-none transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={cn(
          'rounded border-border/70 h-3.5 w-3.5',
          danger ? 'text-destructive focus:ring-destructive/30' : 'text-primary focus:ring-primary/30'
        )}
      />
      <span className="flex items-center gap-1.5 truncate">{children}</span>
    </label>
  )
}

interface Props {
  rows: AdminSubscriptionRow[]
  error: string | null
  lang: 'ar' | 'en'
}

type Modal =
  | { type: 'register' }
  | { type: 'extend'; row: AdminSubscriptionRow }
  | { type: 'cancel'; row: AdminSubscriptionRow }
  | null

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const inputCls =
  'w-full h-8 rounded border border-border bg-background px-3 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

export default function AdminSubscriptionsClient({ rows, error, lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const [modal, setModal] = useState<Modal>(null)
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)

  // Register form state
  const [emailQuery, setEmailQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<UserPick[]>([])
  const [selectedUser, setSelectedUser] = useState<UserPick | null>(null)
  const [workspaceId, setWorkspaceId] = useState('')
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [startDate, setStartDate] = useState(today())
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState('')
  const [cancelExisting, setCancelExisting] = useState(false)
  const [notes, setNotes] = useState('')

  // Extend form state
  const [extMonths, setExtMonths] = useState(1)
  const [extDays, setExtDays] = useState(0)
  const [extAmount, setExtAmount] = useState('')
  const [extNotes, setExtNotes] = useState('')

  const resetRegister = () => {
    setEmailQuery('')
    setResults([])
    setSelectedUser(null)
    setWorkspaceId('')
    setNewWorkspaceName('')
    setClientPhone('')
    setStartDate(today())
    setMonths(1)
    setAmount('')
    setCancelExisting(false)
    setNotes('')
    setModalError(null)
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!emailQuery.trim()) return
    setSearching(true)
    setModalError(null)
    const res = await searchUsersByEmail(emailQuery.trim())
    if (res.success) {
      setResults(res.users)
      if (res.users.length === 0) {
        setModalError(
          isAr
            ? 'لا يوجد عميل بهذا البريد. يجب إنشاء حساب للعميل أولاً.'
            : 'No client found with this email. The client account must exist first.',
        )
      }
    } else {
      setModalError(res.error || 'error')
    }
    setSearching(false)
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedUser) {
      setModalError(isAr ? 'اختر العميل أولاً' : 'Select a client first')
      return
    }
    if (!workspaceId && !newWorkspaceName.trim()) {
      setModalError(isAr ? 'اختر مساحة عمل أو اكتب اسم مساحة جديدة' : 'Choose a workspace or enter a new workspace name')
      return
    }
    setBusy(true)
    setModalError(null)
    const res = await registerSubscription({
      clientEmail: selectedUser.email,
      workspaceId: workspaceId || null,
      newWorkspaceName: newWorkspaceName.trim() || null,
      startDate,
      monthsPaid: months,
      amountPaid: Number(amount) || 0,
      cancelExisting,
      clientPhone: clientPhone.trim() || null,
      notes: notes || null,
    })
    if (res.success) {
      setModal(null)
      router.refresh()
    } else {
      setModalError(res.message || res.error || 'error')
    }
    setBusy(false)
  }

  async function handleExtend(e: React.FormEvent) {
    e.preventDefault()
    if (!modal || modal.type !== 'extend') return
    if (extMonths <= 0 && extDays <= 0) {
      setModalError(isAr ? 'أدخل عدد الشهور أو الأيام' : 'Enter months or days')
      return
    }
    setBusy(true)
    setModalError(null)
    const res = await extendSubscription({
      subscriptionId: modal.row.id,
      months: extMonths > 0 ? extMonths : undefined,
      days: extDays > 0 ? extDays : undefined,
      amountPaid: Number(extAmount) || 0,
      notes: extNotes || null,
    })
    if (res.success) {
      setModal(null)
      router.refresh()
    } else {
      setModalError(res.error || 'error')
    }
    setBusy(false)
  }

  async function handleCancel() {
    if (!modal || modal.type !== 'cancel') return
    setBusy(true)
    setModalError(null)
    const res = await cancelSubscription({ subscriptionId: modal.row.id })
    if (res.success) {
      setModal(null)
      router.refresh()
    } else {
      setModalError(res.error || 'error')
    }
    setBusy(false)
  }

  const formatDate = (d: string) => formatSubDate(d, isAr)

  /** Pre-fills the register modal from a workspace row. */
  const openRegisterFor = (row: AdminSubscriptionRow) => {
    resetRegister()
    setSelectedUser({
      id: row.user_id,
      email: row.client_email || '',
      name: row.client_name,
      active_workspace_id: row.workspace_id,
      workspaces: [{ id: row.workspace_id, name: row.workspace_name || '' }],
    })
    setWorkspaceId(row.workspace_id)
    setModal({ type: 'register' })
  }

  /** Only a real subscription has a record page; "no subscription" has no id. */
  const openRecord = (row: AdminSubscriptionRow) => {
    if (!row.id) {
      openRegisterFor(row)
      return
    }
    router.push(`/admin/subscriptions/${row.id}`)
  }

  const filteredRows = rows.filter((row) => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) return true
    return (
      row.subscription_number?.toLowerCase().includes(query) ||
      row.client_email?.toLowerCase().includes(query) ||
      row.client_name?.toLowerCase().includes(query) ||
      row.workspace_name?.toLowerCase().includes(query)
    )
  })

  const PAGE_SIZE = 25
  useEffect(() => {
    setPage(1)
  }, [searchQuery])
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="max-w-6xl mx-auto space-y-4" dir={dir}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {isAr ? 'الاشتراكات' : 'Subscriptions'}
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
            {isAr
              ? 'تسجيل اشتراكات العملاء يدوياً (عند التحويل) — يتم حفظها في قاعدة البيانات وتظهر للعميل.'
              : 'Manually register client subscriptions (on transfer) — saved to the database and shown to the client.'}
          </p>
        </div>
        <button
          onClick={() => { resetRegister(); setModal({ type: 'register' }) }}
          className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-2.5 h-8 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
        >
          <CalendarPlus className="h-3 w-3" />
          {isAr ? 'تسجيل اشتراك جديد' : 'Register Subscription'}
        </button>
      </div>

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className={cn('absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground', isAr ? 'right-3' : 'left-3')} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={
            isAr
              ? 'البحث برقم الاشتراك، البريد الإلكتروني، اسم العميل أو مساحة العمل...'
              : 'Search by subscription number, email, client name or workspace...'
          }
          className={cn(
            'w-full h-8 rounded border border-border bg-background text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
            isAr ? 'pl-3 pr-9' : 'pl-9 pr-3',
          )}
        />
      </div>

      {error && (
        <div className="flex items-start gap-3 border border-border bg-card p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-xs text-foreground">
              {isAr ? 'خطأ في تحميل البيانات' : 'Failed to load data'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      <div className="border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/60 px-4 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-foreground/70">
            {isAr ? 'سجل الاشتراكات' : 'Subscriptions List'}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{filteredRows.length}</span>
        </div>

        {/* Odoo-style list: a header row and clean records, no cell borders. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-[10px] uppercase tracking-wide text-foreground/70">
                <th className="w-6 px-2 py-2.5" />
                <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                  {isAr ? 'العميل' : 'Client'}
                </th>
                <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                  {isAr ? 'المساحة' : 'Workspace'}
                </th>
                <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                  {isAr ? 'البداية' : 'Start'}
                </th>
                <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                  {isAr ? 'النهاية' : 'End'}
                </th>
                <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                  {isAr ? 'الحالة' : 'Status'}
                </th>
                <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                  {isAr ? 'المبلغ' : 'Amount'}
                </th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-xs text-muted-foreground">
                    <CalendarPlus className="mx-auto mb-2 h-5 w-5 opacity-40" />
                    {isAr ? 'لا توجد نتائج بحث مطابقة' : 'No matching search results'}
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => {
                  const st = subscriptionStateMeta(row, isAr)
                  const hasRecord = Boolean(row.id)

                  return (
                    <tr
                      key={row.id || row.workspace_id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openRecord(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          openRecord(row)
                        }
                      }}
                      className="transition-colors cursor-pointer hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                    >
                      <td className="px-2 py-2.5">
                        <span className={cn('block h-1.5 w-1.5 rounded-full', st.dot)} aria-hidden />
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span className="block max-w-[180px] truncate font-medium text-foreground">
                          {row.client_name || '—'}
                        </span>
                        {row.client_email && (
                          <span
                            dir="ltr"
                            className="mt-0.5 block max-w-[180px] truncate font-mono text-[10px] text-muted-foreground"
                          >
                            {row.client_email}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span className="block max-w-[170px] truncate font-medium text-foreground">
                          {row.workspace_name || '—'}
                        </span>
                        {row.subscription_number && (
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                            {row.subscription_number}
                          </span>
                        )}
                        {row.active_sub_count > 1 && (
                          <span className="mt-0.5 block text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            {isAr
                              ? `+${row.active_sub_count - 1} اشتراك نشط آخر`
                              : `+${row.active_sub_count - 1} more active sub(s)`}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        {row.start_date ? formatSubDate(row.start_date, isAr) : '—'}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        {row.end_date ? formatSubDate(row.end_date, isAr) : '—'}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center border px-2 py-0.5 text-[10px] font-bold',
                            st.pill,
                          )}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap font-mono text-foreground">
                        {row.status !== 'none'
                          ? `${formatMoney(row.amount_paid)} ${row.currency}`
                          : '—'}
                      </td>
                      <td className="px-2 py-2.5 text-end">
                        <RowActions
                          row={row}
                          isAr={isAr}
                          onOpen={() => openRecord(row)}
                          onRegister={() => openRegisterFor(row)}
                          onExtend={() => {
                            // Expired subscriptions can only be extended by days
                            // (the backend refuses months on an expired sub), so
                            // default to 0 months in that case.
                            setExtMonths(row.isExpired ? 0 : 1)
                            setExtDays(0)
                            setExtAmount('')
                            setExtNotes('')
                            setModalError(null)
                            setModal({ type: 'extend', row })
                          }}
                          onCancel={() => {
                            setModalError(null)
                            setModal({ type: 'cancel', row })
                          }}
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredRows.length > 0 && (
          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE}
            total={filteredRows.length}
            onPageChange={setPage}
            isAr={isAr}
          />
        )}
      </div>

      {/* ── Register modal ─────────────────────────────────── */}
      {modal?.type === 'register' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div
            className="bg-card border border-border max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {isAr ? 'تسجيل اشتراك جديد' : 'Register New Subscription'}
            </h3>

            {/* Step 1: pick client */}
            {!selectedUser ? (
              <form onSubmit={handleSearch} className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {isAr ? 'البحث عن العميل بالبريد الإلكتروني' : 'Search client by email'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={emailQuery}
                    onChange={(e) => setEmailQuery(e.target.value)}
                    placeholder={isAr ? 'بريد العميل الإلكتروني' : 'Client email'}
                    required
                    className={inputCls}
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-8 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    {isAr ? 'بحث' : 'Search'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between border border-border bg-muted/30 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{selectedUser.name || selectedUser.email}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{selectedUser.email}</p>
                </div>
                <button
                  onClick={() => { setSelectedUser(null); setResults([]); setWorkspaceId(''); setNewWorkspaceName('') }}
                  className="text-[10px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                >
                  {isAr ? 'تغيير' : 'Change'}
                </button>
              </div>
            )}

            {results.length > 0 && !selectedUser && (
              <div className="space-y-1.5">
                {results.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => { setSelectedUser(u); setResults([]) }}
                    className="w-full text-start border border-border px-3 py-2.5 hover:bg-muted/40 transition-colors"
                  >
                    <p className="text-xs font-medium text-foreground">{u.name || '—'}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{u.email}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: workspace */}
            {selectedUser && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {isAr ? 'جوال العميل (اختياري)' : 'Client phone (optional)'}
                  </label>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder={isAr ? 'مثال: 9665XXXXXXXX' : 'e.g. 9665XXXXXXXX'}
                    className={inputCls}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {isAr ? 'مساحة العمل' : 'Workspace'}
                  </label>
                  <select
                    value={workspaceId}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">{isAr ? '— اختر مساحة موجودة —' : '— Choose existing —'}</option>
                    {selectedUser.workspaces.map((ws) => (
                      <option key={ws.id} value={ws.id}>
                        {ws.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={newWorkspaceName}
                    onChange={(e) => { setNewWorkspaceName(e.target.value); if (e.target.value) setWorkspaceId('') }}
                    placeholder={isAr ? 'أو اكتب اسم مساحة عمل جديدة (تُنشأ تلقائياً)' : 'Or enter a new workspace name (created automatically)'}
                    className={inputCls}
                  />
                  <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
                    <input
                      type="checkbox"
                      checked={cancelExisting}
                      onChange={(e) => setCancelExisting(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span className="text-[11px] text-muted-foreground leading-relaxed">
                      {isAr
                        ? 'إلغاء الاشتراكات النشطة السابقة على هذه المساحة (اتركها فارغة لإضافة الاشتراك الجديد بجانب القديم)'
                        : 'Cancel previous active subscriptions on this workspace (leave unchecked to add the new one alongside the old one)'}
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {isAr ? 'تاريخ البدء (يوم التحويل)' : 'Start date (transfer day)'}
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {isAr ? 'عدد الشهور المدفوعة' : 'Months paid'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={months}
                      onChange={(e) => setMonths(Math.max(1, Number(e.target.value) || 1))}
                      required
                      className={inputCls}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {isAr ? 'المبلغ المدفوع (USD)' : 'Amount paid (USD)'}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className={inputCls}
                    />
                    {Number(amount) === 0 && (
                      <p className="text-[10px] text-amber-600">
                        {isAr
                          ? 'تنبيه: بمبلغ 0 لن تُسجل أي دفعة.'
                          : 'Note: with amount 0, no payment is recorded.'}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {isAr ? 'تاريخ الانتهاء (تلقائي)' : 'End date (auto)'}
                    </label>
                    <input
                      type="date"
                      value={(() => {
                        if (!startDate || !months) return ''
                        const d = new Date(`${startDate}T00:00:00Z`)
                        d.setUTCMonth(d.getUTCMonth() + months)
                        d.setUTCDate(d.getUTCDate() - 1)
                        return d.toISOString().slice(0, 10)
                      })()}
                      disabled
                      className={cn(inputCls, 'bg-muted text-muted-foreground')}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className={cn(inputCls, 'h-auto py-2')}
                    placeholder={isAr ? 'مثال: تحويل بنكي بتاريخ...' : 'e.g. bank transfer on...'}
                  />
                </div>
              </div>
            )}

            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              {selectedUser && (
                <button
                  onClick={handleRegister}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {isAr ? 'حفظ الاشتراك' : 'Save Subscription'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Extend modal ─────────────────────────────────────── */}
      {modal?.type === 'extend' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div
            className="bg-card border border-border max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {isAr ? 'تمديد الاشتراك' : 'Extend Subscription'}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {isAr ? 'ينتهي حالياً في ' : 'Currently ends '}
              <strong className="text-foreground">{formatDate(modal.row.end_date)}</strong>
            </p>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'عدد الشهور' : 'Months'}</label>
                <input
                  type="number"
                  min={0}
                  value={extMonths}
                  onChange={(e) => setExtMonths(Math.max(0, Number(e.target.value) || 0))}
                  className={inputCls}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'أيام إضافية (اختياري)' : 'Extra days (optional)'}</label>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={extDays}
                  onChange={(e) => setExtDays(Math.max(0, Math.min(3650, Number(e.target.value) || 0)))}
                  className={inputCls}
                />
                <p className="text-[10px] text-muted-foreground">
                  {modal.row.isExpired
                    ? isAr
                      ? 'الاشتراك منتهٍ — التمديد بالأيام يبدأ من اليوم، والأيام فقط هنا (الأشهر تتطلب تسجيل اشتراك جديد).'
                      : 'Subscription is expired — days extend from today; only days apply here (months require a new registration).'
                    : isAr
                      ? 'تُضاف الأيام على نهاية المدة الحالية.'
                      : 'Days are added on top of the current end date.'}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'المبلغ المدفوع (USD)' : 'Amount paid (USD)'}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={extAmount}
                  onChange={(e) => setExtAmount(e.target.value)}
                  placeholder="0.00"
                  className={inputCls}
                />
                {Number(extAmount) === 0 && (
                  <p className="text-[10px] text-amber-600">
                    {isAr
                      ? 'تنبيه: بمبلغ 0 لن تُسجل أي دفعة عن فترة التمديد.'
                      : 'Note: with amount 0, no payment is recorded for the extension.'}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">{isAr ? 'ملاحظات' : 'Notes'}</label>
                <textarea
                  value={extNotes}
                  onChange={(e) => setExtNotes(e.target.value)}
                  rows={2}
                  className={cn(inputCls, 'h-auto py-2')}
                />
              </div>
            </div>
            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={handleExtend}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
                {isAr ? 'تمديد' : 'Extend'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel modal ─────────────────────────────────────── */}
      {modal?.type === 'cancel' && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div
            className="bg-card border border-border max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {isAr ? 'إلغاء الاشتراك' : 'Cancel Subscription'}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {isAr
                ? `هل أنت متأكد من إلغاء اشتراك ${modal.row.client_email}؟`
                : `Cancel the subscription of ${modal.row.client_email}?`}
            </p>
            {modalError && (
              <div className="flex items-start gap-2 border border-border bg-card p-2.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive mt-0.5" />
                <span className="text-[11px] text-muted-foreground">{modalError}</span>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModal(null)}
                className="inline-flex items-center rounded border border-border bg-background px-3 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
              >
                {isAr ? 'رجوع' : 'Back'}
              </button>
              <button
                onClick={handleCancel}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                {isAr ? 'تأكيد الإلغاء' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The per-row action menu. It stops the click from bubbling, because the whole
 * row opens the record page: an action must never navigate as a side effect.
 */
function RowActions({
  row,
  isAr,
  onOpen,
  onRegister,
  onExtend,
  onCancel,
}: {
  row: AdminSubscriptionRow
  isAr: boolean
  onOpen: () => void
  onRegister: () => void
  onExtend: () => void
  onCancel: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onDocumentClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onDocumentClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocumentClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const item = (onClick: () => void, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      role="menuitem"
      onClick={(event) => {
        event.stopPropagation()
        setOpen(false)
        onClick()
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-start text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  )

  const hasRecord = Boolean(row.id)
  const canExtend = hasRecord && row.status === 'active'
  const canCancel = hasRecord && row.status === 'active' && !row.isExpired
  const needsRegister = !hasRecord || row.isExpired || row.status === 'cancelled'

  return (
    <div className="relative flex justify-end" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={isAr ? 'إجراءات' : 'Actions'}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          onClick={(event) => event.stopPropagation()}
          className="absolute end-0 top-full z-50 mt-1 w-44 border border-border bg-card py-1 shadow-card"
        >
          {hasRecord &&
            item(onOpen, <ExternalLink className="h-3.5 w-3.5" />, isAr ? 'فتح التفاصيل' : 'Open details')}
          {canExtend &&
            item(onExtend, <CalendarPlus className="h-3.5 w-3.5" />, isAr ? 'تمديد' : 'Extend')}
          {canCancel && item(onCancel, <XCircle className="h-3.5 w-3.5" />, isAr ? 'إلغاء' : 'Cancel')}
          {needsRegister &&
            item(onRegister, <CalendarPlus className="h-3.5 w-3.5" />, isAr ? 'تسجيل اشتراك' : 'Register')}
        </div>
      )}
    </div>
  )
}
