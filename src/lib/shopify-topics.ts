/**
 * SHOPIFY_TOPIC_CATALOG — مصدر الحقيقة الوحيد لاشتراكات Shopify.
 *
 * لماذا ملف واحد؟
 * كانت المواضيع مبعثرة في 4 أماكن تخرج عن المزامنة بسهولة:
 *   1. shopify.app.toml [webhooks.subscriptions] (تثبيت CLI)
 *   2. src/lib/shopify-client.ts SHOPIFY_CORE_TOPICS (تسجيل تلقائي عند OAuth)
 *   3. src/app/(app)/app/connect-store/shopify-sync-settings.tsx (مفاتيح UI)
 *   4. src/lib/mapping-constants.ts SHOPIFY_EVENTS (مركز المطابقة)
 * أي موضوع يُضاف هنا يجب إضافته في الأماكن الأربعة أعلاه.
 * هذا الملف هو المرجع — استورده بدل تكرار القوائم يدوياً حيث أمكن.
 *
 * نسخة API: SHOPIFY_API_VERSION في shopify-client.ts (env SHOPIFY_API_VERSION،
 * افتراضي 2025-07) — يجب أن تطابق shopify.app.toml [webhooks].api_version.
 * لا تكتب نسخة يدوياً في أي URL.
 *
 * الصلاحيات والبيانات المحمية (مهم لمراجعة App Store):
 * - التثبيت الأدنى (read-only): read_products, read_orders, read_inventory,
 *   read_locations — يكفي للكتالوج والطلبات الأخيرة (آخر 60 يوماً فقط).
 * - قراءة الطلبات الأقدم من 60 يوماً تتطلب scope إضافي: read_all_orders.
 *   يُطلب من Partner Dashboard (App setup → API access) وليس من TOML فقط،
 *   ويحتاج موافقة Shopify. بدونه تُرجع orders/* آخر 60 يوماً فقط.
 * - مواضيع customers/* تتطلب read_customers (في optional_scopes) وهي
 *   "protected customer data": تحتاج موافقة + وصف استخدام في مراجعة التطبيق.
 *   بدونها تفشل اشتراكات customers/* بصمت (403). راجع:
 *   https://shopify.dev/docs/apps/launch/protected-customer-data
 * - الكتابة العكسية (ERP → المتجر) تتطلب write_products / write_orders /
 *   write_customers — تُطلب كـ optional_scopes فقط عند تفعيل المزامنة العكسية.
 */

/** المواضيع الأساسية المسجلة تلقائياً عند الربط (كتالوج كامل + كل الطلبات + العملاء). */
export const SHOPIFY_CORE_TOPICS = [
  // Products (إنشاء/تحديث/حذف)
  'products/create',
  'products/update',
  'products/delete',
  // Collections = الكاتيجوري (إنشاء/تحديث/حذف)
  'collections/create',
  'collections/update',
  'collections/delete',
  // Orders — كل شيء يخص الطلبات
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'orders/paid',
  'orders/partially_fulfilled',
  'orders/edited',
  'orders/delete',
  // Customers (تتطلب read_customers — بدون موافقة Shopify تفشل بصمت 403)
  'customers/create',
  'customers/update',
  'customers/delete',
] as const

/** موضوع تنظيف التوكن — يُسجل دائماً ولا يظهر كمفتاح مزامنة. */
export const SHOPIFY_SYSTEM_TOPICS = ['app/uninstalled'] as const

/**
 * مواضيع GDPR الإلزامية لمتجر Shopify App Store.
 * يجب الرد عليها بـ 200 خلال 5 ثوانٍ (انظر route.ts للويبهوك).
 * لا تُزامَن مع ERP — فقط audit log.
 */
export const SHOPIFY_GDPR_TOPICS = [
  'customers/data_request',
  'customers/redact',
  'shop/redact',
] as const

/** إشعار تغيّر الصلاحيات — يُحدَّث عمود scopes في shopify_tokens. */
export const SHOPIFY_SCOPES_UPDATE_TOPIC = 'app/scopes_update' as const

/** كل مواضيع النظام التي لا تظهر كمفاتيح مزامنة (تنظيف + امتثال). */
export const SHOPIFY_ALL_SYSTEM_TOPICS = [
  'app/uninstalled',
  'customers/data_request',
  'customers/redact',
  'shop/redact',
  'app/scopes_update',
] as const

/**
 * مواضيع التحديث التي قد تصل خارج الترتيب في الدفعات الكبيرة.
 * يُتجاهل الحدث إذا كان updated_at أقدم من آخر حدث مُعالَج/مُنتظر
 * لنفس الكيان (انظر route.ts للويبهوك).
 */
export const SHOPIFY_UPDATE_TOPICS: ReadonlySet<string> = new Set([
  'products/update',
  'orders/updated',
  'orders/edited',
  'customers/update',
  'collections/update',
  'carts/update',
  'checkouts/update',
  'inventory_levels/update',
  'inventory_items/update',
])

/** هل هذا الموضوع من نوع "تحديث" ويحتاج فحص حداثة؟ */
export function isShopifyUpdateTopic(topic: string): boolean {
  return SHOPIFY_UPDATE_TOPICS.has(topic as never)
}

/** الكتالوج الكامل المعروض في الإعدادات المتقدمة (مفاتيح sync-settings). */
export const SHOPIFY_TOPIC_CATALOG = [
  // Orders
  'orders/create',
  'orders/updated',
  'orders/cancelled',
  'orders/fulfilled',
  'orders/paid',
  'orders/partially_fulfilled',
  'orders/edited',
  'orders/delete',
  // Products
  'products/create',
  'products/update',
  'products/delete',
  // Customers (تتطلب read_customers — تُطلب كـ optional scope)
  'customers/create',
  'customers/update',
  'customers/delete',
  // Collections
  'collections/create',
  'collections/update',
  'collections/delete',
  // Carts / Checkouts
  'carts/create',
  'carts/update',
  'checkouts/create',
  'checkouts/update',
  'checkouts/delete',
  // Inventory
  'inventory_levels/update',
  'inventory_items/create',
  'inventory_items/update',
  'inventory_items/delete',
  // Refunds
  'refunds/create',
] as const

export type ShopifyTopic = (typeof SHOPIFY_TOPIC_CATALOG)[number]
