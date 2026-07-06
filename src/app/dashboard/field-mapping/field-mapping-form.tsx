'use client'

import React, { useState, useEffect } from 'react'
import {
  SlidersHorizontal,
  Trash2,
  Plus,
  Check,
  Save,
  RotateCcw,
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
import { useLanguage } from '@/components/language-provider'
import { formatFieldLabel } from '@/lib/translations'

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
export const ODOO_MODELS = [
  { id: 'product.template', name: 'Product (product.template)', desc: 'بيانات المنتجات والسلع' },
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

// Comprehensive data for Salla Webhook Events organized by category/group
// Full list of 78 subscribable store events from the official Salla Partners API
// NOTE: App lifecycle events (app.installed, app.store.authorize, app.updated, app.uninstalled, app.trial.*, app.subscription.*)
// are AUTO-DELIVERED to the app webhook_url — they are kept here for visibility only (display purposes)
export const SALLA_EVENTS = [
  // ─── Products ───────────────────────────────────────────────────────────────
  { id: 'product.created',          name: 'Product Created (إنشاء منتج)',                    targetModel: 'product.template',  group: 'Products (المنتجات)' },
  { id: 'product.updated',          name: 'Product Updated (تحديث منتج)',                    targetModel: 'product.template',  group: 'Products (المنتجات)' },
  { id: 'product.deleted',          name: 'Product Deleted (حذف منتج)',                      targetModel: 'product.template',  group: 'Products (المنتجات)' },
  { id: 'product.available',        name: 'Product Available (توفر المخزون)',                targetModel: 'product.template',  group: 'Products (المنتجات)' },
  { id: 'product.quantity.low',     name: 'Product Quantity Low (انخفاض المخزون)',            targetModel: 'product.template',  group: 'Products (المنتجات)' },
  { id: 'product.channels.changed', name: 'Product Channels Changed (تغيير قنوات المنتج)',   targetModel: 'product.template',  group: 'Products (المنتجات)' },
  { id: 'product.review.added',     name: 'Product Review Added (إضافة مراجعة منتج)',        targetModel: 'product.template',  group: 'Products (المنتجات)' },
  { id: 'product.review.updated',   name: 'Product Review Updated (تحديث مراجعة منتج)',      targetModel: 'product.template',  group: 'Products (المنتجات)' },

  // ─── Orders ─────────────────────────────────────────────────────────────────
  { id: 'order.created',                    name: 'Order Created (إنشاء طلب)',                               targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.updated',                    name: 'Order Updated (تحديث طلب)',                               targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.status.updated',             name: 'Order Status Updated (تحديث حالة الطلب)',                 targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.cancelled',                  name: 'Order Cancelled (إلغاء طلب)',                             targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.refunded',                   name: 'Order Refunded (استرجاع طلب)',                            targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.deleted',                    name: 'Order Deleted (حذف طلب)',                                 targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.payment.updated',            name: 'Order Payment Updated (تحديث الدفع)',                     targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.coupon.updated',             name: 'Order Coupon Updated (تحديث الكوبون)',                    targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.total.price.updated',        name: 'Order Total Price Updated (تحديث السعر الإجمالي)',        targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.products.updated',           name: 'Order Products Updated (تحديث منتجات الطلب)',             targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.customer.updated',           name: 'Order Customer Updated (تحديث بيانات مستلم الطلب)',       targetModel: 'sale.order', group: 'Orders (الطلبات)' },
  { id: 'order.shipping.address.updated',   name: 'Order Shipping Address Updated (تحديث عنوان الشحن)',      targetModel: 'sale.order', group: 'Orders (الطلبات)' },

  // ─── Order Shipments ─────────────────────────────────────────────────────────
  { id: 'order.shipment.creating',          name: 'Order Shipment Creating (جاري إنشاء الشحنة)',             targetModel: 'sale.order', group: 'Shipments (الشحنات)' },
  { id: 'order.shipment.created',           name: 'Order Shipment Created (إنشاء الشحنة)',                   targetModel: 'sale.order', group: 'Shipments (الشحنات)' },
  { id: 'order.shipment.cancelled',         name: 'Order Shipment Cancelled (إلغاء الشحنة)',                 targetModel: 'sale.order', group: 'Shipments (الشحنات)' },
  { id: 'order.shipment.return.creating',   name: 'Order Shipment Return Creating (جاري إنشاء مرتجع الشحنة)', targetModel: 'sale.order', group: 'Shipments (الشحنات)' },
  { id: 'order.shipment.return.created',    name: 'Order Shipment Return Created (إنشاء مرتجع شحنة)',        targetModel: 'sale.order', group: 'Shipments (الشحنات)' },
  { id: 'order.shipment.return.cancelled',  name: 'Order Shipment Return Cancelled (إلغاء مرتجع الشحنة)',    targetModel: 'sale.order', group: 'Shipments (الشحنات)' },

  // ─── Customers ───────────────────────────────────────────────────────────────
  { id: 'customer.created',   name: 'Customer Registered (تسجيل عميل جديد)',          targetModel: 'res.partner', group: 'Customers (العملاء)' },
  { id: 'customer.updated',   name: 'Customer Profile Updated (تحديث بيانات عميل)',   targetModel: 'res.partner', group: 'Customers (العملاء)' },
  { id: 'customer.login',     name: 'Customer Login (تسجيل دخول عميل)',               targetModel: 'res.partner', group: 'Customers (العملاء)' },

  // ─── Categories ──────────────────────────────────────────────────────────────
  { id: 'category.created',  name: 'Category Created (إنشاء تصنيف)',   targetModel: 'product.category', group: 'Categories (التصنيفات)' },
  { id: 'category.updated',  name: 'Category Updated (تحديث تصنيف)',   targetModel: 'product.category', group: 'Categories (التصنيفات)' },
  { id: 'category.deleted',  name: 'Category Deleted (حذف تصنيف)',     targetModel: 'product.category', group: 'Categories (التصنيفات)' },

  // ─── Branches ────────────────────────────────────────────────────────────────
  { id: 'store.branch.created',  name: 'Branch Created (إنشاء فرع)',   targetModel: 'res.partner', group: 'Branches (الفروع)' },
  { id: 'store.branch.updated',  name: 'Branch Updated (تحديث فرع)',   targetModel: 'res.partner', group: 'Branches (الفروع)' },
  { id: 'store.branch.deleted',  name: 'Branch Deleted (حذف فرع)',     targetModel: 'res.partner', group: 'Branches (الفروع)' },

  // ─── Abandoned Carts ─────────────────────────────────────────────────────────
  { id: 'abandoned.cart',           name: 'Cart Abandoned (سلة متروكة)',            targetModel: 'sale.order', group: 'Carts (السلات المتروكة)' },
  { id: 'abandoned.cart.update',    name: 'Abandoned Cart Updated (تحديث سلة متروكة)', targetModel: 'sale.order', group: 'Carts (السلات المتروكة)' },
  { id: 'abandoned.cart.purchased', name: 'Abandoned Cart Purchased (شراء سلة متروكة)', targetModel: 'sale.order', group: 'Carts (السلات المتروكة)' },

  // ─── Coupons ─────────────────────────────────────────────────────────────────
  { id: 'coupon.applied',   name: 'Coupon Applied (تطبيق كوبون)',     targetModel: 'sale.order', group: 'Coupons (الكوبونات)' },
  { id: 'coupon.applied.v2', name: 'Coupon Applied V2 (تطبيق كوبون V2)', targetModel: 'sale.order', group: 'Coupons (الكوبونات)' },

  // ─── Brands ──────────────────────────────────────────────────────────────────
  { id: 'brand.created',  name: 'Brand Created (إنشاء علامة تجارية)',   targetModel: 'res.partner', group: 'Brands (العلامات التجارية)' },
  { id: 'brand.updated',  name: 'Brand Updated (تحديث علامة تجارية)',   targetModel: 'res.partner', group: 'Brands (العلامات التجارية)' },
  { id: 'brand.deleted',  name: 'Brand Deleted (حذف علامة تجارية)',     targetModel: 'res.partner', group: 'Brands (العلامات التجارية)' },

  // ─── Misc / Store ─────────────────────────────────────────────────────────────
  { id: 'store.settings.updated',   name: 'Store Settings Updated (تحديث إعدادات المتجر)', targetModel: 'res.company', group: 'Store (المتجر)' },
  { id: 'special.offer.created',    name: 'Special Offer Created (إنشاء عرض خاص)',         targetModel: 'sale.order',  group: 'Store (المتجر)' },
  { id: 'special.offer.updated',    name: 'Special Offer Updated (تحديث عرض خاص)',         targetModel: 'sale.order',  group: 'Store (المتجر)' },
  { id: 'special.offer.deleted',    name: 'Special Offer Deleted (حذف عرض خاص)',           targetModel: 'sale.order',  group: 'Store (المتجر)' },

  // ─── App Lifecycle (auto-delivered, informational only) ───────────────────────
  { id: 'app.installed',              name: 'App Installed (تثبيت التطبيق)',               targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
  { id: 'app.updated',                name: 'App Updated (تحديث التطبيق)',                 targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
  { id: 'app.uninstalled',            name: 'App Uninstalled (إلغاء تثبيت التطبيق)',       targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
  { id: 'app.store.authorize',        name: 'App Store Authorize (تفويض المتجر)',          targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
  { id: 'app.trial.started',          name: 'App Trial Started (بدء التجربة المجانية)',     targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
  { id: 'app.trial.expired',          name: 'App Trial Expired (انتهاء التجربة المجانية)', targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
  { id: 'app.subscription.started',   name: 'App Subscription Started (بدء الاشتراك)',      targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
  { id: 'app.settings.updated',       name: 'App Settings Updated (تحديث إعدادات التطبيق)', targetModel: 'res.company', group: 'App Events (أحداث التطبيق)' },
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

export const ZID_FIELDS: Record<string, { value: string; label: string; type: string }[]> = {
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

export const SALLA_FIELDS: Record<string, { value: string; label: string; type: string }[]> = {
  // Salla Events (Products Group)
  'product.created': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'name', label: 'Product Name (name)', type: 'string' },
    { value: 'subtitle', label: 'Product Subtitle (subtitle)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'barcode', label: 'Barcode (barcode)', type: 'string' },
    { value: 'price', label: 'Price Root (price)', type: 'number' },
    { value: 'price.amount', label: 'Price Amount (price.amount)', type: 'number' },
    { value: 'price.currency', label: 'Price Currency (price.currency)', type: 'string' },
    { value: 'sale_price', label: 'Sale Price Root (sale_price)', type: 'number' },
    { value: 'sale_price.amount', label: 'Sale Price Amount (sale_price.amount)', type: 'number' },
    { value: 'cost_price', label: 'Cost Price Root (cost_price)', type: 'number' },
    { value: 'cost_price.amount', label: 'Cost Price Amount (cost_price.amount)', type: 'number' },
    { value: 'regular_price.amount', label: 'Regular Price (regular_price.amount)', type: 'number' },
    { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
    { value: 'unlimited_quantity', label: 'Unlimited Stock (unlimited_quantity)', type: 'boolean' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'product_type', label: 'Product Type (product_type)', type: 'string' },
    { value: 'weight', label: 'Weight (weight)', type: 'number' },
    { value: 'weight_type', label: 'Weight Type (weight_type)', type: 'string' },
    { value: 'description', label: 'Full Description (description)', type: 'string' },
    { value: 'short_description', label: 'Short Description (short_description)', type: 'string' },
    { value: 'main_image', label: 'Main Image URL (main_image)', type: 'string' },
    { value: 'url', label: 'Storefront URL (url)', type: 'string' },
    { value: 'brand_id', label: 'Brand ID Root (brand_id)', type: 'number' },
    { value: 'brand.id', label: 'Brand ID (brand.id)', type: 'string' },
    { value: 'brand.name', label: 'Brand Name (brand.name)', type: 'string' },
    { value: 'categories', label: 'Categories IDs/Array (categories)', type: 'array' },
    { value: 'tags', label: 'Tags IDs/Array (tags)', type: 'array' },
    { value: 'images', label: 'Images Array (images)', type: 'array' },
    { value: 'options', label: 'Options/Variants (options)', type: 'array' },
    { value: 'require_shipping', label: 'Require Shipping (require_shipping)', type: 'boolean' },
    { value: 'maximum_quantity_per_order', label: 'Max Qty Per Order (maximum_quantity_per_order)', type: 'number' },
    { value: 'min_amount_donating', label: 'Min Amount Donating (min_amount_donating)', type: 'number' },
    { value: 'max_amount_donating', label: 'Max Amount Donating (max_amount_donating)', type: 'number' },
    { value: 'sale_end', label: 'Sale End Date (sale_end)', type: 'string' },
    { value: 'mpn', label: 'MPN (mpn)', type: 'string' },
    { value: 'gtin', label: 'GTIN (gtin)', type: 'string' },
    { value: 'hide_quantity', label: 'Hide Quantity (hide_quantity)', type: 'boolean' },
    { value: 'enable_upload_image', label: 'Enable Upload Image (enable_upload_image)', type: 'boolean' },
    { value: 'enable_note', label: 'Enable Note (enable_note)', type: 'boolean' },
    { value: 'pinned', label: 'Pinned (pinned)', type: 'boolean' },
    { value: 'active_advance', label: 'Active Advance (active_advance)', type: 'boolean' },
    { value: 'promotion_title', label: 'Promotion Title (promotion_title)', type: 'string' },
    { value: 'metadata_title', label: 'SEO Metadata Title (metadata_title)', type: 'string' },
    { value: 'metadata_description', label: 'SEO Metadata Desc (metadata_description)', type: 'string' },
    { value: 'booking_details.location', label: 'Booking Location (booking_details.location)', type: 'string' },
    { value: 'booking_details.type', label: 'Booking Type (booking_details.type)', type: 'string' },
    { value: 'booking_details.time_strict_value', label: 'Booking Time Strict Value (booking_details.time_strict_value)', type: 'number' },
    { value: 'booking_details.time_strict_type', label: 'Booking Time Strict Type (booking_details.time_strict_type)', type: 'string' },
    { value: 'booking_details.sessions_count', label: 'Booking Sessions Count (booking_details.sessions_count)', type: 'number' },
    { value: 'booking_details.session_gap', label: 'Booking Session Gap (booking_details.session_gap)', type: 'number' },
    { value: 'booking_details.session_duration', label: 'Booking Session Duration (booking_details.session_duration)', type: 'number' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' }
  ],
  'product.updated': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'name', label: 'Product Name (name)', type: 'string' },
    { value: 'subtitle', label: 'Product Subtitle (subtitle)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'barcode', label: 'Barcode (barcode)', type: 'string' },
    { value: 'price', label: 'Price Root (price)', type: 'number' },
    { value: 'price.amount', label: 'Price Amount (price.amount)', type: 'number' },
    { value: 'price.currency', label: 'Price Currency (price.currency)', type: 'string' },
    { value: 'sale_price', label: 'Sale Price Root (sale_price)', type: 'number' },
    { value: 'sale_price.amount', label: 'Sale Price Amount (sale_price.amount)', type: 'number' },
    { value: 'cost_price', label: 'Cost Price Root (cost_price)', type: 'number' },
    { value: 'cost_price.amount', label: 'Cost Price Amount (cost_price.amount)', type: 'number' },
    { value: 'regular_price.amount', label: 'Regular Price (regular_price.amount)', type: 'number' },
    { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
    { value: 'unlimited_quantity', label: 'Unlimited Stock (unlimited_quantity)', type: 'boolean' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'product_type', label: 'Product Type (product_type)', type: 'string' },
    { value: 'weight', label: 'Weight (weight)', type: 'number' },
    { value: 'weight_type', label: 'Weight Type (weight_type)', type: 'string' },
    { value: 'description', label: 'Full Description (description)', type: 'string' },
    { value: 'short_description', label: 'Short Description (short_description)', type: 'string' },
    { value: 'main_image', label: 'Main Image URL (main_image)', type: 'string' },
    { value: 'url', label: 'Storefront URL (url)', type: 'string' },
    { value: 'brand_id', label: 'Brand ID Root (brand_id)', type: 'number' },
    { value: 'brand.id', label: 'Brand ID (brand.id)', type: 'string' },
    { value: 'brand.name', label: 'Brand Name (brand.name)', type: 'string' },
    { value: 'categories', label: 'Categories IDs/Array (categories)', type: 'array' },
    { value: 'tags', label: 'Tags IDs/Array (tags)', type: 'array' },
    { value: 'images', label: 'Images Array (images)', type: 'array' },
    { value: 'options', label: 'Options/Variants (options)', type: 'array' },
    { value: 'require_shipping', label: 'Require Shipping (require_shipping)', type: 'boolean' },
    { value: 'maximum_quantity_per_order', label: 'Max Qty Per Order (maximum_quantity_per_order)', type: 'number' },
    { value: 'min_amount_donating', label: 'Min Amount Donating (min_amount_donating)', type: 'number' },
    { value: 'max_amount_donating', label: 'Max Amount Donating (max_amount_donating)', type: 'number' },
    { value: 'sale_end', label: 'Sale End Date (sale_end)', type: 'string' },
    { value: 'mpn', label: 'MPN (mpn)', type: 'string' },
    { value: 'gtin', label: 'GTIN (gtin)', type: 'string' },
    { value: 'hide_quantity', label: 'Hide Quantity (hide_quantity)', type: 'boolean' },
    { value: 'enable_upload_image', label: 'Enable Upload Image (enable_upload_image)', type: 'boolean' },
    { value: 'enable_note', label: 'Enable Note (enable_note)', type: 'boolean' },
    { value: 'pinned', label: 'Pinned (pinned)', type: 'boolean' },
    { value: 'active_advance', label: 'Active Advance (active_advance)', type: 'boolean' },
    { value: 'promotion_title', label: 'Promotion Title (promotion_title)', type: 'string' },
    { value: 'metadata_title', label: 'SEO Metadata Title (metadata_title)', type: 'string' },
    { value: 'metadata_description', label: 'SEO Metadata Desc (metadata_description)', type: 'string' },
    { value: 'booking_details.location', label: 'Booking Location (booking_details.location)', type: 'string' },
    { value: 'booking_details.type', label: 'Booking Type (booking_details.type)', type: 'string' },
    { value: 'booking_details.time_strict_value', label: 'Booking Time Strict Value (booking_details.time_strict_value)', type: 'number' },
    { value: 'booking_details.time_strict_type', label: 'Booking Time Strict Type (booking_details.time_strict_type)', type: 'string' },
    { value: 'booking_details.sessions_count', label: 'Booking Sessions Count (booking_details.sessions_count)', type: 'number' },
    { value: 'booking_details.session_gap', label: 'Booking Session Gap (booking_details.session_gap)', type: 'number' },
    { value: 'booking_details.session_duration', label: 'Booking Session Duration (booking_details.session_duration)', type: 'number' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' }
  ],
  'product.deleted': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'deleted_at', label: 'Deleted At (deleted_at)', type: 'string' }
  ],
  'product.available': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'name', label: 'Product Name (name)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'price.amount', label: 'Price Amount (price.amount)', type: 'number' },
    { value: 'price.currency', label: 'Price Currency (price.currency)', type: 'string' },
    { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'url', label: 'Storefront URL (url)', type: 'string' }
  ],
  'product.quantity.low': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'name', label: 'Product Name (name)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'price.amount', label: 'Price Amount (price.amount)', type: 'number' },
    { value: 'price.currency', label: 'Price Currency (price.currency)', type: 'string' },
    { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
    { value: 'status', label: 'Status (status)', type: 'string' }
  ],
  'product.channels.changed': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'name', label: 'Product Name (name)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'channels', label: 'Sales Channels (channels)', type: 'array' }
  ],
  'product.review.added': [
    { value: 'id', label: 'Review ID (id)', type: 'string' },
    { value: 'rating', label: 'Rating (rating)', type: 'number' },
    { value: 'comment', label: 'Comment (comment)', type: 'string' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'product.id', label: 'Product ID (product.id)', type: 'string' },
    { value: 'product.name', label: 'Product Name (product.name)', type: 'string' },
    { value: 'product.sku', label: 'Product SKU (product.sku)', type: 'string' },
    { value: 'customer.id', label: 'Customer ID (customer.id)', type: 'string' },
    { value: 'customer.first_name', label: 'Customer First Name (customer.first_name)', type: 'string' },
    { value: 'customer.last_name', label: 'Customer Last Name (customer.last_name)', type: 'string' },
    { value: 'customer.email', label: 'Customer Email (customer.email)', type: 'string' }
  ],
  'product.review.updated': [
    { value: 'id', label: 'Review ID (id)', type: 'string' },
    { value: 'rating', label: 'Rating (rating)', type: 'number' },
    { value: 'comment', label: 'Comment (comment)', type: 'string' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'product.id', label: 'Product ID (product.id)', type: 'string' },
    { value: 'product.name', label: 'Product Name (product.name)', type: 'string' },
    { value: 'product.sku', label: 'Product SKU (product.sku)', type: 'string' },
    { value: 'customer.id', label: 'Customer ID (customer.id)', type: 'string' },
    { value: 'customer.first_name', label: 'Customer First Name (customer.first_name)', type: 'string' },
    { value: 'customer.last_name', label: 'Customer Last Name (customer.last_name)', type: 'string' },
    { value: 'customer.email', label: 'Customer Email (customer.email)', type: 'string' }
  ],

  // Fallbacks for other generic options
  'product.template': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'name', label: 'Product Name (name)', type: 'string' },
    { value: 'subtitle', label: 'Product Subtitle (subtitle)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'barcode', label: 'Barcode (barcode)', type: 'string' },
    { value: 'price', label: 'Price Root (price)', type: 'number' },
    { value: 'price.amount', label: 'Price Amount (price.amount)', type: 'number' },
    { value: 'price.currency', label: 'Currency (price.currency)', type: 'string' },
    { value: 'sale_price', label: 'Sale Price Root (sale_price)', type: 'number' },
    { value: 'sale_price.amount', label: 'Sale Price Amount (sale_price.amount)', type: 'number' },
    { value: 'cost_price', label: 'Cost Price Root (cost_price)', type: 'number' },
    { value: 'cost_price.amount', label: 'Cost Price Amount (cost_price.amount)', type: 'number' },
    { value: 'regular_price.amount', label: 'Regular Price (regular_price.amount)', type: 'number' },
    { value: 'quantity', label: 'Quantity (quantity)', type: 'number' },
    { value: 'unlimited_quantity', label: 'Unlimited Stock (unlimited_quantity)', type: 'boolean' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'product_type', label: 'Product Type (product_type)', type: 'string' },
    { value: 'weight', label: 'Weight (weight)', type: 'number' },
    { value: 'weight_type', label: 'Weight Type (weight_type)', type: 'string' },
    { value: 'description', label: 'Description (description)', type: 'string' },
    { value: 'short_description', label: 'Short Description (short_description)', type: 'string' },
    { value: 'main_image', label: 'Main Image URL (main_image)', type: 'string' },
    { value: 'url', label: 'Storefront URL (url)', type: 'string' },
    { value: 'brand_id', label: 'Brand ID Root (brand_id)', type: 'number' },
    { value: 'brand.id', label: 'Brand ID (brand.id)', type: 'string' },
    { value: 'brand.name', label: 'Brand Name (brand.name)', type: 'string' },
    { value: 'categories', label: 'Categories IDs/Array (categories)', type: 'array' },
    { value: 'tags', label: 'Tags IDs/Array (tags)', type: 'array' },
    { value: 'images', label: 'Images Array (images)', type: 'array' },
    { value: 'options', label: 'Options/Variants (options)', type: 'array' },
    { value: 'require_shipping', label: 'Require Shipping (require_shipping)', type: 'boolean' },
    { value: 'maximum_quantity_per_order', label: 'Max Qty Per Order (maximum_quantity_per_order)', type: 'number' },
    { value: 'min_amount_donating', label: 'Min Amount Donating (min_amount_donating)', type: 'number' },
    { value: 'max_amount_donating', label: 'Max Amount Donating (max_amount_donating)', type: 'number' },
    { value: 'sale_end', label: 'Sale End Date (sale_end)', type: 'string' },
    { value: 'mpn', label: 'MPN (mpn)', type: 'string' },
    { value: 'gtin', label: 'GTIN (gtin)', type: 'string' },
    { value: 'hide_quantity', label: 'Hide Quantity (hide_quantity)', type: 'boolean' },
    { value: 'enable_upload_image', label: 'Enable Upload Image (enable_upload_image)', type: 'boolean' },
    { value: 'enable_note', label: 'Enable Note (enable_note)', type: 'boolean' },
    { value: 'pinned', label: 'Pinned (pinned)', type: 'boolean' },
    { value: 'active_advance', label: 'Active Advance (active_advance)', type: 'boolean' },
    { value: 'promotion_title', label: 'Promotion Title (promotion_title)', type: 'string' },
    { value: 'metadata_title', label: 'SEO Metadata Title (metadata_title)', type: 'string' },
    { value: 'metadata_description', label: 'SEO Metadata Desc (metadata_description)', type: 'string' },
    { value: 'booking_details.location', label: 'Booking Location (booking_details.location)', type: 'string' },
    { value: 'booking_details.type', label: 'Booking Type (booking_details.type)', type: 'string' },
    { value: 'booking_details.time_strict_value', label: 'Booking Time Strict Value (booking_details.time_strict_value)', type: 'number' },
    { value: 'booking_details.time_strict_type', label: 'Booking Time Strict Type (booking_details.time_strict_type)', type: 'string' },
    { value: 'booking_details.sessions_count', label: 'Booking Sessions Count (booking_details.sessions_count)', type: 'number' },
    { value: 'booking_details.session_gap', label: 'Booking Session Gap (booking_details.session_gap)', type: 'number' },
    { value: 'booking_details.session_duration', label: 'Booking Session Duration (booking_details.session_duration)', type: 'number' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' }
  ],
  'product.update': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'name', label: 'Product Name (name)', type: 'string' },
    { value: 'subtitle', label: 'Product Subtitle (subtitle)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' },
    { value: 'barcode', label: 'Barcode (barcode)', type: 'string' },
    { value: 'price', label: 'Price Root (price)', type: 'number' },
    { value: 'price.amount', label: 'Price Amount (price.amount)', type: 'number' },
    { value: 'price.currency', label: 'Price Currency (price.currency)', type: 'string' },
    { value: 'sale_price', label: 'Sale Price Root (sale_price)', type: 'number' },
    { value: 'sale_price.amount', label: 'Sale Price Amount (sale_price.amount)', type: 'number' },
    { value: 'cost_price', label: 'Cost Price Root (cost_price)', type: 'number' },
    { value: 'cost_price.amount', label: 'Cost Price Amount (cost_price.amount)', type: 'number' },
    { value: 'regular_price.amount', label: 'Regular Price (regular_price.amount)', type: 'number' },
    { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
    { value: 'unlimited_quantity', label: 'Unlimited Stock (unlimited_quantity)', type: 'boolean' },
    { value: 'status', label: 'Status (status)', type: 'string' },
    { value: 'product_type', label: 'Product Type (product_type)', type: 'string' },
    { value: 'weight', label: 'Weight (weight)', type: 'number' },
    { value: 'weight_type', label: 'Weight Type (weight_type)', type: 'string' },
    { value: 'description', label: 'Full Description (description)', type: 'string' },
    { value: 'short_description', label: 'Short Description (short_description)', type: 'string' },
    { value: 'main_image', label: 'Main Image URL (main_image)', type: 'string' },
    { value: 'url', label: 'Storefront URL (url)', type: 'string' },
    { value: 'brand_id', label: 'Brand ID Root (brand_id)', type: 'number' },
    { value: 'brand.id', label: 'Brand ID (brand.id)', type: 'string' },
    { value: 'brand.name', label: 'Brand Name (brand.name)', type: 'string' },
    { value: 'categories', label: 'Categories IDs/Array (categories)', type: 'array' },
    { value: 'tags', label: 'Tags IDs/Array (tags)', type: 'array' },
    { value: 'images', label: 'Images Array (images)', type: 'array' },
    { value: 'options', label: 'Options/Variants (options)', type: 'array' },
    { value: 'require_shipping', label: 'Require Shipping (require_shipping)', type: 'boolean' },
    { value: 'maximum_quantity_per_order', label: 'Max Qty Per Order (maximum_quantity_per_order)', type: 'number' },
    { value: 'min_amount_donating', label: 'Min Amount Donating (min_amount_donating)', type: 'number' },
    { value: 'max_amount_donating', label: 'Max Amount Donating (max_amount_donating)', type: 'number' },
    { value: 'sale_end', label: 'Sale End Date (sale_end)', type: 'string' },
    { value: 'mpn', label: 'MPN (mpn)', type: 'string' },
    { value: 'gtin', label: 'GTIN (gtin)', type: 'string' },
    { value: 'hide_quantity', label: 'Hide Quantity (hide_quantity)', type: 'boolean' },
    { value: 'enable_upload_image', label: 'Enable Upload Image (enable_upload_image)', type: 'boolean' },
    { value: 'enable_note', label: 'Enable Note (enable_note)', type: 'boolean' },
    { value: 'pinned', label: 'Pinned (pinned)', type: 'boolean' },
    { value: 'active_advance', label: 'Active Advance (active_advance)', type: 'boolean' },
    { value: 'promotion_title', label: 'Promotion Title (promotion_title)', type: 'string' },
    { value: 'metadata_title', label: 'SEO Metadata Title (metadata_title)', type: 'string' },
    { value: 'metadata_description', label: 'SEO Metadata Desc (metadata_description)', type: 'string' },
    { value: 'booking_details.location', label: 'Booking Location (booking_details.location)', type: 'string' },
    { value: 'booking_details.type', label: 'Booking Type (booking_details.type)', type: 'string' },
    { value: 'booking_details.time_strict_value', label: 'Booking Time Strict Value (booking_details.time_strict_value)', type: 'number' },
    { value: 'booking_details.time_strict_type', label: 'Booking Time Strict Type (booking_details.time_strict_type)', type: 'string' },
    { value: 'booking_details.sessions_count', label: 'Booking Sessions Count (booking_details.sessions_count)', type: 'number' },
    { value: 'booking_details.session_gap', label: 'Booking Session Gap (booking_details.session_gap)', type: 'number' },
    { value: 'booking_details.session_duration', label: 'Booking Session Duration (booking_details.session_duration)', type: 'number' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' },
    { value: 'updated_at', label: 'Updated At (updated_at)', type: 'string' }
  ],
  'product.delete': [
    { value: 'id', label: 'Product ID (id)', type: 'string' },
    { value: 'sku', label: 'SKU (sku)', type: 'string' }
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
    { value: 'first_name', label: 'First Name (first_name)', type: 'string' },
    { value: 'last_name', label: 'Last Name (last_name)', type: 'string' },
    { value: 'email', label: 'Email (email)', type: 'string' },
    { value: 'mobile', label: 'Mobile (mobile)', type: 'string' },
    { value: 'gender', label: 'Gender (gender)', type: 'string' },
    { value: 'birthday', label: 'Birthday (birthday)', type: 'string' },
    { value: 'city', label: 'City (city)', type: 'string' },
    { value: 'country', label: 'Country (country)', type: 'string' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' }
  ],
  'sale.order': [
    { value: 'id', label: 'Order ID (id)', type: 'number' },
    { value: 'reference_id', label: 'Reference ID (reference_id)', type: 'number' },
    { value: 'payment_method', label: 'Payment Method (payment_method)', type: 'string' },
    { value: 'currency', label: 'Currency (currency)', type: 'string' },
    { value: 'status.name', label: 'Status Name (status.name)', type: 'string' },
    { value: 'amounts.total.amount', label: 'Total Amount (amounts.total.amount)', type: 'number' },
    { value: 'amounts.sub_total.amount', label: 'Subtotal Amount (amounts.sub_total.amount)', type: 'number' },
    { value: 'amounts.tax.amount', label: 'Tax Amount (amounts.tax.amount)', type: 'number' },
    { value: 'amounts.shipping_cost.amount', label: 'Shipping Cost (amounts.shipping_cost.amount)', type: 'number' },
    { value: 'shipping.address.formatted', label: 'Shipping Address (shipping.address.formatted)', type: 'string' },
    { value: 'customer.id', label: 'Customer ID (customer.id)', type: 'number' },
    { value: 'customer.first_name', label: 'Customer First Name (customer.first_name)', type: 'string' },
    { value: 'customer.last_name', label: 'Customer Last Name (customer.last_name)', type: 'string' },
    { value: 'customer.email', label: 'Customer Email (customer.email)', type: 'string' },
    { value: 'customer.mobile', label: 'Customer Mobile (customer.mobile)', type: 'string' },
    { value: 'created_at', label: 'Created At (created_at)', type: 'string' }
  ],
  'sale.order.line': [
    { value: 'items.id', label: 'Line ID (items.id)', type: 'string' },
    { value: 'items.product_id', label: 'Product ID (items.product_id)', type: 'string' },
    { value: 'items.name', label: 'Product Name (items.name)', type: 'string' },
    { value: 'items.sku', label: 'Product SKU (items.sku)', type: 'string' },
    { value: 'items.quantity', label: 'Quantity (items.quantity)', type: 'number' },
    { value: 'items.price', label: 'Unit Price (items.price)', type: 'number' },
    { value: 'items.total', label: 'Line Total (items.total)', type: 'number' }
  ],
  'product.category': [
    { value: 'id', label: 'Category ID (id)', type: 'number' },
    { value: 'name', label: 'Category Name (name)', type: 'string' },
    { value: 'parent_id', label: 'Parent ID (parent_id)', type: 'number' },
    { value: 'status', label: 'Status (status)', type: 'string' }
  ]
}

export default function FieldMappingForm({
  initialModels = [],
  hasOdooConnection = false,
  erpType = 'odoo',
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
  isZidConnected = false,
  isSallaConnected = false,
  onCancel,
  onSuccess,
  fixedMappings = [],
  initialSyncDirection
}: {
  initialModels?: Array<{ model: string; name: string }>
  hasOdooConnection?: boolean
  erpType?: string
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
  isZidConnected?: boolean
  isSallaConnected?: boolean
  onCancel?: () => void
  onSuccess?: () => void
  fixedMappings?: any[]
  initialSyncDirection?: string
}) {
  const { t, lang, dir } = useLanguage()
  const [name, setName] = useState(initialName || '')

  // Determine starting platform dynamically
  const [platform, setPlatform] = useState<'zid' | 'salla'>(() => {
    if (initialAction) {
      const isSallaEvent = SALLA_EVENTS.some(e => e.id === initialAction)
      const isZidEvent = ZID_EVENTS.some(e => e.id === initialAction)
      if (isSallaEvent && !isZidEvent) return 'salla'
      if (isZidEvent && !isSallaEvent) return 'zid'
    }
    return isSallaConnected && !isZidConnected ? 'salla' : 'zid'
  })

  const getErpName = (type: string) => {
    if (type === 'odoo') return 'أودو'
    if (type === 'zoho') return 'زوهو'
    if (type === 'erpnext') return 'ERPNext'
    return 'أودو'
  }
  const getErpNameEn = (type: string) => {
    if (type === 'odoo') return 'Odoo'
    if (type === 'zoho') return 'Zoho'
    if (type === 'erpnext') return 'ERPNext'
    return 'Odoo'
  }

  const SYNC_DIRECTIONS = [
    {
      value: 'store_to_erp',
      label: platform === 'salla'
        ? (lang === 'ar' ? `من سلة إلى ${getErpName(erpType)} (Store ➔ ERP)` : `Salla to ${getErpNameEn(erpType)} (Store ➔ ERP)`)
        : (lang === 'ar' ? `من زد إلى ${getErpName(erpType)} (Store ➔ ERP)` : `Zid to ${getErpNameEn(erpType)} (Store ➔ ERP)`),
      desc: lang === 'ar'
        ? `مزامنة وتحديث البيانات من متجرك الإلكتروني إلى نظام ${getErpName(erpType)}.`
        : `Sync and update data from your e-commerce store into ${getErpNameEn(erpType)}.`
    },
    {
      value: 'erp_to_store',
      label: platform === 'salla'
        ? (lang === 'ar' ? `من ${getErpName(erpType)} إلى سلة (ERP ➔ Store)` : `${getErpNameEn(erpType)} to Salla (ERP ➔ Store)`)
        : (lang === 'ar' ? `من ${getErpName(erpType)} إلى زد (ERP ➔ Store)` : `${getErpNameEn(erpType)} to Zid (ERP ➔ Store)`),
      desc: lang === 'ar'
        ? `مزامنة وتحديث البيانات من نظام ${getErpName(erpType)} إلى متجرك الإلكتروني.`
        : `Sync and update data from ${getErpNameEn(erpType)} into your e-commerce store.`
    }
  ]

  // Set default model state
  const defaultModel = hasOdooConnection && initialModels.length > 0
    ? initialModels[0].model
    : 'product.template'

  const [odooModel, setOdooModel] = useState(initialOdooModel || defaultModel)
  const [odooOperation, setOdooOperation] = useState<'create' | 'update' | 'delete'>(initialOdooOperation || 'create')
  const [odooMatchField, setOdooMatchField] = useState(initialOdooMatchField || '')
  const [zidMatchField, setZidMatchField] = useState(initialZidMatchField || '')
  const [syncDirection, setSyncDirection] = useState<string>(initialSyncDirection || 'store_to_erp')
  const [zidEvent, setZidEvent] = useState(initialAction || (isSallaConnected && !isZidConnected ? 'product.created' : 'product.create'))

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

  // Apply Fixed Mappings automatically
  useEffect(() => {
    if (!fixedMappings || fixedMappings.length === 0) return

    const fm = fixedMappings.find(
      m => m.platform === platform && m.odoo_model === odooModel && m.action === zidEvent
    )
    if (!fm) return

    // 1. Auto-inject the line in mappings state if not present
    setMappings(prev => {
      const currentLines = prev[odooModel] || []
      const alreadyHasField = currentLines.some(l => l.erpField === fm.odoo_field)
      if (alreadyHasField) return prev

      const newLine: MappingLine = {
        id: Math.random().toString(36).substring(2, 9),
        erpField: fm.odoo_field,
        zidField: fm.platform_field,
        staticValue: ''
      }
      return {
        ...prev,
        [odooModel]: [...currentLines, newLine]
      }
    })

    // 2. Set the match fields automatically for update/delete operations
    if (odooOperation === 'update' || odooOperation === 'delete') {
      setOdooMatchField(fm.odoo_field)
      setZidMatchField(fm.platform_field)
    } else {
      setOdooMatchField(prev => prev || fm.odoo_field)
      setZidMatchField(prev => prev || fm.platform_field)
    }
  }, [platform, odooModel, zidEvent, odooOperation, fixedMappings])

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

  // Automatically align Event when Odoo model changes
  useEffect(() => {
    // If we are editing and the model hasn't changed from the initial saved model, do not auto-align
    if (editingId && odooModel === initialOdooModel) {
      return
    }
    const eventsList = platform === 'salla' ? SALLA_EVENTS : ZID_EVENTS
    const fallbackEvent = platform === 'salla' ? 'product.created' : 'product.create'
    const event = eventsList.find(e => e.targetModel === odooModel || (odooModel.includes('product') && e.targetModel === 'product.template'))
    if (event) {
      setZidEvent(event.id)
    } else {
      setZidEvent(fallbackEvent)
    }
  }, [odooModel, initialOdooModel, editingId, platform])

  // Get current active tab properties
  const isModelTab = activeTab === odooModel || activeRelatedModels.some(m => m.model === activeTab)
  const currentModelKey = activeTab
  const currentModelMappings = mappings[currentModelKey] || []

  const currentErpFields = modelFields[currentModelKey] || ODOO_FIELDS[currentModelKey] || []
  const currentZidFields = (() => {
    const activeTabLower = currentModelKey.toLowerCase()
    const activeFields = platform === 'salla' ? SALLA_FIELDS : ZID_FIELDS

    // 1. If we are on a child lines/variants tab, resolve child fields
    if (activeTabLower.includes('line')) {
      return activeFields['sale.order.line'] || []
    }
    if (activeTabLower.includes('product.product') || activeTabLower === 'product.product') {
      return activeFields['product.product'] || []
    }

    // 2. Otherwise, resolve base model fields depending on the selected Event
    if (platform === 'salla') {
      if (SALLA_FIELDS[zidEvent]) {
        return SALLA_FIELDS[zidEvent]
      }
      if (zidEvent === 'product.deleted') {
        return SALLA_FIELDS['product.delete'] || []
      }
      if (zidEvent === 'product.updated' || zidEvent === 'product.publish' || zidEvent === 'product.available' || zidEvent === 'product.quantity.low') {
        return SALLA_FIELDS['product.update'] || []
      }
      if (zidEvent.startsWith('product')) {
        return SALLA_FIELDS['product.template'] || []
      }
      if (zidEvent.startsWith('order') || zidEvent.startsWith('abandoned.cart')) {
        return SALLA_FIELDS['sale.order'] || []
      }
      if (zidEvent.startsWith('customer') || zidEvent.startsWith('store.branch')) {
        return SALLA_FIELDS['res.partner'] || []
      }
      if (zidEvent.startsWith('category')) {
        return SALLA_FIELDS['product.category'] || []
      }
    } else {
      if (ZID_FIELDS[zidEvent]) {
        return ZID_FIELDS[zidEvent]
      }
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
        if (activeTabLower.includes('category') || activeTabLower.includes('group') || (activeTab === odooModel && zidEvent.startsWith('category'))) {
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
    }

    // Fallback based on model namespace
    if (activeTabLower.includes('partner') || activeTabLower.includes('customer')) return activeFields['res.partner'] || []
    if (activeTabLower.includes('order')) return activeFields['sale.order'] || []
    if (activeTabLower.includes('category') || activeTabLower.includes('group') || (activeTab === odooModel && zidEvent.startsWith('category'))) return activeFields['product.category'] || []
    return activeFields['product.template'] || []
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
    const activeFields = platform === 'salla' ? SALLA_FIELDS : ZID_FIELDS
    if (platform === 'salla') {
      if (SALLA_FIELDS[zidEvent]) return SALLA_FIELDS[zidEvent]
      if (zidEvent === 'product.deleted') return SALLA_FIELDS['product.delete'] || []
      if (zidEvent === 'product.updated' || zidEvent === 'product.publish' || zidEvent === 'product.available' || zidEvent === 'product.quantity.low') return SALLA_FIELDS['product.update'] || []
      if (zidEvent.startsWith('product')) return SALLA_FIELDS['product.template'] || []
      if (zidEvent.startsWith('order') || zidEvent.startsWith('abandoned.cart')) return SALLA_FIELDS['sale.order'] || []
      if (zidEvent.startsWith('customer') || zidEvent.startsWith('store.branch')) return SALLA_FIELDS['res.partner'] || []
      if (zidEvent.startsWith('category')) return SALLA_FIELDS['product.category'] || []
    } else {
      if (ZID_FIELDS[zidEvent]) return ZID_FIELDS[zidEvent]
      if (zidEvent === 'product.delete') return ZID_FIELDS['product.delete'] || []
      if (zidEvent === 'product.update' || zidEvent === 'product.publish') return ZID_FIELDS['product.update'] || []
      if (zidEvent.startsWith('product')) return ZID_FIELDS['product.template'] || []
      if (zidEvent.startsWith('order')) return ZID_FIELDS['sale.order'] || []
      if (zidEvent.startsWith('customer')) return ZID_FIELDS['res.partner'] || []
      if (zidEvent === 'category.delete') return ZID_FIELDS['product.category.delete'] || []
      if (zidEvent.startsWith('category')) return ZID_FIELDS['product.category'] || []
      if (zidEvent === 'cart.abandoned') return ZID_FIELDS['cart.abandoned'] || []
    }
    return activeFields['product.template'] || []
  })()

  useEffect(() => {
    if (odooOperation === 'create') return

    // If we are editing and the model and operation haven't changed from the initial saved ones, do not auto-align
    if (editingId && odooModel === initialOdooModel && odooOperation === initialOdooOperation) {
      return
    }

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
    editingId,
    initialOdooModel,
    initialOdooOperation,
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
          placeholder={lang === 'ar' ? 'رقم ثابت...' : 'Static number...'}
          className="h-9 w-full rounded-md border border-transparent bg-transparent px-3 text-sm outline-none hover:border-input hover:bg-muted/30 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        />
      )
    }

    return (
      <input
        type="text"
        value={Array.isArray(mapping.staticValue) ? mapping.staticValue.join(', ') : String(mapping.staticValue || '')}
        onChange={(e) => handleStaticValueChange(mapping.id, e.target.value)}
        disabled={isStaticDisabled}
        placeholder={lang === 'ar' ? 'قيمة ثابتة...' : 'Static value...'}
        className="h-9 w-full rounded-md border border-transparent bg-transparent px-3 text-sm outline-none hover:border-input hover:bg-muted/30 focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
    )
  }

  const handleSave = async () => {
    setIsSaving(true)
    setErrorMessage('')

    if (!name || !name.trim()) {
      setErrorMessage(lang === 'ar' ? 'اسم إعداد الربط مطلوب لتمييز الإعدادات.' : 'Mapping name is required.')
      setIsSaving(false)
      return
    }

    if (((odooOperation === 'update' || odooOperation === 'delete') || syncDirection.split(',').map(s => s.trim()).includes('erp_to_store')) && (!odooMatchField || !zidMatchField)) {
      setErrorMessage(lang === 'ar' ? 'اختر حقلي المطابقة في أودو والمنصة الإلكترونية للربط.' : 'Matching reference fields are required for this sync configuration.')
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
        mappings: mappings,
        platform,
        syncDirection
      })

      if (res.success) {
        setIsSaved(true)
        setToastMessage(
          editingId 
            ? (lang === 'ar' ? 'تم تحديث إعدادات الربط بنجاح!' : 'Field mapping updated successfully!') 
            : (lang === 'ar' ? 'تم حفظ إعدادات الربط بنجاح!' : 'Field mapping saved successfully!')
        )
        setShowToast(true)
        setTimeout(() => {
          setShowToast(false)
          if (onSuccess) onSuccess()
        }, 1500)
      } else {
        setErrorMessage(res.error || (lang === 'ar' ? 'فشل حفظ إعدادات الربط' : 'Failed to save mapping settings'))
      }
    } catch (err: any) {
      console.error('Error saving mapping:', err)
      setErrorMessage(err.message || (lang === 'ar' ? 'حدث خطأ أثناء حفظ إعدادات الربط' : 'An error occurred while saving mapping settings'))
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
    setToastMessage(lang === 'ar' ? 'تم التراجع عن التغييرات' : 'Changes discarded')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 3000)
  }

  return (
    <div className="relative space-y-4 text-foreground font-sans" dir={dir}>

      {/* Top Button Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            variant="default"
            className="gradient-brand text-white font-medium rounded-lg px-3.5 py-1.5 h-8.5 text-xs shadow-sm hover:scale-[1.01] transition-transform duration-200"
          >
            {isSaving ? (
              <Loader2 className={cn("h-3.5 w-3.5 animate-spin", lang === 'ar' ? "ml-1.5" : "mr-1.5")} />
            ) : (
              <Save className={cn("h-3.5 w-3.5", lang === 'ar' ? "ml-1.5" : "mr-1.5")} />
            )}
            {t('ws.saveBtn')}
          </Button>
          <Button
            onClick={handleDiscard}
            disabled={isSaving}
            variant="outline"
            className="border-border hover:bg-muted font-medium rounded-lg px-3.5 py-1.5 h-8.5 text-xs text-muted-foreground transition-all"
          >
            <RotateCcw className={cn("h-3.5 w-3.5", lang === 'ar' ? "ml-1.5" : "mr-1.5")} />
            {lang === 'ar' ? 'إلغاء التغييرات' : 'Discard'}
          </Button>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">{lang === 'ar' ? 'الحالة:' : 'Status:'}</span>
          <span className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border",
            isSaved
              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
              : "bg-amber-500/10 text-amber-500 border-amber-500/20"
          )}>
            {isSaved ? (lang === 'ar' ? 'تم الحفظ' : 'Saved') : (lang === 'ar' ? 'مسودة' : 'Draft')}
          </span>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-500">
          {errorMessage}
        </div>
      )}

      {/* Main Odoo-style Form Sheet */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-md overflow-hidden p-4 md:p-5">

        {/* Name Input */}
        <div className="relative mb-5 group max-w-xl font-sans">
          <div className="flex items-end justify-between border-b border-slate-200 focus-within:border-primary transition-all pb-1">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setIsSaved(false)
              }}
              placeholder={lang === 'ar' ? 'اسم إعداد الربط...' : 'Mapping name...'}
              className="w-full bg-transparent text-lg font-bold outline-none placeholder:text-muted-foreground/40 text-foreground py-0.5 border-0 ring-0 focus:ring-0 focus:border-0"
            />
          </div>
          <p className="text-[11px] text-slate-500 font-medium mt-1">
            {lang === 'ar' ? 'حدد اسماً توضيحياً لقاعدة مطابقة الحقول هذه (مثال: مطابقة المنتجات).' : 'Specify a descriptive identifier for this mapping ruleset (e.g. Products Mapping).'}
          </p>
        </div>

        {/* Master Details Block */}
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 max-w-5xl mb-6 text-xs">
          
          {/* Store Platform (always first, full width) */}
          {isZidConnected && isSallaConnected && !editingId ? (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {lang === 'ar' ? 'منصة المتجر' : 'Store Platform'}
              </label>
              <div className="flex gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200/50 max-w-sm">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPlatform('zid')
                    setZidEvent('product.create')
                    setIsSaved(false)
                  }}
                  className={cn(
                    "flex-1 h-8 rounded-lg text-xs font-semibold shadow-none transition-all",
                    platform === 'zid' 
                      ? "bg-white text-slate-800 border border-slate-200 shadow-sm" 
                      : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {lang === 'ar' ? 'زد (Zid)' : 'Zid'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setPlatform('salla')
                    setZidEvent('product.created')
                    setIsSaved(false)
                  }}
                  className={cn(
                    "flex-1 h-8 rounded-lg text-xs font-semibold shadow-none transition-all",
                    platform === 'salla' 
                      ? "bg-white text-slate-800 border border-slate-200 shadow-sm" 
                      : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {lang === 'ar' ? 'سلة (Salla)' : 'Salla'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {lang === 'ar' ? 'منصة المتجر' : 'Store Platform'}
              </label>
              <div className="flex h-9 items-center px-3 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 capitalize dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 w-fit">
                {platform === 'salla' ? (lang === 'ar' ? 'سلة (Salla)' : 'Salla') : (lang === 'ar' ? 'زد (Zid)' : 'Zid')}
              </div>
            </div>
          )}

          {/* Sync Direction Block */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
              {lang === 'ar' ? 'اتجاه المزامنة' : 'Sync Direction'}
            </label>
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
              <SearchableSelect
                multiple={true}
                value={syncDirection ? syncDirection.split(',').filter(Boolean) : []}
                onChange={(vals: string[]) => {
                  setSyncDirection(vals.join(','))
                  setIsSaved(false)
                }}
                options={SYNC_DIRECTIONS}
                placeholder={lang === 'ar' ? 'اختر اتجاه المزامنة...' : 'Select sync direction...'}
              />
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              {lang === 'ar'
                ? 'حدد اتجاهات المزامنة المفعلة لقاعدة الربط هذه.'
                : 'Determine the enabled synchronization directions for this mapping.'}
            </p>
          </div>

          {/* Core Sync Operation */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
              {t('map.operationLabel')}
            </label>
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
              <SearchableSelect
                value={odooOperation}
                onChange={(val) => {
                  if (val === 'create' || val === 'update' || val === 'delete') {
                    setOdooOperation(val)
                    setIsSaved(false)
                  }
                }}
                options={ODOO_OPERATIONS.map(opt => ({
                  value: opt.value,
                  label: formatFieldLabel(opt.label, lang)
                }))}
                placeholder={t('map.selectEventPlaceholder')}
              />
            </div>            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              {lang === 'ar' ? `العملية التي ينفذها المحرك تلقائياً داخل ${getErpName(erpType)} لهذا الربط.` : `The operation executed automatically by the sync engine in ${getErpNameEn(erpType)} for this mapping.`}
            </p>
          </div>

          {/* ERP Model & Store Event (side-by-side) */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
              {lang === 'ar' ? `نموذج ${getErpName(erpType)}` : `${getErpNameEn(erpType)} Model`}
            </label>
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
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
                      label: model.name ? `${formatFieldLabel(model.name, lang)} (${model.model})` : model.model,
                      desc: model.model
                    }))
                    : ODOO_MODELS.map(model => ({
                      value: model.id,
                      label: formatFieldLabel(model.name, lang),
                      desc: model.desc
                    }))
                }
                placeholder={lang === 'ar' ? `ابحث أو اختر نموذج ${getErpName(erpType)}...` : `Search or select ${getErpNameEn(erpType)} model...`}
              />
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              {lang === 'ar' ? `النموذج الأساسي الذي يمثل البيانات في نظام ${getErpName(erpType)} ERP.` : `The primary model class representing data in ${getErpNameEn(erpType)} ERP.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
              {platform === 'salla' 
                ? (lang === 'ar' ? 'حدث سلة' : 'Salla Event') 
                : (lang === 'ar' ? 'حدث زد' : 'Zid Event')}
            </label>
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
              <SearchableSelect
                value={zidEvent}
                onChange={(val) => {
                  setZidEvent(val)
                  setIsSaved(false)
                }}
                options={(platform === 'salla' ? SALLA_EVENTS : ZID_EVENTS).map(event => ({
                  value: event.id,
                  label: formatFieldLabel(event.name, lang),
                }))}
                placeholder={t('map.selectEventPlaceholder')}
              />
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              {platform === 'salla'
                ? (lang === 'ar' ? 'الحدث المفعل لعملية المزامنة من منصة سلة.' : 'The trigger event on Salla ecommerce platform.')
                : (lang === 'ar' ? 'الحدث المفعل لعملية المزامنة من منصة زد.' : 'The trigger event on Zid ecommerce platform.')}
            </p>
          </div>

          {/* Reference Field & Store Reference Field (conditional, side-by-side) */}
          {(odooOperation === 'update' || odooOperation === 'delete' || syncDirection.split(',').map(s => s.trim()).includes('erp_to_store')) && (
            <>
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
                  {lang === 'ar' ? `حقل ${getErpName(erpType)} المرجعي للمطابقة` : `${getErpNameEn(erpType)} Reference Field`}
                </label>
                <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
                  <SearchableSelect
                    value={odooMatchField}
                    onChange={(val) => {
                      setOdooMatchField(val)
                      setIsSaved(false)
                    }}
                    options={primaryMatchErpFields.map(opt => ({
                      ...opt,
                      label: formatFieldLabel(opt.label, lang)
                    }))}
                    placeholder={t('map.selectField')}
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                  {lang === 'ar' ? `الحقل الذي سيتم البحث به داخل نموذج ${getErpName(erpType)} المختار للمطابقة.` : `The field used to search and match records inside the selected ${getErpNameEn(erpType)} model.`}
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
                  {platform === 'salla'
                    ? (lang === 'ar' ? 'حقل سلة المرجعي للمطابقة' : 'Salla Reference Field')
                    : (lang === 'ar' ? 'حقل زد المرجعي للمطابقة' : 'Zid Reference Field')}
                </label>
                <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
                  <SearchableSelect
                    value={zidMatchField}
                    onChange={(val) => {
                      setZidMatchField(val)
                      setIsSaved(false)
                    }}
                    options={primaryMatchZidFields.map(opt => ({
                      ...opt,
                      label: formatFieldLabel(opt.label, lang)
                    }))}
                    placeholder={t('map.selectField')}
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                  {platform === 'salla'
                    ? (lang === 'ar' ? `قيمة هذا الحقل من الويب هوك الخاص بسلة ستُطابق حقل ${getErpName(erpType)} المرجعي.` : `The value from this Salla webhook field will be matched against the ${getErpNameEn(erpType)} reference field.`)
                    : (lang === 'ar' ? `قيمة هذا الحقل من الويب هوك الخاص بزد ستُطابق حقل ${getErpName(erpType)} المرجعي.` : `The value from this Zid webhook field will be matched against the ${getErpNameEn(erpType)} reference field.`)}
                </p>
              </div>
            </>
          )}

          {/* Related Models & Mapping Tip (side-by-side) */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
              {lang === 'ar' ? 'النماذج الفرعية المرتبطة' : `Related ${getErpNameEn(erpType)} Models`}
            </label>
            <div className="rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
              <SearchableSelect
                value={relatedOdooModels}
                onChange={handleRelatedModelsChange}
                multiple={true}
                options={
                  hasOdooConnection && initialModels.length > 0
                    ? initialModels.map(model => ({
                      value: model.model,
                      label: model.name ? `${formatFieldLabel(model.name, lang)} (${model.model})` : model.model,
                      desc: model.model
                    }))
                    : ODOO_MODELS.map(model => ({
                      value: model.id,
                      label: formatFieldLabel(model.name, lang),
                      desc: model.desc
                    }))
                }
                placeholder={lang === 'ar' ? 'ابحث واختر نماذج فرعية مرتبطة...' : `Search and select related ${getErpNameEn(erpType)} models...`}
              />
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
              {lang === 'ar' ? 'يمكنك كتابة واختيار أكثر من نموذج فرعي مرتبط في نفس الوقت لربط البيانات المتداخلة كأجزاء من النموذج الرئيسي.' : 'You can search and select multiple related child models to map nested structures as parts of the primary model.'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200/20 dark:border-slate-800 bg-slate-500/5 dark:bg-slate-950/40 p-4 flex flex-col justify-center text-[11px] leading-relaxed text-slate-400 space-y-1 min-h-[90px] h-auto">
            <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
              💡 {lang === 'ar' ? 'نصيحة مطابقة الحقول' : 'Mapping Tip'}
            </span>
            <span>
              {lang === 'ar' 
                ? 'يمكنك مطابقة النماذج الفرعية ديناميكياً. اختر النموذج الرئيسي أولاً (مثل أمر البيع)، ثم اختر الجداول الفرعية التابعة له (مثل بند الطلب) لإنشاء ربط متكامل.' 
                : 'You can map child models dynamically. Select a main model (e.g. Sales Order) first, then select its children rows (e.g. Order Line) to create composite structures.'}
            </span>
          </div>
        </div>

        {/* Notebook / Tabs Selector */}
        <div className="border-b border-border/80 flex items-center justify-between mb-3.5">
          <div className="flex gap-1 overflow-x-auto">
            {/* Primary Model Tab */}
            <button
              onClick={() => setActiveTab(odooModel)}
              className={cn(
                "px-3 py-2 font-medium text-xs transition-all relative border-t-2 whitespace-nowrap",
                activeTab === odooModel
                  ? "border-t-primary bg-card text-foreground font-semibold border-x border-b border-b-card -mb-[1px] rounded-t-md"
                  : "border-t-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {lang === 'ar' ? 'تفاصيل الربط' : 'Mapping Details'} ({hasOdooConnection && initialModels.find(m => m.model === odooModel)?.name ? formatFieldLabel(initialModels.find(m => m.model === odooModel)!.name, lang) : ODOO_MODELS.find(m => m.id === odooModel)?.name ? formatFieldLabel(ODOO_MODELS.find(m => m.id === odooModel)!.name, lang) : odooModel})
            </button>

            {/* Related Models Tabs */}
            {activeRelatedModels.map(rel => (
              <button
                key={rel.model}
                onClick={() => setActiveTab(rel.model)}
                className={cn(
                  "px-3 py-2 font-medium text-xs transition-all relative border-t-2 whitespace-nowrap",
                  activeTab === rel.model
                    ? "border-t-primary bg-card text-foreground font-semibold border-x border-b border-b-card -mb-[1px] rounded-t-md"
                    : "border-t-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {formatFieldLabel(rel.label, lang)}
              </button>
            ))}

            {/* Settings Tab */}
            <button
              onClick={() => setActiveTab('settings')}
              className={cn(
                "px-3 py-2 font-medium text-xs transition-all relative border-t-2 whitespace-nowrap",
                activeTab === 'settings'
                  ? "border-t-primary bg-card text-foreground font-semibold border-x border-b border-b-card -mb-[1px] rounded-t-md"
                  : "border-t-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {lang === 'ar' ? 'الإعدادات المتقدمة' : 'Advanced Settings'}
            </button>
          </div>

          <div className="text-muted-foreground/40 pr-2 hidden sm:block">
            <ArrowRightLeft className="h-3.5 w-3.5" />
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
                  <table className="w-full text-start border-collapse">
                    <thead>
                      <tr className="bg-muted/40 text-xs uppercase font-bold text-muted-foreground tracking-wider border-b border-border/80">
                        <th className="py-3 px-4 font-semibold text-start flex items-center gap-2">
                          {t('map.erpField')} ({currentModelKey})
                          {isLoadingFields[currentModelKey] && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        </th>
                        <th className="py-3 px-4 font-semibold text-start">{t('map.zidField')}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t('map.staticValue')}</th>
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
                            <td className="py-1 px-4 text-start">
                              <SearchableSelect
                                value={mapping.erpField}
                                onChange={(val) => {
                                  handleFieldChange(mapping.id, 'erpField', val)
                                }}
                                options={currentErpFields.map(opt => ({
                                  ...opt,
                                  label: formatFieldLabel(opt.label, lang)
                                }))}
                                placeholder={t('map.selectField')}
                                variant="cell"
                              />
                            </td>

                            {/* Zid Field selection */}
                            <td className="py-1 px-4 text-start">
                              <div className="flex items-center gap-1">
                                <SearchableSelect
                                  value={mapping.zidField || ''}
                                  onChange={(val) => {
                                    handleFieldChange(mapping.id, 'zidField', val)
                                  }}
                                  options={[
                                    { value: '', label: t('map.clear') },
                                    ...currentZidFields.map(opt => ({
                                      ...opt,
                                      label: formatFieldLabel(opt.label, lang)
                                    }))
                                  ]}
                                  placeholder={t('map.selectField')}
                                  variant="cell"
                                  disabled={hasStaticValue(mapping.staticValue)}
                                />
                                {mapping.zidField && (
                                  <button
                                    type="button"
                                    onClick={() => handleFieldChange(mapping.id, 'zidField', '')}
                                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                                    title={lang === 'ar' ? 'إزالة حقل المتجر' : 'Clear store field'}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* Static Value selection/input */}
                            <td className="py-1 px-4 text-start">
                              <div className="flex items-center gap-1">
                                {renderStaticValueInput(mapping)}
                                {hasStaticValue(mapping.staticValue) && (
                                  <button
                                    type="button"
                                    onClick={() => handleStaticValueChange(mapping.id, Array.isArray(mapping.staticValue) ? [] : '')}
                                    className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                                    title={lang === 'ar' ? 'إزالة القيمة الثابتة' : 'Clear static value'}
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
                                title={lang === 'ar' ? 'حذف حقل الربط' : 'Remove Mapping Rule'}
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
                            {t('map.noMappings')}
                          </td>
                        </tr>
                      )}

                      {/* Add a Line Row */}
                      <tr>
                        <td colSpan={4} className="py-3 px-4">
                          <button
                            onClick={handleAddLine}
                            className="text-primary hover:text-primary/80 font-semibold flex items-center gap-1.5 transition-all hover:translate-x-0.5 text-sm"
                          >
                            <Plus className="h-4 w-4" />
                            {t('map.addFieldBtn')}
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
                className="p-4 border border-border rounded-lg bg-muted/20 space-y-4 text-sm text-start"
              >
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-primary" />
                  {t('map.advancedSettings')}
                </h3>
                <div className="space-y-4 max-w-xl">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" id="sync-bi" className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary" defaultChecked />
                    <div>
                      <label htmlFor="sync-bi" className="font-semibold block text-foreground">{lang === 'ar' ? 'مزامنة ثنائية الاتجاه' : 'Bi-directional Sync'}</label>
                      <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'إبقاء المنصتين متزامنتين عند تعديل البيانات في أي منهما.' : 'Keep both platforms synchronized when either side is modified.'}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" id="sync-delete" className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary" />
                    <div>
                      <label htmlFor="sync-delete" className="font-semibold block text-foreground">{lang === 'ar' ? 'مزامنة عمليات الحذف' : 'Sync Deletions'}</label>
                      <span className="text-xs text-muted-foreground">{lang === 'ar' ? `حذف المنتج من متجر زد تلقائياً عند أرشفته أو حذفه في نظام ${getErpName(erpType)}.` : `Delete product on Zid when it is archived/deleted in ${getErpNameEn(erpType)}.`}</span>
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
