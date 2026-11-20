jest.mock('@clerk/themes', () => ({ dark: {} }), { virtual: true })

import { getClerkAppearance, getClerkProfileAppearance } from '../../src/lib/clerk-appearance'

/**
 * Regression pin (2026-11-09): the embedded-launch change set
 * `rootBox/cardBox: 'w-full max-w-full'`, which stretched the Clerk
 * sign-in card to the full page width ("login screen looks bad / too wide").
 * The card must stay a constrained, centered box as it was before.
 */
it('constrains the Clerk sign-in card instead of stretching it full-width', () => {
  for (const isDark of [false, true]) {
    const { elements } = getClerkAppearance(isDark)
    expect(elements?.rootBox).not.toContain('max-w-full')
    expect(elements?.cardBox).not.toContain('max-w-full')
    expect(elements?.rootBox).toContain('max-w-md')
    expect(elements?.rootBox).toContain('mx-auto')
    expect(elements?.cardBox).toContain('max-w-md')
  }
})

// The profile dialog must not inherit the narrow sign-in card limits.
it('gives the Clerk user profile a responsive, wider modal', () => {
  for (const isDark of [false, true]) {
    const { elements } = getClerkProfileAppearance(isDark)
    expect(elements.rootBox).toContain('max-w-none')
    expect(elements.cardBox).toContain('max-w-none')
    expect(elements.modalContent).toContain('960px')
    expect(elements.modalContent).toContain('100vw-24px')
  }
})
