/**
 * ERPNext engine - the second ERP backend (REST, not XML-RPC).
 *
 * Split out of sync-engine.ts verbatim (no logic change) so the Odoo engine
 * no longer carries a 570-line parallel implementation of the same steps:
 * resolveRelation / buildValues / findExisting / execute.
 *
 * Shared dependencies come from three side modules, never from sync-engine.ts
 * (that would be a circular import, since the Odoo engine drives this one):
 *   - sync-types.ts   — data types
 *   - sync-helpers.ts — pure value helpers (resolvePath, toNameString)
 *   - sync-runtime.ts — supabaseAdmin client + logSync writer
 */

import { resolvePath, toNameString } from '@/lib/sync-helpers'
import { logSync } from '@/lib/sync-runtime'
import type {
  FieldMappingItem,
  FieldMappingRow,
  OdooFieldMeta,
  OdooOperation,
  SyncEngineResult,
} from '@/lib/sync-types'

// ─── ERPNext REST client & sync helpers ───────────────────────────────────────

export class ErpNextClient {
  private url: string
  private authHeader: string

  constructor(params: { url: string; username: string; apiKey: string }) {
    this.url = params.url.replace(/\/+$/, '')
    this.authHeader = `token ${params.username.trim()}:${params.apiKey.trim()}`
  }

  async search(docType: string, filters: any[][]): Promise<string[]> {
    const filtersStr = JSON.stringify(filters)
    const url = `${this.url}/api/resource/${docType}?filters=${encodeURIComponent(filtersStr)}&fields=["name"]&limit_page_length=1`
    
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`ERPNext search failed with HTTP ${res.status}: ${res.statusText}`)
    }

    const json = await res.json()
    const data = json.data || []
    return data.map((d: any) => d.name)
  }

  async create(docType: string, values: any): Promise<string> {
    const url = `${this.url}/api/resource/${docType}`
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext create failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    const json = await res.json()
    return json.data?.name || ''
  }

  async update(docType: string, name: string, values: any): Promise<boolean> {
    const url = `${this.url}/api/resource/${docType}/${encodeURIComponent(name)}`
    
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext update failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    return true
  }

  async delete(docType: string, name: string): Promise<boolean> {
    const url = `${this.url}/api/resource/${docType}/${encodeURIComponent(name)}`
    
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': this.authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ERPNext delete failed with HTTP ${res.status}: ${errText || res.statusText}`)
    }

    return true
  }
}

export async function fetchErpNextFieldMeta(
  client: ErpNextClient,
  docType: string,
  fieldNames?: string[]
): Promise<Map<string, OdooFieldMeta>> {
  const map = new Map<string, OdooFieldMeta>()
  try {
    const url = `${client['url']}/api/resource/DocType/${docType}`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': client['authHeader'],
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (res.ok) {
      const json = await res.json()
      const doc = json.data || {}
      const rawFields = doc.fields || []

      const systemFields = [
        { fieldname: 'name', label: 'Name', fieldtype: 'Data' },
        { fieldname: 'owner', label: 'Owner', fieldtype: 'Data' },
      ]

      const allFields = [...systemFields, ...rawFields]

      for (const f of allFields) {
        if (!fieldNames || fieldNames.includes(f.fieldname)) {
          let ttype = 'char'
          const ftype = (f.fieldtype || '').toLowerCase()
          if (ftype === 'link') ttype = 'many2one'
          else if (ftype === 'table') ttype = 'one2many'
          else if (ftype === 'check') ttype = 'boolean'
          else if (['currency', 'float', 'percent'].includes(ftype)) ttype = 'float'
          else if (ftype === 'int') ttype = 'integer'
          else if (ftype === 'select') ttype = 'selection'

          map.set(f.fieldname, {
            name: f.fieldname,
            ttype,
            relation: f.options || ''
          })
        }
      }
    }
  } catch (err: any) {
    console.warn('[SyncEngine] fetchErpNextFieldMeta failed, skipping relation resolution:', err.message)
  }
  return map
}

async function resolveSingleErpNextRelationName(
  client: ErpNextClient,
  relation: string,
  itemValue: unknown,
  platform: 'zid' | 'salla'
): Promise<string | null> {
  if (itemValue === undefined || itemValue === null) return null

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

  try {
    // Fetch target relation fields meta to verify field existence
    const relationFields = await fetchErpNextFieldMeta(client, relation)

    // â”€â”€â”€ Case 1: Search by Platform ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (platformId) {
      let searchField: string | null = null
      if (platform === 'zid') {
        if (relationFields.has('x_zid_id')) searchField = 'x_zid_id'
        else if (relationFields.has('zid_id')) searchField = 'zid_id'
      } else if (platform === 'salla') {
        if (relationFields.has('x_salla_id')) searchField = 'x_salla_id'
        else if (relationFields.has('salla_id')) searchField = 'salla_id'
      }

      if (searchField) {
        const names = await client.search(relation, [[searchField, '=', platformId]])
        if (names && names.length > 0) {
          console.info(`[SyncEngine] Resolved ERPNext relation ${relation} by platform ID "${platformId}" â†’ "${names[0]}"`)
          return names[0]
        }
      }
    }

    // â”€â”€â”€ Case 2: Search by Name inside ERPNext â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
      const names = await client.search(relation, [['name', '=', nameVal]])
      if (names && names.length > 0) {
        console.info(`[SyncEngine] Resolved ERPNext relation ${relation} by name="${nameVal}" â†’ "${names[0]}"`)
        return names[0]
      }

      if (relationFields.has('item_code')) {
        const itemNames = await client.search(relation, [['item_code', '=', nameVal]])
        if (itemNames && itemNames.length > 0) return itemNames[0]
      }
    }

    // â”€â”€â”€ Case 3: Create it if not found â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const systemDocTypes = ['currency', 'uom', 'company', 'warehouse', 'payment_term', 'price_list']
    if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined' && !systemDocTypes.includes(relation.toLowerCase())) {
      console.info(`[SyncEngine] Creating new ERPNext "${relation}" with name="${nameVal}"`)
      
      const createData: Record<string, any> = {}
      createData.name = nameVal

      // Set specific fields if they exist in the target DocType:
      if (relationFields.has('item_group_name')) createData.item_group_name = nameVal
      if (relationFields.has('customer_name')) createData.customer_name = nameVal
      if (relationFields.has('uom_name')) createData.uom_name = nameVal
      
      // Tree hierarchy defaults
      if (relationFields.has('parent_item_group')) createData.parent_item_group = 'All Item Groups'
      if (relationFields.has('parent_customer_group')) createData.parent_customer_group = 'All Customer Groups'
      if (relationFields.has('parent_territory')) createData.parent_territory = 'All Territories'
      if (relationFields.has('is_group')) createData.is_group = 0

      // Customer defaults
      if (relationFields.has('customer_type')) createData.customer_type = 'Individual'
      if (relationFields.has('customer_group')) createData.customer_group = 'All Customer Groups'
      if (relationFields.has('territory')) createData.territory = 'All Territories'

      // Item defaults
      if (relation.toLowerCase() === 'item') {
        createData.item_code = nameVal
        createData.item_name = nameVal
        createData.item_group = 'All Item Groups'
        createData.stock_uom = 'Nos'
      }

      if (platformId) {
        let key: string | null = null
        if (platform === 'zid') {
          if (relationFields.has('x_zid_id')) key = 'x_zid_id'
          else if (relationFields.has('zid_id')) key = 'zid_id'
        } else if (platform === 'salla') {
          if (relationFields.has('x_salla_id')) key = 'x_salla_id'
          else if (relationFields.has('salla_id')) key = 'salla_id'
        }
        if (key) createData[key] = platformId
      }

      try {
        const newName = await client.create(relation, createData)
        if (newName) {
          console.info(`[SyncEngine] Successfully created ERPNext relation "${relation}" â†’ "${newName}"`)
          return newName
        }
      } catch (createErr: any) {
        console.warn(`[SyncEngine] Failed to create ERPNext relation "${relation}":`, createErr.message)
      }
    }
  } catch (err: any) {
    console.warn(`[SyncEngine] Error resolving ERPNext relation for ${relation}:`, err.message)
  }

  return null
}

export async function buildErpNextValues(
  client: ErpNextClient,
  mappingItems: FieldMappingItem[],
  zidData: Record<string, unknown>,
  fieldMeta: Map<string, OdooFieldMeta>,
  platform: 'zid' | 'salla' = 'zid'
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {}

  for (const item of mappingItems) {
    if (!item.erpField) continue

    const hasStaticValue = Array.isArray(item.staticValue)
      ? item.staticValue.length > 0
      : item.staticValue !== undefined && item.staticValue !== null && item.staticValue !== ''

    const rawValue = hasStaticValue
      ? item.staticValue
      : item.zidField
        ? resolvePath(zidData, item.zidField)
        : undefined
    if (rawValue === undefined || rawValue === null) continue

    const meta = fieldMeta.get(item.erpField)
    const ttype = meta?.ttype ?? ''
    const relation = meta?.relation ?? ''

    if (ttype === 'many2one' && relation) {
      if (hasStaticValue) {
        const valStr = String(Array.isArray(rawValue) ? rawValue[0] : rawValue)
        values[item.erpField] = valStr
        continue
      }

      const singleValue = Array.isArray(rawValue) ? rawValue[0] : rawValue
      const resolvedName = await resolveSingleErpNextRelationName(client, relation, singleValue, platform)
      if (resolvedName !== null) {
        values[item.erpField] = resolvedName
      } else {
        const nameStr = toNameString(singleValue)
        console.warn(`[SyncEngine] Skipping ERPNext "${item.erpField}" â€” could not resolve "${nameStr}" in ${relation}`)
      }
      continue
    }

    if (ttype === 'one2many' && relation) {
      const items = Array.isArray(rawValue) ? rawValue : [rawValue]
      const childRows: any[] = []
      
      try {
        const childFields = await fetchErpNextFieldMeta(client, relation)
        
        // Find the first Link field in the child schema
        let linkField: string | null = null
        let linkRelation: string | null = null
        
        for (const [name, meta] of childFields.entries()) {
          if (meta.ttype === 'many2one' && meta.relation) {
            linkField = name
            linkRelation = meta.relation
            break
          }
        }

        for (const childItem of items) {
          if (childItem !== undefined && childItem !== null) {
            const rowData: Record<string, any> = {}

            if (linkField && linkRelation) {
              const resolvedName = await resolveSingleErpNextRelationName(client, linkRelation, childItem, platform)
              if (resolvedName) {
                rowData[linkField] = resolvedName
              }
            }

            // Copy any other matching fields from childItem if it's an object
            if (typeof childItem === 'object' && childItem !== null) {
              const childObj = childItem as Record<string, any>
              for (const key of Object.keys(childObj)) {
                let targetKey = key
                if (key === 'quantity' && childFields.has('qty')) targetKey = 'qty'
                else if (key === 'qty' && childFields.has('quantity')) targetKey = 'quantity'
                else if (key === 'price' && childFields.has('rate')) targetKey = 'rate'
                else if (key === 'rate' && childFields.has('price')) targetKey = 'price'

                if (childFields.has(targetKey)) {
                  let val = childObj[key]
                  const type = childFields.get(targetKey)?.ttype
                  if (type === 'float' || type === 'integer') {
                    const parsed = parseFloat(val)
                    if (!isNaN(parsed)) val = parsed
                  }
                  rowData[targetKey] = val
                }
              }
            }

            if (Object.keys(rowData).length > 0) {
              childRows.push(rowData)
            }
          }
        }
      } catch (err: any) {
        console.warn(`[SyncEngine] Failed to resolve child table rows for ${relation}:`, err.message)
      }

      if (childRows.length > 0) {
        values[item.erpField] = childRows
      }
      continue
    }

    let value: unknown = rawValue
    if (ttype === 'boolean' && typeof value === 'string') {
      value = value === 'true'
    }
    if (
      typeof value === 'string' &&
      (['integer', 'float', 'monetary'].includes(ttype) ||
       ['qty', 'rate', 'price', 'quantity', 'amount'].includes(item.erpField.toLowerCase()))
    ) {
      const parsed = parseFloat(value)
      if (!isNaN(parsed)) value = parsed
    }

    if (Array.isArray(value)) {
      value = value.map(toNameString).join(', ')
    }

    values[item.erpField] = value
  }

  return values
}

async function findExistingErpNextRecord(
  client: ErpNextClient,
  model: string,
  zidData: Record<string, unknown>,
  erpValues: Record<string, unknown>,
  mapping?: { odoo_match_field?: string | null; zid_match_field?: string | null }
): Promise<string | null> {
  const candidates: any[][] = []

  // 1. User defined matching fields
  if (mapping?.odoo_match_field && mapping?.zid_match_field) {
    const matchValue = resolvePath(zidData, mapping.zid_match_field)
    if (matchValue !== undefined && matchValue !== null && matchValue !== '') {
      candidates.push([mapping.odoo_match_field, '=', matchValue])
    }
  }

  // 2. Platform ID (Zid ID / Salla ID)
  const zidId = String(
    zidData.id ??
    zidData.category_id ??
    zidData.category_uuid ??
    zidData.customer_id ??
    zidData.order_id ??
    ''
  )
  if (zidId) {
    try {
      const relationFields = await fetchErpNextFieldMeta(client, model)
      if (relationFields.has('x_zid_id')) candidates.push(['x_zid_id', '=', zidId])
      else if (relationFields.has('zid_id')) candidates.push(['zid_id', '=', zidId])
      else if (relationFields.has('x_salla_id')) candidates.push(['x_salla_id', '=', zidId])
      else if (relationFields.has('salla_id')) candidates.push(['salla_id', '=', zidId])
    } catch {}
  }

  // 3. Match by Name / Item Code / Group Name
  const nameVal = String(
    erpValues.name ??
    erpValues.item_group_name ??
    erpValues.customer_name ??
    (zidData.name ? toNameString(zidData.name) : '') ??
    ''
  ).trim()

  if (nameVal && nameVal !== '[object Object]' && nameVal !== 'undefined') {
    candidates.push(['name', '=', nameVal])
    if (model.toLowerCase() === 'item') {
      candidates.push(['item_code', '=', nameVal])
    }
    if (model.toLowerCase() === 'item group') {
      candidates.push(['item_group_name', '=', nameVal])
    }
  }

  // 4. Match by SKU
  const sku = String(zidData.sku || erpValues.item_code || erpValues.default_code || '')
  if (sku && sku !== 'none') {
    if (model.toLowerCase() === 'item') {
      candidates.push(['item_code', '=', sku])
    } else {
      candidates.push(['name', '=', sku])
    }
  }

  for (const filter of candidates) {
    try {
      const records = await client.search(model, [filter])
      if (records.length > 0) return records[0]
    } catch (err) {
      console.warn(`[SyncEngine] Duplicate check failed for ERPNext ${model}:`, err)
    }
  }

  return null
}

export async function executeErpNextOperation(params: {
  client: ErpNextClient
  mapping: FieldMappingRow
  event: string
  storeId: string
  zidEntityId: string
  zidData: Record<string, unknown>
  docType: string
  operation: OdooOperation
  values: Record<string, unknown>
  triggerType?: 'automatic' | 'manual'
  existingLogId?: string
}): Promise<SyncEngineResult['records'][number]> {
  const {
    client,
    mapping,
    event,
    storeId,
    zidEntityId,
    zidData,
    docType,
    operation,
    values,
    triggerType,
    existingLogId,
  } = params

  if (operation === 'create') {
    const duplicateId = await findExistingErpNextRecord(client, docType, zidData, values, mapping)
    if (duplicateId !== null) {
      const msg = `Matching ${docType} "${duplicateId}" already exists in ERPNext; create skipped`
      console.info(`[SyncEngine] ${msg}`)
      await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: duplicateId, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
      return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'skipped', message: msg }
    }

    if (docType.toLowerCase() === 'item') {
      if (!values.item_code && zidData.sku) values.item_code = zidData.sku
      if (!values.item_name && zidData.name) values.item_name = toNameString(zidData.name)
      if (!values.item_group) values.item_group = 'All Item Groups'
      if (!values.stock_uom) values.stock_uom = 'Nos'
    }

    const newName = await client.create(docType, values)
    console.info(`[SyncEngine] âœ… Created ${docType} "${newName}" in ERPNext (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: newName, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Created record: ${newName}` }
  }

  const existingId = await findExistingErpNextRecord(client, docType, zidData, values, mapping)
  if (existingId === null) {
    const msg = `No matching ${docType} record found in ERPNext for ${operation}`
    console.warn(`[SyncEngine] ${msg}`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, status: 'skipped', error_message: msg, payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'skipped', message: msg }
  }

  if (operation === 'update') {
    const ok = await client.update(docType, existingId, values)
    if (!ok) throw new Error(`ERPNext update returned false for ${docType} "${existingId}"`)
    console.info(`[SyncEngine] âœ… Updated ${docType} "${existingId}" in ERPNext (zid_id="${zidEntityId}")`)
    await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
    return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Updated record: ${existingId}` }
  }

  const ok = await client.delete(docType, existingId)
  if (!ok) throw new Error(`ERPNext delete returned false for ${docType} "${existingId}"`)
  console.info(`[SyncEngine] âœ… Deleted ${docType} "${existingId}" from ERPNext (zid_id="${zidEntityId}")`)
  await logSync({ id: existingLogId, workspace_id: mapping.workspace_id, field_mapping_id: mapping.id, event, store_id: storeId, zid_entity_id: zidEntityId, odoo_model: docType, odoo_record_id: existingId, status: 'success', payload: zidData, trigger_type: triggerType })
  return { mappingId: mapping.id, mappingName: mapping.name, model: docType, status: 'success', message: `Deleted record: ${existingId}` }
}
