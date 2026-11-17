import { readFileSync } from 'fs'
import { join } from 'path'

import { pickStaleZidVariants } from '../../src/lib/products/variant-reconciliation'

const ENGINE_PATH = join(__dirname, '../../src/lib/odoo/product-native-variants.ts')
const source = readFileSync(ENGINE_PATH, 'utf8')

describe('Zid parent update archives variants removed from the option list', () => {
  it('returns nothing for an empty current list — never "remove everything"', () => {
    expect(pickStaleZidVariants({
      odooVariantIds: [10, 11],
      usedOdooVariantIds: [],
      priorLinks: [{ zidEntityId: 'red', odooRecordId: 10 }],
      currentZidVariantIds: [],
    })).toEqual([])
  })

  it('archives only prior Zid variants that disappeared from the full list', () => {
    expect(pickStaleZidVariants({
      odooVariantIds: [10, 11, 12],
      usedOdooVariantIds: [11],
      priorLinks: [
        { zidEntityId: 'red', odooRecordId: 10 },
        { zidEntityId: 'green', odooRecordId: 11 },
        { zidEntityId: 'blue', odooRecordId: 12 },
      ],
      currentZidVariantIds: ['green'],
    })).toEqual([10, 12])
  })

  it('never touches Odoo variants with no prior Zid history', () => {
    expect(pickStaleZidVariants({
      odooVariantIds: [10, 99],
      usedOdooVariantIds: [10],
      priorLinks: [{ zidEntityId: 'red', odooRecordId: 10 }],
      currentZidVariantIds: ['green'],
    })).toEqual([])
  })

  it('ignores links to variants outside this template and malformed ids', () => {
    expect(pickStaleZidVariants({
      odooVariantIds: [10],
      usedOdooVariantIds: [],
      priorLinks: [
        { zidEntityId: 'gone', odooRecordId: 777 },
        { zidEntityId: 'zero', odooRecordId: 0 },
        { zidEntityId: 'bad', odooRecordId: Number.NaN },
      ],
      currentZidVariantIds: ['red'],
    })).toEqual([])
  })

  it('keeps a variant that matched by a different source id than its old link', () => {
    // Zid variant ids are stable; the guard also covers a re-used Odoo record.
    expect(pickStaleZidVariants({
      odooVariantIds: [10],
      usedOdooVariantIds: [10],
      priorLinks: [{ zidEntityId: 'old-id', odooRecordId: 10 }],
      currentZidVariantIds: ['new-id'],
    })).toEqual([])
  })
})

describe('wiring pins: native variant executor calls the reconciliation', () => {
  it('calls pickStaleZidVariants and archives with active:false on an update', () => {
    expect(source).toMatch(/pickStaleZidVariants\(\{/)
    expect(source).toMatch(/client\.write\('product\.product', staleIds, \{ active: false \}\)/)
    // Reconciliation must not fire on a first create or an empty/unknown list.
    expect(source).toMatch(/duplicateId !== null\s*&&\s*variants\.length > 0/)
  })

  it('fails if the reconciliation wiring is removed', () => {
    const guard = (src: string) =>
      /pickStaleZidVariants\(\{/.test(src)
      && /client\.write\('product\.product', staleIds, \{ active: false \}\)/.test(src)
    expect(guard(source)).toBe(true)
    expect(guard(source.replace('pickStaleZidVariants({', 'noReconciliation({'))).toBe(false)
  })
})


describe('variant attribute-line race guards', () => {
  it('re-reads and consolidates duplicate attribute lines before variant generation', () => {
    expect(source).toMatch(/ensureSingleAttributeLine\(/)
    expect(source).toMatch(/lines\.slice\(1\).*flatMap/)
    expect(source).toMatch(/client\.unlink\('product\.template\.attribute\.line', duplicateIds\)/)
  })
})
