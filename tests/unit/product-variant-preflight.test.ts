import { assertCompleteVariantCombinations, type GenericVariant } from '@/lib/products/variants'

function variant(id: string, attributes: Record<string,string>): GenericVariant {
  return { id, sku: id, price: 10, attributes }
}

describe('native variant preflight prevents partial Odoo writes', () => {
  it('accepts fully specified, distinct options', () => {
    expect(() => assertCompleteVariantCombinations([
      variant('red-small', { Color: 'Red', Size: 'Small' }),
      variant('blue-large', { Color: 'Blue', Size: 'Large' }),
    ])).not.toThrow()
  })

  it('rejects missing option values before the first template mutation', () => {
    expect(() => assertCompleteVariantCombinations([
      variant('white', {}),
      variant('black', { Color: 'Black' }),
    ])).toThrow(/missing attribute combination/)
    expect(() => assertCompleteVariantCombinations([
      variant('blank', { Color: '  ' }),
    ])).toThrow(/missing attribute combination/)
  })

  it('rejects ambiguous duplicate combinations regardless of case/order', () => {
    expect(() => assertCompleteVariantCombinations([
      variant('a', { Color: 'Red', Size: 'Large' }),
      variant('b', { size: 'large', color: 'RED' }),
    ])).toThrow(/duplicate attribute combination/)
  })

  it('rejects inconsistent attribute groups', () => {
    expect(() => assertCompleteVariantCombinations([
      variant('a', { Color: 'Red', Size: 'Large' }),
      variant('b', { Color: 'Blue' }),
    ])).toThrow(/inconsistent attribute groups/)
  })

  it('does not reject a product with zero variants', () => {
    expect(() => assertCompleteVariantCombinations([])).not.toThrow()
  })
})
