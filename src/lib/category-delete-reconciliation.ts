/**
 * Detect category deletes missed by Zid webhooks.
 *
 * An absent category is NEVER enough on its own to modify Odoo: require
 * two authoritative Merchant API 404 responses separated by a minute.
 * Audit only categories already linked to the current workspace/store/ERP;
 * cap remote requests and persist a cursor between cycles.
 */
import { resolveExecutionTarget } from './erp-execution-target'
import { supabase } from './supabase'
import { enqueueWebhookEvent } from './sync-queue'
import { isWebhookEventEnabled } from './webhook-gate'
import { getAccessToken } from './zid/token'
import { ZidAPI } from './zid-client'

const MAX_REMOTE_CALLS_PER_CYCLE = 4
const MAX_LINKS_PER_MERCHANT = 2
const MIN_CONFIRMATION_DELAY_MS = 60_000

/** Only an explicit 404 can prove absence. Never treat timeouts or 5xx as deletion. */
export function isZidCategoryNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const response = (error as { response?: { status?: unknown } }).response
  return response?.status === 404
}

function scopeFor(parts: Array<string | number>): string {
  return JSON.stringify(['zid', 'category-delete-audit', ...parts])
}

async function persistState(scope: string, cursor: Record<string, unknown>, now: string): Promise<void> {
  const { error } = await supabase.from('sync_reconcile_state').upsert({
    scope, cursor, last_attempt: now, updated_at: now,
  }, { onConflict: 'scope' })
  if (error) throw new Error('category audit cursor persistence unavailable')
}

async function readCursor(scope: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('sync_reconcile_state')
    .select('cursor').eq('scope', scope).maybeSingle()
  if (error) throw new Error('category audit cursor unavailable')
  return data?.cursor && typeof data.cursor === 'object' && !Array.isArray(data.cursor)
    ? data.cursor as Record<string, unknown> : {}
}

export interface CategoryDeleteAuditResult {
  checked: number
  confirmedMissing: number
  enqueued: number
  errors: string[]
}

export async function reconcileZidDeletedCategories(now = new Date()): Promise<CategoryDeleteAuditResult> {
  const result: CategoryDeleteAuditResult = { checked: 0, confirmedMissing: 0, enqueued: 0, errors: [] }
  const { data: merchants, error: merchantError } = await supabase
    .from('merchant_tokens').select('merchant_id,store_id,workspace_id')
    .not('workspace_id', 'is', null).limit(100)
  if (merchantError) {
    result.errors.push('category audit merchant discovery unavailable')
    return result
  }

  let remaining = MAX_REMOTE_CALLS_PER_CYCLE
  for (const merchant of merchants ?? []) {
    if (remaining <= 0) break
    const workspaceId = String(merchant.workspace_id || '')
    const merchantId = String(merchant.merchant_id || merchant.store_id || '')
    const storeId = String(merchant.store_id || merchant.merchant_id || '')
    if (!workspaceId || !merchantId || !storeId) continue

    const scope = scopeFor([workspaceId, storeId])
    try {
      const target = await resolveExecutionTarget(workspaceId, 'zid', storeId)
      const gate = await isWebhookEventEnabled(workspaceId, 'zid', 'category.delete', storeId)
      if (!gate.allowed) continue

      const cursor = await readCursor(scope)
      const offset = Number.isSafeInteger(cursor.offset) && Number(cursor.offset) >= 0
        ? Number(cursor.offset) : 0
      const pageSize = Math.min(MAX_LINKS_PER_MERCHANT, remaining)
      const { data: links, error: linksError } = await supabase
        .from('odoo_entity_links')
        .select('store_entity_id')
        .eq('workspace_id', workspaceId)
        .eq('store_id', storeId)
        .eq('platform', 'zid')
        .eq('entity_type', 'categories')
        .order('created_at', { ascending: true })
        .range(offset, offset + pageSize - 1)
      if (linksError) throw new Error('linked category discovery failed')
      const rows = links ?? []
      if (!rows.length) {
        await persistState(scope, { offset: 0 }, now.toISOString())
        continue
      }

      const token = await getAccessToken(merchantId, workspaceId)
      if (!token) throw new Error('category audit token unavailable')
      const creds = {
        authorization: token.authorization || '',
        managerToken: token.accessToken,
        storeId,
      }

      for (const row of rows) {
        const categoryId = String(row.store_entity_id || '')
        if (!/^\d+$/.test(categoryId)) continue
        remaining -= 1
        result.checked += 1
        const missingScope = scopeFor([workspaceId, storeId, 'missing', categoryId])
        try {
          await ZidAPI.categories.get(creds, categoryId)
          // A successful read clears any first 404: transient absence is not a deletion.
          const missingCursor = await readCursor(missingScope)
          if (missingCursor.firstSeenAt) await persistState(missingScope, {}, now.toISOString())
        } catch (error) {
          if (!isZidCategoryNotFound(error)) throw error
          const missingCursor = await readCursor(missingScope)
          const firstSeen = typeof missingCursor.firstSeenAt === 'string'
            ? Date.parse(missingCursor.firstSeenAt) : NaN
          if (!Number.isFinite(firstSeen) || now.getTime() - firstSeen < MIN_CONFIRMATION_DELAY_MS) {
            if (!Number.isFinite(firstSeen)) {
              await persistState(missingScope, { firstSeenAt: now.toISOString() }, now.toISOString())
            }
            continue
          }
          result.confirmedMissing += 1
          const queued = await enqueueWebhookEvent({
            workspaceId, storeId, platform: 'zid', event: 'category.delete',
            payload: { category_id: categoryId },
            executionTarget: target,
            dedupKey: 'reconcile:zid:category.delete:' + scope + ':' + categoryId,
          })
          if (queued.error || queued.skipped || (!queued.id && !queued.duplicate && !queued.coalesced)) {
            throw new Error('category deletion enqueue not confirmed')
          }
          if (queued.id) result.enqueued += 1
        }
      }
      const nextOffset = rows.length === pageSize ? offset + rows.length : 0
      await persistState(scope, { offset: nextOffset }, now.toISOString())
    } catch (error) {
      result.errors.push(storeId + ': ' +
        (error instanceof Error ? error.message.slice(0, 180) : 'category audit failed'))
    }
  }
  return result
}
