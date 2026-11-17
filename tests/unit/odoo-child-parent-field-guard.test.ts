import fs from 'fs'
import path from 'path'

describe('Zid child variant parent lookup (Odoo 14–20)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/odoo/product-native-variants.ts'), 'utf8')

  it('checks product.template metadata before searching store-ID columns', () => {
    const start = source.indexOf('const parentMatchFields =')
    const end = source.indexOf('// Fallback 1: Resolve parent template via odoo_entity_links', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const parentLookup = source.slice(start, end)
    expect(parentLookup).toContain("await fetchFieldMeta(")
    expect(parentLookup).toContain("'product.template'")
    expect(parentLookup).toContain('parentFieldMeta.has(field)')
    expect(parentLookup.indexOf('parentFieldMeta.has(field)'))
      .toBeLessThan(parentLookup.indexOf("await client.search('product.template'"))
  })

  it('keeps the store-scoped link and success-log fallbacks when custom fields are absent', () => {
    expect(source).toContain("storeEntityId: String(parentZidId)")
    expect(source).toContain("storeId,")
    expect(source).toContain("// Fallback 1: Resolve parent template via odoo_entity_links")
    expect(source).toContain("// Fallback 2: Resolve parent template via sync_logs")
    expect(source).toContain("// Fallback 3: Check custom Odoo fields on product.template")
  })

  it('does not attempt to search Odoo numeric id with a Zid UUID', () => {
    expect(source).toContain("!Number.isSafeInteger(Number(parentZidId))")
    expect(source).toContain("Number(parentZidId) <= 0")
  })
})
