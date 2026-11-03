import { injectCustomerCompanyFields } from '../../src/lib/customers/company-fields'

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
})
