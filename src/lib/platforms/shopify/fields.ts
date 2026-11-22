/**
 * Shopify event list and per-model field catalogue.
 *
 * SHOPIFY_EVENTS is NOT the same set as SHOPIFY_TOPIC_CATALOG in
 * src/lib/shopify-topics.ts, and it is not what shopify.app.toml
 * subscribes to. It is the mapping-centre table: it carries a targetModel
 * per event, and it offers events the app never subscribes to (such as
 * products/delete). Do not merge the three lists — that changes what the
 * app subscribes to and what the mapping UI offers.
 *
 * Moved here from src/lib/mapping-constants.ts (split stage 3). The data is
 * unchanged; only its location moved. `mapping-constants.ts` still re-exports
 * every name, so no import elsewhere had to change.
 */
export const SHOPIFY_EVENTS = [
  // Products
  { id: 'products/create', name: 'Product Created (إنشاء منتج)', targetModel: 'product.template', group: 'Products (المنتجات)' },
  { id: 'products/update', name: 'Product Updated (تحديث منتج)', targetModel: 'product.template', group: 'Products (المنتجات)' },
  { id: 'products/delete', name: 'Product Deleted (حذف منتج)', targetModel: 'product.template', group: 'Products (المنتجات)' },
  // Orders
  { id: 'orders/create', name: 'Order Created (إنشاء طلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'orders/updated', name: 'Order Updated (تحديث طلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'orders/cancelled', name: 'Order Cancelled (إلغاء طلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'orders/fulfilled', name: 'Order Fulfilled (تنفيذ طلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'orders/paid', name: 'Order Paid (دفع الطلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'orders/partially_fulfilled', name: 'Order Partially Fulfilled (تنفيذ جزئي)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'orders/edited', name: 'Order Edited (تعديل الطلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'orders/delete', name: 'Order Deleted / Cancelled (حذف / إلغاء الطلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  // Customers
  { id: 'customers/create', name: 'Customer Registered (تسجيل عميل جديد)', targetModel: 'res.partner', group: 'Customers (العملاء)' },
  { id: 'customers/update', name: 'Customer Profile Updated (تحديث بيانات عميل)', targetModel: 'res.partner', group: 'Customers (العملاء)' },
  { id: 'customers/delete', name: 'Customer Deleted (حذف عميل)', targetModel: 'res.partner', group: 'Customers (العملاء)' },
  // Collections/Categories
  { id: 'collections/create', name: 'Collection Created (إنشاء تصنيف)', targetModel: 'product.category', group: 'Categories (التصنيفات)' },
  { id: 'collections/update', name: 'Collection Updated (تحديث تصنيف)', targetModel: 'product.category', group: 'Categories (التصنيفات)' },
  { id: 'collections/delete', name: 'Collection Deleted (حذف تصنيف)', targetModel: 'product.category', group: 'Categories (التصنيفات)' },
]


export const SHOPIFY_FIELDS: Record<string, { value: string; label: string; type: string }[]> = {
  'products/create': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'title', label: 'Product Title (title)', type: 'string' },
    { value: 'body_html', label: 'Body HTML / Description (body_html)', type: 'string' },
    { value: 'vendor', label: 'Vendor (vendor)', type: 'string' },
    { value: 'product_type', label: 'Product Type (product_type)', type: 'string' },
    { value: 'handle', label: 'Handle / SEO Slug (handle)', type: 'string' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'published_scope', label: 'Published Scope (published_scope)', type: 'string' },
    { value: 'tags', label: 'Tags (tags)', type: 'string' },
    
    // First Variant details
    { value: 'variants.0.price', label: 'Variant Price (variants.0.price)', type: 'number' },
    { value: 'variants.0.compare_at_price', label: 'Compare At Price (variants.0.compare_at_price)', type: 'number' },
    { value: 'variants.0.sku', label: 'Variant SKU (variants.0.sku)', type: 'string' },
    { value: 'variants.0.barcode', label: 'Variant Barcode (variants.0.barcode)', type: 'string' },
    { value: 'variants.0.inventory_quantity', label: 'Inventory Quantity (variants.0.inventory_quantity)', type: 'number' },
    { value: 'variants.0.weight', label: 'Weight (variants.0.weight)', type: 'number' },
    { value: 'variants.0.weight_unit', label: 'Weight Unit (variants.0.weight_unit)', type: 'string' },
    { value: 'variants.0.requires_shipping', label: 'First Variant Requires Shipping (variants.0.requires_shipping)', type: 'boolean' },
    
    { value: 'images', label: 'Images Array / First Image (images)', type: 'array' },
    { value: 'options', label: 'Options/Variants (options)', type: 'array' },
    
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' },
  ],
  'products/update': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'title', label: 'Product Title (title)', type: 'string' },
    { value: 'body_html', label: 'Body HTML / Description (body_html)', type: 'string' },
    { value: 'vendor', label: 'Vendor (vendor)', type: 'string' },
    { value: 'product_type', label: 'Product Type (product_type)', type: 'string' },
    { value: 'handle', label: 'Handle / SEO Slug (handle)', type: 'string' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'tags', label: 'Tags (tags)', type: 'string' },
    { value: 'variants.0.price', label: 'Variant Price (variants.0.price)', type: 'number' },
    { value: 'variants.0.sku', label: 'Variant SKU (variants.0.sku)', type: 'string' },
    { value: 'variants.0.barcode', label: 'Variant Barcode (variants.0.barcode)', type: 'string' },
    { value: 'variants.0.inventory_quantity', label: 'Inventory Quantity (variants.0.inventory_quantity)', type: 'number' },
    { value: 'variants.0.requires_shipping', label: 'First Variant Requires Shipping (variants.0.requires_shipping)', type: 'boolean' },
    { value: 'images', label: 'Images Array / First Image (images)', type: 'array' },
    { value: 'options', label: 'Options/Variants (options)', type: 'array' },
  ],
  'products/delete': [
    { value: 'id', label: 'Product ID (id)', type: 'string' }
  ],
  'customers/create': [
    { value: 'id', label: 'Customer ID (id)', type: 'string' },
    { value: 'email', label: 'Email (email)', type: 'string' },
    { value: 'first_name', label: 'First Name (first_name)', type: 'string' },
    { value: 'last_name', label: 'Last Name (last_name)', type: 'string' },
    { value: 'phone', label: 'Phone Number (phone)', type: 'string' },
    { value: 'state', label: 'State (state)', type: 'string' },
    { value: 'currency', label: 'Currency (currency)', type: 'string' },
    { value: 'verified_email', label: 'Verified Email (verified_email)', type: 'boolean' },
    { value: 'addresses.0.city', label: 'Address City (addresses.0.city)', type: 'string' },
    { value: 'addresses.0.country', label: 'Address Country (addresses.0.country)', type: 'string' },
    { value: 'addresses.0.zip', label: 'Address Zip Code (addresses.0.zip)', type: 'string' },
    { value: 'addresses.0.address1', label: 'Address Line 1 (addresses.0.address1)', type: 'string' },
  ],
  // Mirrors customers/create: an update payload carries the full customer object,
  // so the same address fields must be mappable here.
  'customers/update': [
    { value: 'id', label: 'Customer ID (id)', type: 'string' },
    { value: 'email', label: 'Email (email)', type: 'string' },
    { value: 'first_name', label: 'First Name (first_name)', type: 'string' },
    { value: 'last_name', label: 'Last Name (last_name)', type: 'string' },
    { value: 'phone', label: 'Phone Number (phone)', type: 'string' },
    { value: 'state', label: 'State (state)', type: 'string' },
    { value: 'currency', label: 'Currency (currency)', type: 'string' },
    { value: 'verified_email', label: 'Verified Email (verified_email)', type: 'boolean' },
    { value: 'addresses.0.city', label: 'Address City (addresses.0.city)', type: 'string' },
    { value: 'addresses.0.country', label: 'Address Country (addresses.0.country)', type: 'string' },
    { value: 'addresses.0.zip', label: 'Address Zip Code (addresses.0.zip)', type: 'string' },
    { value: 'addresses.0.address1', label: 'Address Line 1 (addresses.0.address1)', type: 'string' },
  ],
  // Delete payload is id-only ({id, tax_exemptions, admin_graphql_api_id}).
  'customers/delete': [
    { value: 'id', label: 'Customer ID (id)', type: 'string' }
  ],
  'orders/create': [
    // Reserved: NOT a real webhook field. When picked as the match field, the
    // engine resolves it from odoo_entity_links (the Odoo id saved at create
    // time, scoped per store). Must stay identical to STORED_ODOO_ID_FIELD in
    // src/lib/entity-links.ts — pinned by tests/unit/entity-links.test.ts.
    { value: '__odoo_record_id', label: 'Saved Odoo ID — auto (__odoo_record_id)', type: 'number' },
    { value: 'id', label: 'Order ID (id)', type: 'string' },
    { value: 'name', label: 'Order Name / Number (name)', type: 'string' },
    { value: 'email', label: 'Customer Email (email)', type: 'string' },
    { value: 'total_price', label: 'Total Price (total_price)', type: 'number' },
    { value: 'subtotal_price', label: 'Subtotal Price (subtotal_price)', type: 'number' },
    { value: 'total_tax', label: 'Total Tax (total_tax)', type: 'number' },
    { value: 'currency', label: 'Currency (currency)', type: 'string' },
    { value: 'financial_status', label: 'Financial / Payment Status (financial_status)', type: 'string' },
    { value: 'fulfillment_status', label: 'Fulfillment Status (fulfillment_status)', type: 'string' },
    { value: 'tags', label: 'Tags (tags)', type: 'string' },
    { value: 'customer.id', label: 'Customer ID (customer.id)', type: 'string' },
    { value: 'customer.email', label: 'Customer Email (customer.email)', type: 'string' },
    { value: 'customer.first_name', label: 'Customer First Name (customer.first_name)', type: 'string' },
    { value: 'customer.last_name', label: 'Customer Last Name (customer.last_name)', type: 'string' },
    { value: 'shipping_address.city', label: 'Shipping City (shipping_address.city)', type: 'string' },
    { value: 'shipping_address.address1', label: 'Shipping Address (shipping_address.address1)', type: 'string' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
  ],
  'orders/updated': [
    // Same reserved field as orders/create (see above).
    { value: '__odoo_record_id', label: 'Saved Odoo ID — auto (__odoo_record_id)', type: 'number' },
    { value: 'id', label: 'Order ID (id)', type: 'string' },
    { value: 'name', label: 'Order Name / Number (name)', type: 'string' },
    { value: 'total_price', label: 'Total Price (total_price)', type: 'number' },
    { value: 'financial_status', label: 'Financial / Payment Status (financial_status)', type: 'string' },
    { value: 'fulfillment_status', label: 'Fulfillment Status (fulfillment_status)', type: 'string' },
  ],
  'collections/create': [
    { value: 'id', label: 'Collection ID (id)', type: 'number' },
    { value: 'title', label: 'Collection Title (title)', type: 'string' },
    { value: 'body_html', label: 'Description HTML (body_html)', type: 'string' },
    { value: 'handle', label: 'Handle / SEO Slug (handle)', type: 'string' },
    { value: 'sort_order', label: 'Sort Order (sort_order)', type: 'string' },
    { value: 'published_at', label: 'Published At (published_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' },
  ],
  'collections/update': [
    { value: 'id', label: 'Collection ID (id)', type: 'number' },
    { value: 'title', label: 'Collection Title (title)', type: 'string' },
    { value: 'body_html', label: 'Description HTML (body_html)', type: 'string' },
    { value: 'handle', label: 'Handle / SEO Slug (handle)', type: 'string' },
    { value: 'sort_order', label: 'Sort Order (sort_order)', type: 'string' },
    { value: 'published_at', label: 'Published At (published_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' },
  ],
  'collections/delete': [
    { value: 'id', label: 'Collection ID (id)', type: 'number' },
  ],
  // Order line items (webhook `line_items` array). The engine reads any mapped
  // path from each item generically (resolvePath over the products / items /
  // line_items candidates), so the line `id` works here exactly like the
  // header `id` does on the order tab — for every order topic/operation.
  'sale.order.line': [
    { value: 'id', label: 'Line Item ID (id)', type: 'string' },
    { value: 'variant_id', label: 'Variant ID (variant_id)', type: 'string' },
    { value: 'product_id', label: 'Product ID (product_id)', type: 'string' },
    { value: 'title', label: 'Line Title (title)', type: 'string' },
    { value: 'variant_title', label: 'Variant Title (variant_title)', type: 'string' },
    { value: 'name', label: 'Line Name (name)', type: 'string' },
    { value: 'sku', label: 'Line SKU (sku)', type: 'string' },
    { value: 'vendor', label: 'Vendor (vendor)', type: 'string' },
    { value: 'quantity', label: 'Quantity (quantity)', type: 'number' },
    { value: 'price', label: 'Unit Price (price)', type: 'number' },
    { value: 'line_price', label: 'Line Price (line_price)', type: 'number' },
    { value: 'total_discount', label: 'Total Discount (total_discount)', type: 'number' },
    { value: 'grams', label: 'Weight Grams (grams)', type: 'number' },
    { value: 'fulfillment_status', label: 'Fulfillment Status (fulfillment_status)', type: 'string' },
  ],
}

/**
 * Shopify custom-data fields are populated by shopify/enrichment.ts.
 * They are intentionally generic: merchants can map a whole JSON snapshot or
 * address a nested path such as metafields.custom.external_code in custom
 * mappings without teaching the generic engine any Shopify-specific schema.
 */
const SHOPIFY_CUSTOM_DATA_FIELDS = [
  { value: 'metafields_json', label: 'Metafields JSON (metafields_json)', type: 'string' },
  { value: 'metafield_rows', label: 'Metafields Rows (metafield_rows)', type: 'array' },
  { value: 'metafields', label: 'Metafields Object (metafields.<namespace>.<key>)', type: 'object' },
]

for (const [topic, fields] of Object.entries(SHOPIFY_FIELDS)) {
  if (topic === 'sale.order.line' || topic.endsWith('/delete')) continue
  const existing = new Set(fields.map((field) => field.value))
  for (const field of SHOPIFY_CUSTOM_DATA_FIELDS) {
    if (!existing.has(field.value)) fields.push(field)
  }
}

// All subscribed order lifecycle topics use the same Shopify order payload
// shape. Reuse the update catalogue so Mapping Center can customize every
// topic that shopify.app.toml actually subscribes to.
for (const topic of ['orders/cancelled', 'orders/fulfilled', 'orders/paid', 'orders/partially_fulfilled', 'orders/edited', 'orders/delete']) {
  if (!SHOPIFY_FIELDS[topic]) SHOPIFY_FIELDS[topic] = [...(SHOPIFY_FIELDS['orders/updated'] || [])]
}

