/** Preferences need cross-site cookie attributes when the app runs inside Zid. */
export function writePreferenceCookie(name: 'lang' | 'theme', value: string) {
  const embedded = window.self !== window.top && window.location.protocol === 'https:'
  const attributes = embedded ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${365 * 24 * 60 * 60}; ${attributes}`
}
