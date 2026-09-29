import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <SignIn
        afterSignInUrl="/app/dashboard"
        signUpUrl="/sign-up"
        forceRedirectUrl="/app/dashboard"
      />
    </div>
  )
}
