export interface ZidStatusOption {
  key: string
  label: string
}

export const DEFAULT_ZID_ORDER_STATUSES: ZidStatusOption[] = [
  { key: 'new', label: 'طلب جديد (New)' },
  { key: 'preparing', label: 'جاري التجهيز (Preparing)' },
  { key: 'ready', label: 'جاهز للاستلام (Ready)' },
  { key: 'indelivery', label: 'جاري التوصيل (In Delivery)' },
  { key: 'delivered', label: 'تم التوصيل (Delivered)' },
  { key: 'canceled', label: 'ملغي (Canceled)' },
  { key: 'cancelled', label: 'ملغي (Cancelled)' },
  { key: 'reversed', label: 'مرتجع (Reversed)' },
  { key: 'partially_reversed', label: 'مرتجع جزئياً (Partially Reversed)' },
  { key: 'reverse_in_progress', label: 'جاري الإرجاع (Reverse in Progress)' },
]

/**
 * Salla counterpart. Keys are Salla's canonical order status slugs — kept
 * identical to SMART_DEFAULT_ORDER_STATUSES.salla in auto-bootstrap.ts (a
 * test pins the agreement, since a drift would write statuses Odoo can never
 * match and silently break the custom-field selection).
 */
export const DEFAULT_SALLA_ORDER_STATUSES: ZidStatusOption[] = [
  { key: 'under_review', label: 'بإنتظار المراجعة (Under Review)' },
  { key: 'pending_payment', label: 'بانتظار الدفع (Pending Payment)' },
  { key: 'confirmed', label: 'مؤكد (Confirmed)' },
  { key: 'preparing', label: 'جاري التجهيز (Preparing)' },
  { key: 'ready', label: 'جاهز (Ready)' },
  { key: 'shipped', label: 'تم الشحن (Shipped)' },
  { key: 'in_transit', label: 'في الطريق (In Transit)' },
  { key: 'delivered', label: 'تم التوصيل (Delivered)' },
  { key: 'completed', label: 'تم التنفيذ (Completed)' },
  { key: 'on_hold', label: 'موقوف (On Hold)' },
  { key: 'partial', label: 'جزئي (Partial)' },
  { key: 'canceled', label: 'ملغي (Canceled)' },
  { key: 'refunded', label: 'مسترجع (Refunded)' },
]

export type OrderStatusPlatform = 'zid' | 'salla'

/** Per-platform defaults for the sale.order custom status field. */
export function defaultOrderStatusFieldName(platform: OrderStatusPlatform): string {
  return platform === 'salla' ? 'x_salla_order_status' : 'x_zid_order_status'
}

export function defaultOrderStatusFieldLabel(platform: OrderStatusPlatform): string {
  return platform === 'salla' ? 'حالة الطلب في سلة' : 'حالة الطلب في زد'
}

export function defaultOrderStatusOptions(platform: OrderStatusPlatform): ZidStatusOption[] {
  return platform === 'salla' ? DEFAULT_SALLA_ORDER_STATUSES : DEFAULT_ZID_ORDER_STATUSES
}
