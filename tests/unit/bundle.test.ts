import {
  extractBundleComponents,
  formatBundleInternalNotes,
  isDynamicBundle,
} from '../../src/lib/products/bundle'

describe('bundle helpers', () => {
  it('detects dynamic_bundle only', () => {
    expect(isDynamicBundle({ product_class: 'dynamic_bundle' })).toBe(true)
    expect(isDynamicBundle({ product_class: 'grouped_product' })).toBe(false)
    expect(isDynamicBundle({})).toBe(false)
    expect(isDynamicBundle(null)).toBe(false)
  })

  it('extracts components from all known keys', () => {
    const data = {
      grouped_products: [
        { item: { id: 'p1', sku: 'SKU-1', name: { ar: 'عطر', en: 'Perfume' } }, quantity: 2 },
        { sku: 'SKU-2', name: 'Chocolate', qty: 3 },
      ],
    }
    expect(extractBundleComponents(data)).toEqual([
      { id: 'p1', sku: 'SKU-1', barcode: '', name: 'عطر', quantity: 2 },
      { id: null, sku: 'SKU-2', barcode: '', name: 'Chocolate', quantity: 3 },
    ])
  })

  it('returns [] when no components are carried', () => {
    expect(extractBundleComponents({ product_class: 'dynamic_bundle' })).toEqual([])
    expect(extractBundleComponents(null)).toEqual([])
  })

  it('extracts components from the option-group object shape (dynamic bundle order payload)', () => {
    // Zid order payloads carry bundle_products as an object keyed by the
    // option-group name, each value an array of picked products.
    const data = {
      bundle_products: {
        'اختيار 1': [{ id: 'a1', sku: 'SKU-1', name: 'Perfume', quantity: 1 }],
        'اختيار 2': [{ id: 'b2', sku: 'SKU-2', name: 'Chocolate', quantity: 2 }],
      },
    }
    expect(extractBundleComponents(data)).toEqual([
      { id: 'a1', sku: 'SKU-1', barcode: '', name: 'Perfume', quantity: 1 },
      { id: 'b2', sku: 'SKU-2', barcode: '', name: 'Chocolate', quantity: 2 },
    ])
  })

  it('defaults component quantity to 1', () => {
    const [c] = extractBundleComponents({ components: [{ sku: 'A' }] })
    expect(c.quantity).toBe(1)
  })

  it('formats internal notes and never returns empty text for empty components', () => {
    const notes = formatBundleInternalNotes({
      grouped_products: [
        { item: { sku: 'SKU-1', name: { ar: 'عطر' } }, quantity: 1 },
        { sku: 'SKU-2', name: 'Chocolate', quantity: 2 },
      ],
    })
    expect(notes).toContain('بزمة ديناميكية')
    expect(notes).toContain('عطر ×1 (SKU: SKU-1)')
    expect(notes).toContain('Chocolate ×2 (SKU: SKU-2)')
    expect(formatBundleInternalNotes({})).toBe('')
  })
})
