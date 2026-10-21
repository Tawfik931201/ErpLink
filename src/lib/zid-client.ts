/**
 * Zid API Client — built from the official Zid OpenAPI Specification.
 *
 * Authentication:
 *   Every request requires TWO headers (for the Manager/third-party flow):
 *     - Authorization    : Partner-level app token (static, issued by Zid to the app)
 *     - X-Manager-Token  : Per-store OAuth access token (obtained via OAuth 2.0 flow)
 *
 *   Products endpoints also accept:
 *     - Access-Token     : OAuth access token (newer alternative to X-Manager-Token)
 *     - Store-Id         : Numeric store ID (required on product endpoints)
 *     - Role             : "Manager"
 *
 *   Optional:
 *     - Accept-Language  : "en" | "ar" | "all-languages"  (default: "en")
 *     - Currency         : ISO 4217 code e.g. "SAR"
 *
 * Base URL: https://api.zid.sa/
 */
import axios from 'axios'

import { checkImpersonationWriteBlock } from './auth'

// ─── Constants ────────────────────────────────────────────────────────────────

export const ZID_BASE_URL = 'https://api.zid.sa'


// ─── Types ────────────────────────────────────────────────────────────────────

/** Header credentials needed to call the Zid Manager API */
export interface ZidCredentials {
  /** Partner Authorization token (app-level, static) */
  authorization: string
  /** Per-store OAuth access token (X-Manager-Token) */
  managerToken: string
  /** Numeric store ID — required for product endpoints */
  storeId?: string | number
  /** Language preference */
  language?: 'en' | 'ar' | 'all-languages'
}

/** OAuth token response from Zid */
export interface ZidOAuthTokenResponse {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
  scope: string
  /** Partner-level app token returned by Zid during OAuth — the permanent Authorization header */
  Authorization?: string
  authorization?: string
}

// ─── Product types (from OAS) ─────────────────────────────────────────────────

export interface ZidLocalizedString {
  ar: string
  en: string
}

export interface ZidProductImage {
  id: string
  url: string
  thumbnail?: string
  is_main?: boolean
}

export interface ZidProductWeight {
  value: number | null
  unit: string
}

export interface ZidProductSeo {
  title?: ZidLocalizedString
  description?: ZidLocalizedString
}

export interface ZidPurchaseRestrictions {
  min_quantity_per_cart: number | null
  max_quantity_per_cart: number | null
  availability_period_start: string | null
  availability_period_end: string | null
  sale_price_period_start: string | null
  sale_price_period_end: string | null
}

export interface ZidProduct {
  id: string                          // UUID
  sku: string
  barcode: string
  parent_id: string | null
  name: ZidLocalizedString
  slug: string
  price: number
  sale_price: number | null
  formatted_price: string
  formatted_sale_price: string | null
  currency: string
  currency_symbol: string
  short_description: ZidLocalizedString
  product_class: 'standalone' | 'voucher' | 'grouped_product' | 'downloadable' | 'dynamic_bundle'
  structure: 'standalone' | 'parent' | 'child'
  is_draft: boolean
  is_infinite: boolean
  quantity: number | null
  weight: ZidProductWeight
  keywords: string[]
  requires_shipping: boolean
  is_taxable: boolean
  images: ZidProductImage[]
  attributes: unknown[]
  categories: unknown[]
  has_options: boolean
  has_fields: boolean
  display_order: number
  html_url: string
  seo: ZidProductSeo | null
  store_id: number
  purchase_restrictions: ZidPurchaseRestrictions
  created_at: string
  updated_at: string
}

export interface ZidProductListResponse {
  total_products_count: number
  normal_products_count: number
  voucher_products_count: number
  grouped_products_count: number
  downloadable_products_count: number
  next: string | null
  previous: string | null
  count: number
  results: ZidProduct[]
}

// ─── Product list params (from OAS query params) ──────────────────────────────

export interface ZidProductListParams {
  page?: number
  page_size?: number
  product_class?: 'voucher' | 'grouped_product' | 'downloadable' | 'dynamic_bundle'
  is_published?: boolean
  quantity?: number
  quantity__gte?: number
  quantity__lte?: number
  categories?: number
  search?: string
  ordering?: 'created_at' | 'updated_at'
  in_stock?: boolean
  price?: number
  price__gt?: number
  price__lt?: number
  extended?: boolean
  id__in?: string[]
  barcode?: string
  structure?: 'standalone' | 'parent' | 'child'
  is_infinite?: boolean
  deleted?: boolean
}

// ─── Order types ──────────────────────────────────────────────────────────────

export type ZidOrderStatus =
  | 'new'
  | 'preparing'
  | 'ready'
  | 'indelivery'
  | 'delivered'
  | 'canceled'
  | 'reversed'
  | 'partially_reversed'
  | 'reverse_in_progress'

export type ZidPaymentMethod =
  | 'zid_cod'
  | 'zid_bank_transfer'
  | 'zid_cop'
  | 'zid_credit_card'

export type ZidPaymentStatus = 'pending' | 'paid' | 'refunded' | 'voided'

export interface ZidOrderListParams {
  page: number
  per_page: number
  payload_type?: 'simple' | 'tiny' | 'pos' | 'print' | 'print_summary' | 'default'
  order_status?: ZidOrderStatus
  payment_method?: ZidPaymentMethod
  payment_status?: ZidPaymentStatus
  customer_id?: number
  date_from?: string        // ISO 8601
  date_to?: string          // ISO 8601
  date_attribute?: 'created_at' | 'updated_at'
  sort_by?: 'asc' | 'desc'
  order_by?: 'created_at'
  search_term?: string
  order_id?: string
  customer_type?: 'individual' | 'business'
  sku?: string
}

// ─── Customer types ───────────────────────────────────────────────────────────

export interface ZidCustomerListParams {
  page?: number
  per_page?: number
  after?: string             // cursor-based pagination
  type?: 'individual' | 'business'
  gender?: 'male' | 'female'
  search_term?: string
  telephone?: string
  date_from?: string
  date_to?: string
  order_by?: string
  sort_by?: 'asc' | 'desc'
}

export interface ZidCreateCustomerBody {
  type: 'individual' | 'business'
  name: string
  mobile: string              // e.g. "966500000004"
  email?: string
  gender?: 'male' | 'female'
  business_name?: string      // required if type = 'business'
  tax_number?: string         // required if type = 'business'
  commercial_registration?: string
}

// ─── Webhook types ────────────────────────────────────────────────────────────

export type ZidWebhookEvent =
  | 'order.create'
  | 'order.created'
  | 'order.status.update'
  | 'order.updated'
  | 'order.cancelled'
  | 'order.delivered'
  | 'order.payment_status.update'
  | 'order.tag'
  | 'product.create'
  | 'product.created'
  | 'product.update'
  | 'product.updated'
  | 'product.delete'
  | 'product.deleted'
  | 'product.publish'
  | 'product.published'
  | 'product.stock.create'
  | 'product.stock.update'
  | 'product.stock.delete'
  | 'location.create'
  | 'location.update'
  | 'location.delete'
  | 'location.shipping_zone.attach'
  | 'location.shipping_zone.detach'
  | 'abandoned_cart.created'
  | 'abandoned_cart.completed'
  | 'category.create'
  | 'category.delete'
  | 'category.update'
  | 'customer.create'
  | 'customer.created'
  | 'customer.login'
  | 'customer.update'
  | 'customer.merchant.update'
  | string

export interface ZidCreateWebhookBody {
  event: ZidWebhookEvent
  url: string
  secret?: string
}

// ─── Stock / Location types ───────────────────────────────────────────────────

export interface ZidStockUpdateBody {
  available_quantity: number
  is_infinite?: boolean
}

// ─── Axios instance ───────────────────────────────────────────────────────────

export const zidClient = axios.create({
  baseURL: ZID_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30_000,
})

// Block any write requests to Zid API when impersonating
zidClient.interceptors.request.use(async (config) => {
  const method = config.method?.toUpperCase() || 'GET'
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    await checkImpersonationWriteBlock('Zid API')
  }
  return config
})


// ─── Header builder ───────────────────────────────────────────────────────────

/**
 * Build the required headers for Zid Manager API calls.
 * Combines the partner Authorization token and the per-store X-Manager-Token.
 */
export function buildZidHeaders(creds: ZidCredentials): Record<string, string> {
  let authHeader = creds.authorization
  if (authHeader && !authHeader.startsWith('Bearer ')) {
    authHeader = `Bearer ${authHeader}`
  }

  const headers: Record<string, string> = {
    Authorization: authHeader,
    'X-Manager-Token': creds.managerToken,
    'Accept-Language': creds.language ?? 'en',
  }
  if (creds.storeId !== undefined) {
    headers['Store-Id'] = String(creds.storeId)
    headers['Role'] = 'Manager'
    // Newer product endpoints use Access-Token header instead of X-Manager-Token
    headers['Access-Token'] = creds.managerToken
  }
  return headers
}

// ─── ZidAPI — typed endpoint wrappers ────────────────────────────────────────

export const ZidAPI = {
  // ── Account / Store info ─────────────────────────────────────────────────

  account: {
    /** GET /v1/managers/account/me — authenticated user profile */
    me: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/account/me', { headers: buildZidHeaders(creds) }),

    /** GET /v1/managers/account/store — store core details */
    store: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/account/store', { headers: buildZidHeaders(creds) }),

    /** GET /v1/managers/account/store/localization */
    localization: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/account/store/localization', { headers: buildZidHeaders(creds) }),
  },

  // ── Products  ─────────────────────────────────────────────────────────────
  // Base: GET/PATCH /v1/products/
  // Note: requires Store-Id, Access-Token, Role: Manager headers

  products: {
    /** GET /v1/products/ — list products with full filtering */
    list: (creds: ZidCredentials, params?: ZidProductListParams) =>
      zidClient.get<ZidProductListResponse>('/v1/products/', {
        headers: buildZidHeaders(creds),
        params,
      }),

    /** GET /v1/products/{product_id}/ */
    get: (creds: ZidCredentials, productId: string) =>
      zidClient.get<{ product: ZidProduct }>(`/v1/products/${productId}/`, {
        headers: buildZidHeaders(creds),
      }),

    /** POST /v1/products/ — create product */
    create: (creds: ZidCredentials, data: any) =>
      zidClient.post('/v1/products/', { product_class: 'standalone', ...data }, {
        headers: buildZidHeaders(creds),
      }),

    /** PATCH /v1/products/{product_id}/ — update product */
    update: (creds: ZidCredentials, productId: string, data: Partial<ZidProduct>) =>
      zidClient.patch(`/v1/products/${productId}/`, data, {
        headers: buildZidHeaders(creds),
      }),

    /** DELETE /v1/products/{product_id}/ */
    delete: (creds: ZidCredentials, productId: string) =>
      zidClient.delete(`/v1/products/${productId}/`, {
        headers: buildZidHeaders(creds),
      }),

    /** PATCH /v1/products/ — bulk update products */
    bulkUpdate: (creds: ZidCredentials, data: unknown) =>
      zidClient.patch('/v1/products/', data, { headers: buildZidHeaders(creds) }),

    /** POST /v1/products/ — create downloadable product */
    createDownloadable: (
      creds: ZidCredentials,
      data: { name: ZidLocalizedString; price: number; is_draft?: boolean }
    ) =>
      zidClient.post('/v1/products/', { ...data, product_class: 'downloadable' }, {
        headers: buildZidHeaders(creds),
      }),

    // Product images
    images: {
      list: (creds: ZidCredentials, productId: string) =>
        zidClient.get(`/v1/products/${productId}/images/`, { headers: buildZidHeaders(creds) }),

      delete: (creds: ZidCredentials, productId: string, imageId: string) =>
        zidClient.delete(`/v1/products/${productId}/images/${imageId}/`, {
          headers: buildZidHeaders(creds),
        }),
    },

    // Stock management
    stocks: {
      list: (creds: ZidCredentials, productId: string) =>
        zidClient.get(`/v1/products/${productId}/stocks/`, { headers: buildZidHeaders(creds) }),

      get: (creds: ZidCredentials, productId: string, stockId: string) =>
        zidClient.get(`/v1/products/${productId}/stocks/${stockId}/`, {
          headers: buildZidHeaders(creds),
        }),

      update: (creds: ZidCredentials, productId: string, stockId: string, data: ZidStockUpdateBody) =>
        zidClient.patch(`/v1/products/${productId}/stocks/${stockId}/`, data, {
          headers: buildZidHeaders(creds),
        }),

      bulkUpdate: (creds: ZidCredentials, productId: string, data: unknown) =>
        zidClient.patch(`/v1/products/${productId}/stocks/`, data, {
          headers: buildZidHeaders(creds),
        }),
    },
  },

  // ── Orders  ───────────────────────────────────────────────────────────────

  orders: {
    /** GET /v1/managers/store/orders */
    list: (creds: ZidCredentials, params: ZidOrderListParams) =>
      zidClient.get('/v1/managers/store/orders', {
        headers: buildZidHeaders(creds),
        params,
      }),

    /** GET /v1/managers/store/orders/{order-id}/view */
    get: (creds: ZidCredentials, orderId: string) =>
      zidClient.get(`/v1/managers/store/orders/${orderId}/view`, {
        headers: buildZidHeaders(creds),
      }),

    /** POST /v1/managers/store/orders/{order-id}/change-order-status */
    changeStatus: (
      creds: ZidCredentials,
      orderId: string,
      status: ZidOrderStatus
    ) =>
      zidClient.post(
        `/v1/managers/store/orders/${orderId}/change-order-status`,
        { status },
        { headers: buildZidHeaders(creds) }
      ),

    /** POST /v1/managers/store/orders/{order_Id}/add-order-comment */
    addComment: (creds: ZidCredentials, orderId: string, comment: string) =>
      zidClient.post(
        `/v1/managers/store/orders/${orderId}/add-order-comment`,
        { comment },
        { headers: buildZidHeaders(creds) }
      ),

    /** GET /v1/managers/store/orders/custom-statuses */
    customStatuses: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/store/orders/custom-statuses', {
        headers: buildZidHeaders(creds),
      }),

    /** GET /v1/managers/store/abandoned-carts */
    abandonedCarts: (creds: ZidCredentials, params?: { page?: number; per_page?: number }) =>
      zidClient.get('/v1/managers/store/abandoned-carts', {
        headers: buildZidHeaders(creds),
        params,
      }),
  },

  // ── Customers  ────────────────────────────────────────────────────────────

  customers: {
    /** GET /v1/managers/store/customers */
    list: (creds: ZidCredentials, params?: ZidCustomerListParams) =>
      zidClient.get('/v1/managers/store/customers', {
        headers: buildZidHeaders(creds),
        params,
      }),

    /** GET /v1/managers/store/customers/{customer_id} */
    get: (creds: ZidCredentials, customerId: string | number) =>
      zidClient.get(`/v1/managers/store/customers/${customerId}`, {
        headers: buildZidHeaders(creds),
      }),

    /** GET /v1/managers/store/customers/{customerId}/profile */
    profile: (creds: ZidCredentials, customerId: string | number) =>
      zidClient.get(`/v1/managers/store/customers/${customerId}/profile`, {
        headers: buildZidHeaders(creds),
      }),

    /** POST /v1/managers/store/customers — add customer (multipart/form-data) */
    create: (creds: ZidCredentials, data: ZidCreateCustomerBody) => {
      const form = new FormData()
      Object.entries(data).forEach(([k, v]) => { if (v !== undefined) form.append(k, v) })
      return zidClient.post('/v1/managers/store/customers', form, {
        headers: { ...buildZidHeaders(creds), 'Content-Type': 'multipart/form-data' },
      })
    },

    /** PUT /v1/managers/store/customers/{customerId} — update customer */
    update: (creds: ZidCredentials, customerId: string | number, data: Partial<ZidCreateCustomerBody>) =>
      zidClient.put(`/v1/managers/store/customers/${customerId}`, data, {
        headers: buildZidHeaders(creds),
      }),

    /** DELETE /v1/managers/store/customers/{customer_id} */
    delete: (creds: ZidCredentials, customerId: string | number) =>
      zidClient.delete(`/v1/managers/store/customers/${customerId}`, {
        headers: buildZidHeaders(creds),
      }),

    /** GET /v1/managers/store/customers/by-phone/{customerPhone} */
    findByPhone: (creds: ZidCredentials, phone: string) =>
      zidClient.get(`/v1/managers/store/customers/by-phone/${phone}`, {
        headers: buildZidHeaders(creds),
      }),
  },

  // ── Categories  ───────────────────────────────────────────────────────────

  categories: {
    list: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/store/categories', { headers: buildZidHeaders(creds) }),

    get: (creds: ZidCredentials, categoryId: string | number) =>
      zidClient.get(`/v1/managers/store/categories/${categoryId}/view`, {
        headers: buildZidHeaders(creds),
      }),

    create: (creds: ZidCredentials, data: unknown) =>
      zidClient.post('/v1/managers/store/categories/add', data, {
        headers: buildZidHeaders(creds),
      }),

    update: (creds: ZidCredentials, categoryId: string | number, data: unknown) =>
      zidClient.post(`/v1/managers/store/categories/${categoryId}/update`, data, {
        headers: buildZidHeaders(creds),
      }),
  },

  // ── Webhooks  ─────────────────────────────────────────────────────────────

  webhooks: {
    /** GET /v1/managers/webhooks */
    list: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/webhooks', { headers: buildZidHeaders(creds) }),

    /** POST /v1/managers/webhooks */
    create: (creds: ZidCredentials, data: ZidCreateWebhookBody) =>
      zidClient.post('/v1/managers/webhooks', data, { headers: buildZidHeaders(creds) }),

    /** DELETE /v1/managers/webhooks */
    delete: (creds: ZidCredentials, webhookId?: string) =>
      zidClient.delete('/v1/managers/webhooks', {
        headers: buildZidHeaders(creds),
        data: webhookId ? { id: webhookId } : undefined,
      }),

    /** DELETE /v1/managers/webhooks/subscribers/{subscriber} */
    deleteBySubscriber: (creds: ZidCredentials, subscriber: string) =>
      zidClient.delete(`/v1/managers/webhooks/subscribers/${subscriber}`, {
        headers: buildZidHeaders(creds),
      }),

    /** GET /v1/managers/webhooks/health-summary */
    healthSummary: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/webhooks/health-summary', { headers: buildZidHeaders(creds) }),

    /** GET /v1/managers/webhooks/broken */
    broken: (creds: ZidCredentials) =>
      zidClient.get('/v1/managers/webhooks/broken', { headers: buildZidHeaders(creds) }),

    /** POST /v1/managers/webhooks/broken/recover */
    recoverBroken: (creds: ZidCredentials) =>
      zidClient.post('/v1/managers/webhooks/broken/recover', {}, { headers: buildZidHeaders(creds) }),
  },

  // ── Locations / Inventory  ────────────────────────────────────────────────

  locations: {
    /** GET /v1/locations/ */
    list: (creds: ZidCredentials) =>
      zidClient.get('/v1/locations/', { headers: buildZidHeaders(creds) }),

    /** GET /v1/locations/{location_id}/ */
    get: (creds: ZidCredentials, locationId: string) =>
      zidClient.get(`/v1/locations/${locationId}/`, { headers: buildZidHeaders(creds) }),

    /** POST /v1/locations/ — create location */
    create: (creds: ZidCredentials, data: unknown) =>
      zidClient.post('/v1/locations/', data, { headers: buildZidHeaders(creds) }),

    /** PATCH /v1/locations/{location_id}/ — update location */
    update: (creds: ZidCredentials, locationId: string, data: unknown) =>
      zidClient.patch(`/v1/locations/${locationId}/`, data, { headers: buildZidHeaders(creds) }),

    /** POST /v1/locations/{location_id}/stock-update/ — update product stock at location */
    stockUpdate: (creds: ZidCredentials, locationId: string, data: unknown) =>
      zidClient.post(`/v1/locations/${locationId}/stock-update/`, data, {
        headers: buildZidHeaders(creds),
      }),
  },

  // ── Store Subscription (App Market) ──────────────────────────────────────

  market: {
    /** GET /v1/market/app/subscription — check app subscription status */
    subscription: (creds: ZidCredentials) =>
      zidClient.get('/v1/market/app/subscription', { headers: buildZidHeaders(creds) }),
  },

  // ── Reverse / Refund / Waybill (documented endpoints) ────────────────────
  // Only the endpoints that exist are wrapped here. Verified against
  // docs.zid.sa → "Reverse Orders" (2026-10-21): the folder publishes
  // Create Reverse Order (POST /v1/managers/store/reverse-orders), Waybill,
  // Reasons (add/list), Calculate Reverse Totals, Create Refund, Upload Bank
  // Transfer Receipt, Update Return Products and Order Details – View for
  // Return. **There is no GET list of a store's reverse orders**, so nothing
  // polls one; Zid returns are detected from the order status and quantified
  // with view-for-return instead.
  returns: {
    /**
     * GET /v1/managers/store/orders/{order-id}/view-for-return
     *
     * The documented source of "what can still come back": products with
     * `quantity` = remaining returnable (original − previous returns), and
     * `products: []` once everything has been returned. Totals are
     * recalculated for the remaining items.
     */
    viewForReturn: (creds: ZidCredentials, orderId: string) =>
      zidClient.get(`/v1/managers/store/orders/${orderId}/view-for-return`, {
        headers: buildZidHeaders(creds),
      }),
  },


  // ── Store metadata (auto-fill mapping dropdowns) ─────────────────────────
  storeMeta: {
    /**
     * GET payment methods — used to auto-fill the analytic-distribution payment
     * rules in the Standard Mapping orders tab.
     * Returns [] on failure (non-fatal).
     */
    paymentMethods: async (creds: ZidCredentials): Promise<any[]> => {
      try {
        const res = await zidClient.get('/v1/managers/store/payment-methods', {
          headers: buildZidHeaders(creds),
        })
        const data = res.data?.data ?? res.data?.results ?? res.data ?? []
        return Array.isArray(data) ? data : []
      } catch (err: any) {
        console.warn('[ZidAPI] payment-methods fetch failed (non-fatal):', err?.response?.data || err?.message)
        return []
      }
    },

    /**
     * GET order custom statuses — returns main statuses with optional sub-statuses.
     * Returns [] on failure (non-fatal).
     */
    orderStatuses: async (creds: ZidCredentials): Promise<any[]> => {
      try {
        const res = await zidClient.get('/v1/managers/store/orders/custom-statuses', {
          headers: buildZidHeaders(creds),
        })
        const data = res.data?.payload ?? res.data?.data ?? res.data?.results ?? res.data ?? []
        return Array.isArray(data) ? data : []
      } catch (err: any) {
        console.warn('[ZidAPI] order-statuses fetch failed (non-fatal):', err?.response?.data || err?.message)
        return []
      }
    },
  },
}
