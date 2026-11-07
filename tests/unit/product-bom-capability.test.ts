import { assertBomCapability, needsProductBom } from '../../src/lib/products/bom-capability'

const capability = () => ({ execute: jest.fn(async (model: string) => model === 'mrp.bom' ? {
  product_tmpl_id: { type: 'many2one' }, bom_line_ids: { type: 'one2many' },
  type: { type: 'selection', selection: [['normal', 'Manufacture'], ['phantom', 'Kit']] },
} : { product_id: { type: 'many2one' }, product_qty: { type: 'float' } }) })

describe('BoM capability before product effects', () => {
  it.each(['normal', 'phantom'])('accepts supported %s BoMs', async type => {
    await expect(assertBomCapability(capability(), type)).resolves.toBeUndefined()
  })
  it('rejects missing Manufacturing with an actionable error', async () => {
    const client = { execute: jest.fn().mockRejectedValue(new Error("Object mrp.bom doesn't exist")) }
    await expect(assertBomCapability(client, 'normal')).rejects.toThrow('Manufacturing')
  })
  it('fails closed when required fields are unavailable', async () => {
    await expect(assertBomCapability({ execute: jest.fn().mockResolvedValue({}) })).rejects.toThrow('required')
  })
  it('rejects a selected type the ERP does not offer', async () => {
    const client = capability()
    client.execute.mockResolvedValueOnce({ product_tmpl_id: { type: 'many2one' }, bom_line_ids: { type: 'one2many' }, type: { type: 'selection', selection: [['normal', 'Manufacture']] } } as any)
    await expect(assertBomCapability(client, 'phantom')).rejects.toThrow('unavailable')
  })
  it.each(['grouped_product', 'grouped', 'bundle', 'dynamic_bundle'])('checks enabled %s products before writes', type => {
    expect(needsProductBom({ bom: { enabled: true } }, { product_class: type })).toBe(true)
    expect(needsProductBom({ bom: { enabled: false } }, { product_class: type })).toBe(false)
  })
  it('does not require Manufacturing for an ordinary product even when BoM is enabled', () => {
    expect(needsProductBom({ bom: { enabled: true } }, { sku: 'simple' })).toBe(false)
    expect(needsProductBom({ bom: { enabled: true } }, { components: [] })).toBe(true)
  })
})
