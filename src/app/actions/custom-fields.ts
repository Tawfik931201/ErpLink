'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { decrypt } from '@/lib/crypto'
import {
  buildSelectionString,
  escapeXmlAttr,
  validateCustomFieldInput,
} from '@/lib/custom-field-validation'
import { OdooClient } from '@/lib/odoo-client'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

async function getOdooClient() {
  const user = await getOrCreateDbUser()
  if (!user.active_workspace_id) throw new Error('No active workspace selected')

  const { data: conn } = await supabase
    .from('erp_connections')
    .select('*')
    .eq('workspace_id', user.active_workspace_id)
    .maybeSingle()

  if (!conn) throw new Error('Odoo connection not found. Please connect to Odoo first.')

  if (conn.erp_type && conn.erp_type !== 'odoo') {
    throw new Error('إدارة الحقول المخصصة غير مدعومة حالياً إلا لنظام أودو (Custom fields are currently only supported for Odoo)')
  }

  return {
    client: new OdooClient({
      url: conn.url,
      db: conn.db_name || '',
      username: conn.username,
      apiKey: decrypt(conn.password),
    }),
    workspaceId: user.active_workspace_id,
    erpType: (conn.erp_type as string | null) || 'odoo',
  }
}

export type CustomFieldView = 'list' | 'form' | 'both'

export interface CreateCustomFieldData {
  fieldLabel: string          // Human-readable label
  technicalName: string       // x_something (validated on client)
  fieldType: string           // char, integer, float, boolean, text, date, datetime, many2one, selection
  odooModel: string           // e.g. 'sale.order'
  views: CustomFieldView      // list | form | both
  readonly?: boolean
  required?: boolean
  copy?: boolean
  help?: string
  // For many2one
  relation?: string
  // For selection: array of [key, label] pairs
  selectionOptions?: Array<{ key: string; label: string }>
  // Odoo security group IDs (Many2Many)
  groupIds?: number[]
}

// ─────────────────────────────────────────────────────────────────────────────
// View Injection Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the root base view for a model (form type only).
 * Root = view with no parent (inherit_id = False), lowest priority.
 */
async function findBaseView(
  client: InstanceType<typeof OdooClient>,
  odooModel: string,
): Promise<{ id: number; name: string } | null> {

  type ViewRecord = { id: number; name: string; priority: number }

  const exec = async (domain: any[]): Promise<ViewRecord[]> => {
    try {
      return await client.execute<ViewRecord[]>(
        'ir.ui.view',
        'search_read',
        [domain],
        { fields: ['id', 'name', 'priority'], limit: 10, order: 'priority asc, id asc' }
      ) || []
    } catch { return [] }
  }

  // 1. Root views: inherit_id = False (most reliable)
  const roots = await exec([
    ['model', '=', odooModel],
    ['type', '=', 'form'],
    ['inherit_id', '=', false],
  ])
  if (roots.length > 0) {
    const best = roots[0]
    console.log(`[findBaseView] ✓ inherit_id=False form: id=${best.id} name="${best.name}" priority=${best.priority}`)
    return best
  }

  // 2. mode = 'base'
  const byMode = await exec([
    ['model', '=', odooModel],
    ['type', '=', 'form'],
    ['mode', '=', 'base'],
  ])
  if (byMode.length > 0) {
    const best = byMode[0]
    console.log(`[findBaseView] ✓ mode=base form: id=${best.id} name="${best.name}"`)
    return best
  }

  // 3. Any view of this type (take lowest priority = most base)
  const any = await exec([
    ['model', '=', odooModel],
    ['type', '=', 'form'],
  ])
  if (any.length > 0) {
    const best = any.sort((a, b) => a.priority - b.priority)[0]
    console.log(`[findBaseView] ✓ any (lowest-priority) form: id=${best.id} name="${best.name}" priority=${best.priority}`)
    return best
  }

  console.warn(`[findBaseView] ✗ No form view found for ${odooModel}`)
  return null
}

/**
 * Inject a custom field into Odoo form view via ir.ui.view inheritance.
 * Makes the field visible in Odoo UI without Odoo Studio.
 *
 * - Tries multiple xpath expressions until one succeeds
 * - Skips creation if a view with same name already exists (idempotent)
 * - Sets mode='extension' (correct Odoo approach)
 */
async function injectFieldIntoViews(
  client: InstanceType<typeof OdooClient>,
  fieldName: string,
  fieldLabel: string,
  odooModel: string,
) {
  const results: { type: string; viewId: number | null; error?: string }[] = []
  const modelSlug = odooModel.replace(/\./g, '_')

  try {
    // ── Step 1: Find base view ───────────────────────────────────────────
    const base = await findBaseView(client, odooModel)
    if (!base) {
      results.push({ type: 'form', viewId: null, error: `No form view found for ${odooModel}` })
      return results
    }

    // ── Step 2: Check duplicate ──────────────────────────────────────────
    const viewName = `erplink_${modelSlug}_${fieldName}_form`
    try {
      const existing = await client.execute<Array<{ id: number }>>(
        'ir.ui.view', 'search_read',
        [[['name', '=', viewName], ['model', '=', odooModel]]],
        { fields: ['id'], limit: 1 }
      )
      if (existing && existing.length > 0) {
        console.log(`[injectFieldIntoViews] View "${viewName}" already exists (id=${existing[0].id})`)
        results.push({ type: 'form', viewId: existing[0].id })
        return results
      }
    } catch { /* ignore duplicate check errors */ }

    // ── Step 3: Build & create view ──────────────────────────────────────
    // We try to place inside a group named 'erp_link_group' so all custom fields are grouped together under "ERP Link"
    //
    // fieldLabel is user text interpolated into a real XML attribute, so it
    // MUST be escaped: a label containing `"` would otherwise close the
    // attribute and inject arbitrary arch markup into the customer's Odoo.
    // fieldName is machine-validated (x_[a-z0-9_]) upstream, so it cannot
    // contain anything structural.
    const safeLabel = escapeXmlAttr(fieldLabel)
    const group = `<group name="erp_link_group" string="ERP Link"><field name="${fieldName}" string="${safeLabel}"/></group>`
    const archAttempts = [
      // 1. Try to inject into the existing erp_link_group group (if already created by another field)
      `<data><xpath expr="//group[@name='erp_link_group']" position="inside"><field name="${fieldName}" string="${safeLabel}"/></xpath></data>`,

      // 2. Try to create the erp_link_group inside the <sheet> (standard Odoo template)
      `<data><xpath expr="//sheet" position="inside">${group}</xpath></data>`,

      // 3. Try to create it after the last group in sheet
      `<data><xpath expr="//sheet//group[last()]" position="after">${group}</xpath></data>`,

      // 4. Try to create it inside a notebook
      `<data><xpath expr="//notebook" position="before">${group}</xpath></data>`,

      // 5. Try to create it after the 'name' field
      `<data><xpath expr="//field[@name='name']" position="after">${group}</xpath></data>`,

      // 6. Absolute last resort: inside the <form> tag
      `<data><xpath expr="//form" position="inside">${group}</xpath></data>`,
    ]

    let created = false
    let lastErr = ''

    for (let i = 0; i < archAttempts.length; i++) {
      try {
        const viewId = await client.create('ir.ui.view', {
          name: viewName,
          model: odooModel,
          inherit_id: base.id,
          arch_base: archAttempts[i],
          mode: 'extension',
          type: 'form',
          priority: 99,
          active: true,
        })
        console.log(`[injectFieldIntoViews] ✓ Form view created (attempt ${i + 1}/6) id=${viewId}`)
        results.push({ type: 'form', viewId })
        created = true
        break
      } catch (e: any) {
        lastErr = e.message || String(e)
        console.warn(`[injectFieldIntoViews] Attempt ${i + 1} failed: ${lastErr.slice(0, 100)}`)
      }
    }

    if (!created) {
      results.push({ type: 'form', viewId: null, error: `All form xpath attempts failed. Last: ${lastErr}` })
    }

  } catch (err: any) {
    console.error(`[injectFieldIntoViews] Outer error for form:`, err.message || err)
    results.push({ type: 'form', viewId: null, error: err.message })
  }

  return results
}


// ─────────────────────────────────────────────────────────────────────────────
// Public Actions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a custom field in Odoo (ir.model.fields) and inject it into views.
 */
export async function createCustomOdooField(data: CreateCustomFieldData) {
  console.log('[createCustomOdooField] Starting...', { technicalName: data.technicalName, model: data.odooModel })

  try {
    const { client, workspaceId, erpType } = await getOdooClient()

    // 0. Validate on the server. The form validates too, but a Server Action is
    //    a public endpoint — anything reaching it did not pass through the UI.
    const check = validateCustomFieldInput(
      {
        technicalName: data.technicalName,
        fieldLabel: data.fieldLabel,
        fieldType: data.fieldType,
        odooModel: data.odooModel,
        relation: data.relation,
        selectionOptions: data.selectionOptions,
        groupIds: data.groupIds,
        help: data.help,
      },
      erpType
    )
    if (!check.ok) {
      console.warn('[createCustomOdooField] Rejected invalid input:', check.error)
      return { success: false, error: check.error }
    }
    const v = check.value

    // 1. Find model_id
    const modelRecords = await client.execute<Array<{ id: number; model: string; name: string }>>(
      'ir.model',
      'search_read',
      [[['model', '=', v.odooModel]]],
      { fields: ['id', 'model', 'name'], limit: 1 }
    )

    if (!modelRecords || modelRecords.length === 0) {
      throw new Error(`Model "${v.odooModel}" not found in Odoo`)
    }

    const modelId = modelRecords[0].id
    console.log('[createCustomOdooField] Found model_id:', modelId)

    // 2. Build field payload
    const fieldPayload: Record<string, unknown> = {
      name: v.technicalName,
      field_description: v.fieldLabel,
      model_id: modelId,
      ttype: v.fieldType,
      store: true,
      tracking: true,
      readonly: data.readonly ?? false,
      required: data.required ?? false,
      copied: data.copy ?? true,
      help: v.help || '',
    }

    if (v.fieldType === 'many2one' && v.relation) {
      fieldPayload.relation = v.relation
    }

    if (v.fieldType === 'selection' && v.selectionOptions && v.selectionOptions.length > 0) {
      fieldPayload.selection = buildSelectionString(v.selectionOptions)
    }

    if (v.groupIds && v.groupIds.length > 0) {
      // In Odoo, M2M fields are written using command format: [(6, 0, [ids])]
      fieldPayload.groups = [[6, 0, v.groupIds]]
    }

    // 3. Create field in Odoo
    console.log('[createCustomOdooField] Creating field in ir.model.fields...')
    const newFieldId = await client.create('ir.model.fields', fieldPayload)
    console.log('[createCustomOdooField] Field created in Odoo, id:', newFieldId)

    // 4. Inject field into views automatically
    let viewResults: { type: string; viewId: number | null; error?: string }[] = []
    try {
      viewResults = await injectFieldIntoViews(
        client,
        v.technicalName,
        v.fieldLabel,
        v.odooModel,
      )
      console.log('[createCustomOdooField] View injection results:', JSON.stringify(viewResults))
    } catch (viewErr: any) {
      console.warn('[createCustomOdooField] View injection error (non-critical):', viewErr.message)
    }

    // 5. Save locally in Supabase (best-effort)
    try {
      await supabase.from('custom_odoo_fields').insert([{
        workspace_id: workspaceId,
        odoo_field_id: newFieldId,
        field_name: v.technicalName,
        field_label: v.fieldLabel,
        odoo_model: v.odooModel,
        field_type: v.fieldType,
        views: 'form',
        properties: {
          readonly: data.readonly ?? false,
          required: data.required ?? false,
          copy: data.copy ?? true,
          help: v.help || '',
          relation: v.relation || null,
          selection_options: v.selectionOptions || [],
          group_ids: v.groupIds || [],
          injected_views: viewResults,
        },
        created_at: new Date().toISOString(),
      }])
      console.log('[createCustomOdooField] Saved locally in Supabase.')
    } catch (supaErr) {
      console.warn('[createCustomOdooField] Supabase save failed (non-critical):', supaErr)
    }

    revalidatePath('/app/mapping-center')

    const viewsFailed = viewResults.filter(r => r.error)
    return {
      success: true,
      odooFieldId: newFieldId,
      viewResults,
      viewWarning: viewsFailed.length > 0
        ? `Field created, but could not inject into some views: ${viewsFailed.map(v => `${v.type}: ${v.error}`).join(', ')}`
        : null,
    }
  } catch (error: any) {
    console.error('[createCustomOdooField] Failed:', error)
    return { success: false, error: error.message || 'Failed to create custom field' }
  }
}

/**
 * List all custom fields created by this workspace.
 * Fetches from Supabase first, falls back to Odoo.
 */
export async function getCustomOdooFields() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) return { success: true, fields: [] }

    // Try Supabase first
    const { data: localFields, error } = await supabase
      .from('custom_odoo_fields')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .order('created_at', { ascending: false })

    if (!error && localFields) {
      return { success: true, fields: localFields, source: 'supabase' }
    }

    // Fallback: fetch from Odoo directly
    const { client } = await getOdooClient()
    const odooFields = await client.execute<Array<{
      id: number; name: string; field_description: string; model: string; ttype: string
    }>>(
      'ir.model.fields',
      'search_read',
      [[['name', 'like', 'x_'], ['store', '=', true]]],
      { fields: ['id', 'name', 'field_description', 'model', 'ttype'], limit: 200 }
    )

    return {
      success: true,
      fields: odooFields.map(f => ({
        id: String(f.id),
        odoo_field_id: f.id,
        field_name: f.name,
        field_label: f.field_description,
        odoo_model: f.model,
        field_type: f.ttype,
      })),
      source: 'odoo',
    }
  } catch (error: any) {
    console.error('[getCustomOdooFields] Failed:', error)
    return { success: false, fields: [], error: error.message }
  }
}

/**
 * Delete a custom field from Odoo (and Supabase record if exists).
 * Also automatically cleans up any inherited views created for this field.
 */
export async function deleteCustomOdooField(odooFieldId: number, supabaseId?: string) {
  try {
    const { client, workspaceId } = await getOdooClient()

    // 1. Find field technical name first
    const fieldRecords = await client.execute<Array<{ name: string; model: string }>>(
      'ir.model.fields', 'search_read',
      [[['id', '=', odooFieldId]]],
      { fields: ['name', 'model'], limit: 1 }
    )

    if (fieldRecords && fieldRecords.length > 0) {
      const fieldName = fieldRecords[0].name
      const modelSlug = fieldRecords[0].model.replace(/\./g, '_')

      // Only ever unlink an `x_` / `custom_` field. Without this the action
      // could delete any column in the customer's Odoo by passing its id —
      // including Odoo's own core fields, which breaks their ERP.
      if (!/^(x_|custom_)[a-z][a-z0-9_]*$/.test(fieldName)) {
        console.warn('[deleteCustomOdooField] Refusing to delete non-custom field', fieldName)
        return { success: false, error: 'Only custom (x_*) fields can be deleted here' }
      }
      
      // 2. Find and delete the inherited views created by our app
      // e.g. zidlink_product_template_x_myfield_form or zidlink_product_template_x_myfield_tree
      try {
        const viewNamePattern = `erplink_${modelSlug}_${fieldName}_`
        const views = await client.execute<Array<{ id: number }>>(
          'ir.ui.view', 'search',
          [[['name', 'like', viewNamePattern]]]
        )
        if (views && views.length > 0) {
          console.log(`[deleteCustomOdooField] Cleaning up inherited views:`, views)
          await client.execute<boolean>('ir.ui.view', 'unlink', [views])
        }
      } catch (viewDelErr: any) {
        console.warn(`[deleteCustomOdooField] Failed to delete inherited views:`, viewDelErr.message)
      }
    }

    // 3. Delete field from Odoo
    await client.execute<boolean>('ir.model.fields', 'unlink', [[odooFieldId]])
    console.log('[deleteCustomOdooField] Deleted field from Odoo, id:', odooFieldId)

    // 4. Delete from Supabase
    if (supabaseId) {
      await supabase
        .from('custom_odoo_fields')
        .delete()
        .eq('id', supabaseId)
        .eq('workspace_id', workspaceId)
    }

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[deleteCustomOdooField] Failed:', error)
    return { success: false, error: error.message || 'Failed to delete custom field' }
  }
}

export interface UpdateCustomFieldData {
  id: string                   // Supabase ID
  odooFieldId: number          // Odoo field ID
  fieldLabel: string
  readonly: boolean
  required: boolean
  copy: boolean
  help: string
  selectionOptions?: Array<{ key: string; label: string }>
  groupIds?: number[]
}

export async function updateCustomOdooField(data: UpdateCustomFieldData) {
  try {
    const { client, workspaceId } = await getOdooClient()

    // The Supabase side used to be filtered by row id only, so passing another
    // workspace's `data.id` rewrote that workspace's label and properties.
    // Both the read and the write are now scoped to the caller's workspace.
    const { data: existing } = await supabase
      .from('custom_odoo_fields')
      .select('properties, odoo_field_id')
      .eq('id', data.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (!existing) {
      console.warn('[updateCustomOdooField] No custom field', data.id, 'in workspace', workspaceId)
      return { success: false, error: 'Custom field not found' }
    }

    // Never write a field the workspace does not actually own.
    const odooFieldId = existing.odoo_field_id ?? data.odooFieldId
    if (typeof odooFieldId !== 'number' || odooFieldId !== data.odooFieldId) {
      console.warn('[updateCustomOdooField] odooFieldId does not match the stored field')
      return { success: false, error: 'Custom field not found' }
    }

    const fieldLabel = String(data.fieldLabel ?? '').trim()
    if (!fieldLabel) {
      return { success: false, error: 'Field label is required' }
    }

    const fieldPayload: Record<string, unknown> = {
      field_description: fieldLabel,
      readonly: data.readonly,
      required: data.required,
      copied: data.copy,
      help: data.help,
    }

    if (data.selectionOptions && data.selectionOptions.length > 0) {
      fieldPayload.selection = buildSelectionString(
        data.selectionOptions.map(o => ({ key: String(o?.key ?? ''), label: String(o?.label ?? '') }))
      )
    }

    if (data.groupIds) {
      fieldPayload.groups = [[6, 0, data.groupIds]]
    } else {
      fieldPayload.groups = [[5, 0, 0]] // clear groups
    }

    console.log('[updateCustomOdooField] Writing to ir.model.fields...', odooFieldId, fieldPayload)
    await client.execute('ir.model.fields', 'write', [[odooFieldId], fieldPayload])

    // Update in Supabase
    const oldProps = (existing.properties || {}) as Record<string, unknown>
    const newProps = {
      ...oldProps,
      readonly: data.readonly,
      required: data.required,
      copy: data.copy,
      help: data.help,
      selection_options: data.selectionOptions || oldProps.selection_options || [],
      group_ids: data.groupIds || oldProps.group_ids || [],
    }

    await supabase
      .from('custom_odoo_fields')
      .update({
        field_label: fieldLabel,
        properties: newProps,
      })
      .eq('id', data.id)
      .eq('workspace_id', workspaceId)

    revalidatePath('/app/mapping-center')
    return { success: true }
  } catch (error: any) {
    console.error('[updateCustomOdooField] Failed:', error)
    return { success: false, error: error.message || 'Failed to update custom field' }
  }
}

