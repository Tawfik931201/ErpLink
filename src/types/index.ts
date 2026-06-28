/**
 * Shared TypeScript types for the ZidLink SaaS application.
 */
// ─── Prisma replaced by Supabase ───────────────────────────────────────────────────

// ─── API Response wrapper ────────────────────────────────────────────────────
export interface ApiResponse<T> {
  data: T
  success: boolean
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

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

// ─── Odoo Types ───────────────────────────────────────────────────────────────
export interface OdooProduct {
  id: number
  name: string
  default_code: string   // SKU
  list_price: number
  standard_price: number
  qty_available: number
  active: boolean
  description?: string
  categ_id: [number, string]
}

export interface OdooSaleOrder {
  id: number
  name: string           // e.g. S00001
  state: OdooSaleOrderState
  partner_id: [number, string]
  amount_untaxed: number
  amount_tax: number
  amount_total: number
  date_order: string
  order_line: number[]
}

export type OdooSaleOrderState =
  | 'draft'
  | 'sent'
  | 'sale'
  | 'done'
  | 'cancel'

export interface OdooPartner {
  id: number
  name: string
  email: string
  phone?: string
  mobile?: string
  street?: string
  city?: string
  country_id: [number, string]
}

// ─── Sync Types ───────────────────────────────────────────────────────────────
export interface SyncConfig {
  syncProducts: boolean
  syncOrders: boolean
  syncCustomers: boolean
  syncInventory: boolean
  cronExpression: string   // e.g. "*/30 * * * *"
  direction: 'ZID_TO_ODOO' | 'ODOO_TO_ZID' | 'BIDIRECTIONAL'
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export interface DashboardStats {
  totalSyncs: number
  successfulSyncs: number
  failedSyncs: number
  lastSyncAt: string | null
  productsCount: number
  ordersCount: number
  customersCount: number
}
