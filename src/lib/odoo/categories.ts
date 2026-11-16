import { categoryFields, categoryMatchValue, prepareCategoryValues } from '@/lib/categories/odoo-values'
import { applyFixedSettingsToValues } from '@/lib/odoo/value-settings'
import { resolveZidMatchValue } from '@/lib/sync-helpers'

import type { OdooConfiguredMatch, OdooValuesPreparation } from './operation-types'

export async function prepareOdooCategory({
  client, mapping, event, zidData, odooValues, mergedSettings, odooModel, platformHint, fixedMatch,
}: OdooValuesPreparation & {
  fixedMatch?: OdooConfiguredMatch
}): Promise<Record<string, unknown>> {
  const catEv = event.toLowerCase()
  const catPlatform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
    catEv.startsWith('shopify:') || catEv.includes('shopify') ? 'shopify'
    : catEv.includes('salla') ? 'salla'
    : 'zid'
  )
  const majorVersion = await client.getMajorVersion().catch(() => 17)
  let effectiveOdooValues = await applyFixedSettingsToValues(odooValues, mergedSettings, zidData, majorVersion, mapping.workspace_id, catPlatform, odooModel)

  if (mergedSettings.parent_id !== undefined) effectiveOdooValues.parent_id = mergedSettings.parent_id
  const fields = await categoryFields(client)
  if (fixedMatch?.odoo_field && fixedMatch.odoo_field !== 'id') {
    const field = fields[fixedMatch.odoo_field]
    if (!field || field.readonly) throw new Error(`Invalid category match field: ${fixedMatch.odoo_field}`)
    const matchVal = resolveZidMatchValue(zidData, fixedMatch.zid_field)
    if (matchVal === undefined || matchVal === null || matchVal === '') throw new Error('Configured category match value is missing')
    effectiveOdooValues[fixedMatch.odoo_field] = categoryMatchValue(matchVal, field)
  }
  if (mergedSettings.link_company !== false && fields.company_id && mergedSettings.company_id) effectiveOdooValues.company_id = Number(mergedSettings.company_id)
  effectiveOdooValues = prepareCategoryValues(effectiveOdooValues, fields)
  return effectiveOdooValues
}
