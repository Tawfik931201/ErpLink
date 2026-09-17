import { redirect } from 'next/navigation'

// P0: legacy `/onboarding` entry point now forwards to the quick-setup wizard.
// Kept as a redirect (instead of deleting) so old links/bookmarks keep working
// with no middleware change.
export default function OnboardingRedirect() {
  redirect('/dashboard/setup')
}
