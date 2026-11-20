import { dark } from '@clerk/themes'

export const CLERK_VARIABLES = {
  colorPrimary: '#0284c7',
  fontFamily: 'var(--font-tajawal), sans-serif',
  borderRadius: '0.5rem',
}

export function getClerkAppearance(isDark: boolean) {
  return {
    baseTheme: isDark ? dark : undefined,
    variables: CLERK_VARIABLES,
    elements: {
      // Constrained centered card, as before the embedded-launch change
      // (8d517d4 set max-w-full, which stretched the sign-in card to the
      // full page width). max-w-md keeps the previous ~400px look on
      // desktop while still shrinking to fit a narrow Zid iframe.
      rootBox: 'mx-auto w-full max-w-md',
      cardBox: 'w-full max-w-md',
      card: 'shadow-md border border-border',
    },
  }
}

/**
 * Clerk's profile modal needs room for its navigation and account details.
 * Do not reuse the compact sign-in card sizing for the profile dialog.
 */
export function getClerkProfileAppearance(isDark: boolean) {
  const appearance = getClerkAppearance(isDark)
  return {
    ...appearance,
    elements: {
      ...appearance.elements,
      rootBox: 'mx-auto w-full max-w-none',
      cardBox: 'w-full max-w-none',
      card: 'w-full max-w-none shadow-md border border-border',
      modalContent: 'w-[min(960px,calc(100vw-24px))] max-w-[calc(100vw-24px)]',
    },
  }
}
