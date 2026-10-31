'use server'

import { revalidatePath, unstable_cache, revalidateTag } from 'next/cache'

import { getActiveUserId } from '@/lib/auth'
import { autoBootstrapWorkspace } from '@/lib/auto-bootstrap'
import { encrypt, decrypt } from '@/lib/crypto'
import { formatOdooVersion } from '@/lib/odoo/version'
import { OdooClient } from '@/lib/odoo-client'
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'

// TTLs for the in-process memoization layer. These sit on top of Next's
// unstable_cache so repeated/concurrent reads inside one session never hit
// Odoo again after the first fetch (stable in dev too, where the Next data
// cache is unreliable).
const TTL_MODELS_MS = 30 * 60 * 1000 // 30 min — model list rarely changes
const TTL_FIELDS_MS = 10 * 60 * 1000 // 10 min — new custom fields appear quickly
const TTL_OPTIONS_MS = 10 * 60 * 1000

async function getOrCreateDbUser() {
  const userId = await getActiveUserId()
  if (!userId) throw new Error('Unauthorized')

  return ensureDbUser(userId)
}

/** The subset of an `erp_connections` row needed to talk to Odoo over XML-RPC. */
type OdooConnectionRow = {
  url: string
  db_name?: string | null
  username: string
  password: string
}

/**
 * Builds an Odoo XML-RPC client from a stored ERP connection row.
 *
 * The password is decrypted in exactly one place: `password` is stored
 * encrypted, and a call site that forgets `decrypt()` fails at auth time with
 * a confusing "access denied" instead of a clear error. Every read path in
 * this file goes through here.
 */
function createOdooClient(connection: OdooConnectionRow): OdooClient {
  return new OdooClient({
    url: connection.url,
    db: connection.db_name || '',
    username: connection.username,
    apiKey: decrypt(connection.password),
  })
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

const TTL_VERSION_MS = 6 * 60 * 60 * 1000 // 6 h — an ERP version does not change intraday

/**
 * Detect the version of the active workspace's connected Odoo server.
 *
 * Used by the connect screen when the stored connection has no version yet
 * (connections created before migration 20261021, or a database where that
 * migration has not been applied). Never throws: the version is decoration,
 * the connection itself is already working.
 */
export async function detectOdooVersion(): Promise<{
  success: boolean
  version?: string | null
  error?: string
}> {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: false, error: 'لم يتم تحديد بيئة عمل نشطة (No active workspace selected)' }
    }

    const connection = await getCachedErpConnection(user.active_workspace_id)
    if (!connection || connection.erp_type !== 'odoo') {
      return { success: false, error: 'لا يوجد اتصال أودو نشط (No active Odoo connection)' }
    }

    const stored = connection.odoo_version as string | null | undefined
    if (stored) return { success: true, version: stored }

    const version = await ttlCache.get(
      `odoo:version:${user.active_workspace_id}`,
      TTL_VERSION_MS,
      async () => formatOdooVersion(await createOdooClient(connection).getVersionInfo())
    )

    if (version) {
      const { error } = await supabase
        .from('erp_connections')
        .update({ odoo_version: version })
        .eq('id', connection.id)
      if (error) {
        console.warn(
          '[Odoo Action] odoo_version not stored (is migration 20261021 applied?):',
          error.message
        )
      }
    }

    return { success: true, version }
  } catch (error: any) {
    console.warn('[Odoo Action] detectOdooVersion failed:', error?.message ?? error)
    return { success: false, error: error?.message || 'Failed to detect Odoo version' }
  }
}

function validateSafeExternalUrl(rawUrl: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(rawUrl)
    const hostname = parsed.hostname.toLowerCase()

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'بروتوكول الرابط غير مدعوم، يجب أن يكون http أو https' }
    }

    // Block localhost, internal IPs and cloud metadata addresses
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      if (process.env.NODE_ENV === 'production') {
        return { valid: false, error: 'غير مسموح بربط عناوين الشبكات الداخلية أو المحلية (SSRF Protection)' }
      }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'صيغة الرابط غير صحيحة (Invalid URL format)' }
  }
}

/**
 * Test Odoo credentials
 */
export async function testErpConnection(url: string, db: string, username: string, apiKey: string, erpType: string = 'odoo') {
  try {
    const userId = await getActiveUserId()
    if (!userId) {
      return { success: false, error: 'غير مصرح - يرجى تسجيل الدخول أولاً (Unauthorized)' }
    }

    if (erpType === 'odoo') {
      if (!url || !db || !username || !apiKey) {
        return { success: false, error: 'جميع الحقول مطلوبة لاختبار الاتصال (All fields are required)' }
      }

      // Ensure URL has protocol
      let formattedUrl = url.trim()
      if (!/^https?:\/\//i.test(formattedUrl)) {
        formattedUrl = `https://${formattedUrl}`
      }

      const urlCheck = validateSafeExternalUrl(formattedUrl)
      if (!urlCheck.valid) {
        return { success: false, error: urlCheck.error }
      }

      const client = new OdooClient({
        url: formattedUrl,
        db: db.trim(),
        username: username.trim(),
        apiKey: apiKey.trim(),
      })

      const uid = await client.authenticate()
      if (uid) {
        // The version is informational: a server that authenticates but does
        // not answer `common.version` must still connect.
        const version = await client
          .getVersionInfo()
          .then(formatOdooVersion)
          .catch((err) => {
            console.warn('[ERP Action] could not read Odoo version:', err?.message ?? err)
            return null
          })
        return { success: true, uid, version }
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

    const detectedVersion =
      erpType === 'odoo' && 'version' in testResult ? (testResult.version ?? null) : null

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

    // Store the detected Odoo version in a second, best-effort write: a
    // database that has not applied migration 20261021 has no `odoo_version`
    // column, and naming it in the insert above would fail the whole connect.
    let storedVersion: string | null = result?.odoo_version ?? null
    if (erpType === 'odoo' && detectedVersion) {
      const { error: versionError } = await supabase
        .from('erp_connections')
        .update({ odoo_version: detectedVersion })
        .eq('id', result.id)

      if (versionError) {
        console.warn(
          '[Odoo Action] odoo_version not stored (is migration 20261021 applied?):',
          versionError.message
        )
      } else {
        storedVersion = detectedVersion
      }
    }

    revalidateTag('erp-connection')
    revalidateTag('odoo-models')
    revalidateTag('odoo-fields')
    revalidatePath('/app/connect-odoo')
    revalidatePath('/app/connect-store')

    // Bump stored credentials — drop every memoized Odoo result so the next
    // read is fetched through the new connection.
    ttlCache.clear('odoo:')

    // Auto-bootstrap workspace defaults in background (zero-configuration)
    if (user.active_workspace_id) {
      autoBootstrapWorkspace(user.active_workspace_id).catch((err) =>
        console.warn('[Odoo Action] autoBootstrapWorkspace non-fatal warning:', err)
      )
    }

    return { success: true, connection: { ...result, odoo_version: storedVersion } }
  } catch (error: any) {
    console.error('[Odoo Action] saveOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to save connection details' }
  }
}

/**
 * Force refresh Odoo models/fields cache (clear 24h cache)
 *
 * Requires a signed-in user. Without a check this Server Action was callable
 * by anyone: `revalidateTag` drops the shared Next data cache and
 * `ttlCache.clear('odoo:')` drops the in-process memo for *every* tenant, so an
 * unauthenticated caller could loop this and force all customers' next request
 * to re-fetch their full model/field list over XML-RPC.
 */
export async function refreshOdooCache() {
  try {
    const userId = await getActiveUserId()
    if (!userId) {
      return { success: false, error: 'غير مصرح - يرجى تسجيل الدخول أولاً (Unauthorized)' }
    }

    revalidateTag('odoo-models')
    revalidateTag('odoo-fields')
    // Also bust any per-model tags if they exist
    revalidateTag('odoo-model-fields')
    // Drop the in-process memoization layer too (Next tags don't touch it).
    ttlCache.clear('odoo:')
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
    revalidatePath('/app/connect-odoo')
    revalidatePath('/app/connect-store')

    // Connection removed — drop memoized Odoo results referencing it.
    ttlCache.clear('odoo:')
    return { success: true }
  } catch (error: any) {
    console.error('[Odoo Action] disconnectOdooConnection failed:', error)
    return { success: false, error: error.message || 'Failed to disconnect Odoo connection' }
  }
}

async function fetchModelsRaw(connection: any) {
  const { url, username, password, erp_type } = connection
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

  const client = createOdooClient(connection)

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

    const models = await ttlCache.get(
      `odoo:models:${connRes.connection.id}`,
      TTL_MODELS_MS,
      () => getCachedModels(connRes.connection.id, connRes.connection)
    )
    return { success: true, models }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooModels failed:', error)
    return { success: false, error: error.message || 'Failed to fetch models from Odoo' }
  }
}

async function fetchModelFieldsRaw(connection: any, modelName: string) {
  const { url, username, password, erp_type } = connection
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

  const client = createOdooClient(connection)

  // For products, query both product.template and product.product so variants and custom fields on both are found
  const modelsToQuery = (modelName === 'product.template' || modelName === 'product.product')
    ? ['product.template', 'product.product']
    : [modelName]

  // Fetch fields directly from ir.model.fields database table via search_read
  let fieldsData: Array<{ name: string; field_description: string; ttype: string; relation?: string }> = []
  try {
    fieldsData = await client.execute<Array<{ name: string; field_description: string; ttype: string; relation?: string }>>(
      'ir.model.fields',
      'search_read',
      [[['model', 'in', modelsToQuery]]],
      { fields: ['name', 'field_description', 'ttype', 'relation'], limit: 5000 }
    )
  } catch (searchErr) {
    console.error(`[Odoo Action] search_read on ir.model.fields failed for ${modelName}:`, searchErr)
  }

  const seen = new Set<string>()
  const result: Array<{ value: string; label: string; desc: string; type: string; relation?: string }> = []

  for (const f of (fieldsData || [])) {
    if (f && f.name && !seen.has(f.name)) {
      seen.add(f.name)
      result.push({
        value: f.name,
        label: f.field_description || f.name,
        desc: f.name,
        type: f.ttype,
        relation: f.relation
      })
    }
  }

  // Fallback / Enrichment: try fields_get if fieldsData was empty or to catch any dynamic custom fields
  if (result.length === 0) {
    try {
      const fgRes = await client.execute<Record<string, { string?: string; type?: string; relation?: string }>>(
        modelName,
        'fields_get',
        [],
        { attributes: ['string', 'type', 'relation'] }
      )
      if (fgRes && typeof fgRes === 'object') {
        for (const [name, meta] of Object.entries(fgRes)) {
          if (!seen.has(name)) {
            seen.add(name)
            result.push({
              value: name,
              label: meta.string || name,
              desc: name,
              type: meta.type || 'char',
              relation: meta.relation
            })
          }
        }
      }
    } catch (fgErr) {
      console.warn(`[Odoo] fields_get fallback for ${modelName} failed:`, fgErr)
    }
  }

  return result.sort((a, b) => a.label.localeCompare(b.label))
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
 * Fetch fields for a specific Odoo/ERPNext model.
 * If forceRefresh is true, bypasses the cache and queries Odoo directly.
 */
export async function getOdooModelFields(modelName: string, forceRefresh = false) {
  try {
    if (!modelName) {
      return { success: false, error: 'Model name is required' }
    }

    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.' }
    }

    if (forceRefresh) {
      try {
        revalidateTag('odoo-fields')
        revalidateTag('odoo-model-fields')
      } catch {}
      // Bypass both cache layers and warm the in-process cache with fresh data
      // so the UI reflects the new fields synchronously.
      ttlCache.clear(`odoo:fields:${connRes.connection.id}`)
      const fields = await fetchModelFieldsRaw(connRes.connection, modelName)
      ttlCache.set(`odoo:fields:${connRes.connection.id}:${modelName}`, fields, TTL_FIELDS_MS)
      return { success: true, fields }
    }

    const fields = await ttlCache.get(
      `odoo:fields:${connRes.connection.id}:${modelName}`,
      TTL_FIELDS_MS,
      () => getCachedModelFields(connRes.connection.id, modelName, connRes.connection)
    )
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

    const cacheKey = `odoo:options:${connRes.connection.id}:${modelName}:${fieldName}`
    const result = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const { url, username, password, erp_type } = connRes.connection
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

      const client = createOdooClient(connRes.connection)

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
    })

    return result
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooFieldValueOptions for ${modelName}.${fieldName} failed:`, error)
    return { success: false, error: error.message || 'Failed to fetch field options', options: [] }
  }
}

/**
 * Fetch all security groups (res.groups) from Odoo.
 * Cached 30 min per connection (in-process single-flight + Next data cache):
 * the old version hit Odoo XML-RPC on every add-field mount, which is why the
 * page felt slow even when Supabase was fast.
 */
const TTL_GROUPS_MS = 30 * 60 * 1000 // 30 min — groups rarely change

async function fetchOdooGroupsRaw(connection: any) {
  const client = createOdooClient(connection)

  const groups = await client.execute<Array<{ id: number; full_name: string; name: string }>>(
    'res.groups',
    'search_read',
    [[['share', '=', false]]], // Filter out portal/share groups
    { fields: ['id', 'full_name', 'name'], order: 'full_name asc, name asc', limit: 500 }
  )

  return groups.map(g => ({
    id: g.id,
    name: g.full_name || g.name || `Group #${g.id}`,
  }))
}

const getCachedOdooGroups = unstable_cache(
  async (connectionId: string, connection: any) => {
    return fetchOdooGroupsRaw(connection)
  },
  ['odoo-groups'],
  {
    revalidate: 1800, // 30 minutes
    tags: ['odoo-groups']
  }
)

export async function getOdooGroups() {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) return { success: true, groups: [] }

    const { data: conn } = await supabase
      .from('erp_connections')
      .select('id,url,db_name,username,password,erp_type')
      .eq('workspace_id', user.active_workspace_id)
      .maybeSingle()

    if (!conn) return { success: true, groups: [] }

    if (conn.erp_type && conn.erp_type !== 'odoo') {
      return { success: true, groups: [] }
    }

    const groups = await ttlCache.get(
      `odoo:groups:${conn.id}`,
      TTL_GROUPS_MS,
      () => getCachedOdooGroups(conn.id, conn)
    )

    return { success: true, groups }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooGroups failed:', error)
    return { success: false, error: error.message || 'Failed to fetch Odoo groups', groups: [] }
  }
}

/**
 * Fetch all warehouses (stock.warehouse) from Odoo
 *
 * Pass `force = true` to bypass the 10-minute TTL memo (manual refresh button).
 */
export async function getOdooWarehouses(force = false): Promise<{
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

    const cacheKey = `odoo:warehouses:${connRes.connection.id}`
    if (force) ttlCache.delete(cacheKey)
    const warehouses = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const client = createOdooClient(connRes.connection)

      const records = await client.execute<Array<{ id: number; name: string; code: string }>>(
        'stock.warehouse',
        'search_read',
        [[]],
        { fields: ['id', 'name', 'code'], order: 'name asc' }
      )

      return records.map(w => ({
        id: w.id,
        name: w.name,
        code: w.code || '',
      }))
    })

    return { success: true, warehouses }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooWarehouses failed:', error)
    return { success: false, error: error.message || 'Failed to fetch warehouses' }
  }
}

/**
 * Fetch taxes (account.tax) from Odoo
 *
 * Pass `force = true` to bypass the TTL memo.
 */
export async function getOdooTaxes(force = false): Promise<{
  success: boolean
  taxes?: Array<{ value: string; label: string; amount?: number; typeTaxUse?: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found', taxes: [] }
    }

    if (connRes.connection.erp_type && connRes.connection.erp_type !== 'odoo') {
      return { success: true, taxes: [] }
    }

    const cacheKey = `odoo:taxes:${connRes.connection.id}`
    if (force) ttlCache.delete(cacheKey)

    const taxes = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const client = createOdooClient(connRes.connection)

      let records: Array<{ id: number; name: string; amount?: number; type_tax_use?: string }> = []
      try {
        records = await client.execute<Array<{ id: number; name: string; amount?: number; type_tax_use?: string }>>(
          'account.tax',
          'search_read',
          [[]],
          { fields: ['id', 'name', 'amount', 'type_tax_use'], order: 'type_tax_use desc, sequence, id asc' }
        )
      } catch (err: any) {
        console.warn('[getOdooTaxes] search_read failed, falling back to name_search:', err)
        try {
          const searched = await client.execute<Array<[number, string]>>(
            'account.tax',
            'name_search',
            ['', [], 'ilike', 100]
          )
          records = (searched || []).map(([id, name]) => ({ id, name }))
        } catch (err2) {
          console.error('[getOdooTaxes] name_search fallback also failed:', err2)
        }
      }

      return (records || []).map((t) => {
        let label = t.name || `Tax #${t.id}`
        if (t.amount !== undefined && t.amount !== null && !label.includes(`${t.amount}%`)) {
          label = `${label} (${t.amount}%)`
        }
        if (t.type_tax_use && t.type_tax_use !== 'sale') {
          label = `${label} [${t.type_tax_use}]`
        }
        return {
          value: String(t.id),
          label,
          amount: t.amount,
          typeTaxUse: t.type_tax_use,
        }
      })
    })

    return { success: true, taxes }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooTaxes failed:', error)
    return { success: false, error: error.message || 'Failed to fetch taxes', taxes: [] }
  }
}


/**
 * Fetch stock locations (stock.location) from Odoo, optionally filtered by usage type
 *
 * Pass `force = true` to bypass the 10-minute TTL memo (used by the manual
 * "refresh locations" button, so newly created Odoo locations appear at once).
 */
export async function getOdooLocations(usage?: string, force = false): Promise<{
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

    const usageKey = usage || 'all'
    const cacheKey = `odoo:locations:${connRes.connection.id}:${usageKey}`
    if (force) ttlCache.delete(cacheKey)
    const locations = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const client = createOdooClient(connRes.connection)

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

      return records.map(l => ({
        id: l.id,
        name: l.name,
        complete_name: l.complete_name || l.name,
        usage: l.usage || '',
      }))
    })

    return { success: true, locations }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooLocations failed:', error)
    return { success: false, error: error.message || 'Failed to fetch locations' }
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

    const client = createOdooClient(connRes.connection)

    await client.authenticate()

    // Try each phase manually for detailed reporting
    const platform = 'zid' // default for dry run
    const { resolveSingleRelationId } = await import('@/lib/sync-engine')

    // Phase 1a: Custom Lookup (fuzzyMatchMappings)
    if (args.item.fuzzyMatchMappings?.length > 0) {
      const itemCopy = { ...args.item } // shallow clone is fine
      const matchedId = await resolveSingleRelationId(
        client, args.relation, args.sampleData, platform as any,
        'create' as any, itemCopy, user.active_workspace_id, '',
        args.sampleData, {},
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

    const { erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const options = await ttlCache.get(
      `odoo:accounts:${connRes.connection.id}:${type}:${companyId || 'all'}`,
      TTL_OPTIONS_MS,
      async () => {
        const client = createOdooClient(connRes.connection)

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

        return records.map(([id, label]) => ({
          value: String(id),
          label: label || String(id),
        }))
      }
    )

    return { success: true, options }
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooAccountsByType for ${type} failed:`, error)
    return { success: false, error: error.message || 'Failed to fetch accounts', options: [] }
  }
}

/**
 * Lists analytic accounts so the Standard Mapping orders tab can attach one to
 * a rule. `plan_id` only exists from Odoo 17, so the field list is probed with
 * `fields_get` instead of assuming a version.
 */
export async function getOdooAnalyticAccounts(force = false, companyId?: number) {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', accounts: [] }
    }

    const { erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, accounts: [] }
    }

    const cacheKey = `odoo:analytic-accounts:${connRes.connection.id}:${companyId || 'all'}`
    if (force) ttlCache.delete(cacheKey)

    const accounts = await ttlCache.get(
      cacheKey,
      TTL_OPTIONS_MS,
      async () => {
        const client = createOdooClient(connRes.connection)

        const fieldsMeta = await client.execute<Record<string, any>>(
          'account.analytic.account',
          'fields_get',
          [['name', 'code', 'active', 'company_id', 'plan_id']],
          { attributes: ['type', 'relation'] }
        )

        const fields = ['id', 'name']
        if (fieldsMeta?.code) fields.push('code')
        if (fieldsMeta?.plan_id) fields.push('plan_id')
        if (fieldsMeta?.company_id) fields.push('company_id')

        const domain: any[] = [['active', '=', true]]
        if (companyId && companyId > 0 && fieldsMeta?.company_id) {
          domain.unshift('|', ['company_id', '=', false], ['company_id', '=', companyId])
        }

        const records = await client.execute<Array<Record<string, any>>>(
          'account.analytic.account',
          'search_read',
          [domain],
          { fields, order: 'code asc, name asc', limit: 500 }
        )

        return (Array.isArray(records) ? records : []).map(record => ({
          id: Number(record.id),
          name: String(record.name || ''),
          code: record.code ? String(record.code) : '',
          plan: Array.isArray(record.plan_id) ? String(record.plan_id[1] || '') : '',
        })).filter(account => Number.isFinite(account.id) && account.id > 0)
      }
    )

    return { success: true, accounts: accounts || [] }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooAnalyticAccounts failed:', error)
    return { success: false, error: error.message || 'Failed to fetch analytic accounts', accounts: [] }
  }
}

export async function searchOdooCategories(searchTerm: string = '') {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const client = createOdooClient(connRes.connection)

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

export async function searchOdooProducts(searchTerm: string = '') {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { erp_type } = connRes.connection
    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const client = createOdooClient(connRes.connection)

    const records = await client.execute<Array<[number, string]>>(
      'product.template',
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
    console.error(`[Odoo Action] searchOdooProducts failed:`, error)
    return { success: false, error: error.message || 'Failed to search products', options: [] }
  }
}

export async function getOdooCustomers(force = false): Promise<{
  success: boolean
  options?: Array<{ value: string; label: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { url, username, password, erp_type } = connRes.connection
    if (erp_type === 'erpnext') {
      const decryptedPassword = decrypt(password)
      const authHeader = `token ${username.trim()}:${decryptedPassword.trim()}`
      try {
        const response = await fetch(`${url}/api/resource/Customer?limit_page_length=100`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
          cache: 'no-store',
        })
        if (response.ok) {
          const json = await response.json()
          const records = json.data || []
          return {
            success: true,
            options: records.map((r: any) => ({
              value: r.name,
              label: r.name,
            })),
          }
        }
      } catch (err: any) {
        console.error('[ERPNext] getOdooCustomers failed:', err)
      }
      return { success: true, options: [] }
    }

    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const cacheKey = `odoo:customers:${connRes.connection.id}`
    if (force) ttlCache.delete(cacheKey)

    const result = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const client = createOdooClient(connRes.connection)

      try {
        const records = await client.execute<Array<{ id: number; name?: string; display_name?: string }>>(
          'res.partner',
          'search_read',
          [[]],
          { fields: ['id', 'name', 'display_name'], limit: 300, order: 'name asc' }
        )
        if (records && records.length > 0) {
          return records.map((r) => ({
            value: String(r.id),
            label: r.display_name || r.name || String(r.id),
          }))
        }
      } catch (e) {
        console.warn('[Odoo Action] search_read res.partner failed, trying name_search:', e)
      }

      const raw = await client.execute<Array<[number, string]>>(
        'res.partner',
        'name_search',
        ['', [], 'ilike', 300]
      )
      return (raw || []).map(([id, label]) => ({
        value: String(id),
        label: label || String(id),
      }))
    })

    return { success: true, options: result || [] }
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooCustomers failed:`, error)
    return { success: false, error: error.message || 'Failed to fetch customers', options: [] }
  }
}

export async function getOdooProducts(force = false): Promise<{
  success: boolean
  options?: Array<{ value: string; label: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found or inactive.', options: [] }
    }

    const { url, username, password, erp_type } = connRes.connection
    if (erp_type === 'erpnext') {
      const decryptedPassword = decrypt(password)
      const authHeader = `token ${username.trim()}:${decryptedPassword.trim()}`
      try {
        const response = await fetch(`${url}/api/resource/Item?limit_page_length=100`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
          cache: 'no-store',
        })
        if (response.ok) {
          const json = await response.json()
          const records = json.data || []
          return {
            success: true,
            options: records.map((r: any) => ({
              value: r.name,
              label: r.name,
            })),
          }
        }
      } catch (err: any) {
        console.error('[ERPNext] getOdooProducts failed:', err)
      }
      return { success: true, options: [] }
    }

    if (erp_type && erp_type !== 'odoo') {
      return { success: true, options: [] }
    }

    const cacheKey = `odoo:products_list:${connRes.connection.id}`
    if (force) ttlCache.delete(cacheKey)

    const result = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const client = createOdooClient(connRes.connection)

      try {
        const records = await client.execute<Array<{ id: number; name?: string; display_name?: string; default_code?: string }>>(
          'product.product',
          'search_read',
          [[]],
          { fields: ['id', 'name', 'display_name', 'default_code'], limit: 300, order: 'name asc' }
        )
        if (records && records.length > 0) {
          return records.map((r) => ({
            value: String(r.id),
            label: r.display_name || r.name || String(r.id),
          }))
        }
      } catch (e) {
        console.warn('[Odoo Action] search_read product.product failed, trying name_search:', e)
      }

      const raw = await client.execute<Array<[number, string]>>(
        'product.product',
        'name_search',
        ['', [], 'ilike', 300]
      )
      return (raw || []).map(([id, label]) => ({
        value: String(id),
        label: label || String(id),
      }))
    })

    return { success: true, options: result || [] }
  } catch (error: any) {
    console.error(`[Odoo Action] getOdooProducts failed:`, error)
    return { success: false, error: error.message || 'Failed to fetch products', options: [] }
  }
}

/**
 * Fetch accounting journals (account.journal) from Odoo, used for the
 * credit-note journal on store returns (orders tab).
 *
 * Pass `force = true` to bypass the TTL memo (used by the manual refresh
 * button, so journals created in Odoo after opening the tab appear at once).
 */
export async function getOdooJournals(force = false): Promise<{
  success: boolean
  journals?: Array<{ id: number; name: string; code: string; type: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found' }
    }

    if (connRes.connection.erp_type && connRes.connection.erp_type !== 'odoo') {
      return { success: true, journals: [] }
    }

    const cacheKey = `odoo:journals:${connRes.connection.id}`
    if (force) ttlCache.delete(cacheKey)

    const journals = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const client = createOdooClient(connRes.connection)

      const records = await client.execute<Array<{ id: number; name: string; code: string; type: string }>>(
        'account.journal',
        'search_read',
        [[]],
        { fields: ['id', 'name', 'code', 'type', 'company_id'], order: 'type asc, name asc' }
      )

      return records.map(j => ({
        id: j.id,
        name: j.name || '',
        code: j.code || '',
        type: j.type || '',
      }))
    })

    return { success: true, journals }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooJournals failed:', error)
    return { success: false, error: error.message || 'Failed to fetch journals' }
  }
}



/**
 * Fetch currencies (res.currency) from Odoo.
 * Returns both active and inactive currencies with their codes, symbols, and rate.
 */
export async function getOdooCurrencies(force = false): Promise<{
  success: boolean
  currencies?: Array<{ id: number; name: string; symbol: string; active: boolean; rate?: number }>
  options?: Array<{ value: string; label: string }>
  error?: string
}> {
  try {
    const connRes = await getActiveWorkspaceErpConnection()
    if (!connRes.success || !connRes.connection) {
      return { success: false, error: 'ERP connection not found', options: [] }
    }

    if (connRes.connection.erp_type && connRes.connection.erp_type !== 'odoo') {
      return { success: true, currencies: [], options: [] }
    }

    const cacheKey = `odoo:currencies:${connRes.connection.id}`
    if (force) ttlCache.delete(cacheKey)

    const currencies = await ttlCache.get(cacheKey, TTL_OPTIONS_MS, async () => {
      const client = createOdooClient(connRes.connection)

      const records = await client.execute<Array<{ id: number; name: string; symbol: string; active: boolean; rate?: number }>>(
        'res.currency',
        'search_read',
        [[]],
        { fields: ['id', 'name', 'symbol', 'active', 'rate'], order: 'active desc, name asc' }
      )

      return (records || []).map(c => ({
        id: c.id,
        name: c.name || '',
        symbol: c.symbol || '',
        active: !!c.active,
        rate: typeof c.rate === 'number' ? c.rate : 1,
      }))
    })

    const options = (currencies || []).map(c => ({
      value: String(c.id),
      label: `${c.name}${c.symbol ? ` (${c.symbol})` : ''}${!c.active ? ' [غير مفعّلة في أودو / Inactive]' : ''}`,
    }))

    return { success: true, currencies, options }
  } catch (error: any) {
    console.error('[Odoo Action] getOdooCurrencies failed:', error)
    return { success: false, error: error.message || 'Failed to fetch currencies', options: [] }
  }
}
