'use server'

import { auth } from '@clerk/nextjs/server'
import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import { OdooClient } from '@/lib/odoo-client'
import { encrypt, decrypt } from '@/lib/crypto'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')

  return ensureDbUser(userId)
}

/**
 * Get active workspace's Odoo connection
 */
export async function getActiveWorkspaceOdooConnection() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, connection: null }
    }

    const { data: connection, error } = await supabase
      .from('odoo_connections')
      .select('*')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (error) throw new Error('Failed to query Odoo connection: ' + error.message)

    return { success: true, connection }
  } catch (error: any) {
    console.error('[Odoo Action] getActiveWorkspaceOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to fetch Odoo connection' }
  }
}

/**
 * Test Odoo credentials
 */
export async function testOdooConnection(url: string, db: string, username: string, apiKey: string) {
  try {
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
  } catch (error: any) {
    console.error('[Odoo Action] testOdooConnection failed:', error)
    return { success: false, error: error.message || 'فشل الاتصال - يرجى التحقق من الخادم وبيانات الاعتماد (Connection failed)' }
  }
}

/**
 * Save or update Odoo credentials
 */
export async function saveOdooConnection(data: {
  connectionName: string
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

    if (!data.connectionName.trim() || !data.url.trim() || !data.dbName.trim() || !data.username.trim() || !data.apiKey.trim()) {
      throw new Error('جميع الحقول مطلوبة لحفظ الاتصال (All fields are required)')
    }

    // Format URL
    let formattedUrl = data.url.trim()
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`
    }

    // Test connection first
    const testResult = await testOdooConnection(
      formattedUrl,
      data.dbName,
      data.username,
      data.apiKey
    )

    if (!testResult.success) {
      throw new Error(testResult.error || 'فشل اختبار الاتصال بالخادم (Connection test failed)')
    }

    // Encrypt apiKey before saving
    const encryptedKey = encrypt(data.apiKey.trim())

    // Check if connection already exists for this workspace
    const existingRes = await getActiveWorkspaceOdooConnection()
    const existing = existingRes.success ? existingRes.connection : null

    let result
    if (existing) {
      // Update existing connection
      const { data: updated, error } = await supabase
        .from('odoo_connections')
        .update({
          connection_name: data.connectionName.trim(),
          url: formattedUrl,
          db_name: data.dbName.trim(),
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
        .from('odoo_connections')
        .insert([
          {
            workspace_id: user.active_workspace_id,
            connection_name: data.connectionName.trim(),
            url: formattedUrl,
            db_name: data.dbName.trim(),
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

    revalidatePath('/dashboard/connect-odoo')
    revalidatePath('/dashboard/integrations')
    return { success: true, connection: result }
  } catch (error: any) {
    console.error('[Odoo Action] saveOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to save connection details' }
  }
}

/**
 * Disconnect Odoo (Delete connection)
 */
export async function disconnectOdooConnection(connectionId: string) {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      throw new Error('لم يتم تحديد بيئة عمل نشطة (No active workspace selected)')
    }

    const { error } = await supabase
      .from('odoo_connections')
      .delete()
      .eq('id', connectionId)
      .eq('workspace_id', user.active_workspace_id)

    if (error) throw new Error('فشل قطع الاتصال من قاعدة البيانات: ' + error.message)

    revalidatePath('/dashboard/connect-odoo')
    revalidatePath('/dashboard/integrations')
    return { success: true }
  } catch (error: any) {
    console.error('[Odoo Action] disconnectOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to disconnect Odoo connection' }
  }
}

/**
 * Fetch all models from Odoo
 */
export async function getOdooModels() {
  try {
    const connRes = await getActiveWorkspaceOdooConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'Odoo connection not found or inactive. Please connect to Odoo first.' }
    }

    const { url, db_name, username, password } = connRes.connection
    const decryptedPassword = decrypt(password)

    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    // Fetch models from ir.model
    const models = await client.execute<Array<{ model: string; name: string }>>(
      'ir.model',
      'search_read',
      [[]],
      {
        fields: ['model', 'name'],
        order: 'model asc',
      }
    )

    return { success: true, models }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooModels failed:', error)
    return { success: false, error: error.message || 'Failed to fetch models from Odoo' }
  }
}

/**
 * Fetch fields for a specific Odoo model
 */
export async function getOdooModelFields(modelName: string) {
  try {
    if (!modelName) {
      return { success: false, error: 'Model name is required' }
    }

    const connRes = await getActiveWorkspaceOdooConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'Odoo connection not found or inactive.' }
    }

    const { url, db_name, username, password } = connRes.connection
    const decryptedPassword = decrypt(password)

    const client = new OdooClient({
      url,
      db: db_name || '',
      username,
      apiKey: decryptedPassword,
    })

    // Fetch fields directly from ir.model.fields database table via search_read
    // This is 100x faster than fields_get since it queries the indexed SQL table directly
    const fieldsData = await client.execute<Array<{ name: string; field_description: string; ttype: string; relation?: string }>>(
      'ir.model.fields',
      'search_read',
      [[['model', '=', modelName]]],
      { fields: ['name', 'field_description', 'ttype', 'relation'] }
    )

    // Map fields to a cleaner format (exact Odoo labels with technical names as descriptions)
    const fields = fieldsData.map((f) => ({
      value: f.name,
      label: f.field_description || f.name,
      desc: f.name,
      type: f.ttype,
      relation: f.relation
    })).sort((a, b) => a.label.localeCompare(b.label))

    return { success: true, fields }
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooModelFields for ${modelName} failed:`, error)
    return { success: false, error: error.message || `Failed to fetch fields for model ${modelName}` }
  }
}

/**
 * Fetch selectable/static value options for one Odoo field.
 * - selection: returns the field's configured selection keys/labels
 * - many2one/many2many: returns existing records from the related model
 * - boolean: returns true/false
 */
export async function getOdooFieldValueOptions(modelName: string, fieldName: string) {
  try {
    if (!modelName || !fieldName) {
      return { success: false, error: 'Model and field are required', options: [] }
    }

    const connRes = await getActiveWorkspaceOdooConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'Odoo connection not found or inactive.', options: [] }
    }

    const { url, db_name, username, password } = connRes.connection
    const decryptedPassword = decrypt(password)
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
