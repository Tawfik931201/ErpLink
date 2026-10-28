import { SignInClient } from './sign-in-client'

export default async function SignInPage(props: {
  searchParams: Promise<{ redirect_url?: string }>
}) {
  const searchParams = await props.searchParams
  const signUpUrl = searchParams?.redirect_url
    ? `/sign-up?redirect_url=${encodeURIComponent(searchParams.redirect_url)}`
    : '/sign-up'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <SignInClient signUpUrl={signUpUrl} />
    </div>
  )
}
