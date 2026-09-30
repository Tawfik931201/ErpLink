/**
 * Barrel for the per-platform field catalogues.
 *
 * Kept so existing imports keep working: the mapping centre imports every
 * platform's constants from here. New code should import from
 * `@/lib/platforms/<platform>/fields` directly so it only pulls in the one
 * platform it needs.
 *
 * Split stage 3 moved the data out; the data itself is unchanged.
 */

export { ODOO_MODELS, ODOO_FIELDS, STORE_VARIANT_FIELDS } from '@/lib/platforms/odoo/fields'

export { ZID_EVENTS, ZID_FIELDS, ZID_SUB_FIELDS } from '@/lib/platforms/zid/fields'

export { SALLA_EVENTS, SALLA_FIELDS } from '@/lib/platforms/salla/fields'

export { SHOPIFY_EVENTS, SHOPIFY_FIELDS } from '@/lib/platforms/shopify/fields'
