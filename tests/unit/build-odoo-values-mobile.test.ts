import { buildOdooValues } from '@/lib/sync-engine'
import type { OdooFieldMeta } from '@/lib/sync-types'

/**
 * Odoo 19 removed res.partner.mobile. buildOdooValues normally skips any
 * field the map lacks, but when fetchFieldMeta comes back empty (the
 * ir.model.fields read fails on some SaaS tenants) the old code dropped into
 * HARDCODED_FIELD_META — where `mobile` exists — and the res.partner.write
 * died with `KeyError: 'mobile'`. These tests pin the guard: `mobile` is only
 * written when Odoo positively confirms the field.
 *
 * Source under test: src/lib/sync-engine.ts → buildOdooValues
 */

const client = {} as any

const fieldMetaOf = (names: string[]): Map<string, OdooFieldMeta> =>
  new Map(names.map((name) => [name, { name, ttype: 'char', relation: '' }]))

describe('buildOdooValues — res.partner.mobile guard (Odoo 19)', () => {
  it('writes mobile when Odoo confirms the field exists', async () => {
    const values = await buildOdooValues(
      client,
      [
        { id: 'm1', erpField: 'name', zidField: 'name' },
        { id: 'm2', erpField: 'mobile', zidField: 'mobile' },
      ],
      { name: 'ali', mobile: '0501234567' },
      fieldMetaOf(['name', 'mobile'])
    )
    expect(values).toEqual({ name: 'ali', mobile: '0501234567' })
  })

  it('skips only mobile when the field map is non-empty but lacks it', async () => {
    const values = await buildOdooValues(
      client,
      [
        { id: 'm1', erpField: 'name', zidField: 'name' },
        { id: 'm2', erpField: 'mobile', zidField: 'mobile' },
      ],
      { name: 'ali', mobile: '0501234567' },
      fieldMetaOf(['name'])
    )
    expect(values).toEqual({ name: 'ali' })
  })

  it('skips mobile on an empty field map yet keeps other hardcoded fields (regression guard)', async () => {
    const values = await buildOdooValues(
      client,
      [
        { id: 'm1', erpField: 'name', zidField: 'name' },
        { id: 'm2', erpField: 'mobile', zidField: 'mobile' },
        { id: 'm3', erpField: 'email', zidField: 'email' },
      ],
      { name: 'ali', mobile: '0501234567', email: 'ali@x.com' },
      new Map()
    )
    expect(values).toEqual({ name: 'ali', email: 'ali@x.com' })
  })
})