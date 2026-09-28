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
