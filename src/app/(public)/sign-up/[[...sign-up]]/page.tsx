import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'

import { Logo } from '@/components/ui/logo'

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <div className="mb-5 flex justify-center">
        <Link href="/" aria-label="ErpLink Home">
          <Logo variant="stacked" size="sm" priority />
        </Link>
      </div>
      <SignUp
        afterSignUpUrl="/dashboard"
        signInUrl="/sign-in"
        forceRedirectUrl="/dashboard"
      />
    </div>
  )
}
