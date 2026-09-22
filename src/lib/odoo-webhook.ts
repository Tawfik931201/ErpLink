import { OdooClient, type OdooConfig } from './odoo-client'

export interface RegisterOdooWebhookOptions {
  /** Override the destination path (default: `/api/webhooks/odoo?field_mapping_id=<id>`). */
  webhookPath?: string
  /** Optional suffix to distinguish the automation name. */
  labelSuffix?: string
}

/**
 * Registers an Automated Action (Webhook) in Odoo for a given model.
 * Handles differences between Odoo 17+ and older versions (Odoo 16 and below) dynamically.
 * Configures Odoo to trigger the webhook only when specific fields (from mappings + match field) are modified.
 * Excludes group-restricted fields (like 'standard_price' / Cost) from the native webhook payload (webhook_field_ids)
 * to prevent security warnings and save failures in Odoo, while keeping them as trigger fields.
 */
export async function registerOdooWebhook(
  config: OdooConfig,
  odooModel: string,
  fieldMappingId: string,
  fieldNames: string[],
  options?: RegisterOdooWebhookOptions
): Promise<{ baseAutomationId: number; serverActionId?: number }> {
  const client = new OdooClient(config)

  // 1. Get model ID from ir.model
  console.log(`[OdooWebhook] Resolving model_id for model="${odooModel}"...`)
  const modelIds = await client.search('ir.model', [['model', '=', odooModel]])
  if (!modelIds || modelIds.length === 0) {
    throw new Error(`Model "${odooModel}" not found in Odoo database.`)
  }
  const modelId = modelIds[0]
  console.log(`[OdooWebhook] Resolved model_id=${modelId} for "${odooModel}"`)

  // 2. Resolve database field IDs and detect group-restricted fields
  let odooFieldIds: number[] = []
  let webhookFieldIds: number[] = []

  if (fieldNames && fieldNames.length > 0) {
    try {
      console.log(`[OdooWebhook] Resolving field IDs and metadata for fields:`, fieldNames)
      
      // Query field database IDs from ir.model.fields
      const dbFields = await client.execute<Array<{ id: number, name: string }>>(
        'ir.model.fields',
        'search_read',
        [[
          ['model', '=', odooModel],
          ['name', 'in', fieldNames]
        ]],
        { fields: ['id', 'name'] }
      )
      
      odooFieldIds = dbFields.map(f => f.id)
      console.log(`[OdooWebhook] All trigger field IDs:`, odooFieldIds)

      // Query field attributes using fields_get on the target model to detect group-restricted fields
      const fieldsGetMeta = await client.execute<Record<string, { groups?: string }>>(
        odooModel,
        'fields_get',
        [fieldNames, ['groups']],
        {}
      )

      // Filter out fields that have group restrictions (e.g. 'groups' is a non-empty string)
      const nonRestrictedFieldNames = fieldNames.filter(name => {
        const fieldMeta = fieldsGetMeta[name]
        const hasGroups = fieldMeta && typeof fieldMeta.groups === 'string' && fieldMeta.groups.trim().length > 0
        return !hasGroups
      })

      console.log(`[OdooWebhook] Non-restricted fields (for webhook payload):`, nonRestrictedFieldNames)
      
      // Filter the database IDs for the webhook payload
      const webhookDbFields = dbFields.filter(f => nonRestrictedFieldNames.includes(f.name))
      webhookFieldIds = webhookDbFields.map(f => f.id)
      console.log(`[OdooWebhook] Resolved webhook_field_ids for payload:`, webhookFieldIds)

    } catch (err) {
      console.error('[OdooWebhook] Failed to query field details. Defaulting to all fields.', err)
      // Fallback: use all resolved fields as a backup
      odooFieldIds = []
      webhookFieldIds = []
    }
  }

  // 3. Prepare Webhook URL with query parameter mapping ID
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    throw new Error('[OdooWebhook] NEXT_PUBLIC_APP_URL environment variable is required for webhook registration')
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const webhookUrl = options?.webhookPath
    ? `${appUrl}${options.webhookPath}`
    : `${appUrl}/api/webhooks/odoo?field_mapping_id=${fieldMappingId}`
  const labelSuffix = options?.labelSuffix ? `: ${options.labelSuffix}` : ''

  // 4. Inspect base.automation to detect Odoo 17+ vs 16-
  console.log('[OdooWebhook] Checking base.automation fields to detect Odoo version...')
  let isOdoo17Plus = false
  let supportsWebhookState = false
  let urlFieldName = 'url'

  try {
    const fieldsMeta = await client.execute<Record<string, any>>(
      'base.automation',
      'fields_get',
      [['action_server_ids']],
      { attributes: ['type'] }
    )
    if (fieldsMeta && fieldsMeta.action_server_ids) {
      isOdoo17Plus = true
    }
  } catch (err) {
    console.log('[OdooWebhook] Failed to inspect base.automation. Defaulting to Odoo 16- syntax.', err)
  }

  // 5. If Odoo 17+, check if native Webhook actions are supported
  if (isOdoo17Plus) {
    try {
      console.log('[OdooWebhook] Inspecting ir.actions.server fields for native Webhook support...')
      const srvFields = await client.execute<Record<string, any>>(
        'ir.actions.server',
        'fields_get',
        [['state', 'webhook_url', 'url']],
        { attributes: ['type', 'selection'] }
      )
      
      const stateSelection = srvFields.state?.selection || []
      const hasWebhookOption = stateSelection.some((s: any) => s[0] === 'webhook')
      
      if (hasWebhookOption) {
        supportsWebhookState = true
        if (srvFields.webhook_url) {
          urlFieldName = 'webhook_url'
        } else if (srvFields.url) {
          urlFieldName = 'url'
        }
      }
    } catch (err) {
      console.log('[OdooWebhook] Failed to inspect ir.actions.server state fields.', err)
    }
  }

  console.log(`[OdooWebhook] Odoo version detected: ${isOdoo17Plus ? 'Odoo 17+' : 'Odoo 16-'}`)
  console.log(`[OdooWebhook] Supports native Webhook state: ${supportsWebhookState} (URL field: "${urlFieldName}")`)

  if (isOdoo17Plus) {
    // ── Odoo 17+ Strategy ──────────────────────────────────────────────────
    let serverActionId: number

    if (supportsWebhookState) {
      // Native Webhook Action (No Python code validation, bypasses safe_eval)
      console.log('[OdooWebhook] Registering native Webhook Server Action...')
      const srvActionData: Record<string, any> = {
        name: `ErpLink Webhook: ${odooModel} (${fieldMappingId})${labelSuffix}`,
        model_id: modelId,
        state: 'webhook',
        [urlFieldName]: webhookUrl,
      }

      // Bind webhook_field_ids (only non-restricted fields to bypass security warning)
      if (webhookFieldIds && webhookFieldIds.length > 0) {
        srvActionData.webhook_field_ids = [[6, 0, webhookFieldIds]]
      }

      serverActionId = await client.create('ir.actions.server', srvActionData)
    } else {
      // Fallback Python Code
      console.log('[OdooWebhook] Native webhooks not supported; falling back to Python Server Action...')
      const pythonCode = `import requests
url = '${webhookUrl}'
payload = {
    'event': 'odoo.record.updated',
    'model': record._name,
    'id': record.id,
    'field_mapping_id': '${fieldMappingId}'
}
try:
    requests.post(url, json=payload, timeout=5)
except Exception:
    pass`

      serverActionId = await client.create('ir.actions.server', {
        name: `ErpLink Webhook: ${odooModel} (${fieldMappingId})${labelSuffix}`,
        model_id: modelId,
        state: 'code',
        code: pythonCode,
      })
    }
    console.log(`[OdooWebhook] Created ir.actions.server with ID=${serverActionId}`)

    // Create automated action (base.automation) and link it
    console.log('[OdooWebhook] Creating base.automation...')
    const baseAutomationData: Record<string, any> = {
      name: `ErpLink Automated Action: ${odooModel} (${fieldMappingId})${labelSuffix}`,
      model_id: modelId,
      trigger: 'on_create_or_write',
      action_server_ids: [[6, 0, [serverActionId]]], // Many2many link syntax
    }
    // Bind trigger fields (all fields including restricted ones, so updates trigger the webhook)
    if (odooFieldIds && odooFieldIds.length > 0) {
      baseAutomationData.trigger_field_ids = [[6, 0, odooFieldIds]]
    }

    const baseAutomationId = await client.create('base.automation', baseAutomationData)
    console.log(`[OdooWebhook] Created base.automation with ID=${baseAutomationId}`)

    return { baseAutomationId, serverActionId }
  } else {
    // ── Odoo 16- Strategy ──────────────────────────────────────────────────
    const pythonCode = `import requests
url = '${webhookUrl}'
payload = {
    'event': 'odoo.record.updated',
    'model': record._name,
    'id': record.id,
    'field_mapping_id': '${fieldMappingId}'
}
try:
    requests.post(url, json=payload, timeout=5)
except Exception:
    pass`

    console.log('[OdooWebhook] Creating base.automation directly (delegated inheritance)...')
    const baseAutomationData: Record<string, any> = {
      name: `ErpLink Webhook: ${odooModel} (${fieldMappingId})${labelSuffix}`,
      model_id: modelId,
      trigger: 'on_create_or_write',
      state: 'code',
      code: pythonCode,
    }
    // Bind trigger fields if resolved
    if (odooFieldIds && odooFieldIds.length > 0) {
      baseAutomationData.trigger_field_ids = [[6, 0, odooFieldIds]]
    }

    const baseAutomationId = await client.create('base.automation', baseAutomationData)
    console.log(`[OdooWebhook] Created base.automation with ID=${baseAutomationId}`)

    return { baseAutomationId }
  }
}

/**
 * Registers an Automated Action on `stock.quant` so Odoo notifies us whenever
 * a product's stock balance changes (purchases, sales, inventory adjustments …).
 * Uses the same version detection as `registerOdooWebhook`, targeting the
 * dedicated stock receiver route with `workspace_id`.
 */
export async function registerOdooStockWebhook(
  config: OdooConfig,
  workspaceId: string,
  odooModel = 'stock.quant'
): Promise<{ baseAutomationId: number; serverActionId?: number }> {
  const fieldNames = ['product_id', 'location_id', 'quantity', 'inventory_quantity']
  return registerOdooWebhook(
    config,
    odooModel,
    workspaceId,
    fieldNames,
    {
      webhookPath: `/api/webhooks/odoo/stock?workspace_id=${workspaceId}`,
      labelSuffix: 'Stock',
    }
  )
}

/**
 * Removes the stock Automated Action (and its server action) from Odoo.
 */
export async function unregisterOdooStockWebhook(
  config: OdooConfig,
  baseAutomationId?: number,
  serverActionId?: number
): Promise<boolean> {
  if (!baseAutomationId) return true
  return unregisterOdooWebhook(config, baseAutomationId, serverActionId)
}

/**
 * Removes an Automated Action and optionally its associated Server Action in Odoo.
 */
export async function unregisterOdooWebhook(
  config: OdooConfig,
  baseAutomationId: number,
  serverActionId?: number
): Promise<boolean> {
  const client = new OdooClient(config)
  
  try {
    console.log(`[OdooWebhook] Deleting base.automation ID=${baseAutomationId}...`)
    await client.unlink('base.automation', [baseAutomationId])
    console.log(`[OdooWebhook] Successfully deleted base.automation ID=${baseAutomationId}`)
  } catch (err) {
    console.error(`[OdooWebhook] Error deleting base.automation ID=${baseAutomationId}:`, err)
  }

  if (serverActionId) {
    try {
      console.log(`[OdooWebhook] Deleting ir.actions.server ID=${serverActionId}...`)
      await client.unlink('ir.actions.server', [serverActionId])
      console.log(`[OdooWebhook] Successfully deleted ir.actions.server ID=${serverActionId}`)
    } catch (err) {
      console.error(`[OdooWebhook] Error deleting ir.actions.server ID=${serverActionId}:`, err)
    }
  }

  return true
}
