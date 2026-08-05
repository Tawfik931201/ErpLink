'use client'

import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Handshake,
  Eye,
  FileText,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  approvePartner,
  rejectPartner,
  suspendPartner,
  reactivatePartner,
} from '@/app/actions/partners'
import PaginationControls from '@/components/PaginationControls'
import { PARTNER_TIERS, tierLabel } from '@/lib/partner-tiers'
import { translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

interface DbProfile {
  id: string
  user_id: string
  display_name: string
  status: string
  tier: string
  commission_rate: number | string
  rejection_reason?: string | null
  approved_at?: string | null
  created_at: string
  totalEarnings: number
  totalPending: number
  eligibleToWithdraw: number
}

interface Props {
  profiles: DbProfile[]
  error: string | null
  lang: Language
}

export default function AdminPartnersClient({ profiles, error, lang }: Props) {
  const router = useRouter()
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (k: keyof typeof translations['ar']) =>
    translations[lang][k] || translations['ar'][k]

  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ type: 'approve' | 'reject' | 'suspend' | 'reactivate'; profile: DbProfile } | null>(null)
  const [tierOverride, setTierOverride] = useState<string>('starter')
  const [reason, setReason] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const PAGE_SIZE = 25
  const pagedList = profiles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return d
    }
  }

  const statusDot = (status: string) => {
    const dot: Record<string, string> = {
      pending: 'bg-muted-foreground/50',
      active: 'bg-foreground',
      suspended: 'bg-muted-foreground/30',
      rejected: 'bg-destructive/70',
    }
    const txt: Record<string, string> = {
      pending: 'text-muted-foreground',
      active: 'text-foreground',
      suspended: 'text-muted-foreground',
      rejected: 'text-destructive',
    }
    return {
      dotClass: dot[status] || 'bg-muted-foreground/30',
      textClass: txt[status] || 'text-muted-foreground',
    }
  }

  const actionBtn =
    'inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors'

  async function handleApprove() {
    if (!modal) return
    setBusyId(modal.profile.id)
    setModalError(null)
    try {
      const res = await approvePartner({
        partnerId: modal.profile.id,
        tier: tierOverride,
      })
      if (res.success) {
        setModal(null)
        router.refresh()
      } else {
        setModalError(res.error || 'err')
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject() {
    if (!modal || !reason.trim()) return
    setBusyId(modal.profile.id)
    setModalError(null)
    try {
      const res = await rejectPartner({
        partnerId: modal.profile.id,
        reason: reason.trim(),
      })
      if (res.success) {
        setModal(null)
        setReason('')
        router.refresh()
      } else {
        setModalError(res.error || 'err')
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleSuspend() {
    if (!modal || !reason.trim()) return
    setBusyId(modal.profile.id)
    setModalError(null)
    try {
      const res = await suspendPartner({
        partnerId: modal.profile.id,
        reason: reason.trim(),
      })
      if (res.success) {
        setModal(null)
        setReason('')
        router.refresh()
      } else {
        setModalError(res.error || 'err')
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleReactivate() {
    if (!modal) return
    setBusyId(modal.profile.id)
    setModalError(null)
    try {
      const res = await reactivatePartner({ partnerId: modal.profile.id })
      if (res.success) {
        setModal(null)
        router.refresh()
      } else {
        setModalError(res.error || 'err')
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'error')
    } finally {
      setBusyId(null)
    }
  }

  const list = profiles
  const fmt = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="max-w-6xl mx-auto space-y-4" dir={dir}>
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">{t('admin.partners.title')}</h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{t('admin.partners.subtitle')}</p>
      </div>

      {error && (
        <div className="flex items-start gap-3 border border-border bg-card p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-xs text-foreground">
              {lang === 'ar' ? 'خطأ في تحميل البيانات' : 'Failed to load data'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Affiliates table */}
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-medium text-foreground">{t('admin.partners.listTitle')}</span>
          </div>
          <span className="text-[11px] text-muted-foreground">{list.length}</span>
        </div>

        {list.length === 0 ? (
          <div className="px-6 py-16 text-center text-xs text-muted-foreground">
            <Handshake className="h-5 w-5 mx-auto mb-2 opacity-40" />
            {lang === 'ar' ? 'لا يوجد أفلييت مسجلين حالياً' : 'No registered affiliates'}
          </div>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="px-3 py-2 text-start font-medium">{t('admin.partners.col.name')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('admin.partners.col.tier')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('admin.partners.col.rate')}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'إجمالي الأرباح' : 'Total Earnings'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'المتاح للسحب' : 'Available'}</th>
                  <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'المعلق' : 'Pending'}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('admin.partners.col.status')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('admin.partners.col.createdAt')}</th>
                  <th className="px-3 py-2 text-end font-medium w-10" />
                </tr>
              </thead>
              <tbody>
                {pagedList.map((p) => {
                  const { dotClass, textClass } = statusDot(p.status)
                  return (
                    <tr key={p.id} className="border-b border-border/50 transition-colors hover:bg-muted/30">
                      <td className="px-3 py-2.5 font-medium text-foreground">{p.display_name}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{tierLabel(p.tier, lang)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{Math.round(Number(p.commission_rate) * 100)}%</td>
                      <td className="px-3 py-2.5 font-mono text-foreground">{fmt(p.totalEarnings)}</td>
                      <td className="px-3 py-2.5 font-mono text-foreground">{fmt(p.eligibleToWithdraw)}</td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{fmt(p.totalPending)}</td>
                      <td className="px-3 py-2.5">
                        <div className={cn('flex items-center gap-1.5', textClass)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} />
                          <span>{p.status}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{formatDate(p.created_at)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Link href={`/admin/partners/${p.id}`} className={actionBtn}>
                            <Eye className="h-3 w-3" />
                            {lang === 'ar' ? 'عرض' : 'View'}
                          </Link>
                          <Link href={`/admin/partners/${p.id}/statement`} className={actionBtn}>
                            <FileText className="h-3 w-3" />
                            {lang === 'ar' ? 'كشف الحساب' : 'Statement'}
                          </Link>
                          {p.status === 'pending' && (
                            <>
                              <button
                                onClick={() => {
                                  setModal({ type: 'approve', profile: p })
                                  setTierOverride('starter')
                                  setReason('')
                                  setModalError(null)
                                }}
                                disabled={busyId === p.id}
                                className={actionBtn}
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                {lang === 'ar' ? 'موافقة' : 'Approve'}
                              </button>
                              <button
                                onClick={() => {
                                  setModal({ type: 'reject', profile: p })
                                  setReason('')
                                  setModalError(null)
                                }}
                                disabled={busyId === p.id}
                                className={actionBtn}
                              >
                                <XCircle className="h-3 w-3" />
                                {lang === 'ar' ? 'رفض' : 'Reject'}
                              </button>
                            </>
                          )}
                          {p.status === 'active' && (
                            <button
                              onClick={() => {
                                setModal({ type: 'suspend', profile: p })
                                setReason('')
                                setModalError(null)
                              }}
                              disabled={busyId === p.id}
                              className={actionBtn}
                            >
                              {lang === 'ar' ? 'إيقاف' : 'Suspend'}
                            </button>
                          )}
                          {(p.status === 'suspended' || p.status === 'rejected') && (
                            <button
                              onClick={() => {
                                setModal({ type: 'reactivate', profile: p })
                                setModalError(null)
                              }}
                              disabled={busyId === p.id}
                              className={actionBtn}
                            >
                              {lang === 'ar' ? 'إعادة تفعيل' : 'Reactivate'}
                            </button>
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
            total={list.length}
            onPageChange={setPage}
            isAr={lang === 'ar'}
          />
          </>
        )}
      </div>

      {/* Tiers info */}
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <span className="text-[11px] font-medium text-foreground">
            {lang === 'ar' ? 'إعدادات الطبقات' : 'Tiers Configuration'}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-border/50">
          {(Object.keys(PARTNER_TIERS) as Array<keyof typeof PARTNER_TIERS>).map((k) => {
            const tier = PARTNER_TIERS[k]
            return (
              <div key={k} className="p-4 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{tierLabel(k, lang)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{k}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {tier.maxClients === null
                    ? lang === 'ar' ? 'بدون حد أقصى' : 'Unlimited'
                    : lang === 'ar' ? `حتى ${tier.maxClients} عميل` : `Up to ${tier.maxClients}`}
                </p>
                <p className="font-mono text-sm text-foreground">{Math.round(tier.commissionRate * 100)}%</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Modal ────────────────────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-card border border-border max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground">
              {modal.type === 'approve' && (lang === 'ar' ? 'موافقة على الأفلييت' : 'Approve Affiliate')}
              {modal.type === 'reject' && (lang === 'ar' ? 'رفض الطلب' : 'Reject Application')}
              {modal.type === 'suspend' && (lang === 'ar' ? 'إيقاف الأفلييت' : 'Suspend Affiliate')}
              {modal.type === 'reactivate' && (lang === 'ar' ? 'إعادة تفعيل' : 'Reactivate')}
            </h3>

            <p className="text-[11px] text-muted-foreground">
              <strong className="text-foreground">{modal.profile.display_name}</strong>
              {' — '}
              {tierLabel(modal.profile.tier, lang)}
            </p>

            {modal.type === 'approve' && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {lang === 'ar' ? 'اختر الطبقة' : 'Select Tier'}
                </label>
                <div className="flex gap-2">
                  {(Object.keys(PARTNER_TIERS) as Array<keyof typeof PARTNER_TIERS>).map((k) => {
                    const cfg = PARTNER_TIERS[k]
                    return (
                      <button
                        key={k}
                        onClick={() => setTierOverride(k)}
                        className={cn(
                          'flex-1 border px-3 py-2.5 text-center transition-colors',
                          tierOverride === k
                            ? 'border-foreground bg-muted/40'
                            : 'border-border hover:bg-muted/30',
                        )}
                      >
                        <div className="text-[11px] font-medium text-foreground">{tierLabel(k, lang)}</div>
                        <div className="font-mono text-[11px] mt-1 text-muted-foreground">
                          {Math.round(cfg.commissionRate * 100)}%
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {(modal.type === 'reject' || modal.type === 'suspend') && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-muted-foreground">
                  {lang === 'ar' ? 'السبب' : 'Reason'}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder={
                    modal.type === 'reject'
                      ? (lang === 'ar' ? 'ذكر سبب الرفض...' : 'Enter rejection reason...')
                      : (lang === 'ar' ? 'ذكر سبب الإيقاف...' : 'Enter suspension reason...')
                  }
                  required
                />
              </div>
            )}

            {modal.type === 'reactivate' && (
              <p className="text-[11px] text-muted-foreground">
                {lang === 'ar' ? 'سيتم إعادة تفعيل هذا الأفلييت.' : 'This affiliate will be reactivated.'}
              </p>
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
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={
                  modal.type === 'approve'
                    ? handleApprove
                    : modal.type === 'reject'
                    ? handleReject
                    : modal.type === 'suspend'
                    ? handleSuspend
                    : handleReactivate
                }
                disabled={
                  busyId !== null ||
                  (modal.type !== 'approve' && modal.type !== 'reactivate' && !reason.trim())
                }
                className="inline-flex items-center rounded border border-foreground/20 bg-background px-3 h-7 text-[11px] font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              >
                {busyId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  lang === 'ar'
                    ? { approve: 'موافقة', reject: 'رفض', suspend: 'إيقاف', reactivate: 'إعادة تفعيل' }[modal.type]
                    : modal.type
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
