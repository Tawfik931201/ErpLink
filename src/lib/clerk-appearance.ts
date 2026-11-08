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
      rootBox: 'w-full max-w-full',
      cardBox: 'w-full max-w-full',
      card: 'shadow-md border border-border',
    },
  }
}
