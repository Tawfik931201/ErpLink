'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { decrypt } from '@/lib/crypto'
import { supabase } from '@/lib/supabase'
import { ErpNextClient } from '@/lib/sync-engine'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

import type { CreateCustomFieldData } from './custom-fields'

// ─── Helper Functions ─────────────────────────────────────────────────────────

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

async function getErpNextClient() {
  const user = await getOrCreateDbUser()
  if (!user.active_workspace_id) throw new Error('No active workspace selected')

  const { data: conn } = await supabase
    .from('erp_connections')
    .select('*')
    .eq('workspace_id', user.active_workspace_id)
    .maybeSingle()

  if (!conn) throw new Error('ERPNext connection not found. Please connect to ERPNext first.')

  if (conn.erp_type !== 'erpnext') {
    throw new Error('This operation is only supported for ERPNext connections.')
  }

  return {
    client: new ErpNextClient({
      url: conn.url,
      username: conn.username,
      apiKey: decrypt(conn.password),
    }),
    workspaceId: user.active_workspace_id,
  }
}

function mapFieldTypeToErpNext(type: string): string {
  switch (type) {
    case 'char':
      return 'Data'
    case 'text':
      return 'Small Text'
    case 'integer':
      return 'Int'
    case 'float':
      return 'Float'
    case 'boolean':
      return 'Check'
    case 'date':
      return 'Date'
    case 'datetime':
      return 'Datetime'
    case 'many2one':
      return 'Link'
    case 'selection':
      return 'Select'
    case 'monetary':
      return 'Currency'
    default:
      return 'Data'
  }
}

// ─── Public Actions ───────────────────────────────────────────────────────────

/**
 * Create a custom field in ERPNext (Custom Field DocType).
 */
export async function createCustomErpNextField(data: CreateCustomFieldData) {
  console.log('[createCustomErpNextField] Starting...', { technicalName: data.technicalName, model: data.odooModel })

  try {
    const { client } = await getErpNextClient()

    const erpNextType = mapFieldTypeToErpNext(data.fieldType)
    const payload: Record<string, any> = {
      dt: data.odooModel, // target DocType
      fieldname: data.technicalName,
      label: data.fieldLabel,
      fieldtype: erpNextType,
      reqd: data.required ? 1 : 0,
      read_only: data.readonly ? 1 : 0,
      description: data.help || '',
    }

    if (data.fieldType === 'many2one' && data.relation) {
      payload.options = data.relation
    }

    if (data.fieldType === 'selection' && data.selectionOptions && data.selectionOptions.length > 0) {
      payload.options = data.selectionOptions.map(opt => opt.label).join('\n')
    }

    console.info(`[ERPNext Custom Fields] Creating custom field in ERPNext:`, payload)
    const newFieldName = await client.create('Custom Field', payload)

    revalidatePath('/dashboard/mapping-center')
    return {
      success: true,
      fieldName: newFieldName,
      viewResults: [{ type: 'form', viewId: 1 }], // Fake view results for UI success display
      viewWarning: null,
    }
  } catch (error: any) {
    console.error('[createCustomErpNextField] Failed:', error)
    return { success: false, error: error.message || 'Failed to create ERPNext custom field' }
  }
}

/**
 * List all custom fields in ERPNext that start with "custom_".
 */
export async function getCustomErpNextFields() {
  try {
    const { client } = await getErpNextClient()

    // Query Custom Field REST endpoint
    const url = `${client['url']}/api/resource/Custom Field?fields=["name","dt","fieldname","label","fieldtype","options","reqd","read_only","description"]&filters=[["fieldname","like","custom_%"]]&limit_page_length=999`
    
    console.info(`[ERPNext Custom Fields] Fetching custom fields: ${url}`)
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': client['authHeader'],
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      throw new Error(`Frappe API responded with HTTP ${res.status}: ${res.statusText}`)
    }

    const json = await res.json()
    const rawFields = json.data || []

    const fields = rawFields.map((f: any) => {
      // Map ERPNext field types back to Odoo equivalents for frontend compatibility
      let ttype = 'char'
      const ftype = f.fieldtype
      if (ftype === 'Link') ttype = 'many2one'
      else if (ftype === 'Check') ttype = 'boolean'
      else if (ftype === 'Int') ttype = 'integer'
      else if (ftype === 'Float') ttype = 'float'
      else if (ftype === 'Currency') ttype = 'monetary'
      else if (ftype === 'Select') ttype = 'selection'
      else if (['Small Text', 'Text', 'Long Text'].includes(ftype)) ttype = 'text'

      // Parse selection options back
      let selectionOptions: any[] = []
      if (ftype === 'Select' && f.options) {
        selectionOptions = f.options.split('\n').map((opt: string) => ({ key: opt, label: opt }))
      }

      return {
        id: f.name, // ERPNext Custom Field Doc ID (e.g. "Item-custom_myfield")
        fieldname: f.fieldname,
        field_name: f.fieldname,
        field_label: f.label,
        odoo_model: f.dt, // mapped to odoo_model for compatibility
        field_type: ttype,
        properties: {
          readonly: f.read_only === 1,
          required: f.reqd === 1,
          help: f.description || '',
          relation: ftype === 'Link' ? f.options : undefined,
          selection_options: selectionOptions,
        }
      }
    })

    return { success: true, fields }
  } catch (error: any) {
    console.error('[getCustomErpNextFields] Failed:', error)
    return { success: false, fields: [], error: error.message || 'Failed to fetch ERPNext custom fields' }
  }
}

/**
 * Delete a custom field from ERPNext.
 */
export async function deleteCustomErpNextField(fieldname: string, docType: string) {
  try {
    const { client } = await getErpNextClient()

    // Try standard naming convention [DocType]-[fieldname]
    const namePattern = `${docType}-${fieldname}`
    console.info(`[deleteCustomErpNextField] Deleting custom field record: ${namePattern}`)
    
    try {
      const ok = await client.delete('Custom Field', namePattern)
      revalidatePath('/dashboard/mapping-center')
      return { success: ok }
    } catch (directDelErr) {
      console.warn(`[deleteCustomErpNextField] Direct deletion of "${namePattern}" failed, looking up exact ID:`, directDelErr)
      
      // Fallback: search for custom field record name via filters
      const searchUrl = `${client['url']}/api/resource/Custom Field?filters=[["dt","=","${docType}"],["fieldname","=","${fieldname}"]]&fields=["name"]`
      const res = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'Authorization': client['authHeader'],
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      })
      
      if (!res.ok) throw new Error(`Could not find custom field for deletion in ERPNext`)
      
      const json = await res.json()
      const items = json.data || []
      if (items.length === 0) {
        throw new Error(`Custom field "${fieldname}" on DocType "${docType}" not found in ERPNext.`)
      }

      const exactName = items[0].name
      console.info(`[deleteCustomErpNextField] Found exact record name: ${exactName}, executing delete...`)
      const ok = await client.delete('Custom Field', exactName)
      revalidatePath('/dashboard/mapping-center')
      return { success: ok }
    }
  } catch (error: any) {
    console.error('[deleteCustomErpNextField] Failed:', error)
    return { success: false, error: error.message || 'Failed to delete ERPNext custom field' }
  }
}

export interface UpdateCustomErpNextFieldData {
  id: string                   // ERPNext Custom Field Doc ID (e.g. "Item-custom_myfield")
  fieldname: string
  docType: string
  fieldLabel: string
  readonly: boolean
  required: boolean
  help: string
  selectionOptions?: Array<{ key: string; label: string }>
}

/**
 * Update a custom field properties in ERPNext.
 */
export async function updateCustomErpNextField(data: UpdateCustomErpNextFieldData) {
  try {
    const { client } = await getErpNextClient()

    const payload: Record<string, any> = {
      label: data.fieldLabel,
      reqd: data.required ? 1 : 0,
      read_only: data.readonly ? 1 : 0,
      description: data.help || '',
    }

    if (data.selectionOptions && data.selectionOptions.length > 0) {
      payload.options = data.selectionOptions.map(opt => opt.label).join('\n')
    }

    console.info(`[updateCustomErpNextField] Updating custom field "${data.id}":`, payload)
    const ok = await client.update('Custom Field', data.id, payload)

    revalidatePath('/dashboard/mapping-center')
    return { success: ok }
  } catch (error: any) {
    console.error('[updateCustomErpNextField] Failed:', error)
    return { success: false, error: error.message || 'Failed to update ERPNext custom field' }
  }
}
