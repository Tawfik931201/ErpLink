/**
 * Pure decision helper for Zid → Odoo native-variant deletion.
 *
 * Zid does not send a `product.delete` for a single option value removed from
 * a parent product: it sends `product.update` for the parent with a shorter
 * `variants[]` list. The create/update variant executor only creates and
 * updates the variants in that list, so a removed variant stayed active in
 * Odoo while the sync log still said "success".
 *
 * This helper decides which Odoo `product.product` variants must be archived.
 * It is deliberately conservative: only variants that (a) belong to the
 * template being synced, (b) were previously written by this Zid store
 * (a success `sync_logs` row ties their Odoo id to a Zid variant id), and
 * (c) are absent from the current Zid variant list, are returned. Odoo
 * variants with no Zid history are never touched — a manual addition under
 * the same template is not ours to archive.
 *
 * Import-free so it can be unit-tested without a database.
 */

export interface VariantLink {
  zidEntityId: string
  odooRecordId: number
}

export interface StaleVariantInput {
  /** All Odoo product.product ids currently under the template. */
  odooVariantIds: number[]
  /** Odoo variant ids matched or created during this sync run. */
  usedOdooVariantIds: Iterable<number>
  /** Prior Zid variant id → Odoo product.product id links for this store. */
  priorLinks: VariantLink[]
  /** Zid variant ids present in the current (full) variant list. */
  currentZidVariantIds: Iterable<string>
}

/**
 * Odoo ids to archive. Sorted for deterministic writes and testability.
 * An empty current list yields nothing: an empty list means "we do not know
 * the variants", never "the merchant removed every variant".
 */
export function pickStaleZidVariants(input: StaleVariantInput): number[] {
  const current = new Set(
    [...input.currentZidVariantIds].map(id => String(id).trim()).filter(Boolean)
  )
  if (current.size === 0) return []

  const used = new Set(input.usedOdooVariantIds)
  const underTemplate = new Set(input.odooVariantIds)
  const stale = new Set<number>()

  for (const link of input.priorLinks) {
    const sourceId = String(link.zidEntityId ?? '').trim()
    const odooId = Number(link.odooRecordId)
    if (!sourceId || !Number.isInteger(odooId) || odooId <= 0) continue
    if (!underTemplate.has(odooId)) continue
    if (used.has(odooId)) continue
    if (current.has(sourceId)) continue
    stale.add(odooId)
  }

  return [...stale].sort((a, b) => a - b)
}
