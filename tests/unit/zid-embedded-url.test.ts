import { getZidEmbeddedRedirectTarget, isZidEmbeddedToken } from '../../src/lib/zid/embedded-url'

const token = '9c70b51e-b86f-41ac-aaed-4519273875ec'

it.each([token, token.toUpperCase()])('accepts a Zid embedded UUID token (%s)', value => {
  expect(isZidEmbeddedToken(value)).toBe(true)
})

it.each(['', 'not-a-token', 'header.payload.signature', token.replace('-41ac-', '-11ac-'), null, undefined, 42])(
  'rejects non-embedded values (%s)',
  value => { expect(isZidEmbeddedToken(value)).toBe(false) },
)

it('routes a token arriving on the homepage to /embedded with the locale prefix', () => {
  expect(getZidEmbeddedRedirectTarget({ pathname: '/', token, localePrefix: 'ar-sa' }))
    .toBe(`/ar-sa/embedded?token=${token}`)
})

it('routes a token arriving on /sign-in to /embedded instead of the normal Clerk sign-in', () => {
  expect(getZidEmbeddedRedirectTarget({ pathname: '/sign-in', token, localePrefix: 'en-us' }))
    .toBe(`/en-us/embedded?token=${token}`)
})

it('preserves a Zid language parameter and drops anything that is not a locale', () => {
  expect(getZidEmbeddedRedirectTarget({ pathname: '/', token, language: 'en-sa', localePrefix: 'ar-sa' }))
    .toBe(`/ar-sa/embedded?token=${token}&language=en-sa`)
  expect(getZidEmbeddedRedirectTarget({ pathname: '/', token, language: 'https://evil.example/', localePrefix: 'ar-sa' }))
    .toBe(`/ar-sa/embedded?token=${token}`)
})

it('does not redirect when already on /embedded, with or without a trailing slash', () => {
  expect(getZidEmbeddedRedirectTarget({ pathname: '/embedded', token, localePrefix: 'ar-sa' })).toBeNull()
  expect(getZidEmbeddedRedirectTarget({ pathname: '/embedded/', token, localePrefix: 'ar-sa' })).toBeNull()
})

it('does not redirect without a token or with a malformed one', () => {
  expect(getZidEmbeddedRedirectTarget({ pathname: '/sign-in', token: null, localePrefix: 'ar-sa' })).toBeNull()
  expect(getZidEmbeddedRedirectTarget({ pathname: '/sign-in', token: 'not-a-token', localePrefix: 'ar-sa' })).toBeNull()
})
