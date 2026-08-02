import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { Handshake } from 'lucide-react'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import ClaimWorkspaceForm from './ClaimWorkspaceForm'

export default async function ClaimWorkspacePage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  const userId = await getActiveUserId()
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const token = searchParams.token

  if (!token) {
    redirect('/dashboard')
  }

  // Verify the token is valid
  const { data: invitations } = await supabase
    .from('partner_onboarding_invitations')
    .select('id, status, partner_id, workspace_id, client_name')
    .eq('token', token)
    .limit(1)

  if (!invitations || invitations.length === 0) {
    redirect('/dashboard')
  }

  const inv = invitations[0]
  if (inv.status !== 'accepted') {
    // Already linked or expired
    if (inv.status === 'linked') {
      // Already done — go to dashboard
      redirect('/dashboard')
    }
    redirect('/dashboard')
  }
  if (inv.workspace_id) {
    redirect('/dashboard')
  }

  // Get partner name
  const { data: partner } = await supabase
    .from('partner_profiles')
    .select('display_name')
    .eq('id', inv.partner_id)
    .single()

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-white" dir={dir}>
      <div className="max-w-md w-full rounded-2xl border border-border bg-card shadow-lg p-8 space-y-6">
        <div className="text-center space-y-2">
          <Handshake className="h-10 w-10 mx-auto text-emerald-500" />
          <h1 className="text-xl font-black text-foreground">
            {lang === 'ar' ? 'إنشاء مساحة العمل' : 'Create Your Workspace'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {lang === 'ar'
              ? `مرحباً! ${partner?.display_name ?? ''} ينتظرك. أنشئ مساحة عملك للبدء.`
              : `Welcome! ${partner?.display_name ?? ''} is waiting for you. Create your workspace to get started.`}
          </p>
        </div>
        <ClaimWorkspaceForm token={token} lang={lang} />
      </div>
    </div>
  )
}
