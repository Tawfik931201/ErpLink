import { mergeZidProductPayload } from '@/lib/zid/products'

describe('Zid product event freshness', () => {
  it('does not allow a late publish snapshot to revert a newer price or name', () => {
    const stalePublish = {
      id: 'product-1', sku: 'QA-SKU', price: 180,
      name: { ar: 'الاسم القديم' }, updated_at: '2026-11-18T00:06:36Z',
      event_only_marker: 'delivery',
    }
    const currentApi = {
      id: 'product-1', sku: 'QA-SKU', price: 210,
      name: { ar: 'الاسم الجديد' }, updated_at: '2026-11-18T00:07:36Z',
    }
    expect(mergeZidProductPayload(stalePublish, currentApi)).toEqual({
      ...currentApi, event_only_marker: 'delivery',
    })
  })

  it('does not revive removed variants, bundle members or categories', () => {
    const stalePublish = {
      id: 'p1',
      variants: [{ sku: 'obsolete' }],
      options: [{ id: 'obsolete-option' }],
      categories: [{ id: 42 }],
      group_products: [{ item_id: 'obsolete-member' }],
    }
    const currentApi = {
      id: 'p1',
      variants: [],
      options: [],
      categories: [],
      group_products: [],
    }
    const result = mergeZidProductPayload(stalePublish, currentApi)
    expect(result.variants).toEqual([])
    expect(result.options).toEqual([])
    expect(result.categories).toEqual([])
    expect(result.group_products).toEqual([])
  })

  it('preserves webhook-only fields when the API does not return them', () => {
    expect(mergeZidProductPayload(
      { id: 'p1', price: 101, custom_delivery_marker: 'abc' },
      { id: 'p1', price: 115 }
    )).toEqual({ id: 'p1', price: 115, custom_delivery_marker: 'abc' })
  })
})
