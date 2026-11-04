/** Existing per-store category overrides; keep query scope and fallback order intact. */

import { resolvePath, toNameString } from '@/lib/sync-helpers'
import { supabaseAdmin } from '@/lib/sync-runtime'

/**
 * Look up per-category overrides from the category_mappings table
 * and return an override object matching the standard_mapping_settings shape.
 */
export async function applyCategoryMappingOverrides(
  workspaceId: string,
  platform: string,
  zidData: Record<string, unknown>,
  storeId = '',
): Promise<Record<string, any>> {
  try {
    // Extract a category name from zidData using known field paths
    let catName = ''
    const flatName = resolvePath(zidData, 'flat_name')
    if (flatName && typeof flatName === 'string') { catName = flatName.trim() }
    if (!catName) {
      const nameVal = zidData.name ?? (zidData as any).names ?? zidData.title
      catName = toNameString(nameVal)
    }
    if (!catName) return {}

    // Per-store row first, platform default ('') as fallback — two stores
    // of one platform may map the same category name differently.
    const { data: rows, error } = await supabaseAdmin
      .from('category_mappings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .ilike('source_category_name', catName.replace(/[\\%_]/g, '\\$&'))
      .in('store_id', storeId ? [storeId, ''] : [''])

    if (error) throw error
    const row = (rows ?? []).find((r: any) => (r.store_id || '') === storeId)
      ?? (rows ?? []).find((r: any) => !r.store_id)

    if (!row) return {}

    const override: Record<string, any> = {}
    if (row.parent_id !== undefined && row.parent_id !== null) override.parent_id = Number(row.parent_id) > 0 ? Number(row.parent_id) : false
    if (row.property_cost_method || row.property_valuation) {
      override.inventory_valuation = {}
      if (row.property_cost_method) override.inventory_valuation.property_cost_method = row.property_cost_method
      if (row.property_valuation) override.inventory_valuation.property_valuation = row.property_valuation
    }
    if (row.income_account_id || row.expense_account_id || row.stock_valuation_account_id) {
      override.accounting = {}
      if (row.income_account_id && Number(row.income_account_id) > 0) override.accounting.income_account_id = row.income_account_id
      if (row.expense_account_id && Number(row.expense_account_id) > 0) override.accounting.expense_account_id = row.expense_account_id
      if (row.stock_valuation_account_id && Number(row.stock_valuation_account_id) > 0) override.accounting.stock_valuation_account_id = row.stock_valuation_account_id
    }
    if (row.stock_journal_id && Number(row.stock_journal_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_journal_id = row.stock_journal_id
    }
    if (row.stock_input_account_id && Number(row.stock_input_account_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_input_account_id = row.stock_input_account_id
    }
    if (row.stock_output_account_id && Number(row.stock_output_account_id) > 0) {
      if (!override.accounting) override.accounting = {}
      override.accounting.stock_output_account_id = row.stock_output_account_id
    }
    if (row.odoo_category_id && Number(row.odoo_category_id) > 0) {
      override.odoo_category_id = Number(row.odoo_category_id)
    }
    if (Object.keys(override).length > 0) {
      console.info(`[SyncEngine] Applied per-category mapping for "${catName}":`, override)
    }
    return override
  } catch (err) {
    console.warn('[SyncEngine] applyCategoryMappingOverrides error:', err)
    throw err
  }
}
