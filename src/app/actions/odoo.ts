'use server'

import { revalidatePath, unstable_cache, revalidateTag } from 'next/cache'

import { getActiveUserId } from '@/lib/auth'
import { encrypt, decrypt } from '@/lib/crypto'
import { OdooClient } from '@/lib/odoo-client'
import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

async function getOrCreateDbUser() {
  const userId = await getActiveUserId()
  if (!userId) throw new Error('Unauthorized')

  return ensureDbUser(userId)
}


/**
 * Get active workspace's Odoo connection
 */
const getCachedErpConnection = unstable_cache(
  async (workspaceId: string) => {
    const { data: connection, error } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (error) throw new Error('Failed to query Odoo connection: ' + error.message)
    return connection
  },
  ['erp-connection'],
  { revalidate: 30, tags: ['erp-connection'] }
)

export async function getActiveWorkspaceErpConnection() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, connection: null }
    }

    const connection = await getCachedErpConnection(user.active_workspace_id)
    return { success: true, connection }
  } catch (error: any) {
    console.error('[Odoo Action] getActiveWorkspaceOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to fetch Odoo connection' }
  }
}

/**
 * Test Odoo credentials
 */
export async function testErpConnection(url: string, db: string, username: string, apiKey: string, erpType: string = 'odoo') {
  try {
    if (erpType === 'odoo') {
      if (!url || !db || !username || !apiKey) {
        return { success: false, error: 'جميع الحقول مطلوبة لاختبار الاتصال (All fields are required)' }
      }

      // Ensure URL has protocol
      let formattedUrl = url.trim()
      if (!/^https?:\/\//i.test(formattedUrl)) {
        formattedUrl = `https://${formattedUrl}`
      }

      const client = new OdooClient({
        url: formattedUrl,
        db: db.trim(),
        username: username.trim(),
        apiKey: apiKey.trim(),
      })

      const uid = await client.authenticate()
      if (uid) {
        return { success: true, uid }
      }
      return { success: false, error: 'فشل المصادقة مع أودو - يرجى التحقق من المدخلات (Auth failed - check inputs)' }
    } else if (erpType === 'erpnext') {
      if (!url || !username || !apiKey) {
        return { success: false, error: 'جميع الحقول المطلوبة لاختبار الاتصال فارغة (All required fields must be filled)' }
      }

      // Ensure URL has protocol
      let formattedUrl = url.trim()
      if (!/^https?:\/\//i.test(formattedUrl)) {
        formattedUrl = `https://${formattedUrl}`
      }

      // Strip trailing slash if present
      if (formattedUrl.endsWith('/')) {
        formattedUrl = formattedUrl.slice(0, -1)
      }

      try {
        new URL(formattedUrl)
      } catch {
        return { success: false, error: 'رابط خادم ERPNext غير صالح (Invalid URL format)' }
      }

      const authHeader = `token ${username.trim()}:${apiKey.trim()}`
      try {
        const response = await fetch(`${formattedUrl}/api/method/frappe.auth.get_logged_user`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        })

        if (response.ok) {
          const data = await response.json()
          return { success: true, uid: data.message || 'erpnext-user' }
        } else {
          let errorDetail = ''
          try {
            const errText = await response.text()
            try {
              const errData = JSON.parse(errText)
              errorDetail = errData.exception || errData._server_messages || response.statusText
            } catch {
              errorDetail = errText || response.statusText
            }
          } catch {
            errorDetail = `HTTP ${response.status}: ${response.statusText}`
          }
          return { 
            success: false, 
            error: `فشل تسجيل الدخول إلى ERPNext. يرجى التحقق من مفتاح وسر الـ API وصلاحية الرابط. (${errorDetail})` 
          }
        }
      } catch (fetchErr: any) {
        return { 
          success: false, 
          error: `لم نتمكن من الاتصال بخادم ERPNext. يرجى التحقق من الرابط والاتصال بالشبكة. (Error: ${fetchErr.message})` 
        }
      }
    } else {
      // Zoho or other stubbed ERP
      if (!url || !username || !apiKey) {
        return { success: false, error: 'جميع الحقول المطلوبة لاختبار الاتصال فارغة (All required fields must be filled)' }
      }

      // Ensure URL has protocol
      let formattedUrl = url.trim()
      if (!/^https?:\/\//i.test(formattedUrl)) {
        formattedUrl = `https://${formattedUrl}`
      }

      try {
        new URL(formattedUrl)
      } catch {
        return { success: false, error: 'رابط الخادم غير صالح (Invalid URL format)' }
      }

      return { success: true, uid: 'mock-erp-id' }
    }
  } catch (error: any) {
    console.error('[ERP Action] testErpConnection failed:', error)
    return { success: false, error: error.message || 'فشل الاتصال - يرجى التحقق من الخادم وبيانات الاعتماد (Connection failed)' }
  }
}

/**
 * Save or update Odoo credentials
 */
export async function saveErpConnection(data: {
  connectionName: string
  erpType?: string
  url: string
  dbName: string
  username: string
  apiKey: string
}) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('لم يتم تحديد بيئة عمل نشطة (No active workspace selected)')
    }

    const erpType = data.erpType || 'odoo'

    if (erpType === 'odoo') {
      if (!data.connectionName.trim() || !data.url.trim() || !data.dbName.trim() || !data.username.trim() || !data.apiKey.trim()) {
        throw new Error('جميع الحقول مطلوبة لحفظ الاتصال (All fields are required)')
      }
    } else {
      if (!data.connectionName.trim() || !data.url.trim() || !data.username.trim() || !data.apiKey.trim()) {
        throw new Error('جميع الحقول المطلوبة لحفظ الاتصال فارغة (All required fields must be filled)')
      }
    }

    // Format URL
    let formattedUrl = data.url.trim()
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`
    }

    // Test connection first
    const testResult = await testErpConnection(
      formattedUrl,
      erpType === 'odoo' ? data.dbName : '',
      data.username,
      data.apiKey,
      erpType
    )

    if (!testResult.success) {
      throw new Error(testResult.error || 'فشل اختبار الاتصال بالخادم (Connection test failed)')
    }

    // Encrypt apiKey before saving
    const encryptedKey = encrypt(data.apiKey.trim())

    // Check if connection already exists for this workspace
    const existingRes = await getActiveWorkspaceErpConnection()
    const existing = existingRes.success ? existingRes.connection : null

    let result
    if (existing) {
      // Update existing connection
      const { data: updated, error } = await supabase
        .from('erp_connections')
        .update({
          connection_name: data.connectionName.trim(),
          erp_type: erpType,
          url: formattedUrl,
          db_name: erpType === 'odoo' ? data.dbName.trim() : null,
          username: data.username.trim(),
          password: encryptedKey, // stored in password column encrypted
          status: 'connected',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) throw new Error('فشل تحديث الاتصال في قاعدة البيانات: ' + error.message)
      result = updated
    } else {
      // Insert new connection
      const { data: inserted, error } = await supabase
        .from('erp_connections')
        .insert([
          {
            workspace_id: user.active_workspace_id,
            connection_name: data.connectionName.trim(),
            erp_type: erpType,
            url: formattedUrl,
            db_name: erpType === 'odoo' ? data.dbName.trim() : null,
            username: data.username.trim(),
            password: encryptedKey,
            status: 'connected',
          },
        ])
        .select()
        .single()

      if (error) throw new Error('فشل حفظ الاتصال في قاعدة البيانات: ' + error.message)
      result = inserted
    }

    revalidateTag('erp-connection')
    revalidateTag('odoo-models')
    revalidateTag('odoo-fields')
    revalidatePath('/dashboard/connect-odoo')
    revalidatePath('/dashboard/integrations')
    return { success: true, connection: result }
  } catch (error: any) {
    console.error('[Odoo Action] saveOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to save connection details' }
  }
}

/**
 * Force refresh Odoo models/fields cache (clear 24h cache)
 */
export async function refreshOdooCache() {
  try {
    revalidateTag('odoo-models')
    revalidateTag('odoo-fields')
    // Also bust any per-model tags if they exist
    revalidateTag('odoo-model-fields')
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to refresh Odoo cache' }
  }
}

/**
 * Disconnect Odoo (Delete connection)
 */
export async function disconnectErpConnection(connectionId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('لم يتم تحديد بيئة عمل نشطة (No active workspace selected)')
    }

    const { error } = await supabase
      .from('erp_connections')
      .delete()
      .eq('id', connectionId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('فشل قطع الاتصال من قاعدة البيانات: ' + error.message)

    revalidateTag('erp-connection')
    revalidateTag('odoo-models')
    revalidateTag('odoo-fields')
    revalidatePath('/dashboard/connect-odoo')
    revalidatePath('/dashboard/integrations')
    return { success: true }
  } catch (error: any) {
    console.error('[Odoo Action] disconnectOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to disconnect Odoo connection' }
  }
}

async function fetchModelsRaw(connection: any) {
  const { url, db_name, username, password, erp_type } = connection
  const decryptedPassword = decrypt(password)

  if (erp_type === 'erpnext') {
    const authHeader = `token ${username.trim()}:${decryptedPassword.trim()}`
    const response = await fetch(`${url}/api/resource/DocType?fields=["name"]&limit_page_length=9999`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (response.ok) {
      const json = await response.json()
      const doctypes = json.data || []
      return doctypes.map((d: any) => ({
        model: d.name,
        name: `${d.name} (${d.name})`,
      })).sort((a: any, b: any) => a.model.localeCompare(b.model))
    } else {
      throw new Error(`Frappe API responded with HTTP ${response.status}: ${response.statusText}`)
    }
  }

  if (erp_type && erp_type !== 'odoo') {
    return []
  }

  const client = new OdooClient({
    url,
    db: db_name || '',
    username,
    apiKey: decryptedPassword,
  })

  // Fetch models from ir.model
  return client.execute<Array<{ model: string; name: string }>>(
    'ir.model',
    'search_read',
    [[]],
    {
      fields: ['model', 'name'],
      order: 'model asc',
    }
  )
}

const getCachedModels = unstable_cache(
  async (connectionId: string, connection: any) => {
    return fetchModelsRaw(connection)
  },
  ['odoo-models'],
  {
    revalidate: 86400, // 24 hours
    tags: ['odoo-models']
  }
)

/**
 * Fetch all models from Odoo
 */
export async function getOdooModels() {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive. Please connect to your ERP first.' }
    }

    const models = await getCachedModels(connRes.connection.id, connRes.connection)
    return { success: true, models }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooModels failed:', error)
    return { success: false, error: error.message || 'Failed to fetch models from Odoo' }
  }
}

async function fetchModelFieldsRaw(connection: any, modelName: string) {
  const { url, db_name, username, password, erp_type } = connection
  const decryptedPassword = decrypt(password)

  if (erp_type === 'erpnext') {
    const authHeader = `token ${username.trim()}:${decryptedPassword.trim()}`
    const response = await fetch(`${url}/api/resource/DocType/${modelName}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (response.ok) {
      const json = await response.json()
      const docType = json.data || {}
      const rawFields = docType.fields || []

      // Fetch custom fields for this DocType
      let customFields: any[] = []
      try {
        const cfFilters = JSON.stringify([["dt", "=", modelName]])
        const cfUrl = `${url}/api/resource/Custom Field?fields=["fieldname","label","fieldtype","options","reqd","read_only","description"]&filters=${encodeURIComponent(cfFilters)}&limit_page_length=9999`
        const cfResponse = await fetch(cfUrl, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        })
        if (cfResponse.ok) {
          const cfJson = await cfResponse.json()
          customFields = cfJson.data || []
        } else {
          console.error(`[ERPNext Action] Custom Field fetch responded with status ${cfResponse.status}`)
        }
      } catch (cfErr) {
        console.error(`[ERPNext Action] getOdooModelFields failed to fetch custom fields for ${modelName}:`, cfErr)
      }

      // Always add standard Frappe system fields like name, owner, creation, modified
      const systemFields = [
        { fieldname: 'name', label: 'ID / Name (name)', fieldtype: 'Data' },
        { fieldname: 'owner', label: 'Owner (owner)', fieldtype: 'Data' },
        { fieldname: 'creation', label: 'Created At (creation)', fieldtype: 'Datetime' },
        { fieldname: 'modified', label: 'Modified At (modified)', fieldtype: 'Datetime' },
      ]

      const allFields = [...systemFields, ...rawFields, ...customFields]

      return allFields.map((f: any) => {
        let ttype = 'char'
        const ftype = (f.fieldtype || '').toLowerCase()
        
        if (ftype === 'link') {
          ttype = 'many2one'
        } else if (ftype === 'table') {
          ttype = 'one2many'
        } else if (ftype === 'check') {
          ttype = 'boolean'
        } else if (['currency', 'float', 'percent'].includes(ftype)) {
          ttype = 'float'
        } else if (ftype === 'int') {
          ttype = 'integer'
        } else if (ftype === 'select') {
          ttype = 'selection'
        } else if (['text', 'long text', 'small text', 'code'].includes(ftype)) {
          ttype = 'text'
        }

        return {
          value: f.fieldname,
          label: f.label || f.fieldname,
          desc: f.fieldname,
          type: ttype,
          relation: f.options || undefined
        }
      }).sort((a: any, b: any) => a.label.localeCompare(b.label))
    } else {
      throw new Error(`Frappe API responded with HTTP ${response.status}: ${response.statusText}`)
    }
  }

  if (erp_type && erp_type !== 'odoo') {
    return []
  }

  const client = new OdooClient({
    url,
    db: db_name || '',
    username,
    apiKey: decryptedPassword,
  })

  // Fetch fields directly from ir.model.fields database table via search_read
  const fieldsData = await client.execute<Array<{ name: string; field_description: string; ttype: string; relation?: string }>>(
    'ir.model.fields',
    'search_read',
    [[['model', '=', modelName]]],
    { fields: ['name', 'field_description', 'ttype', 'relation'] }
  )

  // Map fields to a cleaner format
  return fieldsData.map((f) => ({
    value: f.name,
    label: f.field_description || f.name,
    desc: f.name,
    type: f.ttype,
    relation: f.relation
  })).sort((a, b) => a.label.localeCompare(b.label))
}

const getCachedModelFields = unstable_cache(
  async (connectionId: string, modelName: string, connection: any) => {
    return fetchModelFieldsRaw(connection, modelName)
  },
  ['odoo-fields'],
  {
    revalidate: 300, // 5 minutes — so new Odoo fields appear quickly
    tags: ['odoo-fields', 'odoo-model-fields']
  }
)

/**
 * Fetch fields for a specific Odoo/ERPNext model
 */
export async function getOdooModelFields(modelName: string) {
  try {
    if (!modelName) {
      return { success: false, error: 'Model name is required' }
    }

    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.' }
    }

    const fields = await getCachedModelFields(connRes.connection.id, modelName, connRes.connection)
    return { success: true, fields }
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooModelFields for ${modelName} failed:`, error)
    return { success: false, error: error.message || `Failed to fetch fields for model ${modelName}` }
  }
}

/**
 * Fetch selectable/static value options for one Odoo/ERPNext field.
 * - selection: returns the field's configured selection keys/labels
 * - many2one/many2many: returns existing records from the related model
 * - boolean: returns true/false
 */
export async function getOdooFieldValueOptions(modelName: string, fieldName: string) {
  try {
    if (!modelName || !fieldName) {
      return { success: false, error: 'Model and field are required', options: [] }
    }

    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { url, db_name, username, password, erp_type } = connRes.connection
    const decryptedPassword = decrypt(password)

    if (erp_type === 'erpnext') {
      const authHeader = `token ${username.trim()}:${decryptedPassword.trim()}`
      try {
        // First get the DocType layout to read Select field options or Link relations
        const response = await fetch(`${url}/api/resource/DocType/${modelName}`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error(`Frappe API responded with HTTP ${response.status}: ${response.statusText}`)
        }

        const json = await response.json()
        const docType = json.data || {}
        const rawFields = docType.fields || []

        const fieldMeta = rawFields.find((f: any) => f.fieldname === fieldName) || 
          (fieldName === 'name' ? { fieldname: 'name', fieldtype: 'Data' } : null)

        if (!fieldMeta) {
          return { success: false, error: 'Field metadata not found', options: [] }
        }

        const ftype = (fieldMeta.fieldtype || '').toLowerCase()

        if (ftype === 'check') {
          return {
            success: true,
            fieldType: 'boolean',
            options: [
              { value: 'true', label: 'True' },
              { value: 'false', label: 'False' },
            ],
          }
        }

        if (ftype === 'select') {
          const rawOptions = (fieldMeta.options || '').split('\n').map((opt: string) => opt.trim()).filter(Boolean)
          const options = rawOptions.map((opt: string) => ({ value: opt, label: opt }))
          return { success: true, fieldType: 'selection', options }
        }

        if (ftype === 'link' && fieldMeta.options) {
          const relation = fieldMeta.options
          const relRes = await fetch(`${url}/api/resource/${relation}?limit_page_length=100`, {
            method: 'GET',
            headers: {
              'Authorization': authHeader,
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            cache: 'no-store',
          })

          if (relRes.ok) {
            const relJson = await relRes.json()
            const records = relJson.data || []
            const options = records.map((r: any) => ({
              value: r.name,
              label: r.name,
              desc: `${relation} ${r.name}`,
            }))
            return {
              success: true,
              fieldType: 'many2one',
              relation,
              options,
            }
          }
        }

        return { success: true, fieldType: 'char', options: [] }
      } catch (err: any) {
        console.error(`[ERPNext Action] getOdooFieldValueOptions for ${modelName}.${fieldName} failed:`, err)
        return { success: false, error: err.message || 'Failed to fetch field options', options: [] }
      }
    }

    if (erp_type && erp_type !== 'odoo') {
      return { success: true, fieldType: 'char', options: [] }
    }

    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    const fieldsMeta = await client.execute<Record<string, {
      string?: string
      type?: string
      selection?: Array<[string, string]> | Array<string[]>
      relation?: string
    }>>(
      modelName,
      'fields_get',
      [[fieldName]],
      { attributes: ['string', 'type', 'selection', 'relation'] }
    )

    const meta = fieldsMeta?.[fieldName]
    if (!meta) return { success: false, error: 'Field metadata not found', options: [] }

    if (meta.type === 'boolean') {
      return {
        success: true,
        fieldType: meta.type,
        options: [
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ],
      }
    }

    if (meta.type === 'selection') {
      const options = (meta.selection || []).map((item) => {
        const value = String(item[0])
        const label = String(item[1] ?? item[0])
        return { value, label }
      })
      return { success: true, fieldType: meta.type, options }
    }

    if ((meta.type === 'many2one' || meta.type === 'many2many') && meta.relation) {
      const records = await client.execute<Array<[number, string]>>(
        meta.relation,
        'name_search',
        ['', [], 'ilike', 100]
      )
      return {
        success: true,
        fieldType: meta.type,
        relation: meta.relation,
        options: records.map(([id, label]) => ({
          value: String(id),
          label: label || String(id),
          desc: `${meta.relation} #${id}`,
        })),
      }
    }

    return { success: true, fieldType: meta.type, options: [] }
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooFieldValueOptions for ${modelName}.${fieldName} failed:`, error)
    return { success: false, error: error.message || 'Failed to fetch field options', options: [] }
  }
}

/**
 * Fetch all security groups (res.groups) from Odoo
 */
export async function getOdooGroups() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) return { success: true, groups: [] }

    const { data: conn } = await supabase
      .from('erp_connections')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (!conn) return { success: true, groups: [] }

    if (conn.erp_type && conn.erp_type !== 'odoo') {
      return { success: true, groups: [] }
    }

    const client = new OdooClient({
      url: conn.url,
      db: conn.db_name || '',
      username: conn.username,
      apiKey: decrypt(conn.password),
    })

    const groups = await client.execute<Array<{ id: number; full_name: string; name: string }>>(
      'res.groups',
      'search_read',
      [[['share', '=', false]]], // Filter out portal/share groups
      { fields: ['id', 'full_name', 'name'], order: 'full_name asc, name asc' }
    )

    return {
      success: true,
      groups: groups.map(g => ({
        id: g.id,
        name: g.full_name || g.name || `Group #${g.id}`,
      }))
    }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooGroups failed:', error)
    return { success: false, error: error.message || 'Failed to fetch Odoo groups', groups: [] }
  }
}

/**
 * Fetch all warehouses (stock.warehouse) from Odoo
 */
export async function getOdooWarehouses(): Promise<{
  success: boolean
  warehouses?: Array<{ id: number; name: string; code: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found' }
    }

    if (connRes.connection.erp_type && connRes.connection.erp_type !== 'odoo') {
      return { success: true, warehouses: [] }
    }

    const { url, db_name, username, password } = connRes.connection
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decrypt(password),
    })

    const records = await client.execute<Array<{ id: number; name: string; code: string }>>(
      'stock.warehouse',
      'search_read',
      [[]],
      { fields: ['id', 'name', 'code'], order: 'name asc' }
    )

    return {
      success: true,
      warehouses: records.map(w => ({
        id: w.id,
        name: w.name,
        code: w.code || '',
      })),
    }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooWarehouses failed:', error)
    return { success: false, error: error.message || 'Failed to fetch warehouses' }
  }
}

/**
 * Fetch stock locations (stock.location) from Odoo, optionally filtered by usage type
 */
export async function getOdooLocations(usage?: string): Promise<{
  success: boolean
  locations?: Array<{ id: number; name: string; complete_name: string; usage: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found' }
    }

    if (connRes.connection.erp_type && connRes.connection.erp_type !== 'odoo') {
      return { success: true, locations: [] }
    }

    const { url, db_name, username, password } = connRes.connection
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decrypt(password),
    })

    const domain: any[][] = []
    if (usage) {
      domain.push(['usage', '=', usage])
    }

    const records = await client.execute<Array<{ id: number; name: string; complete_name: string; usage: string }>>(
      'stock.location',
      'search_read',
      [domain],
      { fields: ['id', 'name', 'complete_name', 'usage'], order: 'complete_name asc' }
    )

    return {
      success: true,
      locations: records.map(l => ({
        id: l.id,
        name: l.name,
        complete_name: l.complete_name || l.name,
        usage: l.usage || '',
      })),
    }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooLocations failed:', error)
    return { success: false, error: error.message || 'Failed to fetch locations' }
  }
}

/**
 * Fetch product categories (product.category) from Odoo
 */
export async function getOdooCategories(): Promise<{
  success: boolean
  categories?: Array<{ id: number; name: string; parent_id: [number, string] | false; complete_name: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found' }
    }

    if (connRes.connection.erp_type && connRes.connection.erp_type !== 'odoo') {
      return { success: true, categories: [] }
    }

    const { url, db_name, username, password } = connRes.connection
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decrypt(password),
    })

    const records = await client.execute<Array<{ id: number; name: string; parent_id: [number, string] | false; complete_name: string }>>(
      'product.category',
      'search_read',
      [[]],
      { fields: ['id', 'name', 'parent_id', 'complete_name'], order: 'complete_name asc' }
    )

    return {
      success: true,
      categories: records.map(c => ({
        id: c.id,
        name: c.name,
        parent_id: c.parent_id,
        complete_name: c.complete_name || c.name,
      })),
    }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooCategories failed:', error)
    return { success: false, error: error.message || 'Failed to fetch categories' }
  }
}

/**
 * Dry-run: Test a relation's smart match configuration without writing any data to Odoo.
 * Returns which phase would succeed and what would happen.
 */
export async function dryRunMatch(args: {
  relation: string
  item: any
  sampleData: Record<string, unknown>
}) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: false, error: 'No active workspace', phase: 'error' }
    }

    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found', phase: 'error' }
    }

    const { url, db_name, username, password } = connRes.connection
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decrypt(password),
    })

    await client.authenticate()

    // Try each phase manually for detailed reporting
    const platform = 'zid' // default for dry run
    const { resolveSingleRelationId } = await import('@/lib/sync-engine')

    // Phase 1a: Custom Lookup (fuzzyMatchMappings)
    if (args.item.fuzzyMatchMappings?.length > 0) {
      const itemCopy = { ...args.item } // shallow clone is fine
      const matchedId = await resolveSingleRelationId(
        client, args.relation, args.sampleData, platform as any,
        'create' as any, itemCopy, user.active_workspace_id, args.sampleData, {},
        true // dryRun = true
      )
      if (matchedId && matchedId > 0) {
        return { success: true, phase: 'custom_map', matchedId, willCreate: false }
      }
    }

    // Phase 2: Check fallback policy
    const policy = args.item.policy
    if (policy === 'default') {
      const staticVal = args.item.staticValue
      if (staticVal !== undefined && staticVal !== null && staticVal !== '') {
        const id = Number(Array.isArray(staticVal) ? staticVal[0] : staticVal)
        if (Number.isInteger(id) && id > 0) {
          return { success: true, phase: 'default_fallback', matchedId: id, willCreate: false }
        }
      }
    }

    if (policy === 'block') {
      return { success: true, phase: 'block', matchedId: undefined, willCreate: false, error: 'Blocked - no match' }
    }

    if (policy === 'create') {
      return { success: true, phase: 'create', matchedId: undefined, willCreate: true }
    }

    return { success: true, phase: 'not_found', matchedId: undefined, willCreate: false, error: 'No match found and no fallback policy' }

  } catch (error: any) {
    console.error('[dryRunMatch] failed:', error)
    return { success: false, error: error.message || 'Dry run failed', phase: 'error' }
  }
}

export async function getOdooAccountsByType(type: 'receivable' | 'payable', companyId?: number) {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { url, db_name, username, password, erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const decryptedPassword = decrypt(password)
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    const fieldsMeta = await client.execute<Record<string, any>>(
      'account.account',
      'fields_get',
      [['account_type', 'user_type_id', 'company_id', 'company_ids']],
      { attributes: ['name', 'type'] }
    )

    let domain: any[] = []
    if (fieldsMeta?.account_type) {
      const targetType = type === 'receivable' ? 'asset_receivable' : 'liability_payable'
      domain = [['account_type', '=', targetType]]
    } else if (fieldsMeta?.user_type_id) {
      domain = [['user_type_id.type', '=', type]]
    } else {
      domain = []
    }

    if (companyId && companyId > 0) {
      if (fieldsMeta?.company_ids) {
        domain.push(['company_ids', 'in', [companyId]])
      } else if (fieldsMeta?.company_id) {
        domain.push(['company_id', '=', companyId])
      }
    }

    const records = await client.execute<Array<[number, string]>>(
      'account.account',
      'name_search',
      ['', domain, 'ilike', 300]
    )

    return {
      success: true,
      options: records.map(([id, label]) => ({
        value: String(id),
        label: label || String(id),
      })),
    }
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooAccountsByType for ${type} failed:`, error)
    return { success: false, error: error.message || 'Failed to fetch accounts', options: [] }
  }
}

export async function searchOdooAccounts(searchTerm: string = '', accountType?: string) {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { url, db_name, username, password, erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const decryptedPassword = decrypt(password)
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    let domain: any[] = []
    if (accountType) {
      domain.push(['account_type', '=', accountType])
    }

    const records = await client.execute<Array<[number, string]>>(
      'account.account',
      'name_search',
      [searchTerm, domain, 'ilike', 300]
    )

    return {
      success: true,
      options: records.map(([id, label]) => ({
        value: String(id),
        label: label || String(id),
      })),
    }
  } catch (error: any) {
    console.error(`[Odoo Action] searchOdooAccounts failed:`, error)
    return { success: false, error: error.message || 'Failed to search accounts', options: [] }
  }
}

export async function searchOdooJournals(searchTerm: string = '', journalType?: string) {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { url, db_name, username, password, erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const decryptedPassword = decrypt(password)
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    let domain: any[] = []
    if (journalType) {
      domain.push(['type', '=', journalType])
    }

    const records = await client.execute<Array<[number, string]>>(
      'account.journal',
      'name_search',
      [searchTerm, domain, 'ilike', 300]
    )

    return {
      success: true,
      options: records.map(([id, label]) => ({
        value: String(id),
        label: label || String(id),
      })),
    }
  } catch (error: any) {
    console.error(`[Odoo Action] searchOdooJournals failed:`, error)
    return { success: false, error: error.message || 'Failed to search journals', options: [] }
  }
}

export async function searchOdooCategories(searchTerm: string = '') {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { url, db_name, username, password, erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const decryptedPassword = decrypt(password)
    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    const records = await client.execute<Array<[number, string]>>(
      'product.category',
      'name_search',
      [searchTerm, [], 'ilike', 300]
    )

    return {
      success: true,
      options: records.map(([id, label]) => ({
        value: String(id),
        label: label || String(id),
      })),
    }
  } catch (error: any) {
    console.error(`[Odoo Action] searchOdooCategories failed:`, error)
    return { success: false, error: error.message || 'Failed to search categories', options: [] }
  }
}

