import { categoryFields, categoryMatchValue } from '@/lib/categories/odoo-values'
import { resolveEntityLinkId, STORED_ODOO_ID_FIELD } from '@/lib/entity-links'
import { withErpCreateIdentity } from '@/lib/erp-effect-context'
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { fetchFieldMeta } from '@/lib/odoo/field-meta'
import type { OdooClient } from '@/lib/odoo-client'
import { assertSaleOrderLinkOwnership, OrderMatchSafetyError } from '@/lib/orders/matching'
import { allPlatformIdFieldNames, pickExistingIdField, platformIdFieldNames } from '@/lib/platform-fields'
import { resolveZidMatchValue, toNameString } from '@/lib/sync-helpers'
import { supabaseAdmin } from '@/lib/sync-runtime'
import type { OdooFieldMeta } from '@/lib/sync-types'

function invalidOdooFieldFromError(err: unknown): string | null {
  const message = String((err as any)?.message || '')
  const invalid = message.match(/Invalid field ['"]([^'"]+)['"]/i)
  if (invalid?.[1]) return invalid[1]
  // Odoo 20 res.partner.write may surface removed fields as a raw ORM KeyError
  // rather than the older "Invalid field" validation message.
  const keyError = message.match(/KeyError:\s*['"]([^'"]+)['"]/i)
  return keyError?.[1] || null
}

// ─── Helper: safe Odoo create with field-level error fallback ──────────────────
export async function safeCreateOdooRecord(
  client: OdooClient,
  model: string,
  values: Record<string, unknown>,
  _fallbackValues: Record<string, unknown>,
  effectIdentity?: string,
  platform?: 'zid' | 'salla' | 'shopify',
): Promise<number> {
  if (effectIdentity) {
    return withErpCreateIdentity(effectIdentity, () => safeCreateOdooRecord(client, model, values, _fallbackValues, undefined, platform))
  }
  if (model === 'product.category' || (platform === 'salla' && (model === 'product.template' || model === 'product.product'))) {
    return client.create(model, values)
  }
  return createOdooRecordWithFallback(client, model, values, _fallbackValues)
}

async function createOdooRecordWithFallback(
  client: OdooClient,
  model: string,
  values: Record<string, unknown>,
  _fallbackValues: Record<string, unknown>,
): Promise<number> {
  try {
    return await client.create(model, values)
  } catch (err: any) {
    // If error is from an invalid field rejected by Odoo ORM, prune it and retry
    const badField = invalidOdooFieldFromError(err)
    if (badField) {
      if (badField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning invalid field "${badField}" from ${model} create and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badField]
        return await safeCreateOdooRecord(client, model, cleanValues, _fallbackValues)
      }
    }

    // If error is from an invalid selection value (e.g. ValueError: Wrong value for product.template.tracking: 'none')
    const wrongValueMatch = String(err?.message || '').match(/Wrong value for (?:[a-zA-Z0-9_]+\.)*([a-zA-Z0-9_]+):/i)
    if (wrongValueMatch && wrongValueMatch[1]) {
      const badField = wrongValueMatch[1]
      if (badField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning invalid selection value for field "${badField}" from ${model} create and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badField]
        return await safeCreateOdooRecord(client, model, cleanValues, _fallbackValues)
      }
    }

    // If error is due to incompatible companies on a specific relational field (e.g. pricelist_id belongs to another company), prune and retry
    const isCompanyIncompatible = String(err?.message || '').toLowerCase().includes('incompatible companies on records')
    if (isCompanyIncompatible) {
      const fieldInParenMatch = String(err?.message || '').match(/\(([a-z0-9_]+):/i)
      const badRelField = fieldInParenMatch ? fieldInParenMatch[1] : (('pricelist_id' in values) ? 'pricelist_id' : null)
      if (badRelField && badRelField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning incompatible company field "${badRelField}" from ${model} create and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badRelField]
        return await safeCreateOdooRecord(client, model, cleanValues, _fallbackValues)
      }
    }

    // If error is from settings fields (not core mapping fields), retry without them
    const settingsKeys = [
      'property_account_income_categ_id', 'property_account_expense_categ_id',
      'property_stock_valuation_account_id', 'property_stock_journal_id',
      'property_stock_input_account_id', 'property_stock_output_account_id',
      'property_cost_method', 'property_valuation',
      'property_account_income_id', 'property_account_expense_id',
      'company_id',
    ]
    const hasSettingsFields = settingsKeys.some(k => k in values)
    // A transport failure may follow a committed create. Only a confirmed
    // XML-RPC fault establishes that Odoo rejected the request; never issue a
    // second create merely because a timeout/network error carried settings.
    if (hasSettingsFields && err?.faultCode !== undefined && err?.faultCode !== null) {
      const cleanValues = { ...values }
      for (const k of settingsKeys) {
        delete cleanValues[k]
      }
      console.warn(`[SyncEngine] Create failed with settings fields, retrying without them: ${err.message}`)
      const newId = await client.create(model, cleanValues)
      // Try to apply the settings fields via a follow-up write
      const settingsOnly: Record<string, unknown> = {}
      for (const k of settingsKeys) {
        if (k in values && values[k] !== undefined) settingsOnly[k] = values[k]
      }
      if (Object.keys(settingsOnly).length > 0) {
        try {
          await client.write(model, [newId], settingsOnly)
          console.info(`[SyncEngine] Applied settings fields via follow-up write on ${model} #${newId}`)
        } catch (writeErr: any) {
          console.warn(`[SyncEngine] Follow-up write for settings failed on ${model} #${newId}: ${writeErr.message}`)
        }
      }
      return newId
    }
    throw err
  }
}

// ─── Helper: safe Odoo write with field-level error fallback ──────────────────
export async function safeWriteOdooRecord(
  client: OdooClient,
  model: string,
  id: number,
  values: Record<string, unknown>,
  _fallbackValues: Record<string, unknown>,
  platform?: 'zid' | 'salla' | 'shopify',
): Promise<boolean> {
  if (model === 'product.category' || (platform === 'salla' && (model === 'product.template' || model === 'product.product'))) {
    const ok = await client.write(model, [id], values)
    if (!ok && platform === 'salla' && model !== 'product.category') throw new Error(`Odoo rejected product write for ${model} #${id}`)
    return ok
  }
  try {
    await client.write(model, [id], values)
    return true
  } catch (err: any) {
    // If error is from an invalid field rejected by Odoo ORM, prune it and retry
    const badField = invalidOdooFieldFromError(err)
    if (badField) {
      if (badField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning invalid field "${badField}" from ${model} write and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badField]
        return await safeWriteOdooRecord(client, model, id, cleanValues, _fallbackValues)
      }
    }

    // If error is from an invalid selection value (e.g. ValueError: Wrong value for product.template.tracking: 'none')
    const wrongValueMatch = String(err?.message || '').match(/Wrong value for (?:[a-zA-Z0-9_]+\.)*([a-zA-Z0-9_]+):/i)
    if (wrongValueMatch && wrongValueMatch[1]) {
      const badField = wrongValueMatch[1]
      if (badField in values) {
        console.warn(`[SyncEngine] ⚠️ Pruning invalid selection value for field "${badField}" from ${model} write and retrying: ${err.message}`)
        const cleanValues = { ...values }
        delete cleanValues[badField]
        return await safeWriteOdooRecord(client, model, id, cleanValues, _fallbackValues)
      }
    }

    // If error is due to modifying pricelist on a confirmed order in Odoo, prune pricelist_id and retry
    if (/cannot change the pricelist/i.test(String(err?.message || '')) && 'pricelist_id' in values) {
      console.warn(`[SyncEngine] ⚠️ Pruning pricelist_id from ${model} #${id} write and retrying: ${err.message}`)
      const cleanValues = { ...values }
      delete cleanValues.pricelist_id
      return await safeWriteOdooRecord(client, model, id, cleanValues, _fallbackValues)
    }

    const settingsKeys = [
      'property_account_income_categ_id', 'property_account_expense_categ_id',
      'property_stock_valuation_account_id', 'property_stock_journal_id',
      'property_stock_input_account_id', 'property_stock_output_account_id',
      'property_cost_method', 'property_valuation',
      'property_account_income_id', 'property_account_expense_id',
      'company_id',
    ]
    const hasSettingsFields = settingsKeys.some(k => k in values)
    if (hasSettingsFields) {
      const cleanValues = { ...values }
      for (const k of settingsKeys) {
        delete cleanValues[k]
      }
      console.warn(`[SyncEngine] Update failed with settings fields, retrying without them: ${err.message}`)
      await client.write(model, [id], cleanValues)
      // Try to apply the settings fields via a follow-up write
      const settingsOnly: Record<string, unknown> = {}
      for (const k of settingsKeys) {
        if (k in values && values[k] !== undefined) settingsOnly[k] = values[k]
      }
      if (Object.keys(settingsOnly).length > 0) {
        try {
          await client.write(model, [id], settingsOnly)
          console.info(`[SyncEngine] Applied settings fields via follow-up write on ${model} #${id}`)
        } catch (writeErr: any) {
          console.warn(`[SyncEngine] Follow-up write for settings failed on ${model} #${id}: ${writeErr.message}`)
        }
      }
      return true
    }
    throw err
  }
}

/**
 * Persist the store-side unique ID (x_zid_id / x_salla_id / x_shopify_id, with
 * the legacy zid_id/salla_id/shopify_id fallback) on a freshly created Odoo record.
 * This gives future webhooks a stable match key independent of sync_logs or SKU.
 */
export async function persistPlatformIdOnRecord(
  client: OdooClient,
  model: string,
  recordId: number,
  platform: 'zid' | 'salla' | 'shopify',
  idValue: string
) {
  if (!idValue) return
  const [platformIdFieldName, legacyIdFieldName] = platformIdFieldNames(platform)
  try {
    const candidateFields = [platformIdFieldName, legacyIdFieldName]
    if (platform === 'zid') candidateFields.push('x_zid_id_product')
    const meta = await fetchFieldMeta(client, model, candidateFields)
    let idField = pickExistingIdField(meta, platform)
    if (!idField && platform === 'zid' && meta.has('x_zid_id_product')) {
      idField = 'x_zid_id_product'
    }
    // Stage 1: current-then-legacy resolution, shared with the relation lookup.
    if (idField) {
      await client.write(model, [recordId], { [idField]: idValue })
      console.info(`[SyncEngine] ✅ Stored ${idField}="${idValue}" on ${model} #${recordId}`)
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Failed to persist ${platformIdFieldName} on ${model} #${recordId}:`, err?.message || err)
  }
}

export async function findExistingOdooRecord(
  client: OdooClient,
  model: string,
  zidData: Record<string, unknown>,
  odooValues: Record<string, unknown>,
  mapping?: { odoo_match_field?: string | null; zid_match_field?: string | null; merchant_id?: string },
  matchStrategy?: string,
  fixedMatch?: { odoo_field: string; zid_field: string },
  workspaceId?: string,
  platform?: string
): Promise<number | null> {
  const sku = toNameString(zidData.sku || odooValues.default_code)
  const barcode = toNameString(zidData.barcode || odooValues.barcode)
  const zidId = toNameString(zidData.id || zidData.customer_id || zidData.product_id || zidData.category_id || zidData.category_uuid || odooValues.x_zid_id || odooValues.zid_id || odooValues.x_zid_id_categ)
  const numericId = Number(odooValues.id || zidData.odoo_id || zidData.odoo_record_id)
  const isProduct = model === 'product.template' || model === 'product.product'
  const explicitCategoryMatch = model === 'product.category' && !!(fixedMatch || matchStrategy || (mapping?.odoo_match_field && mapping?.zid_match_field))
  const explicitProductMatch = isProduct && !!(fixedMatch || matchStrategy || (mapping?.odoo_match_field && mapping?.zid_match_field))
  const assertOrderOwnership = async (recordId: number) => {
    if (model !== 'sale.order') return
    try {
      await assertSaleOrderLinkOwnership(supabaseAdmin, recordId, {
        workspaceId, platform, storeId: mapping?.merchant_id, storeEntityId: zidId,
      })
    } catch (error) {
      if (error instanceof OrderMatchSafetyError) throw error
      throw new OrderMatchSafetyError('Cannot verify ownership of the matched Odoo sale order; sync stopped')
    }
  }

  // Build candidates — highest priority first
  const candidates: unknown[][] = []

  // 0.5) Priority check: manual product mapping (product_mappings table).
  // This lets the admin hand-pick the Odoo product a store product MUST sync into.
  // Per-store first, platform default ('') as fallback — two stores of one
  // platform may map the same source product id differently.
  if (workspaceId && (model === 'product.template' || model === 'product.product') && (zidId || sku)) {
    try {
      const pmStoreId = mapping?.merchant_id || ''
      let q = supabaseAdmin
        .from('product_mappings')
        .select('odoo_product_id, store_id')
        .eq('workspace_id', workspaceId)
        .not('odoo_product_id', 'is', null)
      if (platform) q = q.eq('platform', platform)
      if (zidId) q = q.eq('source_product_id', zidId)
      if (pmStoreId) q = q.in('store_id', [pmStoreId, ''])
      const { data: pmRows } = await q
      const pmList = (Array.isArray(pmRows) ? pmRows : pmRows ? [pmRows] : []) as Array<{ odoo_product_id: unknown; store_id?: string }>
      const pmRow = pmList.find(r => (r.store_id || '') === pmStoreId) ?? pmList.find(r => !r.store_id) ?? pmList[0]

      let pmRecordId: number | null = pmRow ? Number(pmRow.odoo_product_id) : null
      if (pmRecordId === null && sku) {
        let qs = supabaseAdmin
          .from('product_mappings')
          .select('odoo_product_id, store_id')
          .eq('workspace_id', workspaceId)
          .eq('source_sku', sku)
          .not('odoo_product_id', 'is', null)
        if (platform) qs = qs.eq('platform', platform)
        if (pmStoreId) qs = qs.in('store_id', [pmStoreId, ''])
        const { data: pmRowsSku } = await qs
        const pmSkuList = (Array.isArray(pmRowsSku) ? pmRowsSku : pmRowsSku ? [pmRowsSku] : []) as Array<{ odoo_product_id: unknown; store_id?: string }>
        const pmRowSku = pmSkuList.find(r => (r.store_id || '') === pmStoreId) ?? pmSkuList.find(r => !r.store_id) ?? pmSkuList[0]
        if (pmRowSku?.odoo_product_id) pmRecordId = Number(pmRowSku.odoo_product_id)
      }

      if (pmRecordId && Number.isInteger(pmRecordId) && pmRecordId > 0) {
        try {
          // product_mappings stores template IDs. A coincidentally identical
          // product.product ID can belong to a completely different template.
          if (model === 'product.product') {
            const domain: unknown[][] = [['product_tmpl_id', '=', pmRecordId]]
            if (sku) domain.push(['default_code', '=', sku])
            else if (barcode) domain.push(['barcode', '=', barcode])
            const products = await client.search('product.product', domain, 2)
            if (products.length === 1) return products[0]
            // A multi-variant template needs a specific SKU/combination.
            pmRecordId = null
          }
          const exists = pmRecordId ? await client.search(model, [['id', '=', pmRecordId]], 1) : []
          if (exists.length > 0) {
            console.info(`[SyncEngine] Resolved ${model} #${pmRecordId} from manual product_mappings (source_id="${zidId}", sku="${sku}")`)
            return pmRecordId
          }
        } catch {
          // Record might have been deleted in Odoo, continue with other candidates
        }
      }
    } catch (err) {
      console.warn('[SyncEngine] product_mappings lookup failed:', err)
    }
  }

  // 0) Priority check: If this entity was already synced, check sync_logs first.
  // This matches previously synced records accurately with ZERO reliance on custom Odoo columns.
  //
  // ⚠️ SECURITY: `zid_entity_id` alone is NOT unique across tenants — two
  // merchants can legitimately have product id 123. The lookup is therefore
  // ALWAYS scoped by workspace_id + platform. Without this filter, a record
  // synced for workspace A could be matched in workspace B's Odoo.
  // Multi-store: when the mapping carries its own store (merchant_id), the
  // lookup is additionally scoped by store_id — two Salla stores under one
  // workspace that both have order "1234" must never resolve to each other.
  const matchingScope = getErpExecutionScope()
  if (zidId && workspaceId && matchingScope && platform && mapping?.merchant_id) {
    try {
      const prevLogBase = supabaseAdmin
        .from('sync_logs')
        .select('odoo_record_id')
        .eq('workspace_id', workspaceId)
        .eq('erp_connection_id', matchingScope.erpConnectionId)
        .eq('connection_generation', matchingScope.connectionGeneration)
        .eq('platform', platform)
        .eq('zid_entity_id', zidId)
        .eq('odoo_model', model)
        .eq('status', 'success')
        .not('odoo_record_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
      const { data: previousLogs } = mapping?.merchant_id
        ? await prevLogBase.eq('store_id', mapping.merchant_id).limit(5)
        : await prevLogBase.limit(5)

      if (previousLogs && previousLogs.length > 0) {
        for (const logRow of previousLogs) {
          const idNum = Number(logRow?.odoo_record_id)
          if (Number.isInteger(idNum) && idNum > 0) {
              try {
                // Only check amount_total for sale.order to avoid crashes on models without it
                const fieldsToRead = model === 'sale.order' ? ['id', 'amount_total'] : ['id']
                const recs = await client.searchRead<any>(model, [['id', '=', idNum]], fieldsToRead, 1)
                if (recs.length > 0) {
                  // Ignore return orders (amount_total < 0) for normal updates
                  if (model !== 'sale.order' || Number(recs[0].amount_total) >= 0) {
                    console.info(`[SyncEngine] Resolved ${model} #${idNum} from sync_logs for zid_entity_id="${zidId}"`)
                    await assertOrderOwnership(idNum)
                    return idNum
                  }
                }
              } catch (e) {
                if (e instanceof OrderMatchSafetyError) throw e
                console.warn(`[SyncEngine] Failed to verify ${model} #${idNum} during sync_logs lookup:`, e)
                // Record might have been deleted or field error, continue with other candidates
              }
          }
        }
      }
    } catch (err) {
      if (err instanceof OrderMatchSafetyError) throw err
      console.warn('[SyncEngine] Early sync_logs lookup failed:', err)
    }
  }

  // 0.25) Durable entity link (odoo_entity_links) — fully store-scoped.
  // Unlike sync_logs (success rows are purged after 72h and unscoped by
  // store), links are permanent and keyed per (workspace, platform, store,
  // model, store-entity), so an update arriving days later still resolves —
  // and two stores sharing an order number never collide. The record is
  // verified to still exist in Odoo before use; a stale link is ignored.
  // Skipped when the mapping carries no store: an unscoped lookup would
  // risk another store's record, so those keep the legacy behaviour below
  // instead of guessing. (Standard-preset flows now carry the store on
  // the virtual mapping, so they use this path too.)
  if (zidId && workspaceId && mapping?.merchant_id && platform) {
    try {
      const linkedId = await resolveEntityLinkId({
        workspaceId,
        platform: platform as 'zid' | 'salla' | 'shopify',
        storeId: mapping.merchant_id,
        odooModel: model,
        storeEntityId: zidId,
      })
      if (linkedId) {
        try {
          const fieldsToRead = model === 'sale.order' ? ['id', 'amount_total'] : ['id']
          const recs = await client.searchRead<any>(model, [['id', '=', linkedId]], fieldsToRead, 1)
          if (recs.length > 0) {
            if (model !== 'sale.order' || Number(recs[0].amount_total) >= 0) {
              console.info(`[SyncEngine] Resolved ${model} #${linkedId} from odoo_entity_links for store "${mapping.merchant_id}" entity "${zidId}"`)
              await assertOrderOwnership(linkedId)
              return linkedId
            }
          }
        } catch (err) {
          if (err instanceof OrderMatchSafetyError) throw err
          // Record was deleted in Odoo — fall through to other candidates.
        }
      }
    } catch (err) {
      if (err instanceof OrderMatchSafetyError) throw err
      console.warn('[SyncEngine] entity-link lookup failed:', err)
    }
  }

  // 1) FixedMatch from FixedMappingSettings (user-configured Odoo field ↔ Zid field pair)
  if (model === 'product.category' && (fixedMatch || (mapping?.odoo_match_field && mapping?.zid_match_field))) {
    const target = fixedMatch?.odoo_field || mapping!.odoo_match_field!
    const source = fixedMatch?.zid_field || mapping!.zid_match_field!
    if (source === STORED_ODOO_ID_FIELD) return null // The scoped durable link was checked above.
    const raw = resolveZidMatchValue(zidData, source)
    if (raw === undefined || raw === null || raw === '') throw new Error('Configured category match value is missing')
    const fields = await categoryFields(client)
    const value = target === 'id' ? Number(raw) : categoryMatchValue(raw, fields[target] || { type: 'unsupported' })
    if (target === 'id' && (!Number.isSafeInteger(value) || Number(value) <= 0)) throw new Error('Invalid Odoo category match ID')
    const ids = await client.search(model, [[target, '=', value]], 2)
    if (ids.length > 1) throw new Error('Ambiguous Odoo category match')
    return ids[0] ?? null
  }
  if (fixedMatch?.odoo_field && fixedMatch?.zid_field) {
    const rawVal = resolveZidMatchValue(zidData, fixedMatch.zid_field)
    if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
      const val = fixedMatch.odoo_field === 'id' ? Number(rawVal) : model === 'product.category'
        ? categoryMatchValue(rawVal, (await categoryFields(client))[fixedMatch.odoo_field] || { type: 'unsupported' })
        : toNameString(rawVal)
      if (fixedMatch.odoo_field !== 'id' || (Number.isInteger(val) && Number(val) > 0)) {
        console.info(`[SyncEngine] Fixed match: ${model}.${fixedMatch.odoo_field} = ${JSON.stringify(val)}`)
        candidates.push([fixedMatch.odoo_field, '=', val])
      }
    }
  }

  // 2) Strategy-based matching (from FixedMappingSettings.matching.strategy)
  if (matchStrategy === 'x_zid_id' && zidId) {
    candidates.push(['x_zid_id', '=', zidId])
    if (odooValues.zid_id !== undefined) candidates.push(['zid_id', '=', zidId])
  } else if (matchStrategy === 'sku' && sku) {
    candidates.push(['default_code', '=', sku])
  } else if (matchStrategy === 'barcode' && barcode) {
    candidates.push(['barcode', '=', barcode])
  } else if (matchStrategy === 'name') {
    const name = toNameString(zidData.name || odooValues.name)
    if (name) candidates.push(['name', '=', name])
  }

  // 3) Dynamic mapping custom match field (from field_mapping row)
  if (mapping?.odoo_match_field && mapping?.zid_match_field) {
    if (mapping.zid_match_field === STORED_ODOO_ID_FIELD) {
      // Reserved: "the Odoo id saved for this record". Never read from the
      // webhook payload — resolved from the durable, store-scoped link that
      // the create flow wrote. Requires the Odoo side to be `id`.
      if (mapping.odoo_match_field === 'id' && zidId && workspaceId && mapping.merchant_id && platform) {
        const linkedId = await resolveEntityLinkId({
          workspaceId,
          platform: platform as 'zid' | 'salla' | 'shopify',
          storeId: mapping.merchant_id,
          odooModel: model,
          storeEntityId: zidId,
        })
        if (linkedId) {
          console.info(`[SyncEngine] Using saved Odoo link: ${model}.id = ${linkedId} (store "${mapping.merchant_id}", entity "${zidId}")`)
          candidates.push(['id', '=', linkedId])
        } else {
          console.warn(`[SyncEngine] No saved Odoo link for store "${mapping.merchant_id}" entity "${zidId}" (${model}) — falling back to other candidates`)
        }
      } else if (mapping.odoo_match_field !== 'id') {
        console.warn(`[SyncEngine] Reserved match field ${STORED_ODOO_ID_FIELD} requires the Odoo match field to be "id" — ignoring`)
      }
    } else {
      const matchValue = resolveZidMatchValue(zidData, mapping.zid_match_field)
      if (matchValue !== undefined && matchValue !== null && matchValue !== '') {
        const value = mapping.odoo_match_field === 'id'
          ? Number(matchValue)
          : toNameString(matchValue)
        if (mapping.odoo_match_field !== 'id' || (Number.isInteger(value) && Number(value) > 0)) {
          console.info(`[SyncEngine] Using configured match key: ${model}.${mapping.odoo_match_field} = ${JSON.stringify(value)}`)
          candidates.push([mapping.odoo_match_field, '=', value])
        }
      }
    }
  }

  // 4) Fallback candidates — only tried when no explicit match strategy is configured,
  //    OR when the fallback field matches the configured strategy.
  //    This prevents finding a wrong record via an unrelated field.
  if (Number.isInteger(numericId) && numericId > 0) candidates.push(['id', '=', numericId])
  if (zidId) {
    if (odooValues.x_zid_id !== undefined) candidates.push(['x_zid_id', '=', zidId])
    if (odooValues.zid_id !== undefined) candidates.push(['zid_id', '=', zidId])
  }
  if ((!explicitProductMatch || matchStrategy === 'sku') && sku && (!matchStrategy || matchStrategy === 'sku')) candidates.push(['default_code', '=', sku])
  if ((!explicitProductMatch || matchStrategy === 'barcode') && barcode && (!matchStrategy || matchStrategy === 'barcode')) candidates.push(['barcode', '=', barcode])

  // product.template and product.product: name fallback
  if (isProduct && !explicitProductMatch) {
    const name = toNameString(zidData.name || odooValues.name)
    if (name && !candidates.some(c => c[0] === 'name')) {
      candidates.push(['name', '=', name])
    }
  }

  // product.category has no custom fields by default — match on name or complete_name
  if (model === 'product.category' && !explicitCategoryMatch) {
    // ID-first: a rename (category.updated with a new name) can never match
    // by name, so try ID columns before falling back to it. No custom field
    // name is hardcoded here — matching follows only what is configured:
    // the explicit fixedMatch/strategy candidates above (from the Standard
    // Mapping match fields) keep priority, and below we only reuse platform
    // ID columns the values actually carry (i.e. mapped or match-injected).
    // Missing columns are filtered by the field-meta check below.
    for (const f of allPlatformIdFieldNames()) {
      const v = toNameString(odooValues[f])
      if (v && !candidates.some(c => c[0] === f)) candidates.push([f, '=', v])
    }
    const name = toNameString(zidData.name || odooValues.name)
    if (name && !candidates.some(c => c[0] === 'name')) {
      candidates.push(['name', '=', name])
      // Also try ilike for case-insensitive partial match (Odoo may store "Parent / Child")
      if (!candidates.some(c => c[0] === 'complete_name')) {
        candidates.push(['complete_name', 'ilike', name])
      }
    }
  }

  // res.partner has email & phone/mobile fallbacks
  if (model === 'res.partner') {
    const email = toNameString(zidData.email || odooValues.email)
    const mobile = toNameString(zidData.mobile || zidData.phone || odooValues.mobile || odooValues.phone)
    if (email && !candidates.some(c => c[0] === 'email')) {
      candidates.push(['email', '=', email])
    }
    if (mobile) {
      if (!candidates.some(c => c[0] === 'mobile')) candidates.push(['mobile', '=', mobile])
      if (!candidates.some(c => c[0] === 'phone')) candidates.push(['phone', '=', mobile])
    }
  }

  // Fetch fields metadata to ensure we only search on fields that exist in Odoo
  const fieldNamesToCheck = Array.from(new Set(candidates.map(c => c[0] as string).filter(name => name !== 'id')))
  let checkedFieldMeta = new Map<string, OdooFieldMeta>()
  if (fieldNamesToCheck.length > 0) {
    try {
      checkedFieldMeta = await fetchFieldMeta(client, model, fieldNamesToCheck)
    } catch (err) {
      console.warn(`[SyncEngine] Failed to fetch field meta in findExistingOdooRecord:`, err)
    }
  }

  // Filter candidates to only include valid fields:
  // - Always allow 'id'
  // - If checkedFieldMeta has records, verify presence
  // - If a field starts with 'x_' (custom studio field), NEVER query it unless explicitly confirmed by checkedFieldMeta
  const validCandidates = candidates.filter(domain => {
    const fieldName = domain[0] as string
    if (explicitCategoryMatch && fixedMatch && fieldName !== fixedMatch.odoo_field) return false
    if (fieldName === 'id') return true
    if (checkedFieldMeta.size > 0 && !checkedFieldMeta.has(fieldName)) {
      console.info(`[SyncEngine] Skipping candidate search for missing field "${fieldName}" on ${model}`)
      return false
    }
    if (fieldName.startsWith('x_') && !checkedFieldMeta.has(fieldName)) {
      console.info(`[SyncEngine] Skipping candidate search for unverified custom field "${fieldName}" on ${model}`)
      return false
    }
    return true
  })

  console.info(`[SyncEngine] findExistingOdooRecord model=${model} candidates=${validCandidates.length} domains=${JSON.stringify(validCandidates)}`)
  for (const domain of validCandidates) {
    try {
      const searchDomain = model === 'sale.order' ? [domain, ['amount_total', '>=', 0]] : [domain]
      const ids = await client.search(model, searchDomain, model === 'product.category' || model === 'sale.order' ? 2 : 1)
      if (model === 'product.category' && ids.length > 1) throw new Error('Ambiguous Odoo category match')
      if (model === 'sale.order' && ids.length > 1) throw new OrderMatchSafetyError('Ambiguous Odoo sale order match; sync stopped to prevent overwriting another order')
      if (ids.length > 0) {
        await assertOrderOwnership(ids[0])
        console.info(`[SyncEngine] Matched ${model} #${ids[0]} via domain ${JSON.stringify(searchDomain)}`)
        return ids[0]
      }
    } catch (err) {
      if (model === 'product.category' || model === 'sale.order') throw err
      console.warn(`[SyncEngine] Duplicate check failed for ${model} with domain ${JSON.stringify(domain)}:`, err)
    }
  }

  return null
}
