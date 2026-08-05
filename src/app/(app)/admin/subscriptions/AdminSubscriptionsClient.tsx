'use client'

import {
  CalendarPlus,
  Loader2,
  AlertCircle,
  Search,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import {
  registerSubscription,
  extendSubscription,
  cancelSubscription,
  searchUsersByEmail,
  detectAffiliateForClient,
  type AdminSubscriptionRow,
  type UserPick,
  type AffiliatePick,
} from '@/app/actions/subscription-actions'
import PaginationControls from '@/components/PaginationControls'
import { cn } from '@/lib/utils'

interface Props {
  rows: AdminSubscriptionRow[]
  error: string | null
  affiliates: AffiliatePick[]
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
const actionBtn =
  'inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40'

export default function AdminSubscriptionsClient({ rows, error, affiliates, lang }: Props) {
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
  const [affiliateId, setAffiliateId] = useState('')
  const [autoAffiliate, setAutoAffiliate] = useState<AffiliatePick | null>(null)
  const [manualAffiliate, setManualAffiliate] = useState(false)
  const [detectingAffiliate, setDetectingAffiliate] = useState(false)
  const [startDate, setStartDate] = useState(today())
  const [months, setMonths] = useState(1)
  const [amount, setAmount] = useState('')
  const [cancelExisting, setCancelExisting] = useState(false)
  const [notes, setNotes] = useState('')

  // Extend form state
  const [extMonths, setExtMonths] = useState(1)
  const [extAmount, setExtAmount] = useState('')
  const [extNotes, setExtNotes] = useState('')

  const resetRegister = () => {
    setEmailQuery('')
    setResults([])
    setSelectedUser(null)
    setWorkspaceId('')
    setNewWorkspaceName('')
    setClientPhone('')
    setAffiliateId('')
    setAutoAffiliate(null)
    setManualAffiliate(false)
    setStartDate(today())
    setMonths(1)
    setAmount('')
    setCancelExisting(false)
    setNotes('')
    setModalError(null)
  }

  useEffect(() => {
    if (!selectedUser) {
      setAutoAffiliate(null)
      setDetectingAffiliate(false)
      return
    }
    let cancelled = false
    setDetectingAffiliate(true)
    detectAffiliateForClient({ userId: selectedUser.id, workspaceId: workspaceId || null }).then(
      (res) => {
        if (cancelled) return
        setDetectingAffiliate(false)
        if (res.success && res.affiliate) {
          setAutoAffiliate(res.affiliate)
          if (!manualAffiliate) setAffiliateId(res.affiliate!.id)
        } else {
          setAutoAffiliate(null)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [selectedUser, workspaceId, manualAffiliate])

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
      affiliateId: affiliateId || null,
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
    setBusy(true)
    setModalError(null)
    const res = await extendSubscription({
      subscriptionId: modal.row.id,
      months: extMonths,
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

  const formatDate = (d: string) => {
    try {
      if (!d) return '—'
      const date = new Date(`${d}T00:00:00Z`)
      if (Number.isNaN(date.getTime())) return d
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

      const day = date.getUTCDate()
      const month = date.getUTCMonth()
      const year = date.getUTCFullYear()

      if (isAr) {
        return `${day} ${monthsAr[month]} ${year}`
      }
      return `${months[month]} ${day}, ${year}`
    } catch {
      return d
    }
  }

  const formatAmount = (amount: number | string) => {
    const num = Number(amount) || 0
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }

  const statusDisplay = (row: AdminSubscriptionRow) => {
    if (row.status === 'none') {
      return { dot: 'bg-muted-foreground/30', text: isAr ? 'بدون اشتراك' : 'No subscription', textCls: 'text-muted-foreground' }
    }
    if (row.status === 'cancelled') {
      return { dot: 'bg-muted-foreground/50', text: isAr ? 'ملغى' : 'Cancelled', textCls: 'text-muted-foreground' }
    }
    if (row.isExpired) {
      return { dot: 'bg-destructive/70', text: isAr ? 'منتهٍ' : 'Expired', textCls: 'text-destructive' }
    }
    if (row.daysRemaining <= 7) {
      return { dot: 'bg-foreground/60', text: isAr ? `ينتهي بعد ${row.daysRemaining} يوم` : `Ends in ${row.daysRemaining}d`, textCls: 'text-foreground' }
    }
    return { dot: 'bg-foreground', text: isAr ? 'نشط' : 'Active', textCls: 'text-foreground' }
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
              ? 'تسجيل اشتراكات العملاء يدوياً (عند التحويل) — يتم حفظها في قاعدة البيانات وتظهر للعميل وتُنشئ عمولة الأفلييت تلقائياً.'
              : 'Manually register client subscriptions (on transfer) — saved to the database, shown to the client, and auto-generate the affiliate commission.'}
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

      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground">
            {isAr ? 'سجل الاشتراكات' : 'Subscriptions List'}
          </span>
          <span className="text-[11px] text-muted-foreground">{filteredRows.length}</span>
        </div>

        {filteredRows.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs text-muted-foreground">
            <CalendarPlus className="h-5 w-5 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد نتائج بحث مطابقة' : 'No matching search results'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'العميل' : 'Client'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'المساحة' : 'Workspace'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الأفلييت' : 'Affiliate'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'البداية' : 'Start'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'النهاية' : 'End'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الشهور' : 'Months'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'المبلغ' : 'Amount'}</th>
                  <th className="px-3 py-2 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="px-3 py-2 text-end font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row) => {
                  const st = statusDisplay(row)
                  return (
                    <tr key={row.workspace_id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{row.client_name || '—'}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{row.client_email}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{row.workspace_name || '—'}</p>
                        {row.subscription_number && (
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{row.subscription_number}</p>
                        )}
                        {row.active_sub_count > 1 && (
                          <p className="text-[10px] text-amber-600 font-medium mt-0.5">
                            {isAr
                              ? `+${row.active_sub_count - 1} اشتراك نشط آخر`
                              : `+${row.active_sub_count - 1} more active sub(s)`}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.affiliate_name || '—'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.start_date ? formatDate(row.start_date) : '—'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.end_date ? formatDate(row.end_date) : '—'}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{row.status !== 'none' ? row.months_paid : '—'}</td>
                      <td className="px-3 py-2.5 font-mono text-foreground">
                        {row.status !== 'none'
                          ? `${formatAmount(row.amount_paid)} ${row.currency}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className={cn('flex items-center gap-1.5', st.textCls)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
                          <span>{st.text}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {row.status === 'none' || row.isExpired || row.status === 'cancelled' ? (
                            <button
                              onClick={() => {
                                resetRegister()
                                setSelectedUser({
                                  id: row.user_id,
                                  email: row.client_email || '',
                                  name: row.client_name,
                                  active_workspace_id: row.workspace_id,
                                  workspaces: [
                                    {
                                      id: row.workspace_id,
                                      name: row.workspace_name || '',
                                      partner_id: row.affiliate_id,
                                    },
                                  ],
                                })
                                setWorkspaceId(row.workspace_id)
                                setAffiliateId(row.affiliate_id || '')
                                setModal({ type: 'register' })
                              }}
                              className={actionBtn}
                            >
                              <CalendarPlus className="h-3 w-3" />
                              {isAr ? 'تسجيل' : 'Register'}
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setExtMonths(1)
                                  setExtAmount('')
                                  setExtNotes('')
                                  setModalError(null)
                                  setModal({ type: 'extend', row })
                                }}
                                disabled={row.status !== 'active' || row.isExpired}
                                title={isAr ? 'تمديد الاشتراك' : 'Extend'}
                                className={actionBtn}
                              >
                                <CalendarPlus className="h-3 w-3" />
                                {isAr ? 'تمديد' : 'Extend'}
                              </button>
                              {row.status === 'active' && (
                                <button
                                  onClick={() => {
                                    setModalError(null)
                                    setModal({ type: 'cancel', row })
                                  }}
                                  disabled={row.isExpired}
                                  title={isAr ? 'إلغاء' : 'Cancel'}
                                  className={actionBtn}
                                >
                                  <XCircle className="h-3 w-3" />
                                  {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                              )}
                            </>
                          )}
                        </div>
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
            total={filteredRows.length}
            onPageChange={setPage}
            isAr={isAr}
          />
          </>
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

            {/* Step 2: workspace + affiliate */}
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
                        {ws.partner_id ? (isAr ? ' (مرتبطة بأفلييت)' : ' (affiliate-linked)') : ''}
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

                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    {isAr ? 'الأفلييت المرتبط (اكتشاف تلقائي)' : 'Linked Affiliate (auto-detected)'}
                  </label>
                  {detectingAffiliate ? (
                    <div className="flex items-center gap-2 border border-border bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {isAr ? 'جارٍ اكتشاف الأفلييت المرتبط...' : 'Detecting linked affiliate...'}
                    </div>
                  ) : autoAffiliate && !manualAffiliate ? (
                    <div className="border border-border bg-muted/30 px-3 py-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">{autoAffiliate.display_name}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {Math.round(Number(autoAffiliate.commission_rate) * 100)}% ·{' '}
                          {isAr
                            ? 'مرتبط تلقائياً — العمولة تُحسب له'
                            : 'auto-linked — commission will go to this affiliate'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setManualAffiliate(true)}
                        className="text-[10px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                      >
                        {isAr ? 'تغيير' : 'Change'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={affiliateId}
                        onChange={(e) => setAffiliateId(e.target.value)}
                        className={inputCls}
                      >
                        <option value="">{isAr ? '— بدون أفلييت —' : '— No affiliate —'}</option>
                        {affiliates.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.display_name} · {Math.round(Number(a.commission_rate) * 100)}%
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center justify-between gap-2">
                        {autoAffiliate && (
                          <button
                            type="button"
                            onClick={() => {
                              setManualAffiliate(false)
                              setAffiliateId(autoAffiliate.id)
                            }}
                            className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                          >
                            {isAr ? 'رجوع للاكتشاف التلقائي' : 'Back to auto-detected'}
                          </button>
                        )}
                        {!autoAffiliate && (
                          <p className="text-[10px] text-muted-foreground">
                            {isAr
                              ? 'لا يوجد أفلييت مرتبط بهذا العميل — اختر يدوياً إن لزم'
                              : 'No linked affiliate found for this client — pick manually if needed'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
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
                          ? 'تنبيه: بمبلغ 0 لن تُسجل أي دفعة ولن تُنشأ عمولة للأفلييت.'
                          : 'Note: with amount 0, no payment is recorded and no affiliate commission is created.'}
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
                  min={1}
                  value={extMonths}
                  onChange={(e) => setExtMonths(Math.max(1, Number(e.target.value) || 1))}
                  className={inputCls}
                />
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
                      ? 'تنبيه: بمبلغ 0 لن تُنشأ عمولة للأفلييت عن فترة التمديد.'
                      : 'Note: with amount 0, no affiliate commission is created for the extension.'}
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
