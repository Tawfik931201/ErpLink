import { resolveBinaryField } from '@/lib/odoo/binary-field'
import { HARDCODED_FIELD_META } from '@/lib/odoo/field-meta'
import type { OdooClient } from '@/lib/odoo-client'
import { resolvePath, toNameString } from '@/lib/sync-helpers'
import type { FieldMappingItem, OdooFieldMeta } from '@/lib/sync-types'

import type { ResolveOdooRelation } from './relations'

// ─── Helper: build the Odoo values dict from Zid data + field meta ────────────
export async function buildOdooValues(
  resolveSingleRelationId: ResolveOdooRelation,
  client: OdooClient,
  mappingItems: FieldMappingItem[],
  zidData: Record<string, unknown>,
  fieldMeta: Map<string, OdooFieldMeta>,
  platform: 'zid' | 'salla' | 'shopify' = 'zid',
  workspaceId?: string,
  storeId = '',
  productSettings?: Record<string, any> | null,
): Promise<Record<string, unknown>> {
  if (productSettings?.disabled) return {}
  const values: Record<string, unknown> = {}

  for (const item of mappingItems) {
    if (!item.erpField) continue
    if (productSettings) {
      // Product images are never synced (2026-11-09) — not even an explicit
      // mapping to an `image*` field, regardless of any legacy sync_mode.
      if (item.erpField.startsWith('image')) continue
      if (item.erpField === 'categ_id' && productSettings.category?.sync_mode === 'skip') continue
      if (item.erpField === 'taxes_id' && ['skip', 'static_ids'].includes(productSettings.tax?.sync_mode)) continue
      // Cost source "don't update" ('none'): never write `standard_price` from
      // ANY mapping — preset default (`cost → standard_price`) or custom —
      // otherwise the setting is silently ignored and Odoo's cost is
      // overwritten (the 2026-11-09 report).
      if (item.erpField === 'standard_price' && productSettings.price?.cost_source === 'none') continue
      // Quantities must go through inventory adjustments and the stock-authority guard.
      if (['qty_available', 'virtual_available', 'free_qty'].includes(item.erpField)) continue
    }

    const hasStaticValue = Array.isArray(item.staticValue)
      ? item.staticValue.length > 0
      : item.staticValue !== undefined && item.staticValue !== null && item.staticValue !== ''

    const rawValue = hasStaticValue
      ? item.staticValue
      : item.zidField
        ? resolvePath(zidData, item.zidField)
        : undefined
    if (rawValue === null && item.erpField === 'parent_id') { values.parent_id = false; continue }
    if (rawValue === undefined || rawValue === null) continue

    let meta = fieldMeta.get(item.erpField)
    if (!meta) {
      // Odoo 19 removed res.partner.mobile. The order-sync path already
      // excludes it (see the hasPartnerField guard in createOrUpdatePartner),
      // and buildOdooValues normally skips any field the model lacks — but that
      // depends on fetchFieldMeta having returned a field set. When the
      // ir.model.fields read fails (empty map on some SaaS tenants), the next
      // branch falls into HARDCODED_FIELD_META, where `mobile` exists, and the
      // resulting write dies with KeyError: 'mobile'. No mapped entity other
      // than res.partner carries a `mobile` column, so skip the column unless
      // Odoo positively confirms the field is there.
      if (item.erpField === 'mobile' && (!fieldMeta || fieldMeta.size === 0)) {
        console.warn(`[SyncEngine] Skipping field "mobile" (not confirmed on Odoo model; removed in Odoo 19)`)
        continue
      }
      if (fieldMeta && fieldMeta.size > 0) {
        console.warn(`[SyncEngine] Skipping field "${item.erpField}" because it does not exist on Odoo model`)
        continue
      }
      const fallback = HARDCODED_FIELD_META[item.erpField]
      if (fallback) {
        meta = {
          name: item.erpField,
          ttype: fallback.ttype,
          relation: fallback.relation ?? ''
        }
      }
    }
    const ttype = meta?.ttype ?? ''
    const relation = meta?.relation ?? ''

    // ── Many2one: needs an integer record ID ──────────────────────────────────
    if (ttype === 'many2one' && relation) {
      if (hasStaticValue) {
        const id = Number(Array.isArray(rawValue) ? rawValue[0] : rawValue)
        if (Number.isInteger(id) && id > 0) {
          values[item.erpField] = id
          continue
        }
      }

      const singleValue = Array.isArray(rawValue) ? rawValue[0] : rawValue

      // If parent_id is empty or 0, it means it is a root category in Zid (no parent).
      // In Odoo, setting parent_id to false clears the parent or keeps it empty.
      if (item.erpField === 'parent_id' && (singleValue === null || singleValue === undefined || singleValue === '' || singleValue === 0 || singleValue === '0' || singleValue === 'null' || singleValue === 'None')) {
        values[item.erpField] = false
        continue
      }

      // UoM auto-create is cancelled (2026-11-09): never create a `uom.uom`
      // record, whatever any legacy `uom.auto_create` setting says. Matching
      // an existing UoM by name/ID still works — only creation is off.
      const allowCreate = relation === 'uom.uom' ? false
        : relation === 'product.category' ? productSettings?.category?.sync_mode !== 'map_existing' : true
      const resolvedId = await resolveSingleRelationId(client, relation, singleValue, platform, undefined, undefined, workspaceId, storeId, undefined, { allowCreate })
      if (resolvedId !== null) {
        values[item.erpField] = resolvedId
      } else {
        const nameStr = toNameString(singleValue)
        console.warn(`[SyncEngine] Skipping "${item.erpField}" — could not resolve "${nameStr}" in ${relation}`)
      }
      continue
    }

    // ── Many2many / One2many: needs [(6, 0, [ids])] syntax ────────────────────
    if ((ttype === 'many2many' || ttype === 'one2many') && relation) {
      const items = Array.isArray(rawValue) ? rawValue : [rawValue]
      const ids: number[] = []
      for (const v of items) {
        if (hasStaticValue) {
          const staticId = Number(v)
          if (Number.isInteger(staticId) && staticId > 0) {
            ids.push(staticId)
            continue
          }
        }

        const resolvedId = await resolveSingleRelationId(client, relation, v, platform, undefined, undefined, workspaceId, storeId)
        if (resolvedId !== null) ids.push(resolvedId)
      }
      if (ids.length > 0) {
        values[item.erpField] = [[6, 0, ids]]
      } else {
        console.warn(`[SyncEngine] Skipping "${item.erpField}" — no IDs resolved`)
      }
      continue
    }

    // ── Binary fields: Odoo expects base64 encoded data ────────────────────────
    if (ttype === 'binary') {
      const base64Data = await resolveBinaryField(rawValue)
      if (base64Data) {
        values[item.erpField] = base64Data
      } else {
        console.warn(`[SyncEngine] Skipping binary field "${item.erpField}" — could not resolve. rawValue type=${typeof rawValue} isArray=${Array.isArray(rawValue)} value=${JSON.stringify(rawValue).slice(0, 300)}`)
      }
      continue
    }

    // ── Numeric fields ─────────────────────────────────────────────────────────
    let value: unknown = rawValue
    if (ttype === 'boolean' && typeof value === 'string') {
      value = value === 'true'
    } else if (typeof value === 'string' && (item.erpField.endsWith('_ok') || item.erpField === 'active')) {
      value = value === 'true' || value === '1' || value === 'yes'
    }

    // Zid may send weight / cost as { value: 0, unit: "kg" } — extract the number
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if ('value' in obj || 'weight' in obj) {
        const numCandidate = parseFloat(String((obj as any).value ?? (obj as any).weight ?? ''))
        if (!isNaN(numCandidate)) {
          value = numCandidate
        } else {
          value = 0
        }
      }
    }

    if (
      typeof value === 'string' &&
      (['integer', 'float', 'monetary'].includes(ttype) ||
       ['list_price', 'standard_price', 'qty_available', 'weight', 'volume',
        'price', 'cost', 'taxes_id'].includes(item.erpField))
    ) {
      const parsed = parseFloat(value)
      if (!isNaN(parsed)) value = parsed
    }

    // ── Arrays → comma-separated string for plain text fields ─────────────────
    if (Array.isArray(value)) {
      value = value.map(toNameString).join(', ')
    }

    // ── Flatten language objects for char/text fields ───────────────────────────
    // Zid/Salla may send name/description as {ar: '...', en: '...'}.
    // Odoo plain fields expect a string, not a language dict.
    // We flatten here so the fallback values in safeCreateOdooRecord are also clean.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>
      if ('ar' in obj || 'en' in obj) {
        value = String(obj['ar'] || obj['en'] || '')
      }
    }

    // ── Datetime/date fields: Odoo's XML-RPC to_datetime is strict ─────────────
    // ('YYYY-MM-DD HH:MM:SS'). Salla sends `date.date` with microseconds
    // ("2022-06-26 12:21:45.000000"), which dies on sale.order.create with
    // "ValueError: unconverted data remains: .000000". Extract the
    // Odoo-compatible prefix; already-clean values pass through unchanged,
    // so Zid/Shopify flows are unaffected.
    if (typeof value === 'string' && (ttype === 'datetime' || ttype === 'date')) {
      const m = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/)
      if (m) {
        value = ttype === 'date' ? m[1] : `${m[1]} ${m[2] ? `${m[2]}:${m[3] ?? '00'}` : '00:00:00'}`
      }
    }

    values[item.erpField] = value
  }

  return values
}
