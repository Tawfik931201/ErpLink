'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Handshake,
  Eye,
} from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import {
  approvePartner,
  rejectPartner,
  suspendPartner,
  reactivatePartner,
} from '@/app/actions/partners'
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

  const [tab, setTab] = useState<'pending' | 'active' | 'inactive'>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ type: 'approve' | 'reject' | 'suspend' | 'reactivate'; profile: DbProfile } | null>(null)
  const [tierOverride, setTierOverride] = useState<string>('starter')
  const [reason, setReason] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  const pending = profiles.filter((p) => p.status === 'pending')
  const active = profiles.filter((p) => p.status === 'active')
  const inactive = profiles.filter(
    (p) => p.status === 'suspended' || p.status === 'rejected',
  )

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

  const statusBadge = (status: string) => {
    const m: Record<string, string> = {
      pending: 'bg-amber-50 border-amber-200 text-amber-700',
      active: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      suspended: 'bg-muted border-border text-secondary-foreground',
      rejected: 'bg-red-50 border-red-200 text-red-700',
    }
    return cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border',
      m[status] || '',
    )
  }

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
    } catch (err: any) {
      setModalError(err.message || 'error')
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
    } catch (err: any) {
      setModalError(err.message || 'error')
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
    } catch (err: any) {
      setModalError(err.message || 'error')
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
    } catch (err: any) {
      setModalError(err.message || 'error')
    } finally {
      setBusyId(null)
    }
  }

  const tabs = [
    { key: 'pending' as const, label: lang === 'ar' ? 'معلقة' : 'Pending', count: pending.length },
    { key: 'active' as const, label: lang === 'ar' ? 'نشط' : 'Active', count: active.length },
    { key: 'inactive' as const, label: lang === 'ar' ? 'موقوف/مرفوض' : 'Suspended/Rejected', count: inactive.length },
  ]

  const list = tab === 'pending' ? pending : tab === 'active' ? active : inactive

  return (
    <div className="p-6 md:p-10" dir={dir}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-foreground">{t('admin.partners.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('admin.partners.subtitle')}</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-secondary/20 rounded-xl border border-border/40 w-fit" dir="ltr">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all',
                tab === tabItem.key
                  ? 'bg-card shadow-sm text-foreground border border-border'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span>{tabItem.label}</span>
              <span className={cn(
                'flex h-5 min-w-[20px] items-center justify-center rounded-full text-[10px] font-bold px-1.5',
                tab === tabItem.key
                  ? 'bg-primary/10 text-primary'
                  : 'bg-secondary text-muted-foreground',
              )}>
                {tabItem.count}
              </span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          {list.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              <Handshake className="h-8 w-8 mx-auto mb-2 opacity-40" />
              {tab === 'pending'
                ? (lang === 'ar' ? 'لا توجد طلبات معلقة' : 'No pending requests')
                : tab === 'active'
                ? (lang === 'ar' ? 'لا يوجد شركاء نشطين' : 'No active partners')
                : (lang === 'ar' ? 'لا يوجد شركاء موقوفين' : 'No suspended/rejected partners')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground bg-secondary/30">
                <tr>
                  <th className="px-6 py-3 text-start">
                    {t('admin.partners.col.name')}
                  </th>
                  <th className="px-6 py-3 text-start">
                    {t('admin.partners.col.tier')}
                  </th>
                  <th className="px-6 py-3 text-start">
                    {t('admin.partners.col.rate')}
                  </th>
                  <th className="px-6 py-3 text-start">
                    {t('admin.partners.col.status')}
                  </th>
                  <th className="px-6 py-3 text-start">
                    {t('admin.partners.col.createdAt')}
                  </th>
                  <th className="px-6 py-3 text-start">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="border-t border-border/40">
                    <td className="px-6 py-3 font-semibold">{p.display_name}</td>
                    <td className="px-6 py-3">{tierLabel(p.tier, lang)}</td>
                    <td className="px-6 py-3">{Math.round(Number(p.commission_rate) * 100)}%</td>
                    <td className="px-6 py-3">
                      <span className={statusBadge(p.status)}>{p.status}</span>
                    </td>
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {formatDate(p.created_at)}
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/admin/partners/${p.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted border border-border text-secondary-foreground text-[10px] font-bold hover:bg-secondary transition"
                        >
                          <Eye className="h-3 w-3" />
                          {lang === 'ar' ? 'عرض' : 'View'}
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
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold hover:bg-emerald-100 transition"
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
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold hover:bg-red-100 transition"
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
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold hover:bg-amber-100 transition"
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
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-bold hover:bg-blue-100 transition"
                          >
                            {lang === 'ar' ? 'إعادة تفعيل' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Tiers info */}
        <div className="rounded-2xl border border-border bg-card shadow-sm p-6 space-y-3">
          <h2 className="font-bold text-sm text-foreground">
            {lang === 'ar' ? 'إعدادات الطبقات' : 'Tiers Configuration'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.keys(PARTNER_TIERS) as Array<keyof typeof PARTNER_TIERS>).map((k) => {
              const tier = PARTNER_TIERS[k]
              return (
                <div key={k} className="rounded-xl border border-border p-4 bg-secondary/30">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm">{tierLabel(k, lang)}</span>
                    <span className="text-xs font-mono text-muted-foreground">{k}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tier.maxClients === null
                      ? lang === 'ar' ? 'بدون حد أقصى' : 'Unlimited'
                      : lang === 'ar' ? `حتى ${tier.maxClients} عميل` : `Up to ${tier.maxClients}`}
                  </p>
                  <p className="mt-2 text-base font-black text-foreground">
                    {Math.round(tier.commissionRate * 100)}%
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Modal ────────────────────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-foreground">
              {modal.type === 'approve' && (lang === 'ar' ? 'موافقة على الشريك' : 'Approve Partner')}
              {modal.type === 'reject' && (lang === 'ar' ? 'رفض الطلب' : 'Reject Application')}
              {modal.type === 'suspend' && (lang === 'ar' ? 'إيقاف الشريك' : 'Suspend Partner')}
              {modal.type === 'reactivate' && (lang === 'ar' ? 'إعادة تفعيل' : 'Reactivate')}
            </h3>

            <p className="text-sm text-muted-foreground">
              <strong>{modal.profile.display_name}</strong>
              {' — '}
              {tierLabel(modal.profile.tier, lang)}
            </p>

            {modal.type === 'approve' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground">
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
                          'flex-1 rounded-xl border px-4 py-3 text-center text-xs font-bold transition-all',
                          tierOverride === k
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border hover:border-border/80',
                        )}
                      >
                        <div>{tierLabel(k, lang)}</div>
                        <div className="text-base mt-1">{Math.round(cfg.commissionRate * 100)}%</div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {(modal.type === 'reject' || modal.type === 'suspend') && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground">
                  {lang === 'ar' ? 'السبب' : 'Reason'}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-all"
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
              <p className="text-xs text-muted-foreground">
                {lang === 'ar' ? 'سيتم إعادة تفعيل هذا الشريك.' : 'This partner will be reactivated.'}
              </p>
            )}

            {modalError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {modalError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                className="rounded-xl px-4"
                onClick={() => setModal(null)}
              >
                {lang === 'ar' ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button
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
                className={cn(
                  'rounded-xl px-4 font-bold',
                  modal.type === 'approve' && 'bg-emerald-600 hover:bg-emerald-700 text-white',
                  modal.type === 'reject' && 'bg-red-600 hover:bg-red-700 text-white',
                  modal.type === 'suspend' && 'bg-amber-600 hover:bg-amber-700 text-white',
                  modal.type === 'reactivate' && 'bg-blue-600 hover:bg-blue-700 text-white',
                )}
              >
                {busyId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  lang === 'ar'
                    ? { approve: 'موافقة', reject: 'رفض', suspend: 'إيقاف', reactivate: 'إعادة تفعيل' }[modal.type]
                    : modal.type
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
