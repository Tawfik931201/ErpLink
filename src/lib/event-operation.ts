/**
 * Event → (entity, operation) — the single source of truth.
 *
 * This module exists because two functions used to answer the same question
 * independently and disagreed:
 *
 *   - `webhook-gate.mapEventToEntityAndOp` decided whether the ingress route
 *     accepts the event at all (and which `standard_mapping_settings` row it
 *     is judged against).
 *   - `sync-engine.normalizeOdooOperation` decided what to actually WRITE to
 *     Odoo (create / update / delete / cancel / deliver).
 *
 * A disagreement between them is silent and destructive: the gate can allow an
 * event the engine then routes to a different operation than the merchant
 * enabled. `order.shipment.cancelled` was the worst case — both said `cancel`,
 * so the engine wrote `{state:'cancel'}` on the whole sale.order when the
 * merchant only cancelled a *shipment*.
 *
 * Both now call `resolveEventOperation`. Zid and Shopify keep the old
 * substring heuristic verbatim (their aliases live in `EVENT_ALIASES` inside
 * sync-engine and are applied there); Salla gets an explicit table because its
 * event names do not follow the heuristic's assumptions.
 */

export type SyncOperation = 'create' | 'update' | 'delete' | 'cancel' | 'deliver'

export type PlatformName = 'zid' | 'salla' | 'shopify'

export type ResolvedOperation = {
  entityType: string
  operation: SyncOperation
}

/**
 * Salla's store events, verified against `docs.salla.dev/webhooks` and the
 * Portal's `salla_events action=list` on 2026-10-05.
 *
 * Three decisions here are deliberate and must not be "simplified" back:
 *
 * 1. `order.shipment.cancelled` / `order.shipment.return.cancelled` → `update`,
 *    NEVER `cancel`. In Salla a shipment is a child object; its payload is
 *    `{id, reference_id, shipping_number}` with no items, status or customer.
 *    Cancelling the sale.order because a shipment was cancelled destroys the
 *    order. Only `order.cancelled` cancels.
 *
 * 2. `order.shipment.created` → `deliver`. It is the only Salla event that
 *    means "this order has shipped", so it is the only one that can drive
 *    Odoo delivery (full or partial). Its sibling `order.shipment.creating`
 *    fires while the shipment is still being set up and stays an `update`.
 *
 * 3. `order.deleted` → `update`, not `delete`. The engine has a delete branch
 *    only for `product.template`; a `sale.order` delete falls through with no
 *    defined behaviour. Re-importing the order is the safe interpretation.
 *
 * `product.updated` and `product.available` are struck through in Salla's own
 * docs as deprecated, but the Portal still offers them, so `product.updated`
 * stays subscribed and classified here — the Portal decides what can be
 * subscribed, not the prose.
 */
const SALLA_EVENTS: Record<string, ResolvedOperation> = {
  // ── Orders ────────────────────────────────────────────────────────────────
  'order.created': { entityType: 'orders', operation: 'create' },
  'order.updated': { entityType: 'orders', operation: 'update' },
  'order.status.updated': { entityType: 'orders', operation: 'update' },
  'order.payment.updated': { entityType: 'orders', operation: 'update' },
  'order.products.updated': { entityType: 'orders', operation: 'update' },
  'order.total.price.updated': { entityType: 'orders', operation: 'update' },
  'order.shipping.address.updated': { entityType: 'orders', operation: 'update' },
  'order.coupon.updated': { entityType: 'orders', operation: 'update' },
  'order.customer.updated': { entityType: 'orders', operation: 'update' },
  'order.refunded': { entityType: 'orders', operation: 'update' },
  'order.deleted': { entityType: 'orders', operation: 'update' },
  'order.cancelled': { entityType: 'orders', operation: 'cancel' },

  // Shipments — see decisions 1 and 2 above.
  'order.shipment.creating': { entityType: 'orders', operation: 'update' },
  'order.shipment.created': { entityType: 'orders', operation: 'deliver' },
  'order.shipment.cancelled': { entityType: 'orders', operation: 'update' },
  'order.shipment.return.creating': { entityType: 'orders', operation: 'update' },
  'order.shipment.return.created': { entityType: 'orders', operation: 'update' },
  'order.shipment.return.cancelled': { entityType: 'orders', operation: 'update' },

  // ── Products ──────────────────────────────────────────────────────────────
  'product.created': { entityType: 'products', operation: 'create' },
  'product.updated': { entityType: 'products', operation: 'update' },
  'product.deleted': { entityType: 'products', operation: 'delete' },
  'product.status.updated': { entityType: 'products', operation: 'update' },
  'product.price.updated': { entityType: 'products', operation: 'update' },
  'product.quantity.low': { entityType: 'products', operation: 'update' },
  'product.image.updated': { entityType: 'products', operation: 'update' },
  'product.category.updated': { entityType: 'products', operation: 'update' },
  'product.brand.updated': { entityType: 'products', operation: 'update' },
  'product.tags.updated': { entityType: 'products', operation: 'update' },

  // ── Customers ─────────────────────────────────────────────────────────────
  'customer.created': { entityType: 'customers', operation: 'create' },
  'customer.updated': { entityType: 'customers', operation: 'update' },
  'customer.login': { entityType: 'customers', operation: 'update' },
  'customer.otp.request': { entityType: 'customers', operation: 'update' },

  // ── Categories ────────────────────────────────────────────────────────────
  // `category.deleted` does not exist in Salla — its catalogue is created /
  // updated only — so the engine's category-delete path is not webhook-drivable.
  'category.created': { entityType: 'categories', operation: 'create' },
  'category.updated': { entityType: 'categories', operation: 'update' },

  // Real slug, but the `carts` OAuth scope is deselected so nothing delivers it.
  'abandoned.cart': { entityType: 'orders', operation: 'create' },
}

/**
 * Shopify-only explicit mappings for events the substring heuristic below
 * cannot classify. Consulted ONLY when platform === 'shopify', so Zid and
 * Salla behaviour is untouched:
 *
 * - `collections/*` contain neither 'product' nor 'category' as a substring,
 *   so the heuristic returned null and the webhook gate allowed them
 *   unconditionally — disabling Categories in Standard Mapping never blocked
 *   a Shopify collection webhook at ingress (the engine did respect it
 *   later via derivePresetKey/EVENT_ALIASES, hence the silent disagreement).
 * - `orders/delete` fell through to `update` in the heuristic while the
 *   engine routes it to `cancel` (EVENT_ALIASES maps it to `order.cancel`
 *   and normalizeOdooOperation returns 'cancel'), so the gate checked the
 *   wrong operation against enabled_actions.
 */
const SHOPIFY_EVENTS: Record<string, ResolvedOperation> = {
  'collections/create': { entityType: 'categories', operation: 'create' },
  'collections/update': { entityType: 'categories', operation: 'update' },
  'collections/delete': { entityType: 'categories', operation: 'delete' },
  'orders/delete': { entityType: 'orders', operation: 'cancel' },
};

/**
 * The pre-existing substring heuristic, kept byte-for-byte for every platform
 * other than Salla and the Shopify-only events above. Order matters:
 * `product.category.updated` must be a product (the product branch is checked
 * before the category branch), and the abandoned-cart rule must stay last.
 */
function resolveBySubstring(event: string): ResolvedOperation | null {
  const n = event.toLowerCase()

  if (n.includes('order')) {
    if (n.includes('cancel')) return { entityType: 'orders', operation: 'cancel' }
    if (n.includes('deliver') || n.includes('fulfil') || n.includes('shipped')) return { entityType: 'orders', operation: 'deliver' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'orders', operation: 'create' }
    return { entityType: 'orders', operation: 'update' }
  }

  if (n.includes('product')) {
    if (n.includes('delete') || n.includes('deleted')) return { entityType: 'products', operation: 'delete' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'products', operation: 'create' }
    return { entityType: 'products', operation: 'update' }
  }

  if (n.includes('customer')) {
    if (n.includes('delete') || n.includes('deleted')) return { entityType: 'customers', operation: 'delete' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'customers', operation: 'create' }
    return { entityType: 'customers', operation: 'update' }
  }

  if (n.includes('category')) {
    if (n.includes('delete') || n.includes('deleted')) return { entityType: 'categories', operation: 'delete' }
    if (n.includes('create') || n.includes('created')) return { entityType: 'categories', operation: 'create' }
    return { entityType: 'categories', operation: 'update' }
  }

  if (n.includes('abandoned') && n.includes('cart')) {
    return { entityType: 'orders', operation: 'create' }
  }

  return null
}

/**
 * Resolve one event to its entity + operation, or `null` when the event maps to
 * nothing this app syncs (the caller then allows it through the gate and the
 * engine performs no write).
 *
 * Salla is answered from the explicit table first. An event missing from the
 * table still falls through to the heuristic, so a newly published Salla event
 * degrades to the old behaviour instead of silently becoming a no-op.
 * Shopify-only events the heuristic misroutes (collections/*, orders/delete)
 * are answered from the SHOPIFY_EVENTS table first for the same reason —
 * Zid shares the heuristic and must keep it byte-for-byte.
 */
export function resolveEventOperation(
  event: string,
  platform?: PlatformName | string
): ResolvedOperation | null {
  if (!event) return null
  if (platform === 'salla') {
    const exact = SALLA_EVENTS[event.toLowerCase()]
    if (exact) return exact
  }
  if (platform === 'shopify') {
    const exact = SHOPIFY_EVENTS[event.toLowerCase()]
    if (exact) return exact
  }
  return resolveBySubstring(event)
}

/** Just the operation, for callers that already know the entity. */
export function resolveOperationForEvent(
  event: string,
  platform?: PlatformName | string
): SyncOperation | null {
  return resolveEventOperation(event, platform)?.operation ?? null
}

/** The event slugs Salla classifies explicitly — used by the pinning test. */
export function classifiedSallaEvents(): string[] {
  return Object.keys(SALLA_EVENTS)
}

/** The event slugs Shopify classifies explicitly — used by the pinning test. */
export function classifiedShopifyEvents(): string[] {
  return Object.keys(SHOPIFY_EVENTS)
}
