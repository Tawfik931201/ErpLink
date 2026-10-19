'use client'

import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'

import { getMyActiveSubscription, type MySubscription } from '@/app/actions/subscription-actions'
import { useLanguage } from '@/components/language-provider'
import {
  countdownParts,
  formatCountdownAr,
  formatCountdownEn,
  subscriptionRemainingMs,
} from '@/lib/subscription-countdown'

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
 * States (all rendered RED since 2026-10-19 — the near-expiry strip used to
 * be amber; it was made red on request so every warning reads the same):
 * - No active subscription at all → red strip, no countdown (there is no
 *   deadline to count down to: a no-subscription workspace has no end_date).
 * - Subscription expired → red strip (workspace is archived by the backend).
 * - Subscription ends within 7 days → red strip with a live day/hour/minute/
 *   SECOND countdown ticking every second down to the end of the last valid
 *   day (UTC, end_date inclusive); the message says when the workspace will
 *   close. At zero the strip flips to the expired message without a reload.
 * - Active with >7 days remaining → nothing is rendered.
 *
 * Not dismissible — the strip has no X and no sessionStorage memory, so it
 * is rendered on every page view for as long as the state warrants it
 * (including for admins; requested 2026-10-19).
 */
export default function SubscriptionBanner() {
  const { lang } = useLanguage()
  const isAr = lang === 'ar'
  const [state, setState] = useState<BannerState>(null)
  // Ticks every second while the "soon" state is active so the countdown
  // (days/hours/minutes/seconds) stays fresh without a page reload.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
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

  // Per-second countdown ticker — only runs while the "soon" strip is
  // visible. The moment the countdown reaches zero the subscription has just
  // expired, so flip to the expired message immediately; that state change
  // tears this interval down through the dependency below.
  useEffect(() => {
    if (state?.kind !== 'soon') return
    const id = setInterval(() => {
      if (subscriptionRemainingMs(state.sub.end_date) <= 0) {
        setState({ kind: 'expired', sub: state.sub })
      } else {
        setTick((t) => t + 1)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [state])

  if (!state) return null

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
    const parts = countdownParts(state.sub.end_date)
    const fmt = isAr ? formatCountdownAr(parts) : formatCountdownEn(parts)
    message = isAr
      ? `ينتهي اشتراكك بعد ${fmt} — سيتم إغلاق مساحة العمل عند الانتهاء. تواصل مع الدعم للتجديد.`
      : `Your subscription ends in ${fmt} — the workspace will be closed when it ends. Contact support to renew.`
  }

  return (
    <div
      role="alert"
      className="bg-red-600 text-white w-full shrink-0 sticky top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium shadow-sm"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-white" aria-hidden="true" />
      <p className="flex-1 text-center leading-snug">{message}</p>
    </div>
  )
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
