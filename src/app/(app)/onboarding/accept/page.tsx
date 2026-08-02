import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Handshake, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react'

import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import { acceptClientInvitation } from '@/app/actions/partner-actions'
import { Button } from '@/components/ui/button'

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) =>
    translations[lang][key] || translations['ar'][key]

  const token = searchParams.token

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-white" dir={dir}>
        <div className="max-w-md w-full rounded-2xl border border-border bg-card shadow-lg p-8 text-center space-y-4">
          <AlertCircle className="h-12 w-12 mx-auto text-amber-500" />
          <h1 className="text-xl font-black text-foreground">
            {lang === 'ar' ? 'رابط غير صالح' : 'Invalid Link'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === 'ar'
              ? 'لم يتم العثور على رمز الدعوة. تأكد من الرابط الذي وصلتك.'
              : 'No invitation token found. Please check the link you received.'}
          </p>
        </div>
      </div>
    )
  }

  // Accept the invitation
  const result = await acceptClientInvitation(token)

  if (!result.success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-white" dir={dir}>
        <div className="max-w-md w-full rounded-2xl border border-border bg-card shadow-lg p-8 text-center space-y-4">
          <AlertCircle className="h-12 w-12 mx-auto text-red-500" />
          <h1 className="text-xl font-black text-foreground">
            {lang === 'ar' ? 'عذراً' : 'Sorry'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {result.error === 'invitation_already_used'
              ? lang === 'ar'
                ? 'تم استخدام هذه الدعوة مسبقاً.'
                : 'This invitation has already been used.'
              : result.error === 'invitation_not_found'
              ? lang === 'ar'
                ? 'الدعوة غير موجودة أو منتهية الصلاحية.'
                : 'Invitation not found or expired.'
              : result.error}
          </p>
          <a
            href="/sign-in"
            className="inline-flex items-center gap-1 text-xs text-primary font-bold hover:underline"
          >
            {lang === 'ar' ? 'تسجيل الدخول' : 'Sign in'} <ArrowRight className="h-3 w-3" />
          </a>
        </div>
      </div>
    )
  }

  // Success — redirect to sign-up with email prefilled and intent=accept
  const signupUrl = `/sign-up?email=${encodeURIComponent(result.invitation.email)}&intent=accept-invitation`

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 to-white" dir={dir}>
      <div className="max-w-md w-full rounded-2xl border border-border bg-card shadow-lg p-8 text-center space-y-4">
        <Handshake className="h-12 w-12 mx-auto text-emerald-500" />
        <h1 className="text-xl font-black text-foreground">
          {lang === 'ar' ? 'مرحباً بك!' : 'Welcome!'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lang === 'ar'
            ? `تم تأكيد دعوتك من ${result.partnerName}.`
            : `Your invitation from ${result.partnerName} has been confirmed.`}
        </p>
        <p className="text-xs text-muted-foreground">
          {lang === 'ar'
            ? 'الآن يمكنك إنشاء حساب لتفعيل مساحة العمل الخاصة بك.'
            : 'Now you can create an account to activate your workspace.'}
        </p>
        <a
          href={signupUrl}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <CheckCircle2 className="h-4 w-4" />
          {lang === 'ar' ? 'إنشاء حساب' : 'Create Account'}
        </a>
      </div>
    </div>
  )
}
