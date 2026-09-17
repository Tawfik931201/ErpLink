'use client'

import { AlertTriangle, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { getMyActiveSubscription, type MySubscription } from '@/app/actions/subscription-actions'
import { useLanguage } from '@/components/language-provider'

const DISMISS_KEY = 'subscription_banner_dismissed'

/**
 * Top-of-screen banner shown whenever the user enters the system and their
 * active workspace subscription is expired or about to expire (<= 7 days).
 * Never auto-dismisses: only the X button hides it, and only for the current
 * session (sessionStorage) so it returns on the next visit.
 */
export default function SubscriptionBanner() {
  const { lang } = useLanguage()
  const isAr = lang === 'ar'
  const [sub, setSub] = useState<MySubscription | null | 'none'>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(DISMISS_KEY)) {
      setDismissed(true)
      return
    }
    getMyActiveSubscription().then((res) => {
      setSub(res.success && res.subscription ? res.subscription : 'none')
    })
  }, [])

  const needsBanner =
    !!sub &&
    sub !== 'none' &&
    (sub.isExpired || sub.daysRemaining <= 7)

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore quota errors */
    }
  }, [])

  if (sub === null || dismissed || !needsBanner) return null

  const days = sub.daysRemaining

  return (
    <div
      role="alert"
      className={[
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-sm mb-6',
        sub.isExpired
          ? 'border-red-300 bg-red-50 text-red-800'
          : 'border-amber-300 bg-amber-50 text-amber-900',
      ].join(' ')}
    >
      <AlertTriangle
        className={`h-4 w-4 shrink-0 mt-0.5 ${sub.isExpired ? 'text-red-600' : 'text-amber-600'}`}
      />
      <p className="flex-1 leading-relaxed">
        {sub.isExpired
          ? isAr
            ? `اشتراكك انتهى في ${formatDate(sub.end_date, isAr)}. تواصل مع الدعم لتجديد الاشتراك.`
            : `Your subscription expired on ${formatDate(sub.end_date, isAr)}. Contact support to renew.`
          : isAr
            ? `اشتراكك ينتهي بعد ${days} ${days === 1 ? 'يوم' : 'أيام'} (${formatDate(sub.end_date, isAr)}). تواصل مع الدعم للتجديد.`
            : `Your subscription ends in ${days} day${days === 1 ? '' : 's'} (${formatDate(sub.end_date, isAr)}). Contact support to renew.`}
      </p>
      <button
        onClick={dismiss}
        aria-label={isAr ? 'إغلاق التنبيه' : 'Dismiss notification'}
        className={`shrink-0 rounded-md p-1 transition-colors hover:bg-black/5 ${
          sub.isExpired ? 'text-red-600' : 'text-amber-600'
        }`}
      >
        <X className="h-4 w-4" />
      </button>
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
