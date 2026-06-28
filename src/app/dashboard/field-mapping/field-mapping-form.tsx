'use client'

import React, { useState, useEffect } from 'react'
import { 
  SlidersHorizontal, 
  Trash2, 
  Plus, 
  Check, 
  Save, 
  RotateCcw, 
  Languages,
  HelpCircle,
  ArrowRightLeft,
  Loader2,
  X
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getOdooFieldValueOptions, getOdooModelFields } from '@/app/actions/odoo'
import { saveFieldMapping } from '@/app/actions/field-mappings'
import SearchableSelect from './searchable-select'

// Fallback relations map for preview mode
const FALLBACK_RELATIONS: Record<string, Array<{ model: string; label: string; fieldName: string }>> = {
  'sale.order': [
    { model: 'sale.order.line', label: 'Order Line (sale.order.line)', fieldName: 'order_line' },
  ],
  'product.template': [
    { model: 'product.product', label: 'Product Variant (product.product)', fieldName: 'product_variant_ids' },
  ],
  'res.partner': [
    { model: 'res.partner', label: 'Contact/Address (res.partner)', fieldName: 'child_ids' },
  ]
}

// Sample fallback data for Odoo Models and their fields
const ODOO_MODELS = [
  { id: 'product.template', name: 'Product (product.template)', desc: 'بيانات المنتجات والسلع' },
  { id: 'res.partner', name: 'Customer (res.partner)', desc: 'بيانات العملاء والعناوين' },
  { id: 'sale.order', name: 'Order (sale.order)', desc: 'بيانات طلبات المبيعات وبنودها' },
]

const ODOO_FIELDS: Record<string, { value: string; label: string; desc?: string; type: string; relation?: string }[]> = {
  'product.template': [
    { value: 'name', label: 'Name (الاسم)', desc: 'name', type: 'char' },
    { value: 'list_price', label: 'Sales Price (سعر البيع)', desc: 'list_price', type: 'float' },
    { value: 'standard_price', label: 'Cost Price (التكلفة)', desc: 'standard_price', type: 'float' },
    { value: 'qty_available', label: 'Quantity On Hand (الكمية المتوفرة)', desc: 'qty_available', type: 'float' },
    { value: 'barcode', label: 'Barcode (الباركود)', desc: 'barcode', type: 'char' },
    { value: 'weight', label: 'Weight (الوزن)', desc: 'weight', type: 'float' },
    { value: 'description_sale', label: 'Sales Description (الوصف)', desc: 'description_sale', type: 'text' },
    { value: 'default_code', label: 'Internal Reference / SKU (الرمز المرجعي)', desc: 'default_code', type: 'char' },
    { value: 'product_variant_ids', label: 'Product Variants (خيارات المنتجات)', desc: 'product_variant_ids', type: 'one2many', relation: 'product.product' },
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
    { value: 'price_subtotal', label: 'Subtotal (الإجمالي الفرعي)', desc: 'price_subtotal', type: 'monetary' },
  ]
}

// Comprehensive data for Zid Webhook Events organized by category/group
export const ZID_EVENTS = [
  // Products Group
  { id: 'product.create', name: 'Product Created (إنشاء منتج)', targetModel: 'product.template', group: 'Products (المنتجات)' },
  { id: 'product.update', name: 'Product Updated (تحديث منتج)', targetModel: 'product.template', group: 'Products (المنتجات)' },
  { id: 'product.publish', name: 'Product Published (نشر منتج)', targetModel: 'product.template', group: 'Products (المنتجات)' },
  { id: 'product.delete', name: 'Product Deleted (حذف منتج)', targetModel: 'product.template', group: 'Products (المنتجات)' },

  // Orders Group
  { id: 'order.create', name: 'Order Created (إنشاء طلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.status.update', name: 'Order Status Updated (تحديث حالة الطلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.payment_status.update', name: 'Order Payment Status Updated (تحديث حالة دفع الطلب)', targetModel: 'sale.order', group: 'Orders (الطلبات)' },

  // Customers Group
  { id: 'customer.create', name: 'Customer Registered (تسجيل عميل جديد)', targetModel: 'res.partner', group: 'Customers (العملاء)' },
  { id: 'customer.update', name: 'Customer Profile Updated (تحديث بيانات عميل)', targetModel: 'res.partner', group: 'Customers (العملاء)' },

  // Categories Group
  { id: 'category.create', name: 'Category Created (إنشاء تصنيف جديد)', targetModel: 'product.category', group: 'Categories (التصنيفات)' },
  { id: 'category.update', name: 'Category Updated (تحديث تصنيف)', targetModel: 'product.category', group: 'Categories (التصنيفات)' },
  { id: 'category.delete', name: 'Category Deleted (حذف تصنيف)', targetModel: 'product.category', group: 'Categories (التصنيفات)' },

  // Carts Group
  { id: 'cart.abandoned', name: 'Cart Abandoned (سلة متروكة)', targetModel: 'sale.order', group: 'Carts (السلات المتروكة)' },
]

const ODOO_OPERATIONS = [
  { value: 'create', label: 'Create (إنشاء)' },
  { value: 'update', label: 'Update (تعديل)' },
  { value: 'delete', label: 'Delete (حذف)' },
]

const EMPTY_SELECT_OPTION = { value: '', label: 'فارغ (Clear)' }

type MappingLine = {
  id: string
  erpField: string
  zidField?: string
  staticValue?: string | string[] | number | boolean
}

const ZID_FIELDS: Record<string, { value: string; label: string; type: string }[]> = {
  'product.template': [
    // 1. Basic properties
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'product_class', label: 'Product Class (product_class)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'barcode', label: 'Barcode (barcode)', type: 'string' },
    { value: 'parent_id', label: 'Parent Product ID (parent_id)', type: 'string' },
    { value: 'slug', label: 'SEO Slug (slug)', type: 'string' },
    { value: 'html_url', label: 'HTML URL (html_url)', type: 'string' },
    { value: 'display_order', label: 'Display Order (display_order)', type: 'number' },
    { value: 'store_id', label: 'Store ID (store_id)', type: 'number' },
    { value: 'structure', label: 'Structure (structure)', type: 'string' },
    
    // 2. Names and Descriptions
    { value: 'name.ar', label: 'Product Name Arabic (name.ar)', type: 'string' },
    { value: 'name.en', label: 'Product Name English (name.en)', type: 'string' },
    { value: 'short_description.ar', label: 'Short Description Arabic (short_description.ar)', type: 'string' },
    { value: 'short_description.en', label: 'Short Description English (short_description.en)', type: 'string' },
    { value: 'description.ar', label: 'Full Description Arabic (description.ar)', type: 'string' },
    { value: 'description.en', label: 'Full Description English (description.en)', type: 'string' },

    // 3. Pricing and Cost
    { value: 'price', label: 'Price (price)', type: 'number' },
    { value: 'sale_price', label: 'Sale Price (sale_price)', type: 'number' },
    { value: 'cost', label: 'Cost Price (cost)', type: 'number' },
    { value: 'formatted_price', label: 'Formatted Price (formatted_price)', type: 'string' },
    { value: 'formatted_sale_price', label: 'Formatted Sale Price (formatted_sale_price)', type: 'string' },
    { value: 'currency', label: 'Currency (currency)', type: 'string' },
    { value: 'currency_symbol', label: 'Currency Symbol (currency_symbol)', type: 'string' },

    // 4. Inventory, Stock and Weight
    { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
    { value: 'is_infinite', label: 'Infinite Stock (is_infinite)', type: 'boolean' },
    { value: 'requires_shipping', label: 'Requires Shipping (requires_shipping)', type: 'boolean' },
    { value: 'weight.value', label: 'Weight Value (weight.value)', type: 'number' },
    { value: 'weight.unit', label: 'Weight Unit (weight.unit)', type: 'string' },

    // 5. Flags, Settings and Options
    { value: 'is_draft', label: 'Is Draft (is_draft)', type: 'boolean' },
    { value: 'is_published', label: 'Is Published (is_published)', type: 'boolean' },
    { value: 'is_taxable', label: 'Is Taxable (is_taxable)', type: 'boolean' },
    { value: 'has_options', label: 'Has Options (has_options)', type: 'boolean' },
    { value: 'has_fields', label: 'Has Custom Fields (has_fields)', type: 'boolean' },

    // 6. Metadata and Associations
    { value: 'keywords', label: 'SEO Keywords (keywords)', type: 'array' },
    { value: 'metafields', label: 'Metafields (metafields)', type: 'array' },
    { value: 'meta', label: 'Metadata (meta)', type: 'object' },
    { value: 'images', label: 'Images (images)', type: 'array' },
    { value: 'videos', label: 'Videos (videos)', type: 'array' },
    { value: 'categories', label: 'Categories (categories)', type: 'array' },
    { value: 'related_products_settings', label: 'Related Products Settings (related_products_settings)', type: 'string' },
    { value: 'related_products_title.ar', label: 'Related Products Title Arabic (related_products_title.ar)', type: 'string' },
    { value: 'related_products_title.en', label: 'Related Products Title English (related_products_title.en)', type: 'string' },
    { value: 'badge', label: 'Product Badge (badge)', type: 'object' },
    { value: 'custom_user_input_fields', label: 'Custom User Input Fields (custom_user_input_fields)', type: 'array' },
    { value: 'custom_option_fields', label: 'Custom Option Fields (custom_option_fields)', type: 'array' },
    { value: 'options', label: 'Product Options (options)', type: 'array' },
    { value: 'related_products', label: 'Related Products (related_products)', type: 'array' },
    { value: 'next_product', label: 'Next Product ID (next_product)', type: 'string' },
    { value: 'previous_product', label: 'Previous Product ID (previous_product)', type: 'string' },
    { value: 'group_products', label: 'Group Products (group_products)', type: 'string' },
    { value: 'stocks', label: 'Stock Locations (stocks)', type: 'array' },
    { value: 'sold_products_count', label: 'Sold Products Count (sold_products_count)', type: 'number' },
    { value: 'waiting_customers_count', label: 'Waiting Customers Count (waiting_customers_count)', type: 'number' },

    // 7. System Dates
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' },
  ],
  'product.delete': [
    { value: 'product_id', label: 'Product ID (product_id)', type: 'string' },
    { value: 'slug', label: 'SEO Slug (slug)', type: 'string' },
    { value: 'deleted_at', label: 'Deleted At (deleted_at)', type: 'string' },
    { value: 'event_extra_data', label: 'Event Extra Data (event_extra_data)', type: 'array' },
  ],
  'product.update': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'name.ar', label: 'Product Name Arabic (name.ar)', type: 'string' },
    { value: 'name.en', label: 'Product Name English (name.en)', type: 'string' },
    { value: 'description.ar', label: 'Product Description Arabic (description.ar)', type: 'string' },
    { value: 'description.en', label: 'Product Description English (description.en)', type: 'string' },
    { value: 'price', label: 'Price (price)', type: 'number' },
    { value: 'cost', label: 'Cost Price (cost)', type: 'number' },
    { value: 'is_draft', label: 'Is Draft (is_draft)', type: 'boolean' },
    { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
    { value: 'is_infinite', label: 'Infinite Stock (is_infinite)', type: 'boolean' },
    { value: 'weight.value', label: 'Weight Value (weight.value)', type: 'number' },
    { value: 'weight.unit', label: 'Weight Unit (weight.unit)', type: 'string' },
    { value: 'keywords', label: 'SEO Keywords (keywords)', type: 'array' },
    { value: 'requires_shipping', label: 'Requires Shipping (requires_shipping)', type: 'boolean' },
    { value: 'is_published', label: 'Is Published (is_published)', type: 'boolean' },
  ],
  'product.product': [
    { value: 'variants.id', label: 'Variant ID (variants.id)', type: 'string' },
    { value: 'variants.sku', label: 'Variant SKU (variants.sku)', type: 'string' },
    { value: 'variants.price', label: 'Variant Price (variants.price)', type: 'number' },
    { value: 'variants.barcode', label: 'Variant Barcode (variants.barcode)', type: 'string' },
    { value: 'variants.quantity', label: 'Variant Quantity (variants.quantity)', type: 'number' },
  ],
  'res.partner': [
    { value: 'id', label: 'Customer ID (id)', type: 'number' },
    { value: 'name', label: 'Full Name (name)', type: 'string' },
    { value: 'email', label: 'Email (email)', type: 'string' },
    { value: 'mobile', label: 'Mobile Number (mobile)', type: 'string' },
    { value: 'telephone', label: 'Telephone (telephone)', type: 'string' },
    { value: 'gender', label: 'Gender (gender)', type: 'string' },
    { value: 'birth_date', label: 'Birth Date (birth_date)', type: 'string' },
    { value: 'verified', label: 'Is Verified (verified)', type: 'boolean' },
    { value: 'is_active', label: 'Is Active (is_active)', type: 'boolean' },
    { value: 'is_cod_enabled', label: 'COD Enabled (is_cod_enabled)', type: 'boolean' },
    { value: 'type', label: 'Customer Type (type)', type: 'string' },
    { value: 'business_name', label: 'Business Name (business_name)', type: 'string' },
    { value: 'tax_number', label: 'Tax Number (tax_number)', type: 'string' },
    { value: 'commercial_registration', label: 'Commercial Registration (commercial_registration)', type: 'string' },
    { value: 'source', label: 'Registration Source (source)', type: 'string' },
    { value: 'points', label: 'Loyalty Points (points)', type: 'number' },
    { value: 'order_total_payments', label: 'Order Total Payments (order_total_payments)', type: 'string' },
    { value: 'last_order_date', label: 'Last Order Date (last_order_date)', type: 'string' },
    { value: 'order_counts', label: 'Order Count (order_counts)', type: 'number' },
    { value: 'nickname', label: 'Nickname (nickname)', type: 'string' },
    { value: 'city.id', label: 'City ID (city.id)', type: 'number' },
    { value: 'city.name.ar', label: 'City Name Arabic (city.name.ar)', type: 'string' },
    { value: 'city.name.en', label: 'City Name English (city.name.en)', type: 'string' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' },
  ],
  'cart.abandoned': [
    { value: 'id', label: 'Abandoned Cart ID (id)', type: 'string' },
    { value: 'store_id', label: 'Store ID (store_id)', type: 'string' },
    { value: 'session_id', label: 'Session ID (session_id)', type: 'string' },
    { value: 'url', label: 'Checkout URL (url)', type: 'string' },
    { value: 'cart_id', label: 'Internal Cart ID (cart_id)', type: 'string' },
    { value: 'order_id', label: 'Converted Order ID (order_id)', type: 'number' },
    { value: 'phase', label: 'Abandonment Phase (phase)', type: 'string' },
    { value: 'customer_id', label: 'Customer ID (customer_id)', type: 'number' },
    { value: 'customer_name', label: 'Customer Name (customer_name)', type: 'string' },
    { value: 'customer_email', label: 'Customer Email (customer_email)', type: 'string' },
    { value: 'customer_mobile', label: 'Customer Mobile (customer_mobile)', type: 'string' },
    { value: 'city_id', label: 'City ID (city_id)', type: 'number' },
    { value: 'products_count', label: 'Products Count (products_count)', type: 'number' },
    { value: 'reminders_count', label: 'Reminders Count (reminders_count)', type: 'number' },
    { value: 'cart_total', label: 'Cart Total (cart_total)', type: 'number' },
    { value: 'cart_total_string', label: 'Cart Total String (cart_total_string)', type: 'string' },
    { value: 'whatsapp_message', label: 'WhatsApp Message (whatsapp_message)', type: 'string' },
    { value: 'currency_code', label: 'Currency Code (currency_code)', type: 'string' },
    { value: 'source', label: 'Cart Source (source)', type: 'string' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' },
  ],
  'sale.order': [
    // 1. Basic details
    { value: 'id', label: 'Order ID (id)', type: 'number' },
    { value: 'code', label: 'Order Code (code)', type: 'string' },
    { value: 'store_id', label: 'Store ID (store_id)', type: 'number' },
    { value: 'store_name', label: 'Store Name (store_name)', type: 'string' },
    { value: 'order_url', label: 'Invoice URL (order_url)', type: 'string' },
    { value: 'shipping_method_code', label: 'Shipping Method Code (shipping_method_code)', type: 'string' },
    { value: 'store_url', label: 'Store URL (store_url)', type: 'string' },
    { value: 'currency_code', label: 'Currency Code (currency_code)', type: 'string' },
    { value: 'is_marketplace_order', label: 'Is Marketplace Order (is_marketplace_order)', type: 'boolean' },
    { value: 'has_different_consignee', label: 'Has Different Consignee (has_different_consignee)', type: 'boolean' },
    { value: 'is_guest_customer', label: 'Is Guest Customer (is_guest_customer)', type: 'boolean' },
    { value: 'is_gift_order', label: 'Is Gift Order (is_gift_order)', type: 'boolean' },
    
    // 2. Pricing and totals
    { value: 'order_total', label: 'Order Total (order_total)', type: 'string' },
    { value: 'order_total_string', label: 'Order Total String (order_total_string)', type: 'string' },
    { value: 'has_different_transaction_currency', label: 'Has Different Tx Currency (has_different_transaction_currency)', type: 'boolean' },
    { value: 'transaction_reference', label: 'Transaction Reference (transaction_reference)', type: 'string' },
    { value: 'transaction_amount', label: 'Transaction Amount (transaction_amount)', type: 'number' },
    { value: 'transaction_amount_string', label: 'Transaction Amount String (transaction_amount_string)', type: 'string' },
    { value: 'issue_date', label: 'Issue Date (issue_date)', type: 'string' },
    { value: 'payment_status', label: 'Payment Status (payment_status)', type: 'string' },
    { value: 'is_potential_fraud', label: 'Is Potential Fraud (is_potential_fraud)', type: 'boolean' },
    { value: 'source', label: 'Order Source (source)', type: 'string' },
    { value: 'source_code', label: 'Source Code (source_code)', type: 'string' },
    { value: 'is_reseller_transaction', label: 'Is Reseller Tx (is_reseller_transaction)', type: 'boolean' },
    { value: 'is_on_demand', label: 'Is On Demand (is_on_demand)', type: 'boolean' },
    { value: 'requires_shipping', label: 'Requires Shipping (requires_shipping)', type: 'boolean' },
    { value: 'cod_confirmed', label: 'COD Confirmed (cod_confirmed)', type: 'boolean' },
    { value: 'customer_note', label: 'Customer Note (customer_note)', type: 'string' },
    { value: 'gift_message', label: 'Gift Message (gift_message)', type: 'string' },
    { value: 'payment_link', label: 'Payment Link (payment_link)', type: 'string' },
    { value: 'weight', label: 'Total Weight (weight)', type: 'number' },
    { value: 'products_count', label: 'Products Count (products_count)', type: 'number' },
    { value: 'products_sum_total_string', label: 'Products Sum Total String (products_sum_total_string)', type: 'string' },
    { value: 'language', label: 'Language (language)', type: 'string' },
    { value: 'packages_count', label: 'Packages Count (packages_count)', type: 'number' },
    { value: 'inventory_address', label: 'Inventory Address (inventory_address)', type: 'string' },
    { value: 'invoice_link', label: 'Invoice PDF Link (invoice_link)', type: 'string' },
    { value: 'delivered_at', label: 'Delivered At (delivered_at)', type: 'string' },
    { value: 'comment', label: 'Order Comment (comment)', type: 'string' },

    // 3. Sub-objects / local associations
    { value: 'customer.id', label: 'Customer ID (customer.id)', type: 'string' },
    { value: 'customer.name', label: 'Customer Name (customer.name)', type: 'string' },
    { value: 'customer.email', label: 'Customer Email (customer.email)', type: 'string' },
    { value: 'customer.phone', label: 'Customer Phone (customer.phone)', type: 'string' },
    { value: 'shipping.method.name', label: 'Shipping Method Name (shipping.method.name)', type: 'string' },
    { value: 'shipping.address.city', label: 'Shipping City (shipping.address.city)', type: 'string' },
    { value: 'shipping.address.street', label: 'Shipping Street (shipping.address.street)', type: 'string' },
    { value: 'payment.method.name', label: 'Payment Method Name (payment.method.name)', type: 'string' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' },
  ],
  'sale.order.line': [
    { value: 'items.id', label: 'Line ID (items.id)', type: 'string' },
    { value: 'items.product_id', label: 'Product ID (items.product_id)', type: 'string' },
    { value: 'items.name', label: 'Product Name (items.name)', type: 'string' },
    { value: 'items.sku', label: 'Product SKU (items.sku)', type: 'string' },
    { value: 'items.quantity', label: 'Quantity (items.quantity)', type: 'number' },
    { value: 'items.price', label: 'Unit Price (items.price)', type: 'number' },
    { value: 'items.total', label: 'Line Total (items.total)', type: 'number' },
  ],
  'product.category': [
    { value: 'id', label: 'Category ID (id)', type: 'number' },
    { value: 'uuid', label: 'Category UUID (uuid)', type: 'string' },
    { value: 'name', label: 'Display Name (name)', type: 'string' },
    { value: 'names.ar', label: 'Category Name Arabic (names.ar)', type: 'string' },
    { value: 'names.en', label: 'Category Name English (names.en)', type: 'string' },
    { value: 'description.ar', label: 'Description Arabic (description.ar)', type: 'string' },
    { value: 'description.en', label: 'Description English (description.en)', type: 'string' },
    { value: 'slug', label: 'SEO Slug (slug)', type: 'string' },
    { value: 'url', label: 'Public URL (url)', type: 'string' },
    { value: 'image', label: 'Category Image (image)', type: 'string' },
    { value: 'image_full_size', label: 'Full Size Image URL (image_full_size)', type: 'string' },
    { value: 'cover_image', label: 'Cover Image URL (cover_image)', type: 'string' },
    { value: 'products_count', label: 'Products Count (products_count)', type: 'number' },
    { value: 'parent_id', label: 'Parent Category ID (parent_id)', type: 'string' },
    { value: 'flat_name', label: 'Flat Name (flat_name)', type: 'string' },
    { value: 'is_published', label: 'Is Published (is_published)', type: 'boolean' },
    { value: 'SEO_category_title', label: 'SEO Title (SEO_category_title)', type: 'string' },
    { value: 'SEO_category_description', label: 'SEO Description (SEO_category_description)', type: 'string' },
    { value: 'i18n_SEO_category_title.ar', label: 'SEO Title Arabic (i18n_SEO_category_title.ar)', type: 'string' },
    { value: 'i18n_SEO_category_title.en', label: 'SEO Title English (i18n_SEO_category_title.en)', type: 'string' },
    { value: 'i18n_SEO_category_description.ar', label: 'SEO Description Arabic (i18n_SEO_category_description.ar)', type: 'string' },
    { value: 'i18n_SEO_category_description.en', label: 'SEO Description English (i18n_SEO_category_description.en)', type: 'string' },
  ],
  'product.category.delete': [
    { value: 'id', label: 'Category ID (id)', type: 'number' },
    { value: 'uuid', label: 'Category UUID (uuid)', type: 'string' },
    { value: 'slug', label: 'SEO Slug (slug)', type: 'string' },
  ]
}

export default function FieldMappingForm({
  initialModels = [],
  hasOdooConnection = false,
  preloadedModel = '',
  preloadedFields = [],
  editingId,
  initialAction,
  initialOdooModel,
  initialOdooOperation,
  initialOdooMatchField,
  initialZidMatchField,
  initialMappings,
  initialRelatedModels,
  initialName,
  onCancel,
  onSuccess,
}: {
  initialModels?: Array<{ model: string; name: string }>
  hasOdooConnection?: boolean
  preloadedModel?: string
  preloadedFields?: Array<{ value: string; label: string; desc?: string; type: string; relation?: string }>
  editingId?: string
  initialAction?: string
  initialOdooModel?: string
  initialOdooOperation?: 'create' | 'update' | 'delete'
  initialOdooMatchField?: string
  initialZidMatchField?: string
  initialMappings?: any
  initialRelatedModels?: string[]
  initialName?: string
  onCancel?: () => void
  onSuccess?: () => void
}) {
  const [name, setName] = useState(initialName || '')
  const [lang, setLang] = useState<'EN' | 'AR'>('EN')
  
  // Set default model state
  const defaultModel = hasOdooConnection && initialModels.length > 0 
    ? initialModels[0].model 
    : 'product.template'
    
  const [odooModel, setOdooModel] = useState(initialOdooModel || defaultModel)
  const [odooOperation, setOdooOperation] = useState<'create' | 'update' | 'delete'>(initialOdooOperation || 'create')
  const [odooMatchField, setOdooMatchField] = useState(initialOdooMatchField || '')
  const [zidMatchField, setZidMatchField] = useState(initialZidMatchField || '')
  const [zidEvent, setZidEvent] = useState(initialAction || 'product.create')
  
  // Selected related models array (chips/tags state)
  const [relatedOdooModels, setRelatedOdooModels] = useState<string[]>(initialRelatedModels || [])
  
  // Notebook/Tabs active tab state
  const [activeTab, setActiveTab] = useState<string>(initialOdooModel || defaultModel)

  // Fields loaded from Odoo connection (grouped by model) - initialized with preloaded server fields
  const [modelFields, setModelFields] = useState<Record<string, Array<{ value: string; label: string; desc?: string; type: string; relation?: string }>>>(
    preloadedModel && preloadedFields.length > 0
      ? { [preloadedModel]: preloadedFields }
      : {}
  )
  const [isLoadingFields, setIsLoadingFields] = useState<Record<string, boolean>>({})
  const [staticOptions, setStaticOptions] = useState<Record<string, Array<{ value: string; label: string; desc?: string }>>>({})
  const [isLoadingStaticOptions, setIsLoadingStaticOptions] = useState<Record<string, boolean>>({})

  // Multi-table mappings state (starts clean when Odoo is connected)
  const [mappings, setMappings] = useState<Record<string, MappingLine[]>>(
    initialMappings || (
      hasOdooConnection
        ? {}
        : {
            'product.template': [
              { id: '1', erpField: 'name', zidField: 'name' },
              { id: '2', erpField: 'list_price', zidField: 'price' },
              { id: '3', erpField: 'default_code', zidField: 'sku' },
            ],
            'sale.order': [
              { id: '1', erpField: 'name', zidField: 'id' },
              { id: '2', erpField: 'amount_total', zidField: 'total' },
            ],
            'res.partner': [
              { id: '1', erpField: 'name', zidField: 'name' },
              { id: '2', erpField: 'email', zidField: 'email' },
            ]
          }
    )
  )
  
  const [isSaved, setIsSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  // Sync activeTab to odooModel when odooModel changes on mount/selection
  useEffect(() => {
    setActiveTab(odooModel)
    if (!editingId) {
      setRelatedOdooModels([])
    }
  }, [odooModel, editingId])

  // Get available related models for the primary odooModel
  const primaryFields = modelFields[odooModel] || ODOO_FIELDS[odooModel] || []
  const getAvailableRelatedModels = () => {
    if (hasOdooConnection) {
      // Filter relation fields pointing to other tables
      return primaryFields
        .filter(f => (f.type === 'one2many' || f.type === 'many2many' || f.type === 'many2one') && f.relation)
        .map(f => ({
          model: f.relation!,
          label: `${f.label.split(' (')[0]} (${f.relation})`,
          fieldName: f.value
        }))
    } else {
      return FALLBACK_RELATIONS[odooModel] || []
    }
  }
  const availableRelatedModels = getAvailableRelatedModels()

  // Compute activeRelatedModels dynamically from tags array
  const activeRelatedModels = relatedOdooModels.map(val => {
    const modelName = hasOdooConnection && initialModels.find(m => m.model === val)?.name || ODOO_MODELS.find(m => m.id === val)?.name?.split(' (')[0] || val
    const fieldName = availableRelatedModels.find(m => m.model === val)?.fieldName || 'relation'
    return {
      model: val,
      label: `${modelName} (${val})`,
      fieldName
    }
  })

  // Load fields dynamically for primary model and active related models
  useEffect(() => {
    const modelsToFetch = [odooModel, ...relatedOdooModels].filter(Boolean)
    
    modelsToFetch.forEach(model => {
      // If fields are already loaded, skip fetching to optimize
      if (modelFields[model] || isLoadingFields[model]) return

      if (hasOdooConnection) {
        setIsLoadingFields(prev => ({ ...prev, [model]: true }))
        getOdooModelFields(model).then(res => {
          if (res.success && res.fields) {
            setModelFields(prev => ({ ...prev, [model]: res.fields }))
          } else {
            // Fallback to static mock fields
            setModelFields(prev => ({ ...prev, [model]: ODOO_FIELDS[model] || [] }))
          }
        }).catch(err => {
          console.error(`Failed to load fields for ${model}:`, err)
          setModelFields(prev => ({ ...prev, [model]: ODOO_FIELDS[model] || [] }))
        }).finally(() => {
          setIsLoadingFields(prev => ({ ...prev, [model]: false }))
        })
      } else {
        setModelFields(prev => ({ ...prev, [model]: ODOO_FIELDS[model] || [] }))
      }
    })
  }, [odooModel, relatedOdooModels, hasOdooConnection])

  // Automatically align Zid Event when Odoo model changes
  useEffect(() => {
    const event = ZID_EVENTS.find(e => e.targetModel === odooModel || (odooModel.includes('product') && e.targetModel === 'product.template'))
    if (event) {
      setZidEvent(event.id)
    }
  }, [odooModel])

  // Get current active tab properties
  const isModelTab = activeTab === odooModel || activeRelatedModels.some(m => m.model === activeTab)
  const currentModelKey = activeTab
  const currentModelMappings = mappings[currentModelKey] || []
  
  const currentErpFields = modelFields[currentModelKey] || ODOO_FIELDS[currentModelKey] || []
  const currentZidFields = (() => {
    const activeTabLower = currentModelKey.toLowerCase()
    
    // 1. If we are on a child lines/variants tab, resolve child fields
    if (activeTabLower.includes('line')) {
      return ZID_FIELDS['sale.order.line'] || []
    }
    if (activeTabLower.includes('product.product') || activeTabLower === 'product.product') {
      return ZID_FIELDS['product.product'] || []
    }
    
    // 2. Otherwise, resolve base model fields depending on the selected Zid Event
    if (zidEvent === 'product.delete') {
      return ZID_FIELDS['product.delete'] || []
    }
    if (zidEvent === 'product.update' || zidEvent === 'product.publish') {
      return ZID_FIELDS['product.update'] || []
    }
    if (zidEvent === 'category.delete') {
      return ZID_FIELDS['product.category.delete'] || []
    }
    if (zidEvent.startsWith('product') || zidEvent.startsWith('category')) {
      if (activeTabLower.includes('category')) {
        return ZID_FIELDS['product.category'] || []
      }
      return ZID_FIELDS['product.template'] || []
    }
    if (zidEvent === 'cart.abandoned') {
      return ZID_FIELDS['cart.abandoned'] || []
    }
    if (zidEvent.startsWith('order')) {
      return ZID_FIELDS['sale.order'] || []
    }
    if (zidEvent.startsWith('customer')) {
      return ZID_FIELDS['res.partner'] || []
    }
    
    // Fallback based on model namespace
    if (activeTabLower.includes('partner') || activeTabLower.includes('customer')) return ZID_FIELDS['res.partner'] || []
    if (activeTabLower.includes('order')) return ZID_FIELDS['sale.order'] || []
    return ZID_FIELDS['product.template'] || []
  })()

  const getFieldMeta = (modelKey: string, fieldName: string) => {
    const fields = modelFields[modelKey] || ODOO_FIELDS[modelKey] || []
    return fields.find(field => field.value === fieldName)
  }

  useEffect(() => {
    if (!hasOdooConnection || !isModelTab) return

    currentModelMappings.forEach((line) => {
      const meta = getFieldMeta(currentModelKey, line.erpField)
      if (!meta || !['selection', 'boolean', 'many2one', 'many2many'].includes(meta.type)) return

      const key = `${currentModelKey}.${line.erpField}`
      if (staticOptions[key] || isLoadingStaticOptions[key]) return

      setIsLoadingStaticOptions(prev => ({ ...prev, [key]: true }))
      getOdooFieldValueOptions(currentModelKey, line.erpField)
        .then((res) => {
          if (res.success && res.options) {
            setStaticOptions(prev => ({ ...prev, [key]: res.options || [] }))
          } else {
            setStaticOptions(prev => ({ ...prev, [key]: [] }))
          }
        })
        .catch((err) => {
          console.error(`Failed to load static options for ${key}:`, err)
          setStaticOptions(prev => ({ ...prev, [key]: [] }))
        })
        .finally(() => {
          setIsLoadingStaticOptions(prev => ({ ...prev, [key]: false }))
        })
    })
  }, [hasOdooConnection, isModelTab, currentModelKey, currentModelMappings, modelFields, staticOptions, isLoadingStaticOptions])

  const primaryMatchErpFields = modelFields[odooModel] || ODOO_FIELDS[odooModel] || []
  const primaryMatchZidFields = (() => {
    if (zidEvent === 'product.delete') return ZID_FIELDS['product.delete'] || []
    if (zidEvent === 'product.update' || zidEvent === 'product.publish') return ZID_FIELDS['product.update'] || []
    if (zidEvent.startsWith('product')) return ZID_FIELDS['product.template'] || []
    if (zidEvent.startsWith('order')) return ZID_FIELDS['sale.order'] || []
    if (zidEvent.startsWith('customer')) return ZID_FIELDS['res.partner'] || []
    if (zidEvent === 'cart.abandoned') return ZID_FIELDS['cart.abandoned'] || []
    return currentZidFields
  })()

  useEffect(() => {
    if (odooOperation === 'create') return

    const odooOptions = primaryMatchErpFields.map(field => field.value)
    const zidOptions = primaryMatchZidFields.map(field => field.value)

    if (odooMatchField && !odooOptions.includes(odooMatchField)) {
      setOdooMatchField('')
    }
    if (zidMatchField && !zidOptions.includes(zidMatchField)) {
      setZidMatchField('')
    }

    if (!odooMatchField) {
      const defaultOdoo =
        odooOptions.find(field => field === 'default_code') ||
        odooOptions.find(field => field === 'barcode') ||
        odooOptions.find(field => field === 'id') ||
        ''
      if (defaultOdoo) setOdooMatchField(defaultOdoo)
    }

    if (!zidMatchField) {
      const defaultZid =
        zidOptions.find(field => field === 'sku') ||
        zidOptions.find(field => field === 'barcode') ||
        zidOptions.find(field => field === 'id') ||
        zidOptions.find(field => field === 'product_id') ||
        ''
      if (defaultZid) setZidMatchField(defaultZid)
    }
  }, [
    odooOperation,
    odooModel,
    zidEvent,
    primaryMatchErpFields,
    primaryMatchZidFields,
    odooMatchField,
    zidMatchField,
  ])

  // Unified related models tags update handler
  const handleRelatedModelsChange = (newModels: string[]) => {
    setRelatedOdooModels(newModels)
    setIsSaved(false)
    
    // Initialize mapping empty line if not present
    newModels.forEach(model => {
      if (!mappings[model]) {
        setMappings(prev => ({
          ...prev,
          [model]: []
        }))
      }
    })
    
    // Automatic tab navigation
    const added = newModels.filter(m => !relatedOdooModels.includes(m))
    const removed = relatedOdooModels.filter(m => !newModels.includes(m))
    
    if (added.length > 0) {
      setActiveTab(added[added.length - 1])
    } else if (removed.includes(activeTab)) {
      setActiveTab(odooModel)
    }
  }

  // Mappings Actions for the active model tab
  const handleAddLine = () => {
    const modelKey = activeTab
    const defaultErp = modelFields[modelKey]?.[0]?.value || ODOO_FIELDS[modelKey]?.[0]?.value || ''
    
    const newLine: MappingLine = {
      id: Math.random().toString(36).substring(2, 9),
      erpField: defaultErp,
      zidField: '',
      staticValue: '',
    }

    setMappings(prev => ({
      ...prev,
      [modelKey]: [...(prev[modelKey] || []), newLine]
    }))
    setIsSaved(false)
  }

  const handleRemoveLine = (id: string) => {
    const modelKey = activeTab
    setMappings(prev => ({
      ...prev,
      [modelKey]: (prev[modelKey] || []).filter(m => m.id !== id)
    }))
    setIsSaved(false)
  }

  const handleFieldChange = (id: string, column: 'erpField' | 'zidField', value: string) => {
    const modelKey = activeTab
    setMappings(prev => ({
      ...prev,
      [modelKey]: (prev[modelKey] || []).map(m => {
        if (m.id === id) {
          if (column === 'erpField') {
            return { ...m, erpField: value, zidField: '', staticValue: '' }
          }
          return { ...m, zidField: value, staticValue: value ? '' : m.staticValue }
        }
        return m
      })
    }))
    setIsSaved(false)
  }

  const handleStaticValueChange = (id: string, value: MappingLine['staticValue']) => {
    const modelKey = activeTab
    setMappings(prev => ({
      ...prev,
      [modelKey]: (prev[modelKey] || []).map(m => {
        if (m.id === id) {
          const hasStaticValue = Array.isArray(value) ? value.length > 0 : value !== '' && value !== undefined && value !== null
          return { ...m, staticValue: value, zidField: hasStaticValue ? '' : m.zidField }
        }
        return m
      })
    }))
    setIsSaved(false)
  }

  const hasStaticValue = (value: MappingLine['staticValue']) => (
    Array.isArray(value) ? value.length > 0 : value !== '' && value !== undefined && value !== null
  )

  const renderStaticValueInput = (mapping: MappingLine) => {
    const meta = getFieldMeta(currentModelKey, mapping.erpField)
    const type = meta?.type || 'char'
    const optionKey = `${currentModelKey}.${mapping.erpField}`
    const options = staticOptions[optionKey] || []
    const isStaticDisabled = Boolean(mapping.zidField)

    if (type === 'boolean') {
      return (
        <SearchableSelect
          value={typeof mapping.staticValue === 'boolean' ? String(mapping.staticValue) : String(mapping.staticValue || '')}
          onChange={(val) => handleStaticValueChange(mapping.id, val === '' ? '' : val === 'true')}
          options={[EMPTY_SELECT_OPTION, ...(options.length > 0 ? options : [
            { value: 'true', label: 'True' },
            { value: 'false', label: 'False' },
          ])]}
          placeholder={isLoadingStaticOptions[optionKey] ? 'Loading...' : 'Static value...'}
          variant="cell"
          disabled={isStaticDisabled}
        />
      )
    }

    if (type === 'selection' || type === 'many2one') {
      return (
        <SearchableSelect
          value={Array.isArray(mapping.staticValue) ? '' : String(mapping.staticValue || '')}
          onChange={(val) => handleStaticValueChange(mapping.id, val)}
          options={[EMPTY_SELECT_OPTION, ...options]}
          placeholder={isLoadingStaticOptions[optionKey] ? 'Loading...' : 'Static value...'}
          variant="cell"
          disabled={isStaticDisabled}
        />
      )
    }

    if (type === 'many2many') {
      return (
        <SearchableSelect
          value={Array.isArray(mapping.staticValue) ? mapping.staticValue.map(String) : []}
          onChange={(val) => {
            const values = Array.isArray(val) ? val : []
            handleStaticValueChange(mapping.id, values.includes('') ? [] : values.filter(Boolean))
          }}
          options={[EMPTY_SELECT_OPTION, ...options]}
          placeholder={isLoadingStaticOptions[optionKey] ? 'Loading...' : 'Static values...'}
          variant="cell"
          multiple
          disabled={isStaticDisabled}
        />
      )
    }

    if (['integer', 'float', 'monetary'].includes(type)) {
      return (
        <input
          type="number"
          value={Array.isArray(mapping.staticValue) ? '' : String(mapping.staticValue || '')}
          onChange={(e) => handleStaticValueChange(mapping.id, e.target.value)}
          disabled={isStaticDisabled}
          placeholder="Static number..."
          className="h-9 w-full rounded-md border border-transparent bg-transparent px-3 text-sm outline-none hover:border-input hover:bg-muted/30 focus:border-[#00878a] focus:ring-1 focus:ring-[#00878a] disabled:cursor-not-allowed disabled:opacity-50"
        />
      )
    }

    return (
      <input
        type="text"
        value={Array.isArray(mapping.staticValue) ? mapping.staticValue.join(', ') : String(mapping.staticValue || '')}
        onChange={(e) => handleStaticValueChange(mapping.id, e.target.value)}
        disabled={isStaticDisabled}
        placeholder="Static value..."
        className="h-9 w-full rounded-md border border-transparent bg-transparent px-3 text-sm outline-none hover:border-input hover:bg-muted/30 focus:border-[#00878a] focus:ring-1 focus:ring-[#00878a] disabled:cursor-not-allowed disabled:opacity-50"
      />
    )
  }

  const handleSave = async () => {
    setIsSaving(true)
    setErrorMessage('')

    if (!name || !name.trim()) {
      setErrorMessage('اسم إعداد الربط مطلوب وكبير لتمييز الإعدادات (Mapping name is required)')
      setIsSaving(false)
      return
    }

    if ((odooOperation === 'update' || odooOperation === 'delete') && (!odooMatchField || !zidMatchField)) {
      setErrorMessage('اختر حقلي المطابقة في أودو وزد للتعديل أو الحذف (Matching fields are required for update/delete)')
      setIsSaving(false)
      return
    }

    try {
      const res = await saveFieldMapping({
        id: editingId,
        name: name,
        action: zidEvent,
        odooModel: odooModel,
        odooOperation,
        odooMatchField,
        zidMatchField,
        mappings: mappings
      })

      if (res.success) {
        setIsSaved(true)
        setToastMessage(editingId ? 'تم تحديث إعدادات الربط بنجاح!' : 'تم حفظ إعدادات الربط بنجاح!')
        setShowToast(true)
        setTimeout(() => {
          setShowToast(false)
          if (onSuccess) onSuccess()
        }, 1500)
      } else {
        setErrorMessage(res.error || 'فشل حفظ إعدادات الربط')
      }
    } catch (err: any) {
      console.error('Error saving mapping:', err)
      setErrorMessage(err.message || 'حدث خطأ أثناء حفظ إعدادات الربط')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDiscard = () => {
    if (onCancel) {
      onCancel()
      return
    }
    setOdooModel(defaultModel)
    setOdooOperation('create')
    setOdooMatchField('')
    setZidMatchField('')
    setRelatedOdooModels([])
    setMappings(hasOdooConnection ? {} : {
      'product.template': [
        { id: '1', erpField: 'name', zidField: 'name' },
        { id: '2', erpField: 'list_price', zidField: 'price' },
      ],
      'sale.order': [
        { id: '1', erpField: 'name', zidField: 'id' },
        { id: '2', erpField: 'amount_total', zidField: 'total' },
      ],
      'res.partner': [
        { id: '1', erpField: 'name', zidField: 'name' },
        { id: '2', erpField: 'email', zidField: 'email' },
      ]
    })
    setActiveTab(defaultModel)
    setToastMessage('تم التراجع عن التغييرات')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 3000)
  }

  return (
    <div className="relative space-y-6 text-foreground font-sans">
      
      {/* Top Button Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <Button 
            onClick={handleSave} 
            disabled={isSaving}
            variant="default"
            className="bg-[#00878a] hover:bg-[#007073] text-white font-medium rounded-md px-4 py-2 text-sm shadow-sm transition-all"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
          <Button 
            onClick={handleDiscard}
            disabled={isSaving}
            variant="outline" 
            className="border-border hover:bg-muted font-medium rounded-md px-4 py-2 text-sm text-muted-foreground transition-all"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Discard
          </Button>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Status:</span>
          <span className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
            isSaved 
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" 
              : "bg-amber-500/10 text-amber-500 border-amber-500/20"
          )}>
            {isSaved ? 'Saved' : 'Draft'}
          </span>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-500">
          {errorMessage}
        </div>
      )}

      {/* Main Odoo-style Form Sheet */}
      <div className="bg-card rounded-xl border border-border shadow-md overflow-hidden p-6 md:p-8">
        
        {/* Name Input */}
        <div className="relative mb-8 group max-w-2xl font-sans">
          <div className="flex items-end justify-between border-b-2 border-border focus-within:border-[#00878a] transition-all pb-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setIsSaved(false)
              }}
              placeholder="Name..."
              className="w-full bg-transparent text-3xl font-normal outline-none placeholder:text-muted-foreground/40 text-foreground py-1 border-0 ring-0 focus:ring-0 focus:border-0"
            />
            <button 
              onClick={() => setLang(lang === 'EN' ? 'AR' : 'EN')}
              className="text-[#00878a] hover:bg-[#00878a]/10 font-bold px-2 py-1 rounded transition-colors text-sm shrink-0 flex items-center gap-1.5"
            >
              <Languages className="h-3.5 w-3.5" />
              {lang}
            </button>
          </div>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Specify a descriptive identifier for this mapping ruleset (e.g. Products Mapping).
          </p>
        </div>

        {/* Master Details Block */}
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-3 max-w-5xl mb-8 text-sm">
          {/* Odoo Model Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-muted-foreground">
              odoo model
            </label>
            <SearchableSelect
              value={odooModel}
              onChange={(val) => {
                setOdooModel(val)
                setIsSaved(false)
              }}
              options={
                hasOdooConnection && initialModels.length > 0
                  ? initialModels.map(model => ({
                      value: model.model,
                      label: model.name ? `${model.name} (${model.model})` : model.model,
                      desc: model.model
                    }))
                  : ODOO_MODELS.map(model => ({
                      value: model.id,
                      label: model.name,
                      desc: model.desc
                    }))
              }
              placeholder="Search or select Odoo model..."
            />
            <p className="text-xs text-muted-foreground/70">
              The primary model class representing data in Odoo ERP.
            </p>
          </div>

          {/* Odoo Operation Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-muted-foreground">
              Odoo Operation
            </label>
            <SearchableSelect
              value={odooOperation}
              onChange={(val) => {
                if (val === 'create' || val === 'update' || val === 'delete') {
                  setOdooOperation(val)
                  setIsSaved(false)
                }
              }}
              options={ODOO_OPERATIONS}
              placeholder="Select operation..."
            />
            <p className="text-xs text-muted-foreground/70">
              العملية التي ينفذها المحرك تلقائياً داخل أودو لهذا الربط.
            </p>
          </div>

          {/* Zid Event Selector */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-muted-foreground">
              Zid Event
            </label>
            <SearchableSelect
              value={zidEvent}
              onChange={(val) => {
                setZidEvent(val)
                setIsSaved(false)
              }}
              options={ZID_EVENTS.map(event => ({
                value: event.id,
                label: event.name,
              }))}
              placeholder="Search or select Zid Event..."
            />
            <p className="text-xs text-muted-foreground/70">
              The trigger event on Zid ecommerce platform.
            </p>
          </div>

          {/* Related Odoo Model Selector (Below Odoo Model Selector) */}
          {(odooOperation === 'update' || odooOperation === 'delete') && (
            <>
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-muted-foreground">
                  Odoo Reference Field
                </label>
                <SearchableSelect
                  value={odooMatchField}
                  onChange={(val) => {
                    setOdooMatchField(val)
                    setIsSaved(false)
                  }}
                  options={primaryMatchErpFields}
                  placeholder="Select Odoo reference field..."
                />
                <p className="text-xs text-muted-foreground/70">
                  الحقل الذي سيتم البحث به داخل موديل أودو المختار.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-muted-foreground">
                  Zid Reference Field
                </label>
                <SearchableSelect
                  value={zidMatchField}
                  onChange={(val) => {
                    setZidMatchField(val)
                    setIsSaved(false)
                  }}
                  options={primaryMatchZidFields}
                  placeholder="Select Zid reference field..."
                />
                <p className="text-xs text-muted-foreground/70">
                  قيمة هذا الحقل من الويب هوك ستطابق حقل أودو المرجعي.
                </p>
              </div>
            </>
          )}

          {/* Related Odoo Model Selector (Below Odoo Model Selector) */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-muted-foreground">
              Related Odoo Model (الموديل المرتبط)
            </label>
            <SearchableSelect
              value={relatedOdooModels}
              onChange={handleRelatedModelsChange}
              multiple={true}
              options={
                hasOdooConnection && initialModels.length > 0
                  ? initialModels.map(model => ({
                      value: model.model,
                      label: model.name ? `${model.name} (${model.model})` : model.model,
                      desc: model.model
                    }))
                  : ODOO_MODELS.map(model => ({
                      value: model.id,
                      label: model.name,
                      desc: model.desc
                    }))
              }
              placeholder="Search and select related models..."
            />
            <p className="text-xs text-muted-foreground/70">
              يمكنك كتابة واختيار أكثر من موديل مرتبط في نفس الوقت لربط البيانات المتداخلة كأجزاء من النموذج الرئيسي.
            </p>
          </div>

          {/* Helpful Tips Card */}
          <div className="rounded-xl border border-muted-foreground/10 bg-muted/20 p-4 flex flex-col justify-center text-xs leading-relaxed text-muted-foreground space-y-1 h-[95px]">
            <span className="font-semibold text-foreground flex items-center gap-1">💡 Mapping Tip</span>
            <span>You can map child models dynamically. Select a main model (e.g. Sales Order) first, then select its children rows (e.g. Order Line) to create composite structures.</span>
          </div>
        </div>



        {/* Notebook / Tabs Selector */}
        <div className="border-b border-border/80 flex items-center justify-between mb-4">
          <div className="flex gap-2 overflow-x-auto">
            {/* Primary Model Tab */}
            <button
              onClick={() => setActiveTab(odooModel)}
              className={cn(
                "px-4 py-2.5 font-medium text-sm transition-all relative border-t-2 whitespace-nowrap",
                activeTab === odooModel
                  ? "border-t-[#00878a] bg-card text-foreground font-semibold border-x border-b border-b-card -mb-[1px] rounded-t-md"
                  : "border-t-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Details ({hasOdooConnection && initialModels.find(m => m.model === odooModel)?.name || ODOO_MODELS.find(m => m.id === odooModel)?.name?.split(' (')[0] || odooModel})
            </button>

            {/* Related Models Tabs */}
            {activeRelatedModels.map(rel => (
              <button
                key={rel.model}
                onClick={() => setActiveTab(rel.model)}
                className={cn(
                  "px-4 py-2.5 font-medium text-sm transition-all relative border-t-2 whitespace-nowrap",
                  activeTab === rel.model
                    ? "border-t-[#00878a] bg-card text-foreground font-semibold border-x border-b border-b-card -mb-[1px] rounded-t-md"
                    : "border-t-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {rel.label.split(' (')[0]}
              </button>
            ))}

            {/* Settings Tab */}
            <button
              onClick={() => setActiveTab('settings')}
              className={cn(
                "px-4 py-2.5 font-medium text-sm transition-all relative border-t-2 whitespace-nowrap",
                activeTab === 'settings'
                  ? "border-t-[#00878a] bg-card text-foreground font-semibold border-x border-b border-b-card -mb-[1px] rounded-t-md"
                  : "border-t-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Settings
            </button>
          </div>

          <div className="text-muted-foreground/40 pr-2 hidden sm:block">
            <ArrowRightLeft className="h-4 w-4" />
          </div>
        </div>

        {/* Tab Contents */}
        <div className="min-h-[250px]">
          <AnimatePresence mode="wait">
            {isModelTab ? (
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="space-y-4"
              >
                {/* Mapping Table */}
                <div className="border border-border rounded-lg overflow-visible bg-card relative z-10">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/40 text-xs uppercase font-bold text-muted-foreground tracking-wider border-b border-border/80">
                        <th className="py-3 px-4 font-semibold flex items-center gap-2">
                          Erp Field ({currentModelKey})
                          {isLoadingFields[currentModelKey] && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#00878a]" />}
                        </th>
                        <th className="py-3 px-4 font-semibold">Zid Field</th>
                        <th className="py-3 px-4 font-semibold">Static Value</th>
                        <th className="py-3 px-4 w-12 text-right">
                          <SlidersHorizontal className="h-4 w-4 ml-auto text-muted-foreground/60 cursor-pointer hover:text-foreground transition-colors" />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60 text-sm">
                      <AnimatePresence initial={false}>
                        {currentModelMappings.map((mapping) => (
                          <motion.tr
                            key={mapping.id}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="hover:bg-muted/20 group transition-all"
                          >
                            {/* ERP Field selection */}
                            <td className="py-1 px-4">
                              <SearchableSelect
                                value={mapping.erpField}
                                onChange={(val) => {
                                  handleFieldChange(mapping.id, 'erpField', val)
                                }}
                                options={currentErpFields}
                                placeholder="Select ERP Field..."
                                variant="cell"
                              />
                            </td>

                            {/* Zid Field selection */}
                            <td className="py-1 px-4">
                              <div className="flex items-center gap-1">
                                <SearchableSelect
                                  value={mapping.zidField || ''}
                                  onChange={(val) => {
                                  handleFieldChange(mapping.id, 'zidField', val)
                                }}
                                  options={[EMPTY_SELECT_OPTION, ...currentZidFields]}
                                  placeholder="Select Zid Field..."
                                  variant="cell"
                                  disabled={hasStaticValue(mapping.staticValue)}
                                />
                                {mapping.zidField && (
                                  <button
                                    type="button"
                                    onClick={() => handleFieldChange(mapping.id, 'zidField', '')}
                                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                                    title="Clear Zid field"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Static Value selection/input */}
                            <td className="py-1 px-4">
                              <div className="flex items-center gap-1">
                                {renderStaticValueInput(mapping)}
                                {hasStaticValue(mapping.staticValue) && (
                                  <button
                                    type="button"
                                    onClick={() => handleStaticValueChange(mapping.id, Array.isArray(mapping.staticValue) ? [] : '')}
                                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                                    title="Clear static value"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Actions Column (Delete) */}
                            <td className="py-2.5 px-4 text-right">
                              <button
                                onClick={() => handleRemoveLine(mapping.id)}
                                className="text-muted-foreground/50 hover:text-destructive p-1 rounded hover:bg-destructive/10 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                                title="Remove Mapping Rule"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>

                      {currentModelMappings.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-muted-foreground/80 italic">
                            No field mappings added yet. Click &quot;Add a line&quot; below.
                          </td>
                        </tr>
                      )}

                      {/* Add a Line Row */}
                      <tr>
                        <td colSpan={4} className="py-3 px-4">
                          <button
                            onClick={handleAddLine}
                            className="text-[#00878a] hover:text-[#007073] font-semibold flex items-center gap-1.5 transition-all hover:translate-x-0.5 text-sm"
                          >
                            <Plus className="h-4 w-4" />
                            Add a line
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </motion.div>
            ) : activeTab === 'settings' ? (
              <motion.div
                key="settings-tab"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="p-4 border border-border rounded-lg bg-muted/20 space-y-4 text-sm"
              >
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-[#00878a]" />
                  Advanced Mapping Settings
                </h3>
                <div className="space-y-4 max-w-xl">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" id="sync-bi" className="mt-1 h-4 w-4 rounded border-border text-[#00878a] focus:ring-[#00878a]" defaultChecked />
                    <div>
                      <label htmlFor="sync-bi" className="font-semibold block text-foreground">Bi-directional Sync</label>
                      <span className="text-xs text-muted-foreground">Keep both platforms synchronized when either side is modified.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" id="sync-delete" className="mt-1 h-4 w-4 rounded border-border text-[#00878a] focus:ring-[#00878a]" />
                    <div>
                      <label htmlFor="sync-delete" className="font-semibold block text-foreground">Sync Deletions</label>
                      <span className="text-xs text-muted-foreground">Delete product on Zid when it is archived/deleted in Odoo ERP.</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

      </div>

      {/* Floating Success Toast */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-3.5 rounded-xl shadow-2xl border border-white/10 text-sm max-w-sm font-medium"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check className="h-3 w-3 stroke-[3]" />
            </div>
            <div className="flex-1">{toastMessage}</div>
          </motion.div>
        )}
      </AnimatePresence>
      
    </div>
  )
}
