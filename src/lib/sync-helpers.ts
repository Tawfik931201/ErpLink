/**
 * Pure value helpers shared by the two sync engines.
 *
 * Extracted verbatim from `sync-engine.ts` (no logic change) so
 * `erpnext-engine.ts` can use them without importing the Odoo engine.
 * These functions are side-effect free: no DB, no fetch, no env.
 */

// ─── Helper: resolve a nested path like "name.ar" from a plain object ──────────

export function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const subPaths = path.split('||').map(p => p.trim())
  for (const subPath of subPaths) {
    const value = subPath.split('.').reduce<unknown>((acc, key) => {
      // If acc is a string, and it looks like a stringified object/array, try to parse it
      if (typeof acc === 'string') {
        const trimmed = acc.trim()
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            // First try direct JSON parse (preserves valid JSON and words with apostrophes like Men's)
            acc = JSON.parse(trimmed)
          } catch {
            try {
              // Convert Python dict format to valid JSON
              const jsonStr = trimmed
                .replace(/:\s*None\b/g, ': null')
                .replace(/:\s*True\b/g, ': true')
                .replace(/:\s*False\b/g, ': false')
                .replace(/(^|[{,]\s*)'([^']+)'\s*:/g, '$1"$2":')
                .replace(/:\s*'([^']*)'/g, ': "$1"')
              acc = JSON.parse(jsonStr)
            } catch {
              // Ignore parsing error, keep it as string
            }
          }
        }
      }

      if (acc && typeof acc === 'object') {
        if (Array.isArray(acc)) {
          const idx = parseInt(key, 10)
          return isNaN(idx) ? undefined : acc[idx]
        }
        return (acc as Record<string, unknown>)[key]
      }
      return undefined
    }, obj)

    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }

  // Zid can send localized fields either as { ar, en } or as a plain string.
  // If a mapping asks for "name.ar" but the webhook has "name": "..." use it.
  const firstPath = subPaths[0] ?? ''
  const [root] = firstPath.split('.')
  return obj[root]
}

// ─── Helper: resolve a Match Field value with common Zid field aliases ─────────
// Zid webhook payloads use prefixed names ("category_id", "category_uuid"),
// but the UI dropdown shows generic names ("id", "uuid"). This helper tries
// the user-selected field first, then common aliases so Match Field values
// are always extracted regardless of which name the admin picked.

const ZID_FIELD_ALIASES: Record<string, string[]> = {
  id: ['customer_id', 'product_id', 'category_id', 'category_uuid', 'uuid'],
  uuid: ['customer_id', 'product_id', 'category_uuid', 'category_id', 'id'],
  customer_id: ['id', 'uuid'],
  product_id: ['id', 'uuid'],
  category_id: ['id', 'uuid', 'category_uuid'],
  category_uuid: ['uuid', 'id', 'category_id'],
}

export function resolveZidMatchValue(zidData: Record<string, unknown>, zidField: string): unknown {
  const direct = resolvePath(zidData, zidField)
  if (direct !== undefined && direct !== null && direct !== '') return direct

  const aliases = ZID_FIELD_ALIASES[zidField] || []
  for (const alias of aliases) {
    const v = resolvePath(zidData, alias)
    if (v !== undefined && v !== null && v !== '') return v
  }

  return undefined
}

// ─── Helper: full customer name from a Shopify customer payload ───────────────
// Shopify sends first_name / last_name separately (plus default_address.name
// as "First Last"). The standard preset maps name <- first_name only, which
// drops the family name. Compose "[first, last]" first, then fall back to
// default_address.name / addresses[0].name / name. Pure — no I/O.
export function resolveShopifyCustomerFullName(data: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const first = str(data.first_name)
  const last = str(data.last_name)
  const joined = [first, last].filter(Boolean).join(' ').trim()
  if (joined) return joined
  const defAddr = data.default_address as Record<string, unknown> | null | undefined
  const defName = defAddr && typeof defAddr === 'object' ? str(defAddr.name) : ''
  if (defName) return defName
  const addrs = data.addresses as Array<Record<string, unknown>> | undefined
  if (Array.isArray(addrs) && addrs.length > 0) {
    const a0 = addrs[0] as Record<string, unknown>
    const aName = str(a0?.name)
    if (aName) return aName
    const aJoined = [str(a0?.first_name), str(a0?.last_name)].filter(Boolean).join(' ').trim()
    if (aJoined) return aJoined
  }
  return str(data.name)
}

// ─── Helper: extract a display name from a raw value ──────────────────────────

export function toNameString(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>

    // First, look for a string property directly on obj: name, title, ar, en, name_ar, name_en, names
    const directKeys = ['name', 'title', 'ar', 'en', 'name_ar', 'name_en', 'names']
    for (const key of directKeys) {
      const val = obj[key]
      if (val !== undefined && val !== null) {
        if (typeof val === 'string') return val.trim()
        if (typeof val === 'number') return String(val)
        if (typeof val === 'object') {
          // Recurse to resolve the sub-object (e.g. obj.name is { ar: "...", en: "..." })
          const subResolved = toNameString(val)
          if (subResolved && subResolved !== '[object Object]') {
            return subResolved
          }
        }
      }
    }
  }
  return String(v ?? '')
}
