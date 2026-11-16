import { categoryCompanyClient } from '@/lib/categories/odoo-values'
import { resolveEntityLinkId } from '@/lib/entity-links'
import { withErpExecutionContext } from '@/lib/erp-effect-context'
import { getErpExecutionScope } from '@/lib/erp-execution-target'
import { getEffectiveStandardMappingSettings, resolveSettingsStoreKey } from '@/lib/mapping-settings'
import { fetchFieldMeta } from '@/lib/odoo/field-meta'
import { findExistingOdooRecord } from '@/lib/odoo/records'
import type { OdooClient } from '@/lib/odoo-client'
import { pickExistingIdField } from '@/lib/platform-fields'
import { readSallaStoreCategory } from '@/lib/salla/categories'
import { getCachedStandardMappingSettings } from '@/lib/sync/settings'
import { toNameString } from '@/lib/sync-helpers'
import { supabaseAdmin } from '@/lib/sync-runtime'
import type { FieldMappingRow } from '@/lib/sync-types'
import { readZidStoreCategory } from '@/lib/zid/categories'

import type { ExecuteOdooParams, OdooSyncRecord } from './operation-types'

type CreateCategory = (params: ExecuteOdooParams) => Promise<OdooSyncRecord>

export function bindOdooRelations(createCategory: CreateCategory) {
  return resolveSingleRelationId.bind(null, createCategory)
}

export type ResolveOdooRelation = ReturnType<typeof bindOdooRelations>

// ─── Helper: resolve a single relational value (ID Match → Name Match → Creation) ───
async function resolveSingleRelationId(
  createCategory: CreateCategory,
  client: any,
  relation: string,
  itemValue: unknown,
  platform: 'zid' | 'salla' | 'shopify',
  _operation?: any,
  _item?: any,
  workspaceId?: any,
  storeId = '',
  _payload?: any,
  _extra?: Record<string, unknown>,
  _dryRun?: boolean
): Promise<number | null> {
  if (itemValue === undefined || itemValue === null) return null

  // 1. Extract platformId and nameVal
  let platformId: string | null = null
  let nameVal: string | null = null

  if (itemValue && typeof itemValue === 'object') {
    const obj = itemValue as Record<string, unknown>
    const rawId = obj.id ?? obj.uuid ?? obj.merchant_id
    if (rawId !== undefined && rawId !== null) {
      platformId = String(rawId).trim()
    }
    nameVal = toNameString(itemValue)
  } else if (typeof itemValue === 'number') {
    platformId = String(itemValue)
    nameVal = String(itemValue)
  } else if (typeof itemValue === 'string') {
    const trimmed = itemValue.trim()
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    const isNumeric = /^\d+$/.test(trimmed)
    if (isUuid || isNumeric) {
      platformId = trimmed
    }
    nameVal = trimmed
  }

  if (!nameVal || nameVal === '[object Object]' || nameVal === 'undefined') {
    if (!platformId) return null
  }

  if (relation === 'product.category' && workspaceId && storeId && (platform === 'zid' || platform === 'salla')) {
    return resolveStoreCategory(createCategory, client, itemValue, platform, workspaceId, storeId, _extra?.allowCreate !== false)
  }

  try {
    // ─── Case 0: Resolve from previous sync_logs ───────────────────────────
    if (platformId && workspaceId) {
      try {
        const { data: previousLog } = await supabaseAdmin
          .from('sync_logs')
          .select('odoo_record_id')
          .eq('workspace_id', workspaceId)
          .eq('zid_entity_id', String(platformId))
          .eq('odoo_model', relation)
          .eq('status', 'success')
          .not('odoo_record_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (previousLog?.odoo_record_id) {
          const idNum = Number(previousLog.odoo_record_id)
          if (Number.isInteger(idNum) && idNum > 0) {
            const exists = await client.search(relation, [['id', '=', idNum]], 1)
            if (exists && exists.length > 0) {
              console.info(`[SyncEngine] Case 0 (sync_logs): Resolved ${relation} #${idNum} for platform ID "${platformId}"`)
              return idNum
            }
          }
        }
      } catch (logErr) {
        console.warn(`[SyncEngine] sync_logs check failed for ${relation}:`, logErr)
      }
    }

    // Fetch target relation fields meta to verify field existence (avoiding Odoo RPC errors on non-existing columns)
    const relationFields = await fetchFieldMeta(client, relation, ['name', 'x_zid_id', 'zid_id', 'x_salla_id', 'salla_id', 'x_shopify_id', 'shopify_id'])

    // ─── Case 1: Search by Platform ID (Fixed Mapping check) ─────────────────
    if (platformId) {
      // Stage 1: current-then-legacy resolution now has a single definition.
      const searchField = pickExistingIdField(relationFields, platform)

      if (searchField) {
        const ids = await client.search(relation, [[searchField, '=', platformId]])
        if (ids && ids.length > 0) {
          console.info(`[SyncEngine] Case 1 (ID Match): Resolved ${relation} with ${searchField}="${platformId}" → ID #${ids[0]}`)
          return ids[0]
        }
      }

      // ─── Case 1.5: Try Match Field from standard_mapping_settings ────────
      if (workspaceId && relation) {
        const entityMap: Record<string, string> = {
          'product.category': 'categories',
          'product.template': 'products',
          'res.partner': 'customers',
          'sale.order': 'orders',
        }
        const entityType = entityMap[relation]
        if (entityType) {
          const storeType = platform === 'shopify' ? 'shopify'
            : platform === 'salla' ? 'salla'
            : 'zid'
          try {
            // Must be store-scoped: an unscoped/`maybeSingle()` read returns the
            // platform default (or throws PGRST116) once a per-store row exists,
            // so this store's configured match field was silently ignored.
            const stdSettings = await getEffectiveStandardMappingSettings(
              supabaseAdmin,
              workspaceId,
              storeType,
              entityType,
              storeId
            )
            if (stdSettings) {
              const odooMatchField = stdSettings.match_odoo_field
              if (odooMatchField && (odooMatchField === 'id' || relationFields.has(odooMatchField))) {
                const mfIds = await client.search(relation, [[odooMatchField, '=', platformId]])
                if (mfIds && mfIds.length > 0) {
                  console.info(`[SyncEngine] Case 1.5 (Match Field): Resolved ${relation} via ${odooMatchField}="${platformId}" → ID #${mfIds[0]}`)
                  return mfIds[0]
                }
              }
            }
          } catch (err) {
            console.warn(`[SyncEngine] Match Field lookup failed for ${relation}:`, err)
          }
        }
      }
    }

    // ─── Special Resolution for product.category (Parent Category) ─────────
    // Salla exposes `parent_id` as a bare numeric Salla category ID. If that ID
    // was never synced (the parent is usually created before the child, but a
    // pre-existing parent never syncs at all), every lookup below misses and
    // the ID is skipped — so Parent Category stayed empty in Odoo. Same fetch
    // the Zid branch does, just from Salla's own API.
    if (_extra?.allowCreate !== false) {
      if (relation === 'product.category' && (platform === 'zid' || platform === 'salla') && platformId && workspaceId) {
        try {
          let parentCat: any = null
          let catName: string | null = null

          if (platform === 'salla') {
            const { data: tokenRow } = await supabaseAdmin
              .from('salla_tokens')
              .select('merchant_id')
              .eq('workspace_id', workspaceId)
              .limit(1)
              .maybeSingle()

            if (tokenRow?.merchant_id) {
              const { getSallaCategory } = await import('@/lib/salla-client')
              parentCat = await getSallaCategory(String(tokenRow.merchant_id), platformId)
              if (parentCat) {
                const n = parentCat.name
                catName = typeof n === 'string' && n.trim() ? n.trim() : null
              }
              if (!catName) {
                console.warn(`[SyncEngine] Salla category API returned response without name for ID "${platformId}":`, parentCat)
              }
            } else {
              console.warn(`[SyncEngine] No salla_token found for workspace "${workspaceId}" to resolve parent category`)
            }
          } else {
            // A parent category must use this store's credentials, never the
            // first store attached to the workspace.
            const { resolveZidOrderTokenScope } = await import('@/lib/zid/order-enrichment')
            const tokenRow = storeId ? await resolveZidOrderTokenScope(String(storeId), String(workspaceId)) : null
            if (tokenRow?.merchant_id) {
              const { getAccessToken } = await import('@/lib/zid/token')
              const { ZidAPI } = await import('@/lib/zid-client')
              const tokens = await getAccessToken(tokenRow.merchant_id, String(workspaceId))
              const creds = {
                authorization: tokens.authorization || '', managerToken: tokens.accessToken,
                storeId: tokenRow.store_id || tokenRow.merchant_id,
              }
              const catRes = await ZidAPI.categories.get(creds, platformId)
              parentCat = (catRes.data as any)?.categories ?? (catRes.data as any)?.category ?? catRes.data
              catName = parentCat?.names?.ar || parentCat?.names?.en || parentCat?.name?.ar || parentCat?.name?.en || (typeof parentCat?.name === 'string' ? parentCat.name : null)
              if (!catName) {
                console.warn(`[SyncEngine] Zid category API returned response without name for ID "${platformId}":`, catRes.data)
              }
            } else {
              console.warn(`[SyncEngine] No merchant_token found for workspace "${workspaceId}" to resolve parent category`)
            }
          }

          if (catName) {
            {
              console.info(`[SyncEngine] Fetched parent category "${catName}" from ${platform} for ID "${platformId}"`)
              const found = await client.search('product.category', [['name', '=', catName]])
              if (found && found.length > 0) {
                try {
                  await supabaseAdmin.from('sync_logs').insert([{
                    workspace_id: workspaceId,
                    event: 'category.create',
                    zid_entity_id: String(platformId),
                    odoo_model: 'product.category',
                    odoo_record_id: found[0],
                    status: 'success',
                    payload: parentCat,
                  }])
                } catch {}
                return found[0]
              }
              const createdParentId = await client.create('product.category', { name: catName })
              if (createdParentId) {
                console.info(`[SyncEngine] Created missing parent category "${catName}" in Odoo #${createdParentId}`)
                try {
                  await supabaseAdmin.from('sync_logs').insert([{
                    workspace_id: workspaceId,
                    event: 'category.create',
                    zid_entity_id: String(platformId),
                    odoo_model: 'product.category',
                    odoo_record_id: createdParentId,
                    status: 'success',
                    payload: parentCat,
                  }])
                } catch {}
                return createdParentId
              }
            }
          }
        } catch (catErr) {
          console.warn(`[SyncEngine] Failed to resolve parent category from ${platform} for ID "${platformId}":`, catErr)
        }
      }

    }
    const looksLikePlatformId = typeof nameVal === 'string' &&
      (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nameVal) ||
       /^\d+$/.test(nameVal))

    // ─── Case 2: Search by Name inside Odoo ──────────────────────────────────────
    if (nameVal && !looksLikePlatformId && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      const ids = await client.search(relation, [['name', '=', nameVal]])
      if (ids && ids.length > 0) {
        console.info(`[SyncEngine] Case 2 (Name Match): Resolved ${relation} with name="${nameVal}" → ID #${ids[0]}`)
        return ids[0]
      }
    }

    // ─── Case 3: Create it if not found ──────────────────────────────────────────
    if (_extra?.allowCreate === false) return null
    if (nameVal && !looksLikePlatformId && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      console.info(`[SyncEngine] Case 3 (Creation): Record not found in "${relation}". Creating a new one with name="${nameVal}"`)

      const createData: Record<string, unknown> = {
        name: nameVal
      }

      if (relation === 'res.partner' && itemValue && typeof itemValue === 'object') {
        const obj = itemValue as Record<string, unknown>
        if (obj.email) createData.email = String(obj.email)
        const partnerPhone = obj.telephone || obj.phone || obj.mobile
        if (partnerPhone) createData.phone = String(partnerPhone)
        if (obj.business_name || obj.company_name) createData.company_name = String(obj.business_name || obj.company_name)
        if (obj.tax_number || obj.vat) createData.vat = String(obj.tax_number || obj.vat)
        if (obj.commercial_registration) createData.company_registry = String(obj.commercial_registration)

        // Address fields from nested city
        if (obj.city && typeof obj.city === 'object') {
          const cityObj = obj.city as Record<string, any>
          const cityName = cityObj.ar_name || cityObj.name || cityObj.en_name
          if (cityName) createData.city = String(cityName)
        }

        // Determine company type (Zid is 'business', Salla is 'corporate')
        const typeStr = typeof obj.type === 'string' ? obj.type.toLowerCase() : ''
        const isCorp =
          typeStr === 'corporate' ||
          typeStr === 'business' ||
          typeStr === 'company' ||
          !!obj.business_name ||
          !!obj.tax_number ||
          !!obj.commercial_registration
        createData.company_type = isCorp ? 'company' : 'person'

        if (workspaceId) {
          try {
            // Store-scoped: the receivable/payable accounts are per-store page
            // settings. Unscoped, this read the platform default (or threw
            // PGRST116 with a per-store row present) and applied store #1's
            // accounts to every store's new partners.
            const stdSettings = await getEffectiveStandardMappingSettings(
              supabaseAdmin,
              workspaceId,
              platform,
              'customers',
              storeId
            )

            if (stdSettings) {
              if (stdSettings.receivable_account_id && Number(stdSettings.receivable_account_id) > 0) {
                createData.property_account_receivable_id = Number(stdSettings.receivable_account_id)
              }
              if (stdSettings.payable_account_id && Number(stdSettings.payable_account_id) > 0) {
                createData.property_account_payable_id = Number(stdSettings.payable_account_id)
              }
            }
          } catch (acctErr) {
            console.warn(`[SyncEngine] Failed to load default customer accounts:`, acctErr)
          }
        }
      }

      if (platformId) {
        // No shopify branch on purpose: this create path has never written
        // x_shopify_id. Routing it through pickExistingIdField would start
        // writing the column, so keep it out of the Stage 1 unification.
        if (platform === 'zid') {
          if (relationFields.has('x_zid_id')) createData.x_zid_id = platformId
          else if (relationFields.has('zid_id')) createData.zid_id = platformId
        } else if (platform === 'salla') {
          if (relationFields.has('x_salla_id')) createData.x_salla_id = platformId
          else if (relationFields.has('salla_id')) createData.salla_id = platformId
        }
      }

      try {
        const newRecordId = await client.create(relation, createData)
        if (newRecordId) {
          console.info(`[SyncEngine] Successfully created new ${relation} #${newRecordId} (name="${nameVal}")`)
          return newRecordId
        }
      } catch (createErr: any) {
        console.warn(`[SyncEngine] Failed to create new record in "${relation}" with name="${nameVal}":`, createErr?.message ?? createErr)
      }
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Error resolving/creating relation for ${relation}:`, err?.message ?? err)
  }

  return null
}

/** Resolve store IDs with category settings, never with another store's first token. */
async function resolveStoreCategory(
  createCategory: CreateCategory,
  client: OdooClient, source: unknown, platform: 'zid' | 'salla', workspaceId: string,
  storeId: string, allowCreate: boolean, ancestors = new Set<string>(),
): Promise<number | null> {
  const settings = await getCachedStandardMappingSettings(workspaceId, platform, 'categories', storeId) || {}
  const key = storeId
  const tokenKey = await resolveSettingsStoreKey(supabaseAdmin, platform, storeId, workspaceId)
  const raw = source && typeof source === 'object' ? source as Record<string, unknown> : null
  const id = String(raw?.id ?? raw?.uuid ?? (typeof source === 'number' || (typeof source === 'string' && /^\d+$/.test(source)) ? source : ''))
  if (id && ancestors.has(id)) throw new Error('Cyclic store category hierarchy')
  const path = new Set(ancestors)
  if (id) path.add(id)
  let data: Record<string, unknown> = raw || { name: source }
  const scopedClient = categoryCompanyClient(client, settings.company_id)
  const mapping: FieldMappingRow = { id: 'category_relation', name: 'Category relation', erp_connection_id: getErpExecutionScope()?.erpConnectionId || '', workspace_id: workspaceId, merchant_id: key, store_id: key, action: 'category.create', odoo_model: 'product.category', mappings: {} }
  const fixedMatch = settings.match_odoo_field && settings.match_zid_field
    ? { odoo_field: settings.match_odoo_field, zid_field: settings.match_zid_field } : undefined
  if (!allowCreate && raw) {
    if (fixedMatch) return findExistingOdooRecord(scopedClient, 'product.category', raw, {}, mapping, undefined, fixedMatch, workspaceId, platform)
    const name = toNameString(raw.name ?? raw.names ?? raw.title)
    if (name) {
      const ids = await scopedClient.search('product.category', [['name', '=', name]])
      if (ids.length > 1) throw new Error('Ambiguous Odoo category match')
      return ids[0] ?? null
    }
  }
  // Durable identities survive renames and log retention. Do not fetch a deleted parent.
  if (id) {
    const linked = await resolveEntityLinkId({ workspaceId, platform, storeId: key, odooModel: 'product.category', storeEntityId: id })
    if (linked && (await scopedClient.search('product.category', [['id', '=', linked]], 1)).length) return linked
    const category = platform === 'salla'
      ? await readSallaStoreCategory(workspaceId, tokenKey, id)
      : await readZidStoreCategory(workspaceId, tokenKey, id)
    if (!category || Array.isArray(category) || typeof category !== 'object') throw new Error('Invalid store category response')
    data = { ...category, id }
  }
  const name = toNameString(data.name ?? data.names ?? data.title)
  if (!name) throw new Error('Store category name is missing')
  const existing = await findExistingOdooRecord(scopedClient, 'product.category', data, { name }, mapping, undefined, fixedMatch, workspaceId, platform)
  if (existing) return existing
  if (!allowCreate || settings.disabled || (Array.isArray(settings.enabled_actions) && !settings.enabled_actions.includes('create'))) return null
  const parent = data.parent_id ?? (data.parent as any)?.id ?? data.parent_category_id
  const parentId = parent && parent !== '0' ? await resolveStoreCategory(createCategory, client, parent, platform, workspaceId, key, true, path) : null
  const operation = () => createCategory({ client, mapping, event: 'category.create', storeId: key, zidEntityId: id, zidData: data, odooModel: 'product.category', odooOperation: 'create', odooValues: { name, ...(parentId ? { parent_id: parentId } : {}) }, presetKey: null, platformHint: platform })
  const scope = getErpExecutionScope()
  const result = scope && id ? await withErpExecutionContext({ ...scope, storeEntityId: id, rootModel: 'product.category' }, operation) : await operation()
  if (result.status !== 'success') throw new Error(result.message || 'Parent category creation failed')
  return result.odooRecordId ? Number(result.odooRecordId) : null
}
