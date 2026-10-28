import { SignUp } from '@clerk/nextjs'

export default async function SignUpPage(props: {
  searchParams: Promise<{ redirect_url?: string }>
}) {
  const searchParams = await props.searchParams
  const signInUrl = searchParams?.redirect_url
    ? `/sign-in?redirect_url=${encodeURIComponent(searchParams.redirect_url)}`
    : '/sign-in'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <SignUp fallbackRedirectUrl="/app/dashboard" signInUrl={signInUrl} />
    </div>
  )
}
