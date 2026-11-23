/**
 * Publish company identity only when the business owner supplies verified,
 * publicly shareable details in the deployment environment.
 *
 * Do NOT infer a business address from a visitor's location, the hosting
 * company, a store's warehouse, or a personal social-media profile.
 */
const allowedProfileHosts = new Set([
  'linkedin.com', 'www.linkedin.com', 'facebook.com', 'www.facebook.com',
  'instagram.com', 'www.instagram.com', 'x.com', 'www.x.com',
  'youtube.com', 'www.youtube.com', 'github.com', 'www.github.com',
  'zid.sa', 'www.zid.sa',
])

export function publicBusinessProfile() {
  const rawTelephone = process.env.PUBLIC_BUSINESS_PHONE_E164?.trim() ?? ''
  const telephone = /^\+[1-9]\d{6,14}$/.test(rawTelephone) ? rawTelephone : null

  const street = process.env.PUBLIC_BUSINESS_ADDRESS_STREET?.trim() ?? ''
  const city = process.env.PUBLIC_BUSINESS_ADDRESS_CITY?.trim() ?? ''
  const region = process.env.PUBLIC_BUSINESS_ADDRESS_REGION?.trim() ?? ''
  const postalCode = process.env.PUBLIC_BUSINESS_ADDRESS_POSTAL?.trim() ?? ''
  const country = process.env.PUBLIC_BUSINESS_ADDRESS_COUNTRY?.trim() ?? ''
  const address = city && /^[A-Za-z]{2}$/.test(country)
    ? {
        '@type': 'PostalAddress' as const,
        ...(street ? { streetAddress: street } : {}),
        addressLocality: city,
        ...(region ? { addressRegion: region } : {}),
        ...(postalCode ? { postalCode } : {}),
        addressCountry: country.toUpperCase(),
      }
    : null

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
  return { telephone, address, sameAs }
}
