/**
 * Odoo-side field catalogue, shared by every store platform.
 *
 *
 * Moved here from src/lib/mapping-constants.ts (split stage 3). The data is
 * unchanged; only its location moved. `mapping-constants.ts` still re-exports
 * every name, so no import elsewhere had to change.
 */
export const ODOO_MODELS = [
  { id: 'product.template', name: 'Product (product.template)', desc: 'بيانات المنتجات والسلع' },
  { id: 'product.category', name: 'Category (product.category)', desc: 'بيانات التصنيفات' },
  { id: 'res.partner', name: 'Customer (res.partner)', desc: 'بيانات العملاء والعناوين' },
  { id: 'sale.order', name: 'Order (sale.order)', desc: 'بيانات طلبات المبيعات وبنودها' },
]
export const ODOO_FIELDS: Record<string, { value: string; label: string; desc?: string; type: string; relation?: string }[]> = {
  'product.template': [
    { value: 'name', label: 'Name (الاسم)', desc: 'name', type: 'char' },
    { value: 'list_price', label: 'Sales Price (سعر البيع)', desc: 'list_price', type: 'float' },
    { value: 'standard_price', label: 'Cost Price (التكلفة)', desc: 'standard_price', type: 'float' },
    { value: 'qty_available', label: 'Quantity On Hand (الكمية المتوفرة)', desc: 'qty_available', type: 'float' },
    { value: 'barcode', label: 'Barcode (الباركود)', desc: 'barcode', type: 'char' },
    { value: 'weight', label: 'Weight (الوزن)', desc: 'weight', type: 'float' },
    { value: 'volume', label: 'Volume (الحجم)', desc: 'volume', type: 'float' },
    { value: 'length', label: 'Length (الطول)', desc: 'length', type: 'float' },
    { value: 'width', label: 'Width (العرض)', desc: 'width', type: 'float' },
    { value: 'height', label: 'Height (الارتفاع)', desc: 'height', type: 'float' },
    { value: 'description_sale', label: 'Sales Description (الوصف)', desc: 'description_sale', type: 'text' },
    { value: 'default_code', label: 'Internal Reference / SKU (الرمز المرجعي)', desc: 'default_code', type: 'char' },
    { value: 'product_variant_ids', label: 'Product Variants (خيارات المنتجات)', desc: 'product_variant_ids', type: 'one2many', relation: 'product.product' },
    { value: 'categ_id', label: 'Product Category (الفئة)', desc: 'categ_id', type: 'many2one', relation: 'product.category' },
    { value: 'attribute_line_ids', label: 'Product Attributes (الخصائص)', desc: 'attribute_line_ids', type: 'one2many', relation: 'product.attribute.line' },
    { value: 'detailed_type', label: 'Product Type (نوع المنتج)', desc: 'detailed_type', type: 'selection' },
    { value: 'type', label: 'Product Type (نوع المنتج البديل)', desc: 'type', type: 'selection' },
    { value: 'image_1920', label: 'Product Image (صورة المنتج)', desc: 'image_1920', type: 'binary' },
  ],
  'product.product': [
    { value: 'name', label: 'Variant Name (اسم البديل)', desc: 'name', type: 'char' },
    { value: 'default_code', label: 'SKU (الرمز المرجعي البديل)', desc: 'default_code', type: 'char' },
    { value: 'barcode', label: 'Barcode (الباركود البديل)', desc: 'barcode', type: 'char' },
    { value: 'lst_price', label: 'Variant Price (سعر البديل)', desc: 'lst_price', type: 'float' },
  ],
  'res.partner': [
    { value: 'name', label: 'Name (الاسم)', desc: 'name', type: 'char' },
    { value: 'email', label: 'Email (البريد الإلكتروني)', desc: 'email', type: 'char' },
    { value: 'phone', label: 'Phone (الهاتف)', desc: 'phone', type: 'char' },
    { value: 'mobile', label: 'Mobile (الجوال)', desc: 'mobile', type: 'char' },
    { value: 'street', label: 'Street Address (الشارع)', desc: 'street', type: 'char' },
    { value: 'city', label: 'City (المدينة)', desc: 'city', type: 'char' },
    { value: 'zip', label: 'Zip Code (الرمز البريدي)', desc: 'zip', type: 'char' },
    { value: 'vat', label: 'Tax ID / VAT (الرقم الضريبي)', desc: 'vat', type: 'char' },
    { value: 'company_registry', label: 'Company Registry (السجل التجاري)', desc: 'company_registry', type: 'char' },
    { value: 'company_name', label: 'Company Name (اسم الشركة)', desc: 'company_name', type: 'char' },
    { value: 'child_ids', label: 'Contact Addresses (العناوين الفرعية)', desc: 'child_ids', type: 'one2many', relation: 'res.partner' },
  ],
  'sale.order': [
    { value: 'name', label: 'Order Reference (رقم الطلب)', desc: 'name', type: 'char' },
    { value: 'partner_id', label: 'Customer (العميل)', desc: 'partner_id', type: 'many2one', relation: 'res.partner' },
    { value: 'amount_total', label: 'Total Amount (الإجمالي)', desc: 'amount_total', type: 'monetary' },
    { value: 'date_order', label: 'Order Date (تاريخ الطلب)', desc: 'date_order', type: 'datetime' },
    { value: 'state', label: 'Status (الحالة)', desc: 'state', type: 'selection' },
    { value: 'order_line', label: 'Order Lines (بنود الطلب)', desc: 'order_line', type: 'one2many', relation: 'sale.order.line' },
  ],
  'sale.order.line': [
    { value: 'product_id', label: 'Product (المنتج)', desc: 'product_id', type: 'many2one', relation: 'product.product' },
    { value: 'product_uom_qty', label: 'Quantity (الكمية)', desc: 'product_uom_qty', type: 'float' },
    { value: 'price_unit', label: 'Unit Price (سعر الوحدة)', desc: 'price_unit', type: 'float' },
    { value: 'discount', label: 'Discount % (نسبة الخصم)', desc: 'discount', type: 'float' },
    { value: 'price_subtotal', label: 'Subtotal (الإجمالي الفرعي)', desc: 'price_subtotal', type: 'monetary' },
  ]
}

export const STORE_VARIANT_FIELDS: Record<string, Array<{ value: string; label: string; labelAr: string }>> = {
  zid: [
    { value: 'id', label: 'Variant ID', labelAr: 'معرف البديل' },
    { value: 'product_id', label: 'Product ID', labelAr: 'معرف المنتج' },
    { value: 'sku', label: 'Variant SKU', labelAr: 'الرمز المرجعي للبديل' },
    { value: 'barcode', label: 'Variant Barcode', labelAr: 'الباركود للبديل' },
    { value: 'price', label: 'Variant Price', labelAr: 'سعر البديل' },
    { value: 'sale_price', label: 'Variant Sale Price', labelAr: 'سعر بيع البديل' },
    { value: 'quantity', label: 'Variant Quantity', labelAr: 'كمية البديل' },
    { value: 'weight.value', label: 'Variant Weight', labelAr: 'وزن البديل' }
  ],
  salla: [
    { value: 'id', label: 'Variant ID', labelAr: 'معرف البديل' },
    { value: 'product_id', label: 'Product ID', labelAr: 'معرف المنتج' },
    { value: 'sku', label: 'Variant SKU', labelAr: 'الرمز المرجعي للبديل' },
    { value: 'barcode', label: 'Variant Barcode', labelAr: 'الباركود للبديل' },
    { value: 'price.amount', label: 'Variant Price', labelAr: 'سعر البديل' },
    { value: 'sale_price.amount', label: 'Variant Sale Price', labelAr: 'سعر بيع البديل' },
    { value: 'stock_quantity', label: 'Variant Stock Quantity', labelAr: 'كمية البديل' }
  ],
  shopify: [
    { value: 'id', label: 'Variant ID', labelAr: 'معرف البديل' },
    { value: 'product_id', label: 'Product ID', labelAr: 'معرف المنتج' },
    { value: 'sku', label: 'Variant SKU', labelAr: 'الرمز المرجعي للبديل' },
    { value: 'barcode', label: 'Variant Barcode', labelAr: 'الباركود للبديل' },
    { value: 'price', label: 'Variant Price', labelAr: 'سعر البديل' },
    { value: 'compare_at_price', label: 'Compare At Price', labelAr: 'سعر مقارنة البديل' },
    { value: 'inventory_quantity', label: 'Inventory Quantity', labelAr: 'كمية مخزون البديل' },
    { value: 'weight', label: 'Weight', labelAr: 'الوزن' }
  ]
}

// Comprehensive data for Zid Webhook Events organized by category/group
