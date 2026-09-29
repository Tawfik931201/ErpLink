/**
 * Shared TypeScript types for the ErpLink SaaS application.
 */
// ─── Prisma replaced by Supabase ───────────────────────────────────────────────────

// ─── Zid Types (re-exported from the typed client — single source of truth) ───
export type {
  ZidCredentials,
  ZidOAuthTokenResponse,
  ZidLocalizedString,
  ZidProduct,
  ZidProductImage,
  ZidProductWeight,
  ZidProductSeo,
  ZidPurchaseRestrictions,
  ZidProductListResponse,
  ZidProductListParams,
  ZidOrderStatus,
  ZidOrderListParams,
  ZidPaymentMethod,
  ZidPaymentStatus,
  ZidCustomerListParams,
  ZidCreateCustomerBody,
  ZidWebhookEvent,
  ZidCreateWebhookBody,
  ZidStockUpdateBody,
} from '@/lib/zid-client'

// ─── Dashboard Stats (App Activity Monitoring) ────────────────────────────────
//
// The dashboard reflects *app activity* (sync runs, transfer jobs, mapping
// counts) rather than business data (sales / products) because the platform is
// a connector: data transits through webhooks and is NOT persisted long-term.
//
// Retention in Supabase:
//   - sync_logs.success  : purged after 72 hours
//   - sync_logs.* other   : purged after 7 days
//   - data_transfers.completed : purged after 72 hours
//   - data_transfers.* other    : purged after 7 days

export interface DashboardStats {
  totalSyncs: number
  successfulSyncs: number
  failedSyncs: number
  skippedSyncs: number
  successRate: number
  lastSyncAt: string | null

  activeTransfers: number
  totalTransfers: number
  totalRecordsCreated: number
  totalRecordsFailed: number

  activeMappings: number

  isZidConnected: boolean
  isOdooConnected: boolean
  telegramBotsCount: number
}

export interface EventDistribution {
  event: string
  count: number
}

export interface DailyActivity {
  date: string
  success: number
  failed: number
  skipped: number
}

export interface RecentLog {
  id: string
  event: string
  status: 'success' | 'failed' | 'skipped' | 'processing'
  mapping_name: string | null
  created_at: string
  error_message: string | null
  zid_entity_id: string | null
  trigger_type: string | null
}

export interface RecentTransfer {
  id: string
  name: string
  data_type: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  records_fetched: number
  records_created: number
  records_failed: number
  created_at: string
}
