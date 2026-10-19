'use client'

import { CalendarClock, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import {
  getMyActiveSubscription,
  type MySubscription,
  type WorkspaceTrial,
} from '@/app/actions/subscription-actions'
import { useLanguage } from '@/components/language-provider'
import { cn } from '@/lib/utils'

/** Client-facing subscription status card (dashboard + workspace settings). */
export default function SubscriptionStatusCard() {
  const { lang } = useLanguage()
  const isAr = lang === 'ar'
  const [sub, setSub] = useState<MySubscription | null>(null)
  const [trial, setTrial] = useState<WorkspaceTrial | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getMyActiveSubscription()
    if (res.success) {
      setSub(res.subscription)
      setTrial(res.trial)
      setError(null)
    } else {
      setError(res.error ?? 'error')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {isAr ? 'جاري تحميل الاشتراك...' : 'Loading subscription...'}
      </div>
    )
  }

  if (error) return null

  const formatDate = (d: string) => {
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

  if (!sub) {
    // No subscription row. Inside the 7-day free trial show the trial card;
    // once the trial has run out the workspace is closed (archived).
    if (trial && !trial.isExpired) {
      const days = trial.daysRemaining
      return (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/50 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <h3 className="text-sm font-bold text-amber-900">
              {isAr ? 'تجربة مجانية' : 'Free trial'}
            </h3>
          </div>
          <p className="text-xs text-amber-800/80 mt-1.5 leading-relaxed">
            {isAr
              ? `أنت في فترة التجربة المجانية (7 أيام). ${days > 0 ? `يتبقى ${days} يوم.` : 'تنتهي خلال أقل من يوم.'} سيتم إغلاق مساحة العمل عند انتهاء التجربة إلا إذا تم تسجيل اشتراك. تواصل مع الدعم للاشتراك.`
              : `You are in the 7-day free trial. ${days > 0 ? `${days} day${days === 1 ? '' : 's'} remaining.` : 'Less than a day left.'} The workspace will be closed when the trial ends unless a subscription is registered. Contact support to subscribe.`}
          </p>
          {trial.endsAt && (
            <p className="text-[11px] text-amber-800/70 mt-2">
              {isAr ? 'تنتهي في: ' : 'Ends on: '}
              {formatDate(trial.endsAt)}
            </p>
          )}
        </div>
      )
    }

    if (trial?.isExpired) {
      return (
        <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <h3 className="text-sm font-bold text-red-900">
              {isAr ? 'انتهت التجربة المجانية' : 'Free trial ended'}
            </h3>
          </div>
          <p className="text-xs text-red-800/80 mt-1.5 leading-relaxed">
            {isAr
              ? 'انتهت فترة التجربة المجانية وتم إغلاق مساحة العمل. تواصل مع الدعم للاشتراك وإعادة التفعيل.'
              : 'The free trial has ended and the workspace is closed. Contact support to subscribe and reactivate.'}
          </p>
        </div>
      )
    }

    return (
      <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <h3 className="text-sm font-bold text-amber-900">
            {isAr ? 'لا يوجد اشتراك نشط' : 'No active subscription'}
          </h3>
        </div>
        <p className="text-xs text-amber-800/80 mt-1.5 leading-relaxed">
          {isAr
            ? 'لم يتم تسجيل اشتراك لمساحة العمل الخاصة بك بعد. تواصل مع الدعم لتفعيل اشتراكك.'
            : 'No subscription has been registered for your workspace yet. Contact support to activate your subscription.'}
        </p>
      </div>
    )
  }

  if (sub.status === 'active' && !sub.isExpired) {
    return null
  }

  const expired = sub.isExpired
  const soon = !expired && sub.daysRemaining <= 7

  return (
    <div
      className={cn(
        'rounded-2xl border p-5 space-y-3',
        expired
          ? 'border-red-200 bg-red-50/60'
          : soon
            ? 'border-amber-200 bg-amber-50/60'
            : 'border-emerald-200 bg-emerald-50/60',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {expired ? (
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          )}
          <h3 className="text-sm font-bold text-foreground">
            {isAr ? 'بيانات الاشتراك' : 'Subscription'}
          </h3>
        </div>
        <span
          className={cn(
            'inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border',
            expired
              ? 'bg-red-100 border-red-200 text-red-700'
              : soon
                ? 'bg-amber-100 border-amber-200 text-amber-700'
                : 'bg-emerald-100 border-emerald-200 text-emerald-700',
          )}
        >
          {expired
            ? isAr ? 'منتهٍ' : 'Expired'
            : soon
              ? isAr
                ? `ينتهي بعد ${sub.daysRemaining} يوم`
                : `Ends in ${sub.daysRemaining} day${sub.daysRemaining === 1 ? '' : 's'}`
              : isAr ? 'نشط' : 'Active'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {isAr ? 'البداية: ' : 'Start: '}
            <strong className="text-foreground">{formatDate(sub.start_date)}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
          <span>
            {isAr ? 'النهاية: ' : 'End: '}
            <strong className="text-foreground">{formatDate(sub.end_date)}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>
            {isAr ? 'المدة: ' : 'Period: '}
            <strong className="text-foreground">
              {sub.months_paid} {isAr ? 'شهر' : 'month(s)'}
            </strong>
          </span>
        </div>
      </div>

      {expired && (
        <p className="text-[11px] text-red-700 leading-relaxed">
          {isAr
            ? 'انتهى اشتراكك. تواصل مع الدعم لتجديد الاشتراك.'
            : 'Your subscription has expired. Contact support to renew.'}
        </p>
      )}
    </div>
  )
}
