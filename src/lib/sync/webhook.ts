import { resolveExecutionTarget, validateExecutionTarget, withErpTarget, type ExecutionTarget } from '@/lib/erp-execution-target'
import { prepareSallaWebhookData } from '@/lib/salla/webhook-data'
import { derivePresetKey, normalizeEvent } from '@/lib/sync/events'
import { processFixedMappingFallback, processSingleMapping } from '@/lib/sync/mappings'
import { notifySyncForRecord } from '@/lib/sync/notifications'
import { logSync, supabaseAdmin } from '@/lib/sync-runtime'
import type { FieldMappingRow, SyncEngineResult } from '@/lib/sync-types'
import { enrichZidCustomer } from '@/lib/zid/customers'
import { enrichZidOrder } from '@/lib/zid/orders'
import { enrichZidProduct } from '@/lib/zid/products'

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Processes a store delivery after resolving and validating its ERP target.
 * Applies Standard Mapping first, then any matching custom mappings.
 */
export async function processWebhookEvent(
  event: string, storeId: number | string, data: Record<string, unknown>,
  platformHint?: 'zid' | 'salla' | 'shopify', isQueueExecution = false,
  workspaceIdParam?: string, queueItemId?: string | null, executionTarget?: ExecutionTarget
): Promise<SyncEngineResult> {
  if (!workspaceIdParam || !platformHint) throw new Error('Trusted workspace and platform required for ERP execution')
  const store = String(storeId)
  if (isQueueExecution && !executionTarget) throw new Error('Unpinned ERP execution target requires controlled recovery')
  const target = executionTarget ?? await resolveExecutionTarget(workspaceIdParam, platformHint, store)
  await validateExecutionTarget(workspaceIdParam, platformHint, store, target)
  return withErpTarget({ ...target, workspaceId: workspaceIdParam, platform: platformHint, storeId: store, eventId: queueItemId || `manual:${event}` },
    () => processWebhookEventInternal(event, storeId, data, platformHint, isQueueExecution, workspaceIdParam, queueItemId))
}

async function processWebhookEventInternal(
  event: string,
  storeId: number | string,
  data: Record<string, unknown>,
  platformHint?: 'zid' | 'salla' | 'shopify',
  isQueueExecution = false,
  workspaceIdParam?: string,
  /**
   * رقم صف الطابور الذي يعالَج — **هوية الحدث**.
   *
   * تُستخدم كمفتاح `event_key` في صندوق التليجرام ⇒ **رسالة واحدة لكل
   * طلب**: رسالة الوصول (عند الاستقبال) ورسالة النتيجة (بعد المزامنة)
   * تشتركان في المفتاح نفسه، فالأعلى أولوية يُلغي الأدنى.
   */
  queueItemId?: string | null
): Promise<SyncEngineResult> {
  const storeIdNum = Number(storeId)
  const storeIdStr = Number.isNaN(storeIdNum) ? String(storeId) : String(storeIdNum)
  const normalizedEvent = normalizeEvent(event)
  // ختم تصنيف المصادقة الذي يرفقه مسار الدخول (zid_auth / salla_auth) على
  // التسليمات غير المصادقة فقط. يُقرأ هنا ثم يُحذف فوراً حتى لا يدخل في أي
  // تحويل أو كتابة لاحقة. للتسليمات غير المصادقة تُعاد القراءة القيمية من
  // API المنصة (API يفوز في الدمج) — المتصل غير المصادق يبقى محفزاً فقط،
  // لا مصدراً للقيم. التسليمات المصادقة: سلوك الدمج كما هو تماماً.
  const sallaDeliveryAuth = String((data as any)?.salla_auth ?? '').toLowerCase()
  const deliveryAuth = String((data as any)?.zid_auth ?? sallaDeliveryAuth).toLowerCase()
  if ((data as any)?.zid_auth !== undefined) delete (data as any).zid_auth
  if ((data as any)?.salla_auth !== undefined) delete (data as any).salla_auth
  const isLegacyDelivery = deliveryAuth === 'legacy' || deliveryAuth === 'unconfigured'
  const result: SyncEngineResult = {
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    records: [],
  }

  if (platformHint === 'salla' && (sallaDeliveryAuth === 'legacy' || sallaDeliveryAuth === 'unconfigured')) {
    if (workspaceIdParam) {
      await logSync({
        workspace_id: workspaceIdParam,
        field_mapping_id: '',
        event,
        store_id: storeIdStr,
        zid_entity_id: undefined,
        odoo_model: 'webhook-ingress',
        status: 'skipped',
        error_message: 'Salla webhook authentication required',
        payload: {},
        trigger_type: 'automatic',
        platform: 'salla',
      })
    }
    return { ...result, processed: 1, skipped: 1 }
  }

  let resolvedWorkspaceId = workspaceIdParam
  if (!resolvedWorkspaceId) {
    try {
      const { data: tok } = await supabaseAdmin
        .from('merchant_tokens')
        .select('workspace_id')
        .or(`store_id.eq.${storeIdStr},merchant_id.eq.${storeIdStr}`)
        .maybeSingle()
      resolvedWorkspaceId = tok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!resolvedWorkspaceId) {
    try {
      const { data: sallaTok } = await supabaseAdmin
        .from('salla_tokens')
        .select('workspace_id')
        .eq('merchant_id', storeIdStr)
        .maybeSingle()
      resolvedWorkspaceId = sallaTok?.workspace_id
    } catch { /* ignore */ }
  }
  if (!resolvedWorkspaceId) {
    try {
      const { data: shopTok } = await supabaseAdmin
        .from('shopify_tokens')
        .select('workspace_id')
        .eq('shop_domain', storeIdStr)
        .maybeSingle()
      resolvedWorkspaceId = shopTok?.workspace_id
    } catch { /* ignore */ }
  }

  const isProduct = normalizedEvent.includes('product')
  if (!isProduct) {
    console.info(`[SyncEngine] ===== processWebhookEvent START =====`)
    console.info(`[SyncEngine] event="${event}" normalized="${normalizedEvent}" storeId="${storeIdStr}"`)
  }

  const syncPlatform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
    normalizedEvent.includes('shopify') ? 'shopify'
    : normalizedEvent.includes('salla') ? 'salla'
    : 'zid'
  )
  if (syncPlatform === 'zid') {
    if (normalizedEvent.startsWith('customer.')) {
      data = await enrichZidCustomer(data, storeIdStr, isLegacyDelivery)
    }
    if (isProduct) {
      data = await enrichZidProduct(data, storeIdStr, isLegacyDelivery)
    }
    if (normalizedEvent.startsWith('order.')) {
      const prepared = await enrichZidOrder(data, storeIdStr, resolvedWorkspaceId, normalizedEvent, isLegacyDelivery)
      if ('errorMessage' in prepared) {
        result.records.push({
          mappingId: '',
          mappingName: 'zid_order_enrichment',
          model: 'sale.order',
          status: 'failed',
          message: prepared.errorMessage,
        })
        result.processed += 1
        result.failed += 1
        return result
      }
      data = prepared.data
    }
  } else if (syncPlatform === 'salla') {
    data = await prepareSallaWebhookData(data, storeIdStr, normalizedEvent, isLegacyDelivery)
  }

  // 1. Find all field_mappings matching this store + event
  if (!isProduct) {
    console.info(`[SyncEngine] Querying field_mappings...`)
  }
  let mappingQuery = supabaseAdmin
    .from('field_mappings')
    .select('*')
    .is('erp_destination_retired_at', null)
    .or('store_id.eq.' + storeIdStr + ',merchant_id.eq.' + storeIdStr)
  // حصر الصفوف بمساحة التسليم نفسها. بدون هذا السطر تكفي صفوفة field_mappings
  // قديمة في مساحة أخرى تحمل نفس merchant id أن تخطف المزامنة كاملة: المسار
  // المضبوط يستعير من `existingMappings[0]` إعداداتها واتصال Odoo الخاص بها
  // (2026-10-18: تصنيفات متجر Salla تابعت إعدادات مساحة أخرى القديمة بينما
  // إعدادات صاحب المتجر لا تُقرأ أصلاً — والزد لا يظهر لأن لا صفوفة تطابقه).
  if (resolvedWorkspaceId) mappingQuery = mappingQuery.eq('workspace_id', resolvedWorkspaceId)
  const { data: mappingRows, error: mappingErr } = await mappingQuery

  if (!isProduct) {
    console.info(`[SyncEngine] field_mappings query: rows=${mappingRows?.length ?? 0} error=${mappingErr?.message ?? 'none'}`)
  }

  if (mappingErr) {
    console.error('[SyncEngine] Failed to fetch field_mappings:', JSON.stringify(mappingErr))
    return result
  }

  // Filter in memory by action: either matching normalizedEvent or original event,
  // and ensuring the sync direction includes 'store_to_erp' (default is 'store_to_erp')
  const filteredRows = (mappingRows || []).filter((row) => {
    const actionMatches = row.action === normalizedEvent || row.action === event
    if (!actionMatches) return false
    const direction = row.sync_direction || 'store_to_erp'
    return direction.split(',').map((s: string) => s.trim()).includes('store_to_erp')
  })

  // ── 1a. Standard Mapping FIRST (always when enabled) ────
  // الترتيب المطلوب: الستاندرد أولاً لو مفعّل، ثم الكاستوم.
  // كان السلوك السابق exclusive: لو وُجد field_mapping واحد للحدث،
  // تخطّى الـ preset تماماً ولم يسجّل الستاندرد. الآن يعمل الاثنان
  // بالترتيب: preset الستاندرد (مع حارس isEntityOperationAllowed داخله)
  // ثم كل field_mappings المطابقة. لو الستاندرد معطّل/محظور يرجع
  // processFixedMappingFallback null فلا يضيف شيئاً ويكمل الكاستوم فقط.
  const platform: 'zid' | 'salla' | 'shopify' = platformHint ?? (
    normalizedEvent.includes('shopify') ? 'shopify'
    : normalizedEvent.includes('salla') ? 'salla'
    : 'zid'
  )
  const presetKey = derivePresetKey(normalizedEvent, platform)

  if (presetKey) {
    const presetRecord = await processFixedMappingFallback(
      presetKey, event, storeIdStr, data, platform, mappingRows as FieldMappingRow[] | null,
      resolvedWorkspaceId
    )
    if (presetRecord) {
      result.records.push(presetRecord)
      result.processed += 1
      result[presetRecord.status] += 1
      if (presetRecord.status === 'failed' && !isQueueExecution) {
        try {
          const { enqueueFailedSync } = await import('@/lib/sync-queue')
          enqueueFailedSync({
            workspaceId: resolvedWorkspaceId || mappingRows?.[0]?.workspace_id || '',
            storeId: storeIdStr,
            event,
            platform: platformHint || 'zid',
            payload: data,
            errorMessage: presetRecord.message || '',
          }).catch(() => {})
        } catch { /* ignore */ }
      }
      await notifySyncForRecord(
        resolvedWorkspaceId || mappingRows?.[0]?.workspace_id,
        presetRecord,
        event,
        presetRecord.mappingName,
        presetRecord.mappingId,
        presetRecord.model,
        storeIdStr,
        presetRecord.message,
        data,
        queueItemId ? `queue:${queueItemId}` : null
      )
    }
  }

  if (filteredRows.length === 0) {
    console.info(`[SyncEngine] ===== processWebhookEvent END (standard mapping only, total=${result.processed}) =====`)
    return result
  }

  // ── 1b. Field mappings (when user-defined mappings exist) ─────────────────
  if (!isProduct) {
    console.info(`[SyncEngine] Found ${filteredRows.length} field_mapping(s) to process`)
  }

  for (const row of filteredRows as FieldMappingRow[]) {
    const record = await processSingleMapping(row, event, storeIdStr, data, 'automatic', undefined, platformHint)
    result.records.push(record)
    result.processed += 1
    result[record.status] += 1
    // Enqueue failed operations for retry
    if (record.status === 'failed' && (row.workspace_id || resolvedWorkspaceId) && !isQueueExecution) {
      try {
        const { enqueueFailedSync } = await import('@/lib/sync-queue')
        enqueueFailedSync({
          workspaceId: row.workspace_id || resolvedWorkspaceId || '',
          storeId: storeIdStr,
          event,
          platform: platformHint || 'zid',
          payload: data,
          errorMessage: record.message || '',
        }).catch(() => {})
      } catch { /* ignore queue errors */ }
    }
    await notifySyncForRecord(
      row.workspace_id || resolvedWorkspaceId,
      record,
      event,
      record.mappingName,
      record.mappingId,
      record.model,
      storeIdStr,
      record.message,
      data,
      queueItemId ? `queue:${queueItemId}` : null
    )
  }
  if (!isProduct) {
    console.info(
      `[SyncEngine] Summary: processed=${result.processed} success=${result.success} skipped=${result.skipped} failed=${result.failed}`
    )
    console.info(`[SyncEngine] ===== processWebhookEvent END =====`)
  }
  return result
}
