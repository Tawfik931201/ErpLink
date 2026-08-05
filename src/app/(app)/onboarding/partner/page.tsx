'use client'

import { Handshake, Loader2, CheckCircle2, Clock4, XCircle, ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { getMyPartnerProfile, requestPartnership } from '@/app/actions/partners'
import { clearSignupIntent } from '@/app/actions/signup-intent'
import { Button } from '@/components/ui/button'
import { PARTNER_TIERS } from '@/lib/partner-tiers'
import { translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'
type Profile = {
  id: string
  status: string
  tier: string
  display_name: string
  commission_rate?: number | string
}

export default function PartnerOnboardingPage() {
  const router = useRouter()
  const [lang, setLang] = useState<Language>('ar')

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const cookie = document.cookie
        .split('; ')
        .find((row) => row.startsWith('lang='))
        ?.split('=')[1] as Language | undefined
      if (cookie === 'ar' || cookie === 'en') setLang(cookie)
      const dir = cookie === 'ar' ? 'rtl' : 'ltr'
      document.documentElement.setAttribute('dir', dir)
    }
  }, [])

  const t = (k: keyof typeof translations['ar']) =>
    translations[lang][k] || translations['ar'][k]
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await getMyPartnerProfile()
        if (cancelled) return
        if (res.success && res.profile) {
          setProfile(res.profile as Profile)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()

    // Clear cookie once we're on the actual onboarding page.
    clearSignupIntent().catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!displayName.trim()) {
      setError(t('partners.onboarding.errorRequired') as string)
      return
    }
    setSubmitting(true)
    try {
      const res = await requestPartnership({
        displayName: displayName.trim(),
        notes: notes.trim() || null,
      })
      if (!res.success) {
        setError((res.error as string) || 'unexpected_error')
        return
      }
      if ('profile' in res && res.profile) {
        setProfile(res.profile as Profile)
        router.refresh()
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-background"
        dir={dir}
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (profile && profile.status === 'active') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6" dir={dir}>
        <div className="max-w-lg w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-black text-foreground">
            {t('partners.onboarding.approvedTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('partners.onboarding.approvedDesc')}
          </p>
          <Button
            onClick={() => router.push(`/partner/${profile.id}`)}
            className="gradient-brand text-white rounded-xl px-6 py-3 font-bold"
          >
            {t('partners.onboarding.openDashboard')}
          </Button>
        </div>
      </div>
    )
  }

  if (profile && profile.status === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6" dir={dir}>
        <div className="max-w-lg w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Clock4 className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-black text-foreground">
            {t('partners.onboarding.pendingTitle')}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('partners.onboarding.pendingDesc')}
          </p>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard')}
            className="rounded-xl px-6 py-3 font-semibold"
          >
            {t('partners.onboarding.backDashboard')}
          </Button>
        </div>
      </div>
    )
  }

  if (profile && profile.status === 'rejected') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6" dir={dir}>
        <div className="max-w-lg w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4 shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-700">
            <XCircle className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-black text-foreground">
            {t('partners.onboarding.rejectedTitle')}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('partners.onboarding.rejectedDesc')}
          </p>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard')}
            className="rounded-xl px-6 py-3 font-semibold"
          >
            {t('partners.onboarding.backDashboard')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-secondary/20 flex items-center justify-center p-6" dir={dir}>
      <div className="w-full max-w-2xl space-y-6">
        <button
          onClick={() => router.push('/dashboard')}
          className={cn(
            'inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground',
          )}
        >
          <ArrowLeft className={cn('h-3.5 w-3.5', lang === 'ar' && 'rotate-180')} />
          <span>{t('partners.onboarding.backToDashboard')}</span>
        </button>

        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-8 pt-8 pb-6 border-b border-border bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950/30 dark:to-violet-950/30">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl gradient-brand text-white shadow-primary">
                <Handshake className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">
                  {t('partners.onboarding.badge')}
                </p>
                <h1 className="text-xl font-black text-foreground leading-tight">
                  {t('partners.onboarding.title')}
                </h1>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              {t('partners.onboarding.subtitle')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="displayName"
                className="text-xs font-bold text-muted-foreground"
              >
                {t('partners.onboarding.displayNameLabel')}
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('partners.onboarding.displayNamePlaceholder') as string}
                maxLength={80}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-all"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                {t('partners.onboarding.displayNameHelp')}
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="notes"
                className="text-xs font-bold text-muted-foreground"
              >
                {t('partners.onboarding.notesLabel')}
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('partners.onboarding.notesPlaceholder') as string}
                rows={4}
                maxLength={1500}
                className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 transition-all resize-y"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('partners.onboarding.notesHelp')}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-2">
              <p className="text-xs font-bold text-muted-foreground">
                {t('partners.onboarding.tierPreviewTitle')}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t('partners.onboarding.tierPreviewHelp')}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {(Object.keys(PARTNER_TIERS) as Array<keyof typeof PARTNER_TIERS>).map(
                  (key) => {
                    const tier = PARTNER_TIERS[key]
                    const isDefault = key === 'starter'
                    return (
                      <span
                        key={key}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border',
                          isDefault
                            ? 'bg-primary/10 text-primary border-primary/30'
                            : 'bg-secondary text-muted-foreground border-border',
                        )}
                      >
                        <span>{tier.labelAr}</span>
                        <span className="opacity-60">
                          • {Math.round(tier.commissionRate * 100)}%
                        </span>
                        {tier.maxClients && (
                          <span className="opacity-60">• ≤ {tier.maxClients}</span>
                        )}
                      </span>
                    )
                  },
                )}
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                {t('partners.onboarding.tierPreviewNote')}
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive font-semibold">
                {error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard')}
                className="rounded-xl px-5"
              >
                {t('partners.onboarding.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="gradient-brand text-white rounded-xl px-6 font-bold"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('partners.onboarding.submit')
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
