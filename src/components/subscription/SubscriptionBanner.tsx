'use client'

import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  getMyActiveSubscription,
  type MySubscription,
  type WorkspaceTrial,
} from '@/app/actions/subscription-actions'
import { useLanguage } from '@/components/language-provider'
import {
  countdownParts,
  formatCountdownAr,
  formatCountdownEn,
  msToCountdownParts,
  subscriptionRemainingMs,
} from '@/lib/subscription-countdown'

type BannerState =
  | { kind: 'none' }
  | { kind: 'expired'; sub: MySubscription }
  | { kind: 'soon'; sub: MySubscription }
  | { kind: 'trial'; trial: WorkspaceTrial }
  | { kind: 'trialExpired'; trial: WorkspaceTrial }
  | null

/**
 * Fixed top-of-screen alert strip, rendered above the entire app shell (above
 * the sidebar and the page content) on every page. The page content scrolls
 * underneath it — it behaves like a thin header that cannot be navigated away
 * from.
 *
 * States (all rendered RED since 2026-10-19 — the near-expiry strip used to
 * be amber; it was made red on request so every warning reads the same):
 * - No subscription at all and no usable trial clock → red strip, no countdown
 *   (a workspace with an unknown `created_at` has no deadline to count to).
 * - Free trial running (no subscription yet, `created_at` + 7 days in the
 *   future) → red strip with a live day/hour/minute/SECOND countdown ticking
 *   every second to the trial end; the message says when the workspace will
 *   close. At zero the strip flips to the trial-expired message without a
 *   reload.
 * - Free trial over (no subscription, trial elapsed) → red strip: the
 *   workspace is closed; contact support to subscribe.
 * - Subscription expired → red strip (workspace archived by the backend).
 * - Subscription ends within 7 days → red strip with a live d/h/m/s countdown
 *   down to the end of the last valid day (UTC, end_date inclusive); the
 *   message says when the workspace will close. At zero the strip flips to the
 *   expired message without a reload.
 * - Active with >7 days remaining → nothing is rendered.
 *
 * A paid subscription always supersedes the trial, so the trial states only
 * appear when the action returns `subscription: null` with trial information.
 *
 * Not dismissible — the strip has no X and no sessionStorage memory, so it
 * is rendered on every page view for as long as the state warrants it
 * (including for admins; requested 2026-10-19).
 */
export default function SubscriptionBanner() {
  const { lang } = useLanguage()
  const isAr = lang === 'ar'
  const [state, setState] = useState<BannerState>(null)
  // Ticks every second while a countdown is visible so the d/h/m/s readout
  // stays fresh without a page reload.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    getMyActiveSubscription().then((res) => {
      if (res.success && res.subscription) {
        const sub = res.subscription
        if (sub.isExpired) {
          setState({ kind: 'expired', sub })
        } else if (sub.daysRemaining <= 7) {
          setState({ kind: 'soon', sub })
        } else {
          setState(null)
        }
        return
      }
      if (res.success && res.trial) {
        // No subscription row — the workspace is inside its free trial (or
        // past it). The trial clock supersedes "no active subscription".
        setState(res.trial.isExpired ? { kind: 'trialExpired', trial: res.trial } : { kind: 'trial', trial: res.trial })
        return
      }
      // No subscription, no trial clock (unknown created_at), or a fetch
      // error. Showing the strip is the safe default — the alternative is
      // silently letting an unpaid user in.
      setState({ kind: 'none' })
    })
  }, [])

  // Per-second countdown ticker — runs while either countdown strip is
  // visible (`soon` for a subscription, `trial` for the free trial). The
  // moment the target passes, flip to the expired/closed message immediately;
  // that state change tears this interval down through the dependency below.
  useEffect(() => {
    if (state?.kind !== 'soon' && state?.kind !== 'trial') return
    const id = setInterval(() => {
      if (state.kind === 'soon') {
        if (subscriptionRemainingMs(state.sub.end_date) <= 0) {
          setState({ kind: 'expired', sub: state.sub })
        } else {
          setTick((t) => t + 1)
        }
      } else {
        if (Date.now() >= state.trial.endsAtMs) {
          setState({ kind: 'trialExpired', trial: state.trial })
        } else {
          setTick((t) => t + 1)
        }
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
  } else if (state.kind === 'trial') {
    const parts = msToCountdownParts(state.trial.endsAtMs - Date.now())
    const fmt = isAr ? formatCountdownAr(parts) : formatCountdownEn(parts)
    message = isAr
      ? `تجربة مجانية — تنتهي بعد ${fmt} — سيتم إغلاق مساحة العمل عند الانتهاء. تواصل مع الدعم للاشتراك.`
      : `Free trial — ends in ${fmt} — the workspace will be closed when it ends. Contact support to subscribe.`
  } else if (state.kind === 'trialExpired') {
    const end = state.trial.endsAt ? formatDate(state.trial.endsAt, isAr) : null
    message = isAr
      ? end
        ? `انتهت التجربة المجانية في ${end} — مساحة العمل مغلقة. تواصل مع الدعم للاشتراك.`
        : 'انتهت التجربة المجانية — مساحة العمل مغلقة. تواصل مع الدعم للاشتراك.'
      : end
        ? `Your free trial ended on ${end} — the workspace is closed. Contact support to subscribe.`
        : 'Your free trial has ended — the workspace is closed. Contact support to subscribe.'
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
