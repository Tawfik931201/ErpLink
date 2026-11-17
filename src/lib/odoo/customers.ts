import { injectCustomerCompanyFields, normalizeCustomerCompanyTypeForOdoo, pruneUnsupportedCustomerCompanyFields } from '@/lib/customers/company-fields'
import { applyFixedSettingsToValues, applyRulesToValues } from '@/lib/odoo/value-settings'
import { resolveShopifyCustomerFullName } from '@/lib/shopify/customers'

import type { OdooValuesPreparation } from './operation-types'

export async function prepareOdooCustomer({
  client, mapping, event, zidData, odooValues, mergedSettings, odooModel, platformHint, presetKey,
}: OdooValuesPreparation): Promise<Record<string, unknown>> {
  const custEv = event.toLowerCase()
  const custPlatform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
    custEv.startsWith('shopify:') || custEv.includes('shopify') ? 'shopify'
    : custEv.includes('salla') ? 'salla'
    : 'zid'
  )
  const majorVersion = await client.getMajorVersion().catch(() => 17)
  let effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, custPlatform, odooModel)

  // Apply conditional rules and currency conversion
  effectiveOdooValues = await applyRulesToValues(
    effectiveOdooValues,
    mapping.workspace_id,
    presetKey,
    zidData,
    client
  )

  // Company fields always persist, even without explicit mapping rows
  effectiveOdooValues = injectCustomerCompanyFields(effectiveOdooValues, zidData)
  effectiveOdooValues = normalizeCustomerCompanyTypeForOdoo(effectiveOdooValues, majorVersion)

  // Validate optional company fields against the actual target Odoo model.
  // Odoo 14-20 and installed accounting/localization addons expose different
  // combinations; the commercial registration must not break a partner update.
  const optionalFields = ['company_registry', 'company_name', 'vat', 'company_type', 'is_company']
    .filter((field) => Object.prototype.hasOwnProperty.call(effectiveOdooValues, field))
  if (optionalFields.length > 0) {
    try {
      const available = await client.execute<Record<string, unknown>>(
        'res.partner', 'fields_get', [optionalFields], { attributes: ['type'] }
      )
      effectiveOdooValues = pruneUnsupportedCustomerCompanyFields(effectiveOdooValues, available)
    } catch (error) {
      // Conservatively drop the field known absent on standard Odoo 20 rather
      // than reject every customer because introspection was temporarily down.
      console.warn('[CustomerSync] Optional company field introspection failed', error)
      if (majorVersion >= 20) {
        const fallbackFields = Object.fromEntries(optionalFields.filter((f) => f !== 'company_registry').map((f) => [f, true]))
        effectiveOdooValues = pruneUnsupportedCustomerCompanyFields(effectiveOdooValues, fallbackFields)
      }
    }
  }

  // Shopify and Salla send first_name / last_name separately while the
  // standard presets map name <- a single source, which drops the family
  // name ("Bob" instead of "Bob Biller") — and Salla sends no `name` at
  // all, so without this a Salla create reaches Odoo nameless and fails
  // with "Contacts require a name". Compose the full name here so both the
  // standard preset and a custom mapping of name <- first_name resolve
  // correctly. An explicit mapping to any other source (email, company,
  // static value) is left alone: only an empty name or one that equals
  // first_name alone is replaced.
  if (custPlatform === 'shopify' || custPlatform === 'salla') {
    const fullName = resolveShopifyCustomerFullName(zidData)
    if (fullName) {
      const current = typeof effectiveOdooValues.name === 'string' ? effectiveOdooValues.name.trim() : ''
      const firstOnly = typeof zidData.first_name === 'string' ? zidData.first_name.trim() : ''
      if (!current || (firstOnly && current === firstOnly)) {
        effectiveOdooValues.name = fullName
        odooValues.name = fullName
      }
    }
  }
  return effectiveOdooValues
}
