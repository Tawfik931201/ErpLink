/**
 * Publish company identity only when the business owner supplies verified,
 * publicly shareable details in the deployment environment.
 *
 * Only verified external company profiles can be linked via sameAs.
 */
const allowedProfileHosts = new Set([
  'linkedin.com', 'www.linkedin.com', 'facebook.com', 'www.facebook.com',
  'instagram.com', 'www.instagram.com', 'x.com', 'www.x.com',
  'youtube.com', 'www.youtube.com', 'github.com', 'www.github.com',
  'zid.sa', 'www.zid.sa',
])

export function publicBusinessProfile() {
  const sameAs: string[] = []
  for (const entry of (process.env.PUBLIC_BUSINESS_SAME_AS ?? '').split(/[\n,]+/)) {
    if (!entry.trim()) continue
    try {
      const url = new URL(entry.trim())
      if (url.protocol !== 'https:' || !allowedProfileHosts.has(url.hostname.toLowerCase()) ||
          url.username || url.password || !url.pathname || url.pathname === '/') continue
      const normalized = url.toString()
      if (!sameAs.includes(normalized) && sameAs.length < 8) sameAs.push(normalized)
    } catch {
      // Ignore invalid or unverified profile URLs, never output them in schema.
    }
  }
  return { sameAs }
}
