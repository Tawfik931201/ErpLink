import { normalizeOdooOperation, presetEntityType } from '@/lib/sync-engine'

/**
 * `normalizeOdooOperation` decides whether an inbound event creates, updates,
 * deletes, cancels or delivers a record in Odoo. Getting it wrong means either
 * duplicate records or lost updates, so the precedence order is pinned here.
 *
 * Source under test: src/lib/sync-engine.ts
 */

describe('normalizeOdooOperation', () => {
  it('passes through an explicit valid operation unchanged', () => {
    expect(normalizeOdooOperation('create', 'anything')).toBe('create')
    expect(normalizeOdooOperation('update', 'anything')).toBe('update')
    expect(normalizeOdooOperation('delete', 'anything')).toBe('delete')
    expect(normalizeOdooOperation('cancel', 'anything')).toBe('cancel')
    expect(normalizeOdooOperation('deliver', 'anything')).toBe('deliver')
  })

  it('derives the operation from the event name', () => {
    expect(normalizeOdooOperation(undefined, 'zid:order.update')).toBe('update')
    expect(normalizeOdooOperation(null, 'zid:order.cancel')).toBe('cancel')
    expect(normalizeOdooOperation('', 'zid:order.delete')).toBe('delete')
    expect(normalizeOdooOperation(undefined, 'zid:order.deliver')).toBe('deliver')
  })

  it('treats a publish event as an update', () => {
    expect(normalizeOdooOperation(undefined, 'zid:product.publish')).toBe('update')
  })

  it('honours the aliases table before substring matching', () => {
    // 'shopify:collections/delete' must NOT collapse to the generic word
    // matching below; the alias resolves it to category.delete first.
    expect(normalizeOdooOperation(undefined, 'shopify:collections/delete')).toBe('delete')
  })

  it('defaults to create for an unrecognised event', () => {
    expect(normalizeOdooOperation(undefined, 'zid:something.unknown')).toBe('create')
  })

  it('ignores an unrecognised operation string and falls back to the event', () => {
    expect(normalizeOdooOperation('frobnicate', 'zid:order.update')).toBe('update')
  })

  it('keeps cancel ahead of the generic "delete" substring', () => {
    // A cancel event whose name also contains "delete" must stay a cancel.
    expect(normalizeOdooOperation(undefined, 'zid:order.delete_cancel')).toBe('cancel')
  })
})

describe('presetEntityType', () => {
  it('maps a preset key to the entity the settings guard checks', () => {
    expect(presetEntityType('category')).toBe('categories')
    expect(presetEntityType('product')).toBe('products')
    expect(presetEntityType('customer')).toBe('customers')
    expect(presetEntityType('order')).toBe('orders')
  })

  it('matches a longer preset key containing the entity name', () => {
    expect(presetEntityType('orders.full')).toBe('orders')
  })

  it('returns null when no entity matches, so no guard is applied', () => {
    expect(presetEntityType('something-else')).toBeNull()
    expect(presetEntityType('')).toBeNull()
  })

  it('keeps the first-match order (category before product)', () => {
    // "category_products" contains both needles; the documented order makes
    // 'categories' win. Pinned so reordering the table cannot slip through.
    expect(presetEntityType('category_products')).toBe('categories')
  })
})
