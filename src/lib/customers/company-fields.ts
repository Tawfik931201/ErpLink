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

/**
 * Odoo 20 removed the computed `company_type` field from res.partner while
 * retaining the stable boolean `is_company`. Keep 14-19 behavior unchanged,
 * but translate every company_type value before an Odoo 20 write so both
 * settings-driven and payload-driven classification remain compatible.
 */
export function normalizeCustomerCompanyTypeForOdoo(
  odooValues: Record<string, unknown>,
  odooMajorVersion: number,
): Record<string, unknown> {
  const values = { ...odooValues }
  if (odooMajorVersion >= 20 && values.company_type !== undefined) {
    if (values.is_company === undefined) values.is_company = values.company_type === 'company'
    delete values.company_type
  }
  return values
}


/**
 * Optional company details are not present in every Odoo database/version.
 * In particular Odoo 20 may not expose company_registry, even when a
 * Zid business customer supplies a commercial registration number.
 * Never send an absent optional field to res.partner.write/create.
 * The supported-fields map comes from the *connected* Odoo fields_get.
 */
export function pruneUnsupportedCustomerCompanyFields(
  odooValues: Record<string, unknown>,
  supportedFields: Record<string, unknown>,
): Record<string, unknown> {
  const values = { ...odooValues }
  for (const field of ['company_registry', 'company_name', 'vat', 'company_type', 'is_company']) {
    if (Object.prototype.hasOwnProperty.call(values, field) &&
        !Object.prototype.hasOwnProperty.call(supportedFields, field)) {
      delete values[field]
    }
  }
  return values
}
