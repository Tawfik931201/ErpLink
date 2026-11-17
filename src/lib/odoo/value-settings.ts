import { HARDCODED_FIELD_META } from '@/lib/odoo/field-meta'
import { extractOrderLocationInfo, resolveWarehouse } from '@/lib/odoo/order-location'
import type { OdooClient } from '@/lib/odoo-client'
import { formatBundleInternalNotes, isDynamicBundle, isZidDigitalProduct } from '@/lib/products/bundle'
import { applyProductPriceSettings } from '@/lib/products/settings-values'
import { resolvePath } from '@/lib/sync-helpers'
import { supabaseAdmin } from '@/lib/sync-runtime'

// ─── Helper: apply fixed mapping settings to Odoo values ───────────────────────
// Injects settings-driven defaults/logic (sale_ok, type, price markup, name
// language, etc.) into odooValues.
export async function applyFixedSettingsToValues(
  odooValues: Record<string, unknown>,
  settings: Record<string, any>,
  zidData: Record<string, unknown>,
  odooMajorVersion?: number,
  workspaceId?: string,
  platform?: 'zid' | 'salla' | 'shopify',
  odooModel?: string,
): Promise<Record<string, unknown>> {
  const safeSettings = settings || {}
  const isProductModel = odooModel === 'product.template' || odooModel === 'product.product' || !odooModel
  if (!isProductModel && Object.keys(safeSettings).length === 0) return odooValues

  const values = { ...odooValues }

  // ── product.category only gets inventory_valuation + accounting settings ──
  // Skip all product-template fields (type, sale_ok, is_storable, etc.)
  if (odooModel === 'product.category') {
    const invValCfg = settings.inventory_valuation
    if (invValCfg) {
      if (invValCfg.property_cost_method) values.property_cost_method = invValCfg.property_cost_method
      if (invValCfg.property_valuation) values.property_valuation = invValCfg.property_valuation
    }
    // Fallback: also try flat keys (in case the merge step was skipped)
    if (!values.property_cost_method && settings.costing_method) values.property_cost_method = settings.costing_method
    if (!values.property_valuation && settings.inventory_valuation && typeof settings.inventory_valuation === 'string') values.property_valuation = settings.inventory_valuation
    const acctCfg = settings.accounting
    if (acctCfg) {
      if (acctCfg.income_account_id && Number(acctCfg.income_account_id) > 0) values.property_account_income_categ_id = Number(acctCfg.income_account_id)
      if (acctCfg.expense_account_id && Number(acctCfg.expense_account_id) > 0) values.property_account_expense_categ_id = Number(acctCfg.expense_account_id)
      if (acctCfg.stock_valuation_account_id && Number(acctCfg.stock_valuation_account_id) > 0) values.property_stock_valuation_account_id = Number(acctCfg.stock_valuation_account_id)
      if (acctCfg.stock_journal_id && Number(acctCfg.stock_journal_id) > 0) values.property_stock_journal_id = Number(acctCfg.stock_journal_id)
      if (acctCfg.stock_input_account_id && Number(acctCfg.stock_input_account_id) > 0) values.property_stock_input_account_id = Number(acctCfg.stock_input_account_id)
      if (acctCfg.stock_output_account_id && Number(acctCfg.stock_output_account_id) > 0) values.property_stock_output_account_id = Number(acctCfg.stock_output_account_id)
    }
    delete values.company_id
    return values
  }

  // ── res.partner gets customer_type default settings ──
  if (odooModel === 'res.partner') {
    const custType = settings.customer_type || 'auto'
    if (custType === 'company') {
      values.company_type = 'company'
    } else if (custType === 'person') {
      values.company_type = 'person'
    } else if (custType === 'auto') {
      const typeStr = typeof zidData.type === 'string' ? zidData.type.toLowerCase() : ''
      const isZidCorp =
        typeStr === 'corporate' ||
        typeStr === 'business' ||
        typeStr === 'company' ||
        !!zidData.business_name ||
        !!zidData.tax_number ||
        !!zidData.commercial_registration
      values.company_type = isZidCorp ? 'company' : 'person'
    }

    if (settings.receivable_account_id && Number(settings.receivable_account_id) > 0) {
      values.property_account_receivable_id = Number(settings.receivable_account_id)
    }
    if (settings.payable_account_id && Number(settings.payable_account_id) > 0) {
      values.property_account_payable_id = Number(settings.payable_account_id)
    }

    if (settings.link_company !== false) {
      if (settings.company_id && Number(settings.company_id) > 0) {
        values.company_id = Number(settings.company_id)
      }
    } else {
      delete values.company_id
    }

    return values
  }

  // ── Product type & tracking ──────────────────────────────────────────────────
  // Version matrix (Odoo 14 to 20):
  // - Odoo 14: type=('consu','service','product'). No is_storable. tracking=('none','lot','serial').
  // - Odoo 15-17: type=('consu','service','product'), detailed_type mirrors type. No is_storable. tracking=('none','lot','serial').
  // - Odoo 18-19: 'product' removed from type. type=('consu','service'). is_storable=True for goods. tracking=('none','lot','serial').
  // - Odoo 20: type=('consu','service'). is_storable=True. tracking=('lot','serial') ONLY ('none' removed!). Untracked/quantity is tracking=False.
  const isV18Plus = (odooMajorVersion ?? 0) >= 18
  const isV20Plus = (odooMajorVersion ?? 0) >= 20
  const inventoryCfg = settings.inventory

  if (odooModel === 'product.template' || odooModel === 'product.product' || !odooModel) {
    const defaultType = typeof settings.product_type === 'string'
      ? settings.product_type
      : settings.product_type?.default_type

    // Determine whether inventory should be tracked
    let wantsStorable: boolean
    if (inventoryCfg?.track_inventory !== undefined) {
      wantsStorable = Boolean(inventoryCfg.track_inventory)
    } else {
      wantsStorable = defaultType === 'product' || values.type === 'product' || values.is_storable === true
    }

    // Dynamic bundles and Zid digital products (voucher/downloadable) are never stocked: record them as service
    // products; bundles additionally keep the picked components as a
    // formatted Internal Notes list. Components themselves sync as ordinary
    // storable products.
    if (isDynamicBundle(zidData) || isZidDigitalProduct(zidData)) {
      values.type = 'service'
      values.is_storable = false
      if (isDynamicBundle(zidData)) {
        const notes = formatBundleInternalNotes(zidData)
        if (notes) {
          const existing = typeof values.description === 'string' ? values.description.trim() : ''
          values.description = existing ? `${existing}\n\n${notes}` : notes
        }
      }
    }

    if (!values.type) {
      if (isV18Plus) {
        if (defaultType === 'service') {
          values.type = 'service'
          values.is_storable = false
        } else {
          values.type = 'consu'
          values.is_storable = wantsStorable
        }
      } else {
        if (defaultType === 'service') {
          values.type = 'service'
        } else {
          values.type = wantsStorable ? 'product' : 'consu'
        }
      }
    } else {
      // Normalize values.type if already mapped
      if (isV18Plus && values.type === 'product') {
        values.type = 'consu'
        if (values.is_storable === undefined) {
          values.is_storable = wantsStorable
        }
      } else if (!isV18Plus && values.type === 'product' && inventoryCfg?.track_inventory === false) {
        values.type = 'consu'
      } else if (!isV18Plus && values.type === 'consu' && wantsStorable) {
        values.type = 'product'
      }
    }

    // Ensure is_storable is set only on Odoo 18+ and purged on Odoo 14-17
    if (isV18Plus) {
      if (values.type === 'service') {
        values.is_storable = false
      } else if (values.is_storable === undefined || inventoryCfg?.track_inventory !== undefined) {
        values.is_storable = wantsStorable
      }
    } else {
      delete values.is_storable
    }
    // 15–17 validate type against detailed_type; writing type alone can fail
    // the ORM constraint (or leave the UI/stock type at its old value).
    if ((odooMajorVersion ?? 0) >= 15 && (odooMajorVersion ?? 0) < 18) values.detailed_type = values.type
    else delete values.detailed_type

    // ── Tracking (Traceability) ──
    const configuredTracking = inventoryCfg?.tracking
    if (wantsStorable && values.type !== 'service') {
      if (configuredTracking && configuredTracking !== 'none') {
        values.tracking = configuredTracking
      } else {
        if (isV20Plus) {
          values.tracking = false
        } else {
          values.tracking = 'none'
        }
      }
      if (inventoryCfg?.route_ids && Array.isArray(inventoryCfg.route_ids) && inventoryCfg.route_ids.length > 0) {
        values.route_ids = [[6, 0, inventoryCfg.route_ids]]
      }
    } else {
      if (isV20Plus) {
        values.tracking = false
      } else {
        values.tracking = 'none'
      }
    }

    // Strict guard for Odoo 20+: 'none' is rejected by Odoo 20 ORM selection validation
    if (isV20Plus && values.tracking === 'none') {
      values.tracking = false
    }
  }

  // ── Status fields ───────────────────────────────────────────────────────────
  const status = settings.status
  if (status) {
    // Only set if not already provided by user mapping
    if (status.sale_ok !== undefined && values.sale_ok === undefined) {
      values.sale_ok = status.sale_ok
    }
    if (status.purchase_ok !== undefined && values.purchase_ok === undefined) {
      values.purchase_ok = status.purchase_ok
    }
    // Active status from published setting
    if (values.active === undefined) {
      const pub = status.published
      if (pub === 'always_published') values.active = true
      else if (pub === 'always_draft') values.active = false
      else if (pub === 'from_platform') {
        const platformActive = resolvePath(zidData, 'is_published')
        values.active = platformActive === true || platformActive === 'true'
      }
    }
  }

  applyProductPriceSettings(values, settings, zidData, isProductModel ? platform : undefined)

  // ── Cost source "don't update" ───────────────────────────────────────────
  // `applyProductPriceSettings` only *not writing* `standard_price` when
  // `cost_source === 'none'`. It does not remove one some earlier step
  // already placed there — and two do: the preset default mappings
  // (`cost → standard_price`) and custom field mappings, via
  // `buildOdooValues`. The buildOdooValues guard stops those at the source;
  // this is the choke point that catches everything else (including values
  // copied into variants). Odoo then owns the cost completely.
  if (settings.price?.cost_source === 'none') delete values.standard_price

  // ── Name language selection ─────────────────────────────────────────────────
  const nameCfg = settings.name
  const rawName = zidData.name as Record<string, unknown> | string | undefined
  if (nameCfg && nameCfg.language && rawName && typeof rawName === 'object') {
    if (nameCfg.language === 'both') {
      const arName = rawName['ar']
      const enName = rawName['en']
      // Concatenate both languages as a plain string (no dict)
      const parts: string[] = []
      if (arName && typeof arName === 'string') parts.push(arName)
      if (enName && typeof enName === 'string') parts.push(enName)
      if (parts.length > 0) values.name = parts.join(' ')
    } else {
      const langName = rawName[nameCfg.language]
      if (langName && typeof langName === 'string') {
        values.name = langName
      } else if (nameCfg.fallback_to_other) {
        const otherLang = nameCfg.language === 'ar' ? 'en' : 'ar'
        const fallbackName = rawName[otherLang]
        if (fallbackName && typeof fallbackName === 'string') {
          values.name = fallbackName
        }
      } else {
        delete values.name
      }
    }
  }

  // ── Description language selection ─────────────────────────────────────────
  const descCfg = settings.description
  const rawDesc = zidData.description as Record<string, unknown> | string | undefined
  if (isProductModel && platform === 'salla' && typeof rawDesc === 'string' && rawDesc.trim() && values.description_sale === undefined) {
    values.description_sale = rawDesc
  }
  if (descCfg && descCfg.language && rawDesc && typeof rawDesc === 'object') {
    if (descCfg.language === 'both') {
      const arDesc = rawDesc['ar']
      const enDesc = rawDesc['en']
      const descParts: string[] = []
      if (arDesc && typeof arDesc === 'string') descParts.push(arDesc)
      if (enDesc && typeof enDesc === 'string') descParts.push(enDesc)
      if (descParts.length > 0) values.description_sale = descParts.join(' ')
    } else {
      const langDesc = rawDesc[descCfg.language]
      if (langDesc && typeof langDesc === 'string') {
        values.description_sale = langDesc
      } else if (descCfg.fallback === 'name') {
        values.description_sale = values.name
      }
    }
  }

  // ── Description fallback ─────────────────────────────────────────────────────
  if (descCfg) {
    const selected = rawDesc && typeof rawDesc === 'object'
      ? (descCfg.language === 'both' ? [rawDesc.ar, rawDesc.en].filter(Boolean).join(' ') : rawDesc[descCfg.language])
      : rawDesc
    if (!selected || (typeof selected === 'string' && !selected.trim())) {
      // A missing selected translation must not inherit a different language
      // from buildOdooValues before deciding which fallback the user selected.
      if (descCfg.fallback === 'name') values.description_sale = values.name
      else if (descCfg.fallback === 'custom') values.description_sale = descCfg.custom_text || false
      else if (descCfg.fallback === 'empty') values.description_sale = false
      else delete values.description_sale
    }
      if (descCfg.fallback === 'custom' && descCfg.custom_text && values.description_sale === undefined) {
      values.description_sale = descCfg.custom_text
    } else if (descCfg.fallback === 'empty' && values.description_sale === undefined) {
      values.description_sale = false
    }
  }

  // ── Company ─────────────────────────────────────────────────────────────────
  if (settings.link_company !== false) {
    if (settings.company_id && Number(settings.company_id) > 0) {
      values.company_id = Number(settings.company_id)
    } else {
      const companyCfg = settings.company
      if (companyCfg?.default_company_id && Number(companyCfg.default_company_id) > 0) {
        values.company_id = Number(companyCfg.default_company_id)
      }
    }
  } else {
    delete values.company_id
  }

  // ── Platform ID field ───────────────────────────────────────────────────────
  const matchCfg = settings.matching
  if (matchCfg && matchCfg.platform_id_field && matchCfg.platform_id_field !== 'x_zid_id') {
    // If user configured a custom platform ID field, rename x_zid_id to it
    if (values[matchCfg.platform_id_field] === undefined && values.x_zid_id !== undefined) {
      values[matchCfg.platform_id_field] = values.x_zid_id
      delete values.x_zid_id
    }
  }

  // ── Warehouse / Stock Location ─────────────────────────────────────────────
  // Resolve warehouse from static DB mapping using Zid location data
  if (workspaceId) {
    const { locationId: zidLocId, locationName: zidLocName } = extractOrderLocationInfo(zidData, platform)
    if (zidLocId || zidLocName) {
      const wh = await resolveWarehouse(workspaceId, platform, zidLocId, zidLocName)
      if (wh) {
        if (wh.warehouse_id && !values.warehouse_id) values.warehouse_id = wh.warehouse_id
        if (wh.location_id && !values.location_id && odooModel !== 'sale.order') {
          values.location_id = wh.location_id
        }
      }
    }
  }

  // ── Tax sync_mode ───────────────────────────────────────────────────────────
  const taxCfg = settings.tax
  if (taxCfg) {
    if (taxCfg.sync_mode === 'static_ids' && Array.isArray(taxCfg.default_tax_ids)) {
      values.taxes_id = [[6, 0, taxCfg.default_tax_ids]]
    } else if (taxCfg.sync_mode === 'skip') {
      delete values.taxes_id
    } else if ((taxCfg.sync_mode === 'auto_by_name' || taxCfg.sync_mode === undefined) && !(isProductModel && platform === 'salla')) {
      // Try DB tax_mappings first, then auto_by_name fallback
      const zidTaxName = zidData.tax_name as string || zidData.tax as string || ''
      if (workspaceId && zidTaxName) {
        const { data: taxRow } = await supabaseAdmin
          .from('tax_mappings')
          .select('odoo_tax_id')
          .eq('workspace_id', workspaceId)
          .eq('source_tax_name', zidTaxName)
          .maybeSingle()
        if (taxRow?.odoo_tax_id) {
          values.taxes_id = [[6, 0, [taxRow.odoo_tax_id]]]
        }
      }
    }
  }

  // ── Category sync_mode ──────────────────────────────────────────────────────
  const catCfg = settings.category
  if (catCfg) {
    if (catCfg.sync_mode === 'skip' && values.categ_id !== undefined) {
      delete values.categ_id
    } else if (catCfg.sync_mode === 'map_existing') {
      if (catCfg.match_field === 'name') {
        const catVal = zidData.categories ?? zidData.category
        if (catVal && typeof catVal === 'string') {
          console.info('Category matching by name is handled in buildOdooValues for many2one fields')
        }
      }
    }
  }

  // ── Image sync: CANCELLED ───────────────────────────────────────────────
  // Product photos are never synced (2026-11-09). Any stored
  // `image.sync_mode` ('all'/'main_only' in old rows) is ignored on purpose,
  // so a stale setting can no longer fail the sync with
  // "Unrecognized product image URL". Deleting here preserves the existing
  // Odoo gallery on updates, exactly like the old 'skip' mode.
  for (const field of ['image_1920', 'image_variant_1920', 'image_1024', 'image_512', 'image_256', 'image_128']) {
    delete values[field]
  }

  // ── UOM auto-create: CANCELLED ──────────────────────────────────────────
  // `settings.uom.auto_create` no longer exists as an option and is ignored.
  // Missing `uom.uom` records are never created (see `allowCreate` in
  // `buildOdooValues`); existing UoM records are still matched by name/ID.
  // The old `values.uom_id === undefined` delete was a no-op — removed.



  // ── Website settings ────────────────────────────────────────────────────────
  const webCfg = settings.website
  if (webCfg) {
    if (values.active !== undefined && (webCfg.published === 'always_published' || webCfg.published === 'from_platform')) {
      values.is_published = values.active === true
    }
    if (Array.isArray(webCfg.public_categ_ids) && webCfg.public_categ_ids.length > 0) {
      values.public_categ_ids = [[6, 0, webCfg.public_categ_ids]]
    }
  }

  // ── Accounting settings ─────────────────────────────────────────────────────
  const acctCfg = settings.accounting
  if (acctCfg) {
    if (odooModel === 'product.category') {
      // product.category uses different property field names
      if (acctCfg.income_account_id && Number(acctCfg.income_account_id) > 0) {
        values.property_account_income_categ_id = Number(acctCfg.income_account_id)
      }
      if (acctCfg.expense_account_id && Number(acctCfg.expense_account_id) > 0) {
        values.property_account_expense_categ_id = Number(acctCfg.expense_account_id)
      }
      if (acctCfg.stock_valuation_account_id && Number(acctCfg.stock_valuation_account_id) > 0) {
        values.property_stock_valuation_account_id = Number(acctCfg.stock_valuation_account_id)
      }
      if (acctCfg.stock_journal_id && Number(acctCfg.stock_journal_id) > 0) {
        values.property_stock_journal_id = Number(acctCfg.stock_journal_id)
      }
      if (acctCfg.stock_input_account_id && Number(acctCfg.stock_input_account_id) > 0) {
        values.property_stock_input_account_id = Number(acctCfg.stock_input_account_id)
      }
      if (acctCfg.stock_output_account_id && Number(acctCfg.stock_output_account_id) > 0) {
        values.property_stock_output_account_id = Number(acctCfg.stock_output_account_id)
      }
    } else {
      if (acctCfg.income_account_id && Number(acctCfg.income_account_id) > 0) {
        values.property_account_income_id = Number(acctCfg.income_account_id)
      }
      if (acctCfg.expense_account_id && Number(acctCfg.expense_account_id) > 0) {
        values.property_account_expense_id = Number(acctCfg.expense_account_id)
      }
    }
  }

  // ── Inventory Valuation settings (product.category) ─────────────────────────
  const invValCfg = settings.inventory_valuation
  if (invValCfg && odooModel === 'product.category') {
    if (invValCfg.property_cost_method) {
      values.property_cost_method = invValCfg.property_cost_method
    }
    if (invValCfg.property_valuation) {
      values.property_valuation = invValCfg.property_valuation
    }
  }

  return values
}

// ─── Helper: evaluate a single condition against zidData ───────────────────────
function evaluateCondition(
  field: string | undefined,
  op: string | undefined,
  value: string | undefined,
  zidData: Record<string, unknown>
): boolean {
  if (!field || !op) return false
  const raw = resolvePath(zidData, field)
  const rawStr = raw == null ? '' : String(raw)
  switch (op) {
    case 'eq':       return rawStr === value
    case 'neq':      return rawStr !== value
    case 'gt':       return Number(raw) > Number(value)
    case 'lt':       return Number(raw) < Number(value)
    case 'is_empty': return !rawStr || rawStr === '0'
    case 'is_not_empty': return !!rawStr && rawStr !== '0'
    default:         return false
  }
}

// ─── Helper: apply conditional rules and currency conversion from DB ──────────
export async function applyRulesToValues(
  odooValues: Record<string, unknown>,
  workspaceId: string,
  presetKey: string | null | undefined,
  zidData: Record<string, unknown>,
  _client: OdooClient,
): Promise<Record<string, unknown>> {
  if (!presetKey) return odooValues

  const { data: rules, error } = await supabaseAdmin
    .from('fixed_mapping_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('preset_key', presetKey)
    .eq('enabled', true)
    .order('priority', { ascending: true })

  if (error || !rules || rules.length === 0) return odooValues

  const values = { ...odooValues }

  for (const rule of rules) {
    if (rule.rule_type === 'conditional' && rule.condition_field && rule.action_field) {
      const matched = evaluateCondition(rule.condition_field, rule.condition_op, rule.condition_value, zidData)
      if (matched) {
        const actionVal = rule.action_value
        if (actionVal !== undefined) {
          const meta = HARDCODED_FIELD_META[rule.action_field]
          if (meta?.ttype === 'boolean') {
            values[rule.action_field] = actionVal === 'true' || actionVal === '1'
          } else if (['integer', 'float', 'monetary'].includes(meta?.ttype ?? '')) {
            const n = parseFloat(actionVal)
            if (!isNaN(n)) values[rule.action_field] = n
          } else {
            values[rule.action_field] = actionVal
          }
        }
      }
    }

    if (rule.rule_type === 'currency' && rule.from_currency && rule.to_currency) {
      const sourceField = (rule.condition_field) || 'list_price'
      const raw = Number(resolvePath(zidData, sourceField) ?? values[sourceField])
      if (!isNaN(raw) && raw > 0) {
        // Use DB rule rate, or lookup live rate via currency_mappings + API
        if (rule.conversion_rate) {
          values[rule.action_field || sourceField] = raw * Number(rule.conversion_rate)
        } else {
          const rate = null
          if (rate !== null) {
            values[rule.action_field || sourceField] = raw * rate
          }
        }
      }
    }
  }

  return values
}
