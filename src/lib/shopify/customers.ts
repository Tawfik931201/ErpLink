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
