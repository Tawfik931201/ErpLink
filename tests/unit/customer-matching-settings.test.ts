import { defaultCustomerMatchFields, validateCustomerMatchSettings } from '../../src/lib/customers/matching-settings'

describe('customer matching capabilities', () => {
  const fields = { id: { type: 'integer', readonly: true }, phone: { type: 'char' }, email: { type: 'char' }, child_ids: { type: 'one2many' } }

  it('rejects the removed Odoo 19 mobile field without changing saved choices', () => {
    const settings = { match_zid_field: 'mobile', match_odoo_field: 'mobile' }
    expect(() => validateCustomerMatchSettings(settings, fields)).toThrow(/unavailable/)
    expect(settings.match_odoo_field).toBe('mobile')
  })

  it('accepts confirmed mobile on older or customized Odoo databases', () => {
    expect(() => validateCustomerMatchSettings({ match_zid_field: 'mobile', match_odoo_field: 'mobile' }, { ...fields, mobile: { type: 'char' } })).not.toThrow()
  })

  it('validates both sides and rejects relational or readonly write targets', () => {
    expect(() => validateCustomerMatchSettings({ match_zid_field: 'telephone' }, fields)).toThrow(/both/)
    expect(() => validateCustomerMatchSettings({ match_zid_field: 'id', match_odoo_field: 'child_ids' }, fields)).toThrow(/scalar/)
    expect(() => validateCustomerMatchSettings({ match_zid_field: 'name', match_odoo_field: 'display_name' }, { display_name: { type: 'char', readonly: true } })).toThrow(/scalar/)
    expect(() => validateCustomerMatchSettings({ match_zid_field: 'id', match_odoo_field: 'id' }, fields)).not.toThrow()
  })

  it('seeds the actual Zid webhook phone source and a supported Odoo field', () => {
    expect(defaultCustomerMatchFields('zid', fields)).toEqual({ match_zid_field: 'telephone', match_odoo_field: 'phone' })
    expect(defaultCustomerMatchFields('zid', { mobile: { type: 'char' } }).match_odoo_field).toBe('mobile')
    expect(defaultCustomerMatchFields('shopify', fields).match_zid_field).toBe('phone')
    expect(defaultCustomerMatchFields('salla', fields).match_zid_field).toBe('mobile')
  })
})
