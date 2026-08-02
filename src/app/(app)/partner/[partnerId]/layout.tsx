import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

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
      {/* Minimal nav bar — links back to dashboard and partner sub-pages */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-4 text-sm font-medium text-muted-foreground">
            <a
              href={`/partner/${params.partnerId}`}
              className="hover:text-foreground transition-colors"
            >
              {lang === 'ar' ? 'الرئيسية' : 'Dashboard'}
            </a>
            <a
              href={`/partner/${params.partnerId}/clients`}
              className="hover:text-foreground transition-colors"
            >
              {lang === 'ar' ? 'العملاء' : 'Clients'}
            </a>
            <a
              href={`/partner/${params.partnerId}/commissions`}
              className="hover:text-foreground transition-colors"
            >
              {lang === 'ar' ? 'العمولات' : 'Commissions'}
            </a>
            <a
              href={`/partner/${params.partnerId}/payouts`}
              className="hover:text-foreground transition-colors"
            >
              {lang === 'ar' ? 'المستحقات' : 'Payouts'}
            </a>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-6 md:p-8">{children}</main>
    </div>
  )
}
