import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import PartnerNavLinks from '@/components/partner-nav-links'
import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

export default async function PartnerLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { partnerId: string }
}) {
  const userId = await getActiveUserId()
  if (!userId) redirect('/sign-in')

  // 1. Load the partner profile and verify it belongs to this user
  const { data: profile } = await supabase
    .from('partner_profiles')
    .select('id, user_id, status')
    .eq('id', params.partnerId)
    .single()

  if (!profile) redirect('/dashboard')
  if (profile.user_id !== userId) redirect('/dashboard')
  if (profile.status !== 'active') {
    // If pending, redirect to onboarding with a status banner
    if (profile.status === 'pending') redirect('/onboarding/partner')
    redirect('/dashboard')
  }

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) =>
    translations[lang][key] || translations['ar'][key]

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      {/* Header nav bar — same style as admin/partner dashboard headers */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <a
              href="/dashboard"
              className="text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              ← {t('nav.dashboard')}
            </a>
            <span className="text-muted-foreground/30">/</span>
            <span className="text-sm font-bold text-foreground">
              {t('nav.partnerDashboard')}
            </span>
          </div>
          <PartnerNavLinks basePath={`/partner/${params.partnerId}`} lang={lang} />
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-6 md:p-8">{children}</main>
    </div>
  )
}
