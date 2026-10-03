import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { recordAudit } from '@/lib/audit-logs'
import { isAdmin } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import {
  deriveOdooWebhookSecret,
  odooStockSecretScope,
  odooWebhookSecretFingerprint,
} from '@/lib/odoo/webhook-secret'
import type { OdooConfig } from '@/lib/odoo-client'
import {
  registerOdooStockWebhook,
  registerOdooWebhook,
  unregisterOdooStockWebhook,
  unregisterOdooWebhook,
} from '@/lib/odoo-webhook'
import { supabase } from '@/lib/supabase'

/**
 * POST /api/admin/odoo-webhooks/refresh — re-create every tenant's Odoo
 * Automated Actions so their URLs carry the ingress secret the webhook routes
 * verify (see src/lib/odoo/webhook-secret.ts).
 *
 * Why this exists: the destination URL is written into the customer's Odoo
 * database by this app, and it never contained a secret. The routes therefore
 * rejected every delivery (500, `ODOO_WEBHOOK_SECRET` was never set), which has
 * been silently killing Odoo → store stock and record sync since 2026-09-28. No
 * server-side configuration can add the secret to an existing action — the URL
 * lives in Odoo — so each one has to be re-registered.
 *
 * Ordering differs from the Zid refresh on purpose: here the new action is
 * created **before** the old one is deleted. Overlapping actions are harmless
 * because `dedup_key` collapses them (`sync_queue` + `webhook_inbox`), whereas
 * delete-first risks leaving a tenant with no action at all if the create then
 * fails — a silent, hard-to-notice loss on shared hosting.
 *
 * Safe to run repeatedly: an already-refreshed action is simply replaced by an
 * identical one.
 */

interface StockReport {
  status: 'refreshed' | 'skipped' | 'failed'
  automationId?: number
  error?: string
}

interface MappingReport {
  mappingId: string
  model: string | null
  status: 'refreshed' | 'failed'
  error?: string
}

interface WorkspaceReport {
  workspaceId: string
  stock: StockReport
  mappings: MappingReport[]
  status: 'refreshed' | 'failed'
}

function toOdooConfig(row: { url?: string | null; db_name?: string | null; username?: string | null; password?: string | null }): OdooConfig {
  return {
    url: row.url || '',
    db: row.db_name || '',
    username: row.username || '',
    apiKey: decrypt(row.password || ''),
  }
}

/**
 * Mirrors the field selection in src/app/actions/field-mappings.ts: the trigger
 * fields are the mapped ERP fields plus the match field. `registerOdooWebhook`
 * re-resolves their ids inside Odoo, so the recreated action watches exactly what
 * the original did.
 */
function triggerFieldNames(row: { mappings?: unknown; odoo_model?: string | null; odoo_match_field?: string | null }): string[] {
  const byModel =
    row.mappings && typeof row.mappings === 'object'
      ? ((row.mappings as Record<string, unknown>)[row.odoo_model || ''] as Array<{ erpField?: string }> | undefined)
      : undefined
  const mapped = Array.isArray(byModel) ? byModel.map((m) => m?.erpField) : []
  return Array.from(
    new Set([...mapped, ...(row.odoo_match_field ? [row.odoo_match_field] : [])].filter(Boolean) as string[])
  )
}

export async function POST() {
  const { userId } = await auth()
  if (!userId || !isAdmin(userId)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Checked before anything is touched: re-registering without a derivable
  // secret would replace working actions with ones that stay `legacy`.
  if (!deriveOdooWebhookSecret(odooStockSecretScope('probe'))) {
    return NextResponse.json(
      { error: 'No webhook secret is derivable — ENCRYPTION_KEY is not set. Refusing to touch existing actions.' },
      { status: 400 }
    )
  }

  const { data: connections, error: connErr } = await supabase
    .from('erp_connections')
    .select('id, workspace_id, url, db_name, username, password, erp_type')

  if (connErr) {
    return NextResponse.json({ error: `Failed to list ERP connections: ${connErr.message}` }, { status: 500 })
  }

  const reports: WorkspaceReport[] = []

  for (const row of (connections ?? []) as Array<{
    id?: string | null
    workspace_id?: string | null
    url?: string | null
    db_name?: string | null
    username?: string | null
    password?: string | null
    erp_type?: string | null
  }>) {
    const workspaceId = row.workspace_id
    if (!workspaceId) continue
    // Same guard the webhook sync itself applies.
    if (row.erp_type && row.erp_type !== 'odoo') continue

    const report: WorkspaceReport = {
      workspaceId,
      stock: { status: 'skipped' },
      mappings: [],
      status: 'refreshed',
    }

    let config: OdooConfig
    try {
      config = toOdooConfig(row)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unreadable credentials'
      report.status = 'failed'
      report.stock = { status: 'failed', error: message }
      reports.push(report)
      continue
    }

    // ── Stock: stock.quant → /api/webhooks/odoo/stock ─────────────────────
    try {
      const { data: settingsRow } = await supabase
        .from('standard_mapping_settings')
        .select('settings')
        .eq('workspace_id', workspaceId)
        .eq('store_type', 'zid')
        .eq('entity_type', 'products')
        .maybeSingle()

      const settings = ((settingsRow?.settings || {}) as Record<string, unknown>)
      const inventory = { ...((settings.inventory as Record<string, unknown>) || {}) }
      const refs = inventory.odoo_stock_webhook as
        | { base_automation_id?: number; server_action_id?: number }
        | null
        | undefined

      if (refs?.base_automation_id) {
        const created = await registerOdooStockWebhook(config, workspaceId)
        await unregisterOdooStockWebhook(config, refs.base_automation_id, refs.server_action_id)
        inventory.odoo_stock_webhook = {
          base_automation_id: created.baseAutomationId,
          server_action_id: created.serverActionId,
        }
        settings.inventory = inventory
        const { error: upErr } = await supabase.from('standard_mapping_settings').upsert(
          {
            workspace_id: workspaceId,
            store_type: 'zid',
            entity_type: 'products',
            settings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id, store_type, entity_type' }
        )
        if (upErr) throw upErr
        report.stock = { status: 'refreshed', automationId: created.baseAutomationId }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error('[Odoo Webhook] Stock action refresh failed', { workspaceId, error })
      report.stock = { status: 'failed', error: message }
      report.status = 'failed'
    }

    // ── Records: each erp_to_store field mapping ──────────────────────────
    const { data: mappings, error: mapErr } = await supabase
      .from('field_mappings')
      .select('id, odoo_model, odoo_match_field, odoo_webhook_id, odoo_server_action_id, mappings, sync_direction')
      .eq('workspace_id', workspaceId)
      .not('odoo_webhook_id', 'is', null)

    if (mapErr) {
      report.status = 'failed'
      report.mappings.push({ mappingId: '-', model: null, status: 'failed', error: mapErr.message })
    } else {
      for (const mapping of (mappings ?? []) as Array<{
        id: string
        odoo_model?: string | null
        odoo_match_field?: string | null
        odoo_webhook_id?: number | null
        odoo_server_action_id?: number | null
        mappings?: unknown
        sync_direction?: string | null
      }>) {
        const directions = (mapping.sync_direction || '').split(',').map((d) => d.trim())
        if (!directions.includes('erp_to_store')) continue

        try {
          const created = await registerOdooWebhook(
            config,
            mapping.odoo_model || '',
            mapping.id,
            triggerFieldNames(mapping)
          )
          await unregisterOdooWebhook(
            config,
            mapping.odoo_webhook_id as number,
            mapping.odoo_server_action_id || undefined
          )
          const { error: upErr } = await supabase
            .from('field_mappings')
            .update({
              odoo_webhook_id: created.baseAutomationId,
              odoo_server_action_id: created.serverActionId ?? null,
            })
            .eq('id', mapping.id)
          if (upErr) throw upErr
          report.mappings.push({
            mappingId: mapping.id,
            model: mapping.odoo_model ?? null,
            status: 'refreshed',
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          console.error('[Odoo Webhook] Mapping action refresh failed', { mappingId: mapping.id, error })
          report.mappings.push({
            mappingId: mapping.id,
            model: mapping.odoo_model ?? null,
            status: 'failed',
            error: message,
          })
          report.status = 'failed'
        }
      }
    }

    reports.push(report)
  }

  const refreshed = reports.filter((r) => r.status === 'refreshed').length
  const failed = reports.filter((r) => r.status === 'failed').length

  await recordAudit({
    actorId: userId,
    actorRole: 'admin',
    action: 'odoo.webhooks_refresh',
    entityType: 'odoo_webhook',
    entityId: `workspaces:${reports.length}`,
    metadata: {
      secret: odooWebhookSecretFingerprint(odooStockSecretScope('probe')),
      refreshed,
      failed,
    },
  }).catch(() => {})

  return NextResponse.json({ ok: failed === 0, refreshed, failed, workspaces: reports })
}

export async function GET() {
  return NextResponse.json(
    { error: 'Use POST. This route deletes and re-creates Odoo Automated Actions for every tenant.' },
    { status: 405 }
  )
}