import { extractGenericVariants } from '../../src/lib/products/variants'
import { extractGenericVariants as compatibilityExtract } from '../../src/lib/sync-engine'

describe('product variant normalization characterization', () => {
  it('preserves the original engine export', () => {
    expect(compatibilityExtract).toBe(extractGenericVariants)
  })

  it('returns no variants for absent payloads or Zid option definitions', () => {
    expect(extractGenericVariants(null, 'zid')).toEqual([])
    expect(extractGenericVariants({ options: [{ id: 'definition' }] }, 'zid')).toEqual([])
  })

  it('uses Salla options when variants are empty and preserves localized attributes', () => {
    const [variant] = extractGenericVariants({ id: 20, variants: [], options: [{
      uuid: 'v1', sku_code: 'SKU', regular_price: '12.50', stock_quantity: '3',
      features: [{ label: { ar: 'اللون' }, text: { ar: 'أحمر' } }],
    }] }, 'salla')
    expect(variant).toMatchObject({ id: 'v1', sku: 'SKU', price: 12.5, quantity: 3,
      product_id: 20, attributes: { اللون: 'أحمر' } })
  })

  it('keeps legacy id fallbacks and preserves explicit zero price, cost, stock and weight', () => {
    const [variant] = extractGenericVariants({ id: 'parent', weight: 9, variants: [{
      id: 0, uuid: 'fallback-id', sale_price: 0, price: '8', quantity: 0,
      stock_quantity: 6, weight: 0, cost: 0, cost_price: '4', product_id: 0,
    }] }, 'zid')
    expect(variant).toMatchObject({ id: 'fallback-id', price: 0, quantity: 0,
      weight: 0, cost: 0, product_id: 'parent' })
  })

  it('uses Shopify option names and inventory quantities', () => {
    const [variant] = extractGenericVariants({ options: [{ name: 'Color' }, { name: 'Size' }],
      variants: [{ id: 7, option1: 'Red', option2: 'Large', inventory_quantity: '2', gtin: 'GTIN' }],
    }, 'shopify')
    expect(variant).toMatchObject({ attributes: { Color: 'Red', Size: 'Large' },
      quantity: 2, barcode: 'GTIN' })
  })

  it('normalizes invalid quantities, object weights, descriptions and image precedence', () => {
    const [variant] = extractGenericVariants({ description: { ar: 'وصف' }, weight: { value: '1.25' },
      variants: [{ quantity: 'invalid', image: { src: 'first.png' }, main_image: 'second.png',
        attributes: { Size: { en: 'Large' } } }],
    }, 'salla')
    expect(variant).toMatchObject({ quantity: undefined, weight: 1.25, description: 'وصف',
      image: 'first.png', attributes: { Size: 'Large' } })
  })

  it('does not mutate the source payload', () => {
    const payload = { variants: [{ sku: 'A', attributes: [{ name: 'Size', value: 'S' }] }] }
    const before = JSON.stringify(payload)
    extractGenericVariants(payload, 'zid')
    expect(JSON.stringify(payload)).toBe(before)
  })
})
