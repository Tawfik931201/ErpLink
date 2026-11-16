

async function fetchAndBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    })
    if (!res.ok) {
      console.warn(`[SyncEngine] Failed to fetch binary from URL ${url}: ${res.status} ${res.statusText}`)
      return null
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      console.warn(`[SyncEngine] URL ${url} returned non-image content-type: ${contentType}`)
    }
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength === 0) {
      console.warn(`[SyncEngine] Empty response from URL ${url}`)
      return null
    }
    return Buffer.from(buffer).toString('base64')
  } catch (err) {
    console.warn(`[SyncEngine] Error fetching/encoding binary from URL ${url}:`, err)
    return null
  }
}

// Product images are never synced (cancelled 2026-11-09): no `settings.image`
// option, no gallery writes, no image_1920 writes. This helper only survives
// because `resolveBinaryField` still recognizes store image URL shapes when a
// non-product binary value arrives.
function productImageUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!value || typeof value !== 'object') return undefined
  const image = value as Record<string, any>
  const url = image.url ?? image.origin ?? image.thumbs?.fullSize ?? image.image_url ?? image.src ?? image.image?.url ?? image.path ?? image.full_path
  return typeof url === 'string' ? url.trim() || undefined : undefined
}

export async function resolveBinaryField(rawValue: unknown): Promise<string | null> {
  if (!rawValue) return null

  // 1. If it's a string, check if it's a URL or already base64
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim()
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return fetchAndBase64(trimmed)
    }
    // Check if it's already a base64 string
    if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length > 50) {
      return trimmed
    }
    // Data URL
    if (trimmed.startsWith('data:')) {
      const parts = trimmed.split(';base64,')
      if (parts.length === 2) return parts[1]
    }
    return null
  }

  // 2. If it's an array (like Zid images array)
  if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) return null
    console.info(`[SyncEngine] resolveBinaryField: array of ${rawValue.length} items, first=${JSON.stringify(rawValue[0]).slice(0, 300)}`)
    const mainImg = rawValue.find((img: any) => img && (img.is_main === true || img.is_default === true)) || rawValue[0]
    if (mainImg) {
      const url = productImageUrl(mainImg)
      if (!url && typeof mainImg === 'object') {
        console.warn(`[SyncEngine] resolveBinaryField: mainImg keys=${Object.keys(mainImg).join(', ')} — no known URL key found`)
      }
      console.info(`[SyncEngine] resolveBinaryField: extracted url="${url}" from mainImg type=${typeof mainImg}`)
      if (url && typeof url === 'string') {
        return fetchAndBase64(url.trim())
      }
    }
    console.warn(`[SyncEngine] resolveBinaryField: no valid image found in array`)
    return null
  }

  // 3. If it's an object
  if (typeof rawValue === 'object' && rawValue !== null) {
    const obj = rawValue as Record<string, unknown>
    const url = productImageUrl(obj)
    if (url && typeof url === 'string') {
      return fetchAndBase64(url.trim())
    }
  }

  return null
}
