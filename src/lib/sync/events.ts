import { resolveEventOperation, resolveOperationForEvent } from '@/lib/event-operation'
import type { OdooOperation } from '@/lib/sync-types'

// ─── Helper: Determine platform from webhook event ──────────────────────────
export function getPlatformFromEvent(event: string): 'zid' | 'salla' | 'shopify' {
  // Shopify events use "shopify:" prefix, contain "shopify", or use "/" syntax (orders/create, products/create)
  if (event.startsWith('shopify:') || event.includes('shopify') || event.includes('/')) return 'shopify'
  if (event.includes('salla')) return 'salla'
  if (event.includes('zid')) return 'zid'

  // Explicit Zid events (Zid uses .update present-tense and specific status names)
  if (
    event === 'order.status.update' ||
    event === 'order.payment_status.update' ||
    event === 'order_status_update' ||
    event === 'order_payment_status_update' ||
    event === 'order.create' ||
    event === 'order.created' ||
    event === 'order_create' ||
    event === 'order_created'
  ) {
    return 'zid'
  }

  // Salla events use past-tense verbs (.updated, .cancelled, etc.)
  if (
    event === 'order.status.updated' ||
    event.endsWith('.cancelled') ||
    event.endsWith('.refunded') ||
    event.endsWith('.low') ||
    event.endsWith('.available') ||
    event.endsWith('.changed')
  ) {
    return 'salla'
  }
  return 'zid'
}

// Note: Fixed mapping presets are now sourced exclusively from the database
// (fixed_mappings and fixed_mapping_preset_definitions tables), seeded via migration.
// No hardcoded fallback needed.

// ─── Helper: derive fixed-mapping preset_key from event + platform ────────────
// Known preset_key format: {platform}_{model}_{action}
// e.g. "zid_product_create", "salla_order_update", "shopify_product_create"
//                          "zid_category", "shopify_category_create"
export function derivePresetKey(event: string, platform: string): string | null {
  if (platform === 'salla') {
    const resolved = resolveEventOperation(event, platform)
    if (!resolved) return null
    if (resolved.entityType === 'categories') return 'salla_category'
    return `salla_${resolved.entityType.slice(0, -1)}_${resolved.operation}`
  }

  const ev = event.toLowerCase()
  let model = ''
  let action = ''

  if (platform === 'shopify' || ev.includes('shopify')) {
    const m = ev.match(/shopify:(.+?)_(create|update)/)
    if (m) { model = m[1]; action = m[2] === 'create' ? 'create' : 'update' }
    // Shopify slash topics (products/create, orders/paid, ...): حوّلها لنفس مفاتيح presets.
    if (!model || !action) {
      const slash = ev.match(/^(products|orders|customers|collections|carts|checkouts|inventory_levels|inventory_items|refunds)\/(.+)$/)
      if (slash) {
        const domain = slash[1]
        const verb = slash[2]
        if (domain === 'products') model = 'product'
        else if (domain === 'orders') model = 'order'
        else if (domain === 'customers') model = 'customer'
        else if (domain === 'collections') model = 'category'
        else model = domain
        // Shopify deletes the order record on `orders/delete`, but the engine has
        // no sale.order delete branch — event-operation.ts classifies it as
        // `cancel` and normalizeOdooOperation agrees. Key it as cancel so the
        // preset, the gate check and the write all mean the same thing.
        // (products/customers/collections keep `delete`: they do have one.)
        if (/(cancel|delete)/.test(verb)) action = verb.includes('cancel') ? 'cancel' : (domain === 'orders' ? 'cancel' : 'delete')
        else if (/(fulfill|deliver|paid|partial)/.test(verb)) action = verb.includes('cancel') ? 'cancel' : (domain === 'orders' && /fulfill|partial/.test(verb) ? 'deliver' : 'update')
        else if (/update|edit/.test(verb)) action = 'update'
        else action = 'create'
      }
    }
  }
  if (!model || !action) {
    if (ev.includes('order')) {
      model = 'order'
      if (/(cancel|reversed|delete)/.test(ev)) action = 'cancel'
      else if (/(deliver|fulfill)/.test(ev)) action = 'deliver'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else if (ev.includes('customer')) {
      model = 'customer'
      if (/delete/.test(ev)) action = 'delete'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else if (ev.includes('category') || ev.includes('collection')) {
      model = 'category'
      if (/delete/.test(ev)) action = 'delete'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else if (ev.includes('product')) {
      model = 'product'
      if (/delete/.test(ev)) action = 'delete'
      else if (/create/.test(ev)) action = 'create'
      else action = 'update'
    } else {
      const m = ev.match(/^(\w+)\.(create|update|delete|cancel|deliver)d?$/) ?? ev.match(/^(\w+)_(create|update|delete|cancel|deliver)d?$/)
      if (m) {
        const entity = m[1]
        const verb = m[2]
        if      (entity === 'customer')  model = 'customer'
        else if (entity === 'order')     model = 'order'
        else if (entity === 'category')  model = 'category'
        else                             model = 'product'
        action = verb
      }
    }
  }

  if (!model || !action) return null

  // Zid presets: products, customers, orders all have separate create/update/delete.
  // Categories use a SINGLE unified preset "zid_category" (same settings for all ops).
  // The `${platform}_${model}_${action}` key is what the
  // fixed_mapping_preset_definitions table is keyed on.
  if (model === 'category') return `${platform}_category`
  return `${platform}_${model}_${action}`
}

// ─── Event normalization ──────────────────────────────────────────────────────
// Zid sometimes sends 'product.created' while field_mappings stores 'product.create'.
const EVENT_ALIASES: Record<string, string> = {
  'product.created':        'product.create',
  'product.updated':        'product.update',
  'product.deleted':        'product.delete',
  'product.published':      'product.publish',
  'product_create':         'product.create',
  'product_created':        'product.create',
  'product_update':         'product.update',
  'product_updated':        'product.update',
  'product_delete':         'product.delete',
  'product_deleted':        'product.delete',
  'product.stock.create':   'product.create',
  'product.stock.update':   'product.update',
  'product.stock.delete':   'product.delete',
  'order.created':              'order.create',
  'order.updated':              'order.update',
  'order.status.update':        'order.update',
  'order.status.updated':       'order.update',
  'order.status_update':        'order.update',
  'order_status_update':        'order.update',
  'order_status_updated':       'order.update',
  'order.cancelled':            'order.cancel',
  'order.delivered':            'order.deliver',
  'order.payment_status.update':'order.update',
  'order_payment_status_update':'order.update',
  'order.refunded':             'order.update',
  'order.reversed':             'order.cancel',
  'order_create':               'order.create',
  'order_created':              'order.create',
  'order_update':               'order.update',
  'order_cancel':               'order.cancel',
  'order_deliver':              'order.deliver',
  'orders/create':              'order.create',
  'orders/updated':             'order.update',
  'orders/cancelled':           'order.cancel',
  'orders/fulfilled':           'order.deliver',
  'orders/paid':                'order.update',
  'orders/partially_fulfilled': 'order.deliver',
  'orders/edited':              'order.update',
  'orders/delete':              'order.cancel',
  'customer.created':       'customer.create',
  'customer.updated':       'customer.update',
  'customer.merchant.update': 'customer.update',
  'customer.merchant.updated': 'customer.update',
  'customer_create':        'customer.create',
  'customer_created':       'customer.create',
  'customer_update':        'customer.update',
  'customer_updated':       'customer.update',
  'category.created':       'category.create',
  'category.updated':       'category.update',
  'category.deleted':       'category.delete',
  'category_create':        'category.create',
  'category_created':       'category.create',
  'category_update':        'category.update',
  'category_updated':       'category.update',
  'category_delete':        'category.delete',
  'category_deleted':       'category.delete',
  'collections/create':     'category.create',
  'collections/update':     'category.update',
  'collections/delete':     'category.delete',
  'shopify:collections/create': 'category.create',
  'shopify:collections/update': 'category.update',
  'shopify:collections/delete': 'category.delete',
}

export function normalizeEvent(event: string): string {
  return EVENT_ALIASES[event] ?? event
}

export function normalizeOdooOperation(operation: unknown, event: string, platform?: string): OdooOperation {
  if (operation === 'create' || operation === 'update' || operation === 'delete' || operation === 'cancel' || operation === 'deliver') {
    return operation as OdooOperation
  }

  // Salla is answered from the shared explicit table BEFORE the substring
  // heuristics below, because the two disagree on real Salla events:
  // `order.shipment.cancelled` would substring-match to `cancel` and cancel the
  // whole sale.order when only a shipment was cancelled, and
  // `product.quantity.low` / `customer.login` would fall through to `create`.
  // The webhook gate resolves the same event through the same table, so the
  // operation a merchant enabled is the operation that runs.
  //
  // Only consulted when the platform is explicitly 'salla'. Zid and Shopify
  // share some slug spellings (`order.created`, `order.deleted`, …) and must
  // keep the alias table below — Salla's table would change their meaning.
  if (platform === 'salla') {
    const sallaOperation = resolveOperationForEvent(event, platform)
    if (sallaOperation) return sallaOperation as OdooOperation
  }

  const normalizedEvent = normalizeEvent(event)
  if (normalizedEvent.includes('cancel')) return 'cancel'
  if (normalizedEvent.includes('deliver')) return 'deliver'
  if (normalizedEvent.includes('delete')) return 'delete'
  if (normalizedEvent.includes('update') || normalizedEvent.includes('publish')) return 'update'
  return 'create'
}

/**
 * مفتاح الـpreset إلى نوع الكيان الذي يفحصه حارس الإعدادات.
 * الترتيب مقصود: أول تطابق يفوز (السلوك السابق كان سلسلة `if` متتابعة).
 * يُرجع null عندما لا يطابق الـpreset أي كيان معروف ⇒ لا يُطبَّق الحارس.
 */
const PRESET_ENTITY_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['category', 'categories'],
  ['product', 'products'],
  ['customer', 'customers'],
  ['order', 'orders'],
]

export function presetEntityType(presetKey: string): string | null {
  for (const [needle, entityType] of PRESET_ENTITY_TYPES) {
    if (presetKey.includes(needle)) return entityType
  }
  return null
}

// ─── Store entity identity in webhook payloads ────────────────────────────
/** The store-side entity id carried by a webhook payload.
 *
 *  A Zid `product.delete` payload carries `product_id`, not `id` (the same
 *  reason the fallback create-path chain at the fixed-mapping catch and the
 *  sync_queue ENTITY_KEYS accept `product_id`/`sku`). Using `id`-only chains
 *  made the execution context incomplete and failed the whole delete with
 *  "ERP execution context is incomplete" (reported 2026-11-09 on a Zid
 *  product delete). One helper, every site: the context builder, the
 *  executeOdooOperation zidEntityId, the catch-log, and processSingleMapping. */
export function storeEntityIdFromPayload(data: Record<string, unknown>): string {
  return String(
    data.id ?? data.category_id ?? data.category_uuid ?? data.product_id ??
    data.customer_id ?? data.order_id ?? ''
  )
}
