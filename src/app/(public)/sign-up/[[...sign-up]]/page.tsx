import { cookies } from 'next/headers'
import { SignUp } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

const PARTNER_INTENT_COOKIE = 'partner_intent'

export default function SignUpPage() {
  const cookieStore = cookies()
  const intent = cookieStore.get(PARTNER_INTENT_COOKIE)?.value
  const { userId } = auth()

  if (userId && intent === 'partner') {
    redirect('/onboarding/partner')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <SignUp
        afterSignUpUrl={intent === 'partner' ? '/onboarding/partner' : '/dashboard'}
        signInUrl="/sign-in"
        forceRedirectUrl={intent === 'partner' ? '/onboarding/partner' : '/dashboard'}
      />
    </div>
  )
}
