import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <SignUp
        afterSignUpUrl="/app/dashboard"
        signInUrl="/sign-in"
        forceRedirectUrl="/app/dashboard"
      />
    </div>
  )
}
