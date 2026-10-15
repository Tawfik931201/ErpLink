import { redirect } from 'next/navigation'

// Legacy `/onboarding` entry point now forwards to the dashboard
// (the quick-setup wizard was removed).
// Kept as a redirect (instead of deleting) so old links/bookmarks keep working
// with no middleware change.
export default function OnboardingRedirect() {
  redirect('/app/dashboard')
}
