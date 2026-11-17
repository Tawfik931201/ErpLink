import { injectCustomerCompanyFields, normalizeCustomerCompanyTypeForOdoo, pruneUnsupportedCustomerCompanyFields } from '../../src/lib/customers/company-fields'

describe('customer company fields characterization', () => {
  it('fills undefined fields from platform aliases and classifies companies', () => {
    expect(injectCustomerCompanyFields({}, { tax_id: ' 123 ', cr_number: 456,
      company_name: ' Example ' })).toEqual({ vat: '123', company_registry: '456',
      company_name: 'Example', company_type: 'company' })
  })

  it('preserves explicit null, empty and false mapped values', () => {
    const values = { vat: null, company_registry: '', company_name: false, company_type: 'person' }
    expect(injectCustomerCompanyFields(values, { tax_number: '123', commercial_registration: '456',
      business_name: 'Example' })).toEqual(values)
  })

  it('skips exact sentinels and blanks before trying later aliases', () => {
    expect(injectCustomerCompanyFields({}, { tax_number: 'None', vat: 'null', tax_id: 'undefined',
      vat_number: ' 999 ', commercial_registration: ' ', cr_number: 'CR' }))
      .toEqual({ vat: '999', company_registry: 'CR', company_type: 'company' })
  })

  it('retains existing string coercion and case sensitive sentinel behavior', () => {
    expect(injectCustomerCompanyFields({}, { tax_number: 0, company_name: 'none' }))
      .toEqual({ vat: '0', company_name: 'none', company_type: 'company' })
  })

  it('returns a fresh copy without changing inputs, including noncompany payloads', () => {
    const values = { name: 'Customer' }
    const data = { tax_number: null }
    const result = injectCustomerCompanyFields(values, data)
    expect(result).toEqual(values)
    expect(result).not.toBe(values)
    expect(data).toEqual({ tax_number: null })
  })

  it('translates company_type to is_company on Odoo 20', () => {
    expect(normalizeCustomerCompanyTypeForOdoo({ name: 'Acme', company_type: 'company' }, 20))
      .toEqual({ name: 'Acme', is_company: true })
    expect(normalizeCustomerCompanyTypeForOdoo({ name: 'Person', company_type: 'person' }, 20))
      .toEqual({ name: 'Person', is_company: false })
  })

  it('keeps company_type unchanged on Odoo 14-19', () => {
    expect(normalizeCustomerCompanyTypeForOdoo({ company_type: 'company' }, 14))
      .toEqual({ company_type: 'company' })
    expect(normalizeCustomerCompanyTypeForOdoo({ company_type: 'person' }, 19))
      .toEqual({ company_type: 'person' })
  })

  it('preserves an explicit is_company value on Odoo 20', () => {
    expect(normalizeCustomerCompanyTypeForOdoo({ company_type: 'company', is_company: false }, 20))
      .toEqual({ is_company: false })
  })
  it('filters optional Zid B2B metadata absent on an Odoo 20 partner model', () => {
    const values = injectCustomerCompanyFields(
      { name: 'ERPTEST Business', phone: '966500000001' },
      { tax_number: '300000000000003', commercial_registration: '1010123456', business_name: 'ERPTEST LLC' },
    )
    const normalized = normalizeCustomerCompanyTypeForOdoo(values, 20)
    const supported = {
      name: {}, phone: {}, vat: {}, company_name: {}, is_company: {},
    }
    expect(pruneUnsupportedCustomerCompanyFields(normalized, supported)).toEqual({
      name: 'ERPTEST Business',
      phone: '966500000001',
      vat: '300000000000003',
      company_name: 'ERPTEST LLC',
      is_company: true,
    })
  })

  it('keeps company_registry on Odoo versions that expose it', () => {
    const values = injectCustomerCompanyFields({ name: 'B2B' }, { commercial_registration: '1234567890' })
    const normalized = normalizeCustomerCompanyTypeForOdoo(values, 14)
    expect(pruneUnsupportedCustomerCompanyFields(normalized, {
      company_registry: {}, company_type: {},
    })).toEqual({
      name: 'B2B',
      company_registry: '1234567890',
      company_type: 'company',
    })
  })

  it('never mutates caller values while dropping unsupported metadata', () => {
    const source = { name: 'Business', vat: '123', company_registry: 'CR', is_company: true }
    expect(pruneUnsupportedCustomerCompanyFields(source, { vat: {}, is_company: {} })).toEqual({
      name: 'Business', vat: '123', is_company: true,
    })
    expect(source.company_registry).toBe('CR')
  })

})
