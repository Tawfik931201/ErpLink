/**
 * Sync Retry Queue
 *
 * When a sync operation fails, it is added to the queue.
 * The queue is processed on the next webhook arrival.
 */

import { createClient } from '@supabase/supabase-js'

import { processWebhookEvent } from './sync-engine'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Enqueue a failed sync for retry.
 */
export async function enqueueFailedSync(params: {
  workspaceId: string
  storeId: string
  event: string
  platform: string
  payload: Record<string, unknown>
  errorMessage: string
}) {
  const backoffMinutes = Math.pow(2, 0) * 5 // first retry in 5 minutes

  await supabase.from('sync_queue').insert({
    workspace_id: params.workspaceId,
    store_id: params.storeId,
    event: params.event,
    platform: params.platform,
    payload: params.payload,
    error_message: params.errorMessage?.slice(0, 500),
    retry_count: 0,
    max_retries: 3,
    next_retry_at: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
  })
}

/**
 * Enqueue a webhook event for immediate background processing.
 */
export async function enqueueWebhookEvent(params: {
  workspaceId: string
  storeId: string
  event: string
  platform: string
  payload: Record<string, unknown>
}) {
  await supabase.from('sync_queue').insert({
    workspace_id: params.workspaceId,
    store_id: params.storeId,
    event: params.event,
    platform: params.platform,
    payload: params.payload,
    retry_count: 0,
    max_retries: 3,
    next_retry_at: new Date().toISOString(), // Process immediately
  })
  console.info(`[SyncQueue] 📥 Enqueued webhook event "${params.event}" for store ${params.storeId}`)
}

/**
 * Process all queued syncs that are due for retry or background processing.
 * Called automatically at the end of each webhook handler or by the background runner.
 */
export async function processSyncQueue(maxItems = 5) {
  const { data: items } = await supabase
    .from('sync_queue')
    .select('*')
    .lte('next_retry_at', new Date().toISOString())
    .lt('retry_count', 3)
    .order('next_retry_at', { ascending: true })
    .limit(maxItems)

  if (!items || items.length === 0) return

  for (const item of items) {
    try {
      // Pass isQueueExecution = true as 5th argument to prevent duplicate enqueueing
      const result = await processWebhookEvent(
        item.event,
        item.store_id,
        item.payload as Record<string, unknown>,
        item.platform as any,
        true // isQueueExecution
      )

      if (result.failed === 0) {
        // Success or skipped — remove from queue
        await supabase.from('sync_queue').delete().eq('id', item.id)
        console.info(`[SyncQueue] ✅ Processed/skipped queue item ${item.id} successfully`)
      } else {
        const errorRecord = result.records.find((r: any) => r.status === 'failed')
        await incrementRetry(item, errorRecord?.message || 'Sync failed')
      }
    } catch (err: any) {
      await incrementRetry(item, err?.message)
    }
  }
}

async function incrementRetry(item: any, errorMessage?: string) {
  const newCount = (item.retry_count || 0) + 1
  const maxRetries = item.max_retries || 3

  if (newCount >= maxRetries) {
    // Exhausted retries — keep in queue for manual review but mark it
    await supabase.from('sync_queue').update({
      retry_count: newCount,
      last_error_at: new Date().toISOString(),
      next_retry_at: null, // null = exhausted, for manual review
      error_message: errorMessage || item.error_message,
    }).eq('id', item.id)
    console.warn(`[SyncQueue] ❌ Retry exhausted for queue item ${item.id}`)
  } else {
    // Exponential backoff: 5min, 10min, 20min, ...
    const backoffMinutes = Math.pow(2, newCount - 1) * 5
    await supabase.from('sync_queue').update({
      retry_count: newCount,
      last_error_at: new Date().toISOString(),
      next_retry_at: new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
      error_message: errorMessage || item.error_message,
    }).eq('id', item.id)
  }
}
