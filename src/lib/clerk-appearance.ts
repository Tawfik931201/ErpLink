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
