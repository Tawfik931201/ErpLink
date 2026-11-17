/** Customer matching must use a field the selected Odoo database actually has. */
export interface CustomerMatchField {
  type?: string
  readonly?: boolean
}

export function validateCustomerMatchSettings(
  settings: Record<string, unknown>,
  fields: Record<string, CustomerMatchField>
): void {
  const source = settings.match_zid_field
  const target = settings.match_odoo_field
  if (!!source !== !!target) throw new Error('Select both customer match fields / اختر حقلي مطابقة العميل معًا')
  if (!target) return
  if (typeof target !== 'string' || !fields[target]) {
    throw new Error(`Customer match field "${String(target)}" is unavailable in this Odoo database. Select an available field such as Phone / حقل مطابقة العميل غير متاح في أودوو؛ اختر حقلًا متاحًا مثل الهاتف`)
  }
  if (target !== 'id' && (fields[target].readonly || !['char', 'text', 'integer', 'float', 'selection'].includes(fields[target].type || ''))) {
    throw new Error('Select a writable scalar customer match field / اختر حقل مطابقة عميل قابلًا للكتابة')
  }
}

/** Only seed new settings; never rewrite a merchant's saved matching choice. */
export function defaultCustomerMatchFields(storeType: string, fields: Record<string, CustomerMatchField>) {
  return {
    match_zid_field: storeType === 'zid' ? 'telephone' : storeType === 'shopify' ? 'phone' : 'mobile',
    match_odoo_field: fields.mobile ? 'mobile' : 'phone',
  }
}

/**
 * An explicit Standard Mapping customer field is authoritative for lookup.
 * A different field (especially an old shared email) must not silently take
 * priority when the selected telephone/phone match does not resolve.
 * Durable entity links are checked before these candidate searches.
 */
export function customerMatchCandidateAllowed(candidateField: string, configuredOdooField?: string | null): boolean {
  return !configuredOdooField || candidateField === configuredOdooField
}
