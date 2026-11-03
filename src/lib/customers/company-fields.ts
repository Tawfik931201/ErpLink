/** Pure customer company-field enrichment. Explicitly mapped values win. */

function readNonEmptyString(...values: unknown[]): string {
  for (const v of values) {
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s && s !== 'None' && s !== 'null' && s !== 'undefined') return s
  }
  return ''
}

/**
 * Auto-inject company/tax fields from the platform payload onto a res.partner
 * write, so tax number (الرقم الضريبي) + commercial registry (السجل التجاري)
 * always reach Odoo even when the workspace has no mapping row for them.
 * Explicitly-mapped values win — this only fills gaps.
 */
export function injectCustomerCompanyFields(
  odooValues: Record<string, unknown>,
  zidData: Record<string, unknown>
): Record<string, unknown> {
  const values = { ...odooValues }
  const taxNumber = readNonEmptyString(zidData.tax_number, zidData.vat, zidData.tax_id, zidData.vat_number)
  const commercialReg = readNonEmptyString(
    zidData.commercial_registration,
    zidData.cr_number,
    zidData.commercial_registration_number,
    zidData.company_registry
  )
  const businessName = readNonEmptyString(zidData.business_name, zidData.company_name)

  if (taxNumber && values.vat === undefined) values.vat = taxNumber
  if (commercialReg && values.company_registry === undefined) values.company_registry = commercialReg
  if (businessName && values.company_name === undefined) values.company_name = businessName

  const isCompany = !!taxNumber || !!commercialReg || !!businessName
  if (isCompany && values.company_type === undefined) {
    values.company_type = 'company'
  }
  return values
}
