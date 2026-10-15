'use server'

import { auth } from '@clerk/nextjs/server'

import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'
import { getOrCreateDbUser as ensureDbUser } from '@/lib/users'
import type {
  DashboardStats,
  EventDistribution,
  DailyActivity,
  RecentLog,
  RecentTransfer,
} from '@/types'

async function getOrCreateDbUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  return ensureDbUser(userId)
}

const HOURS_72 = 72 * 60 * 60 * 1000
const DAYS_7 = 7 * 24 * 60 * 60 * 1000

// Dashboard reads are the hottest path in the app: the page fires 9 parallel
// server actions, each rendering for every visitor. A 45s TTL with
// single-flight dedupe means 50 users opening the dashboard together collapse
// into ONE upstream query set instead of 50. Failures are never cached (the
// key is dropped on !success) so an error never sticks to the screen.
const DASH_TTL_MS = 45 * 1000

// ─── Aggregated Stats ──────────────────────────────────────────────────────────

async function fetchDashboardStats(ws: string): Promise<{
  success: boolean
  stats?: DashboardStats
  error?: string
}> {
  try {
    const [
      successCount,
      failedCount,
      skippedCount,
      lastLog,
      activeTransfers,
      recentTransfersAgg,
      mappingsCount,
      zidToken,
      odooConn,
      telegramChats,
    ] = await Promise.all([
      supabase
        .from('sync_logs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('status', 'success')
        .gt('created_at', new Date(Date.now() - HOURS_72).toISOString()),

      supabase
        .from('sync_logs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('status', 'failed')
        .gt('created_at', new Date(Date.now() - DAYS_7).toISOString()),

      supabase
        .from('sync_logs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('status', 'skipped')
        .gt('created_at', new Date(Date.now() - DAYS_7).toISOString()),

      supabase
        .from('sync_logs')
        .select('created_at')
        .eq('workspace_id', ws)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from('data_transfers')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .in('status', ['pending', 'running']),

      supabase
        .from('data_transfers')
        .select('records_created, records_failed')
        .eq('workspace_id', ws)
        .gt('created_at', new Date(Date.now() - DAYS_7).toISOString())
        .order('created_at', { ascending: false })
        .limit(500),

      supabase
        .from('field_mappings')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws),

      supabase
        .from('merchant_tokens')
        .select('merchant_id')
        .eq('workspace_id', ws)
        .limit(1)
        .maybeSingle(),

      supabase
        .from('erp_connections')
        .select('id')
        .eq('workspace_id', ws)
        .maybeSingle(),

      supabase
        .from('telegram_bot_chats')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ws)
        .eq('enabled', true),
    ])

    const success = successCount.count ?? 0
    const failed = failedCount.count ?? 0
    const skipped = skippedCount.count ?? 0
    const total = success + failed + skipped
    const successRate = total > 0 ? (success / total) * 100 : 0

    const transfers = recentTransfersAgg.data ?? []
    const totalRecordsCreated = transfers.reduce(
      (sum, t) => sum + (t.records_created || 0),
      0
    )
    const totalRecordsFailed = transfers.reduce(
      (sum, t) => sum + (t.records_failed || 0),
      0
    )

    return {
      success: true,
      stats: {
        totalSyncs: total,
        successfulSyncs: success,
        failedSyncs: failed,
        skippedSyncs: skipped,
        successRate,
        lastSyncAt: lastLog.data?.created_at ?? null,
        activeTransfers: activeTransfers.count ?? 0,
        totalTransfers: transfers.length,
        totalRecordsCreated,
        totalRecordsFailed,
        activeMappings: mappingsCount.count ?? 0,
        isZidConnected: !!zidToken.data,
        isOdooConnected: !!odooConn.data,
        telegramBotsCount: telegramChats.count ?? 0,
      },
    }
  } catch (error: any) {
    console.error('[Dashboard Action] getDashboardStats failed:', error)
    return { success: false, error: error.message || 'Failed to fetch stats' }
  }
}

export async function getDashboardStats(): Promise<{
  success: boolean
  stats?: DashboardStats
  error?: string
}> {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, stats: emptyStats() }
    }
    const key = `dash:stats:${user.active_workspace_id}`
    const res = await ttlCache.get(key, DASH_TTL_MS, () =>
      fetchDashboardStats(user.active_workspace_id as string)
    )
    if (!res.success) ttlCache.delete(key)
    return res
  } catch (error: any) {
    console.error('[Dashboard Action] getDashboardStats failed:', error)
    return { success: false, error: error.message || 'Failed to fetch stats' }
  }
}

// ─── Event Distribution (Pie chart data) ───────────────────────────────────────

async function fetchEventDistribution(ws: string): Promise<{
  success: boolean
  distribution?: EventDistribution[]
  error?: string
}> {
  try {
    // Supabase JS client does not support GROUP BY directly, so we fetch logs
    // for the retention window (72h) up to a hard cap and aggregate in JS.
    // The cap keeps a busy workspace from pushing megabytes per dashboard view.
    const { data: logs, error } = await supabase
      .from('sync_logs')
      .select('event')
      .eq('workspace_id', ws)
      .gt('created_at', new Date(Date.now() - HOURS_72).toISOString())
      .order('created_at', { ascending: false })
      .limit(2000)

    if (error) throw new Error('Failed to query events: ' + error.message)

    const counts = new Map<string, number>()
    for (const row of logs ?? []) {
      const ev = row.event || 'unknown'
      counts.set(ev, (counts.get(ev) ?? 0) + 1)
    }

    const distribution: EventDistribution[] = Array.from(counts.entries())
      .map(([event, count]) => ({ event, count }))
      .sort((a, b) => b.count - a.count)

    return { success: true, distribution }
  } catch (error: any) {
    console.error('[Dashboard Action] getEventDistribution failed:', error)
    return { success: false, error: error.message }
  }
}

export async function getEventDistribution(): Promise<{
  success: boolean
  distribution?: EventDistribution[]
  error?: string
}> {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, distribution: [] }
    }
    const key = `dash:events:${user.active_workspace_id}`
    const res = await ttlCache.get(key, DASH_TTL_MS, () =>
      fetchEventDistribution(user.active_workspace_id as string)
    )
    if (!res.success) ttlCache.delete(key)
    return res
  } catch (error: any) {
    console.error('[Dashboard Action] getEventDistribution failed:', error)
    return { success: false, error: error.message }
  }
}

// ─── Daily Activity (Area chart data) ──────────────────────────────────────────

async function fetchDailyActivity(ws: string, safeDays: number): Promise<{
  success: boolean
  activity?: DailyActivity[]
  error?: string
}> {
  try {
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString()

    const { data: logs, error } = await supabase
      .from('sync_logs')
      .select('status, created_at')
      .eq('workspace_id', ws)
      .gt('created_at', since)
      .order('created_at', { ascending: true })
      .limit(5000)

    if (error) throw new Error('Failed to query daily activity: ' + error.message)

    // Build date-keyed buckets
    const buckets = new Map<string, DailyActivity>()

    // Initialize buckets for the full range (fill missing days with zeros)
    for (let i = safeDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const dateKey = d.toISOString().slice(0, 10)
      buckets.set(dateKey, {
        date: dateKey,
        success: 0,
        failed: 0,
        skipped: 0,
      })
    }

    for (const log of logs ?? []) {
      const dateKey = (log.created_at as string).slice(0, 10)
      const bucket = buckets.get(dateKey)
      if (!bucket) continue
      if (log.status === 'success') bucket.success++
      else if (log.status === 'failed') bucket.failed++
      else if (log.status === 'skipped') bucket.skipped++
    }

    const activity = Array.from(buckets.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    )

    return { success: true, activity }
  } catch (error: any) {
    console.error('[Dashboard Action] getDailyActivity failed:', error)
    return { success: false, error: error.message }
  }
}

export async function getDailyActivity(days = 7): Promise<{
  success: boolean
  activity?: DailyActivity[]
  error?: string
}> {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, activity: [] }
    }
    // Clamp before keying so getDailyActivity(7) and getDailyActivity(700)
    // don't each burn a cache slot (and a query) for the same chart.
    const safeDays = Math.min(31, Math.max(1, Math.floor(days) || 7))
    const key = `dash:activity:${user.active_workspace_id}:${safeDays}`
    const res = await ttlCache.get(key, DASH_TTL_MS, () =>
      fetchDailyActivity(user.active_workspace_id as string, safeDays)
    )
    if (!res.success) ttlCache.delete(key)
    return res
  } catch (error: any) {
    console.error('[Dashboard Action] getDailyActivity failed:', error)
    return { success: false, error: error.message }
  }
}

// ─── Recent Logs ───────────────────────────────────────────────────────────────

export async function getRecentLogs(limit = 10): Promise<{
  success: boolean
  logs?: RecentLog[]
  error?: string
}> {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, logs: [] }
    }
    const ws = user.active_workspace_id

    // Cap client-supplied limits: server actions accept arbitrary args, and
    // an unbounded limit here turns one click into a full-table scan.
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 10))
    const { data: logs, error } = await supabase
      .from('sync_logs')
      .select(
        'id, event, status, created_at, error_message, zid_entity_id, trigger_type, field_mappings(name)'
      )
      .eq('workspace_id', ws)
      .order('created_at', { ascending: false })
      .limit(safeLimit)

    if (error) throw new Error('Failed to query recent logs: ' + error.message)

    const recent: RecentLog[] = (logs ?? []).map((row: any) => ({
      id: row.id,
      event: row.event,
      status: row.status,
      mapping_name: row.field_mappings?.name ?? null,
      created_at: row.created_at,
      error_message: row.error_message,
      zid_entity_id: row.zid_entity_id,
      trigger_type: row.trigger_type,
    }))

    return { success: true, logs: recent }
  } catch (error: any) {
    console.error('[Dashboard Action] getRecentLogs failed:', error)
    return { success: false, error: error.message }
  }
}

// ─── Recent Transfers ──────────────────────────────────────────────────────────

export async function getRecentTransfers(limit = 5): Promise<{
  success: boolean
  transfers?: RecentTransfer[]
  error?: string
}> {
  try {
    const user = await getOrCreateDbUser()
    if (!user.active_workspace_id) {
      return { success: true, transfers: [] }
    }
    const ws = user.active_workspace_id

    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit) || 5))
    const { data: transfers, error } = await supabase
      .from('data_transfers')
      .select(
        'id, name, data_type, status, records_fetched, records_created, records_failed, created_at'
      )
      .eq('workspace_id', ws)
      .order('created_at', { ascending: false })
      .limit(safeLimit)

    if (error)
      throw new Error('Failed to query recent transfers: ' + error.message)

    return { success: true, transfers: transfers ?? [] }
  } catch (error: any) {
    console.error('[Dashboard Action] getRecentTransfers failed:', error)
    return { success: false, error: error.message }
  }
}

// ─── Helper: empty stats default ───────────────────────────────────────────────

function emptyStats(): DashboardStats {
  return {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    skippedSyncs: 0,
    successRate: 0,
    lastSyncAt: null,
    activeTransfers: 0,
    totalTransfers: 0,
    totalRecordsCreated: 0,
    totalRecordsFailed: 0,
    activeMappings: 0,
    isZidConnected: false,
    isOdooConnected: false,
    telegramBotsCount: 0,
  }
}
