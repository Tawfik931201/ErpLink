'use client'

import { AlertTriangle, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { getMyActiveSubscription, type MySubscription } from '@/app/actions/subscription-actions'
import { useLanguage } from '@/components/language-provider'

const DISMISS_KEY = 'subscription_banner_dismissed'

type BannerState =
  | { kind: 'none' }
  | { kind: 'expired'; sub: MySubscription }
  | { kind: 'soon'; sub: MySubscription }
  | null

/**
 * Fixed top-of-screen alert strip, rendered above the entire app shell (above
 * the sidebar and the page content) on every page. The page content scrolls
 * underneath it — it behaves like a thin header that cannot be navigated away
 * from.
 *
 * States:
 * - No active subscription at all → red strip.
 * - Subscription expired → red strip (workspace is archived by the backend).
 * - Subscription ends within 7 days → amber strip with a live countdown
 *   (days + hours, refreshed every minute).
 * - Active with >7 days remaining → nothing is rendered.
 *
 * Dismissible with the X for the current session only (sessionStorage); it
 * returns on the next visit.
 */
export default function SubscriptionBanner() {
  const { lang } = useLanguage()
  const isAr = lang === 'ar'
  const [state, setState] = useState<BannerState>(null)
  const [dismissed, setDismissed] = useState(false)
  // Ticks every minute while the "soon" state is active so the countdown
  // (days/hours) stays fresh without a page reload.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(DISMISS_KEY)) {
      setDismissed(true)
      return
    }
    getMyActiveSubscription().then((res) => {
      if (!res.success || !res.subscription) {
        // No subscription row on this workspace (or fetch failed) → red strip.
        // A fetch error also lands here; showing the strip is the safe default
        // because the alternative is silently letting an unpaid user in.
        setState({ kind: 'none' })
        return
      }
      const sub = res.subscription
      if (sub.isExpired) {
        setState({ kind: 'expired', sub })
      } else if (sub.daysRemaining <= 7) {
        setState({ kind: 'soon', sub })
      } else {
        setState(null)
      }
    })
  }, [])

  // Live countdown ticker — only runs while the "soon" strip is visible.
  useEffect(() => {
    if (state?.kind !== 'soon') return
    const id = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [state?.kind])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore quota errors */
    }
  }, [])

  if (dismissed || !state) return null

  const isExpired = state.kind === 'expired' || state.kind === 'none'
  const bg = isExpired ? 'bg-red-600' : 'bg-amber-500'
  const fg = isExpired ? 'text-white' : 'text-amber-950'
  const iconColor = isExpired ? 'text-white' : 'text-amber-950'

  let message: string
  if (state.kind === 'none') {
    message = isAr
      ? 'لا يوجد اشتراك نشط — مساحة العمل الخاصة بك غير مفعلة. تواصل مع الدعم لتفعيل اشتراكك.'
      : 'No active subscription — your workspace is not activated. Contact support to activate your subscription.'
  } else if (state.kind === 'expired') {
    message = isAr
      ? `انتهى اشتراكك في ${formatDate(state.sub.end_date, isAr)} — مساحة العمل مؤرشفة. تواصل مع الدعم لتجديد الاشتراك.`
      : `Your subscription expired on ${formatDate(state.sub.end_date, isAr)} — the workspace is archived. Contact support to renew.`
  } else {
    const { days, hours } = remainingParts(state.sub.end_date)
    message = isAr
      ? `ينتهي اشتراكك بعد ${formatRemainingAr(days, hours)} — جدد الاشتراك قبل الانتهاء.`
      : `Your subscription ends in ${formatRemainingEn(days, hours)} — renew before it expires.`
  }

  return (
    <div
      role="alert"
      className={`${bg} ${fg} w-full shrink-0 sticky top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium shadow-sm`}
    >
      <AlertTriangle className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} aria-hidden="true" />
      <p className="flex-1 text-center leading-snug">{message}</p>
      <button
        onClick={dismiss}
        aria-label={isAr ? 'إغلاق التنبيه' : 'Dismiss notification'}
        className={`shrink-0 rounded p-0.5 transition-colors hover:bg-black/10 ${fg}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * Remaining time until the end of the subscription's last valid day.
 * `end_date` is inclusive — the subscription stays valid through the entire
 * day (UTC), so the countdown target is the start of the NEXT day.
 */
function remainingParts(endDate: string): { days: number; hours: number } {
  const end = new Date(`${endDate}T00:00:00Z`).getTime() + 86_400_000
  const rem = Math.max(0, end - Date.now())
  return {
    days: Math.floor(rem / 86_400_000),
    hours: Math.floor((rem % 86_400_000) / 3_600_000),
  }
}

function formatRemainingAr(days: number, hours: number): string {
  if (days > 0) return `${days} ${days === 1 ? 'يوم' : 'أيام'} و ${hours} ساعة`
  if (hours > 0) return `${hours} ساعة`
  return 'أقل من ساعة'
}

function formatRemainingEn(days: number, hours: number): string {
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} and ${hours} hour${hours === 1 ? '' : 's'}`
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}`
  return 'less than an hour'
}

function formatDate(d: string, isAr: boolean): string {
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
