'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  FolderTree,
  Package,
  ShoppingCart,
  SlidersHorizontal,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { getFieldMappings } from '@/app/actions/field-mappings'
import { disableOdooStockWebhook, enableOdooStockWebhook, type OdooStockWebhookRefs } from '@/app/actions/inventory-sync'
import {
  getOdooAnalyticAccounts,
  getOdooCurrencies,
  getOdooCustomers,
  getOdooFieldValueOptions,
  getOdooJournals,
  getOdooLocations,
  getOdooProducts,
  getOdooTaxes,
  getOdooWarehouses,
} from '@/app/actions/odoo'
import {
  checkZidOrderStatusField,
  createZidOrderStatusFieldInOdoo,
} from '@/app/actions/order-custom-status'
import { getOrderStatusMappings, saveOrderStatusMappings } from '@/app/actions/order-status-mappings'
import { getSallaLocations, getSallaPaymentMethods, type SallaLocation } from '@/app/actions/salla'
import { getStandardMappingSettings, saveStandardMappingSettings } from '@/app/actions/standard-mapping'
import { deleteStaticMapping, getStaticMappings, saveStaticMapping } from '@/app/actions/static-mappings'
import { getZidLocations, getZidPaymentMethods, type ZidLocation } from '@/app/actions/zid'
import { useLanguage } from '@/components/language-provider'
import CategoryMappingDialog from '@/components/mapping/category-mapping-dialog'
import ProductMappingDialog from '@/components/mapping/product-mapping-dialog'
import { useToast } from '@/hooks/use-toast'
import { toOdooFieldOption, type OdooFieldOption } from '@/lib/odoo-field-options'
import {
  DEFAULT_ZID_ORDER_STATUSES,
  defaultOrderStatusFieldName,
  type ZidStatusOption,
} from '@/lib/order-custom-status-constants'
import { SALLA_FIELDS } from '@/lib/platforms/salla/fields'
import { SHOPIFY_FIELDS } from '@/lib/platforms/shopify/fields'
import { ZID_FIELDS } from '@/lib/platforms/zid/fields'
import { cn } from '@/lib/utils'

import { CategorySettingsTab } from './standard-components/category-settings-tab'
import { CustomerSettingsTab } from './standard-components/customer-settings-tab'
import { OrderSettingsTab, type CountryTaxRateRule, type VatCountryRuleRow } from './standard-components/order-settings-tab'
import { ProductSettingsTab } from './standard-components/product-settings-tab'
import SyncLogModal from './sync-log-modal'

interface StandardMappingClientProps {
  hasOdooConnection: boolean
  erpType?: string
  /** Multi-store: every linked store per platform (id = merchant_id / shop_domain). */
  zidStores?: { id: string; name: string | null }[]
  sallaStores?: { id: string; name: string | null }[]
  shopifyStores?: { id: string; name: string | null }[]
  initialSubTab?: 'categories' | 'products' | 'customers' | 'orders'
}

/**
 * One analytic-distribution rule row. Numeric fields are kept as strings so
 * the inputs stay editable while typing (same pattern as the warehouse rules).
 */
type AnalyticRuleRow = {
  rowKey: string
  condition: 'all' | 'warehouse' | 'payment'
  source_value: string
  source_label: string
  odoo_analytic_account_id: string
  percentage: string
}

/**
 * Loads the field list for one Odoo model into `setFields`, tracking its own
 * loading flag. Every mapping tab needs exactly this, differing only by model
 * and target state — so the fetch/transform/finally sequence lives here once
 * instead of being copy-pasted per tab.
 */
function useOdooModelFields(
  model: string,
  enabled: boolean,
  setFields: (fields: OdooFieldOption[]) => void,
  setLoading: (loading: boolean) => void
) {
  return useCallback(
    async (force = true) => {
      if (!enabled) return
      setLoading(true)
      try {
        const { getOdooModelFields } = await import('@/app/actions/odoo')
        const res = await getOdooModelFields(model, force)
        if (res.success && res.fields) {
          setFields(res.fields.map(toOdooFieldOption))
        }
      } catch (error) {
        console.error(`Failed to fetch Odoo fields for ${model}:`, error)
      } finally {
        setLoading(false)
      }
    },
    [model, enabled, setFields, setLoading]
  )
}

export default function StandardMappingClient({
  hasOdooConnection,
  zidStores = [],
  sallaStores = [],
  shopifyStores = [],
  initialSubTab,
}: StandardMappingClientProps) {
  const [mappings, setMappings] = useState<any[]>([])
  const [, setIsLoading] = useState(true)
  const { lang, dir } = useLanguage()

  // Standard Mapping
  const [standardSubTab, setStandardSubTab] = useState<'categories' | 'products' | 'customers' | 'orders'>(initialSubTab || 'categories')
  // Per-store tabs: each linked store (even several of one platform) gets its
  // own tab with its own settings. standardStoreTab stays the platform key
  // (all downstream platform logic reads it); standardStoreId scopes the row.
  const firstStore = zidStores[0] ? { platform: 'zid', storeId: zidStores[0].id }
    : sallaStores[0] ? { platform: 'salla', storeId: sallaStores[0].id }
    : shopifyStores[0] ? { platform: 'shopify', storeId: shopifyStores[0].id }
    : { platform: 'zid', storeId: '' }
  const [standardStoreTab, setStandardStoreTab] = useState<string>(firstStore.platform)
  const [standardStoreId, setStandardStoreId] = useState<string>(firstStore.storeId)
  const selectStoreTab = (platform: string, storeId: string) => {
    setStandardStoreTab(platform)
    setStandardStoreId(storeId)
  }

  // ── Category States ──
  const [costMethodOptions, setCostMethodOptions] = useState<{ value: string; label: string }[]>([])
  const [valuationOptions, setValuationOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingOdooOpts, setIsLoadingOdooOpts] = useState(false)

  const [odooCategoryFields, setOdooCategoryFields] = useState<{ value: string; label: string }[]>([])
  const [isLoadingOdooFields, setIsLoadingOdooFields] = useState(false)
  const [matchZidField, setMatchZidField] = useState('')
  const [matchOdooField, setMatchOdooField] = useState('')
  const [costMethod, setCostMethod] = useState('')
  const [inventoryValuation, setInventoryValuation] = useState('')
  const [onDeleteAction, setOnDeleteAction] = useState('nothing')
  const [enabledActions, setEnabledActions] = useState<string[]>([])
  const [disabled, setDisabled] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // ── Product States ──
  const [productTypeOptions, setProductTypeOptions] = useState<{ value: string; label: string }[]>([])
  const [trackingOptions, setTrackingOptions] = useState<{ value: string; label: string }[]>([])
  const [productOdooFields, setProductOdooFields] = useState<{ value: string; label: string }[]>([])
  const [taxOptions, setTaxOptions] = useState<{ value: string; label: string; desc?: string }[]>([])
  const [isLoadingProductOpts, setIsLoadingProductOpts] = useState(false)
  const [isLoadingProductFields, setIsLoadingProductFields] = useState(false)
  const [isLoadingTaxOpts, setIsLoadingTaxOpts] = useState(false)

  const [productType, setProductType] = useState('')
  const [trackInventory, setTrackInventory] = useState(true)
  const [trackingMethod, setTrackingMethod] = useState('')

  // ── Odoo → Zid Inventory Sync (مزامنة المخزون) ──
  const [invSyncEnabled, setInvSyncEnabled] = useState(false)
  const [invSyncMode, setInvSyncMode] = useState<'actual' | 'forecast'>('actual')
  const [odooStockWebhook, setOdooStockWebhook] = useState<OdooStockWebhookRefs | null>(null)
  const [invSyncPairs, setInvSyncPairs] = useState<{
    id?: string
    source_location_id: string
    source_location_name: string
    odoo_location_id: string
    _removed?: boolean
  }[]>([])
  const [zidLocations, setZidLocations] = useState<ZidLocation[]>([])
  const [sallaLocations, setSallaLocations] = useState<SallaLocation[]>([])
  const [odooLocations, setOdooLocations] = useState<Array<{ id: number; name: string; complete_name: string; usage: string }>>([])
  const [isLoadingInvSync, setIsLoadingInvSync] = useState(false)
  const [isRefreshingInvLocations, setIsRefreshingInvLocations] = useState(false)
  const [isSavingPairs, setIsSavingPairs] = useState(false)
  const [isSyncingWebhook, setIsSyncingWebhook] = useState(false)
  const [invSyncWebhookError, setInvSyncWebhookError] = useState('')
  const [markupPercent, setMarkupPercent] = useState(0)
  const [costSource, setCostSource] = useState('cost')
  const [priceSource, setPriceSource] = useState('price')
  const [rounding, setRounding] = useState('')
  const [decimalPlaces, setDecimalPlaces] = useState(2)
  const [nameLanguage, setNameLanguage] = useState('ar')
  const [nameFallback, setNameFallback] = useState(true)
  const [descLanguage, setDescLanguage] = useState('ar')
  const [descFallback, setDescFallback] = useState('none')
  const [descCustomText, setDescCustomText] = useState('')
  const [imageSyncMode, setImageSyncMode] = useState('all')
  const [categorySyncMode, setCategorySyncMode] = useState('auto')
  const [uomAutoCreate, setUomAutoCreate] = useState(true)
  const [taxSyncMode, setTaxSyncMode] = useState('auto_by_name')
  const [defaultTaxIds, setDefaultTaxIds] = useState<string[]>([])
  const [productMatchZidField, setProductMatchZidField] = useState('')
  const [productMatchOdooField, setProductMatchOdooField] = useState('')
  const [productOnDelete, setProductOnDelete] = useState('nothing')
  const [productEnabledActions, setProductEnabledActions] = useState<string[]>(['create', 'update', 'delete'])
  const [productDisabled, setProductDisabled] = useState(false)
  const [productVariantSyncMode, setProductVariantSyncMode] = useState<'AS_VARIANTS' | 'AS_SEPARATE_PRODUCTS'>('AS_VARIANTS')
  const [bomEnabled, setBomEnabled] = useState<boolean>(false)
  const [bomType, setBomType] = useState<'phantom' | 'normal'>('phantom')
  const [isSavingProducts, setIsSavingProducts] = useState(false)

  // ── Customer States ──
  const [odooCustomerFields, setOdooCustomerFields] = useState<{ value: string; label: string }[]>([])
  const [isLoadingCustomerFields, setIsLoadingCustomerFields] = useState(false)
  const [customerMatchZidField, setCustomerMatchZidField] = useState('')
  const [customerMatchOdooField, setCustomerMatchOdooField] = useState('')
  const [customerOnDelete, setCustomerOnDelete] = useState('nothing')
  const [customerEnabledActions, setCustomerEnabledActions] = useState<string[]>(['create', 'update', 'delete'])
  const [customerDisabled, setCustomerDisabled] = useState(false)
  const [customerDefaultType, setCustomerDefaultType] = useState('auto')
  const [receivableAccountId, setReceivableAccountId] = useState('')
  const [payableAccountId, setPayableAccountId] = useState('')
  const [receivableAccountOptions, setReceivableAccountOptions] = useState<{ value: string; label: string }[]>([])
  const [payableAccountOptions, setPayableAccountOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false)
  const [isSavingCustomers, setIsSavingCustomers] = useState(false)

  // ── Company States ──
  const [categoryCompanyId, setCategoryCompanyId] = useState('')
  const [categoryLinkCompany, setCategoryLinkCompany] = useState(false)
  const [productCompanyId, setProductCompanyId] = useState('')
  const [productLinkCompany, setProductLinkCompany] = useState(false)
  const [customerCompanyId, setCustomerCompanyId] = useState('')
  const [customerLinkCompany, setCustomerLinkCompany] = useState(false)
  const [companyOptions, setCompanyOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(false)

  // ── Order States ──
  const [orderDisabled, setOrderDisabled] = useState(false)
  const [orderEnabledActions, setOrderEnabledActions] = useState<string[]>(['create', 'update', 'cancel', 'deliver'])
  const [orderMatchZidField, setOrderMatchZidField] = useState('')
  const [orderMatchOdooField, setOrderMatchOdooField] = useState('')
  const [orderCompanyId, setOrderCompanyId] = useState('')
  const [orderLinkCompany, setOrderLinkCompany] = useState(true)
  const [orderWarehouseId, setOrderWarehouseId] = useState('')
  const [orderPricelistId, setOrderPricelistId] = useState('')
  const [orderPaymentTermId, setOrderPaymentTermId] = useState('')
  const [orderMultiCurrencyEnabled, setOrderMultiCurrencyEnabled] = useState(false)
  const [orderBaseCurrencyId, setOrderBaseCurrencyId] = useState('')
  const [orderAutoConfirm, setOrderAutoConfirm] = useState(false)
  const [orderAutoInvoice, setOrderAutoInvoice] = useState(false)
  const [orderPartialFulfillment, setOrderPartialFulfillment] = useState(false)
  // Store returns: what to do in Odoo when a merchant reverses / refunds an
  // order. `nothing` is the default so existing workspaces are unaffected.
  const [orderReturnsMode, setOrderReturnsMode] = useState<'nothing' | 'negative_so' | 'stock_return_credit_note'>('nothing')
  const [orderReturnsCreditNote, setOrderReturnsCreditNote] = useState(true)
  const [orderReturnsJournalId, setOrderReturnsJournalId] = useState('')
  const [orderReturnsFallback, setOrderReturnsFallback] = useState<'skip' | 'negative_so'>('skip')
  const [orderReturnsReason, setOrderReturnsReason] = useState('')
  const [orderReturnsReasonType, setOrderReturnsReasonType] = useState<'store_reason' | 'custom'>('store_reason')
  // Multi-warehouse rules: Zid location ↔ Odoo warehouse. Row-based so the
  // Zid side is a stable row key rather than an object key (a Record can't
  // represent two half-filled rows without clobbering one of them).
  const [storeWarehouseRules, setStoreWarehouseRules] = useState<Array<{
    rowKey: string
    zid_location_id: string
    odoo_warehouse_id: string
  }>>([])
  const [isRefreshingOrderWarehouses, setIsRefreshingOrderWarehouses] = useState(false)

  // Analytic distribution (Zid + Salla): match by warehouse, by payment method,
  // or fall back to a unified rule. Percentages are relative weights and are
  // normalised to 100 before they reach Odoo.
  const [orderAnalyticEnabled, setOrderAnalyticEnabled] = useState(false)
  const [orderAnalyticRules, setOrderAnalyticRules] = useState<AnalyticRuleRow[]>([])
  const [analyticAccountOptions, setAnalyticAccountOptions] = useState<{ value: string; label: string }[]>([])
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<{ value: string; label: string }[]>([])
  const [orderPaymentAutoSync, setOrderPaymentAutoSync] = useState(true)
  const [orderPaymentJournalMappings, setOrderPaymentJournalMappings] = useState<
    Array<{ rowKey: string; zid_payment_method: string; odoo_journal_id: string }>
  >([])
  const [isLoadingPaymentMethods, setIsLoadingPaymentMethods] = useState(false)
  const [isLoadingAnalyticOptions, setIsLoadingAnalyticOptions] = useState(false)
  const [analyticOptionsError, setAnalyticOptionsError] = useState('')



  // Shipping & Discount Line items
  const [orderAddShipping, setOrderAddShipping] = useState(false)
  const [orderShippingProductId, setOrderShippingProductId] = useState('')
  const [orderShippingProductSku, setOrderShippingProductSku] = useState('')
  const [orderAddCod, setOrderAddCod] = useState(false)
  const [orderCodProductId, setOrderCodProductId] = useState('')
  const [orderCodProductSku, setOrderCodProductSku] = useState('')
  const [orderCodAmount, setOrderCodAmount] = useState('')
  const [orderAddDiscount, setOrderAddDiscount] = useState(false)
  const [orderDiscountProductId, setOrderDiscountProductId] = useState('')
  const [orderDiscountProductSku, setOrderDiscountProductSku] = useState('')
  const [orderDiscountMode, setOrderDiscountMode] = useState('fixed')

  // VAT (ضريبة القيمة المضافة)
  const [orderEnableVat, setOrderEnableVat] = useState(false)
  const [orderVatSaudiTaxId, setOrderVatSaudiTaxId] = useState('')
  const [orderVatNonSaudiTaxId, setOrderVatNonSaudiTaxId] = useState('')
  const [orderVatCountryRules, setOrderVatCountryRules] = useState<VatCountryRuleRow[]>([
    { rowKey: 'vat-sa', country_code: 'SA', country_name: 'المملكة العربية السعودية', tax_id: '' },
    { rowKey: 'vat-other', country_code: 'OTHER', country_name: 'باقي الدول', tax_id: '' },
  ])
  const [orderTaxOptions, setOrderTaxOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingOrderTaxes, setIsLoadingOrderTaxes] = useState(false)
  const [orderPricesIncludeTax, setOrderPricesIncludeTax] = useState(false)
  const [orderTaxRatePercent, setOrderTaxRatePercent] = useState('15')
  const [orderCountryTaxRates, setOrderCountryTaxRates] = useState<CountryTaxRateRule[]>([
    { rowKey: 'rule-sa', country_code: 'SA', country_name: 'السعودية', tax_rate: '15' }
  ])

  // Status mapping
  const [orderStateMapping, setOrderStateMapping] = useState<
    Record<string, { state: string; enabled: boolean; invoice_action?: string; picking_action?: string }>
  >({})

  // Zid Order Status Custom Field in Odoo
  const [orderUpdateCustomStatus, setOrderUpdateCustomStatus] = useState<boolean>(false)
  const [orderStatusCustomField, setOrderStatusCustomField] = useState<string>('')
  const [isCreatingStatusField, setIsCreatingStatusField] = useState<boolean>(false)
  const [statusFieldExists, setStatusFieldExists] = useState<boolean>(false)
  const [statusFieldOptions, setStatusFieldOptions] = useState<ZidStatusOption[]>(DEFAULT_ZID_ORDER_STATUSES)

  // Odoo fields and options loading states
  const [odooOrderFields, setOdooOrderFields] = useState<{ value: string; label: string }[]>([])
  const [isLoadingOrderFields, setIsLoadingOrderFields] = useState(false)
  const [warehouseOptions, setWarehouseOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false)
  const [pricelistOptions, setPricelistOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingPricelists, setIsLoadingPricelists] = useState(false)
  const [paymentTermOptions, setPaymentTermOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingPaymentTerms, setIsLoadingPaymentTerms] = useState(false)
  const [currencyOptions, setCurrencyOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingCurrencies, setIsLoadingCurrencies] = useState(false)
  const [journalOptions, setJournalOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingJournals, setIsLoadingJournals] = useState(false)
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingProducts, setIsLoadingProducts] = useState(false)
  const [isSavingOrders, setIsSavingOrders] = useState(false)

  // Customer & Product Fallback Matching Policies
  const [orderCustomerFallbackPolicy, setOrderCustomerFallbackPolicy] = useState<'create_new' | 'skip_order' | 'default_customer'>('create_new')
  const [orderDefaultCustomerId, setOrderDefaultCustomerId] = useState('')
  const [customerOptions, setCustomerOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false)

  const [orderProductFallbackPolicy, setOrderProductFallbackPolicy] = useState<'create_new' | 'skip_order' | 'default_product'>('create_new')
  const [orderDefaultProductId, setOrderDefaultProductId] = useState('')

  const { toast } = useToast()

  const handleRefreshCustomers = useCallback(async (force = true) => {
    if (!hasOdooConnection) return
    setIsLoadingCustomers(true)
    try {
      const res = await getOdooCustomers(force)
      if (res.success && res.options) {
        setCustomerOptions(res.options)
      } else if (res.error) {
        toast({
          title: lang === 'ar' ? 'فشل تحميل العملاء' : 'Failed to load customers',
          description: res.error,
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('Failed to refresh customers:', err)
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: err?.message || (lang === 'ar' ? 'فشل الاتصال بأودو' : 'Failed to connect to Odoo'),
        variant: 'destructive',
      })
    } finally {
      setIsLoadingCustomers(false)
    }
  }, [hasOdooConnection, lang, toast])

  const handleRefreshProducts = useCallback(async (force = true) => {
    if (!hasOdooConnection) return
    setIsLoadingProducts(true)
    try {
      const res = await getOdooProducts(force)
      if (res.success && res.options) {
        setProductOptions(res.options)
      } else if (res.error) {
        toast({
          title: lang === 'ar' ? 'فشل تحميل المنتجات' : 'Failed to load products',
          description: res.error,
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('Failed to refresh products:', err)
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: err?.message || (lang === 'ar' ? 'فشل الاتصال بأودو' : 'Failed to connect to Odoo'),
        variant: 'destructive',
      })
    } finally {
      setIsLoadingProducts(false)
    }
  }, [hasOdooConnection, lang, toast])

  const categoryFields = (standardStoreTab === 'salla' ? SALLA_FIELDS['product.category']
    : standardStoreTab === 'shopify' ? SHOPIFY_FIELDS['collections/create']
    : ZID_FIELDS['product.category'] || []).map(f => ({ value: f.value, label: f.label }))
  const productFields = (standardStoreTab === 'salla' ? SALLA_FIELDS['product.template']
    : standardStoreTab === 'shopify' ? SHOPIFY_FIELDS['products/create']
    : ZID_FIELDS['product.template'] || []).map(f => ({ value: f.value, label: f.label }))
  const customerFields = (standardStoreTab === 'salla' ? SALLA_FIELDS['res.partner']
    : standardStoreTab === 'shopify' ? SHOPIFY_FIELDS['customers/create']
    : ZID_FIELDS['res.partner'] || []).map(f => ({ value: f.value, label: f.label }))
  const orderFields = (standardStoreTab === 'salla' ? SALLA_FIELDS['sale.order']
    : standardStoreTab === 'shopify' ? SHOPIFY_FIELDS['orders/create']
    : ZID_FIELDS['sale.order'] || []).map(f => ({ value: f.value, label: f.label }))

  const getOrderPlatformStatuses = () => {
    if (standardStoreTab === 'salla') {
      return [
        { key: 'under_review', labelAr: 'قيد المراجعة', labelEn: 'Under Review' },
        { key: 'confirmed', labelAr: 'مؤكد', labelEn: 'Confirmed' },
        { key: 'preparing', labelAr: 'جاري التجهيز', labelEn: 'Preparing' },
        { key: 'ready', labelAr: 'جاهز', labelEn: 'Ready' },
        { key: 'shipped', labelAr: 'تم الشحن', labelEn: 'Shipped' },
        { key: 'in_transit', labelAr: 'قيد الشحن', labelEn: 'In Transit' },
        { key: 'delivered', labelAr: 'تم التوصيل', labelEn: 'Delivered' },
        { key: 'completed', labelAr: 'مكتمل', labelEn: 'Completed' },
        { key: 'canceled', labelAr: 'ملغي', labelEn: 'Canceled' },
        { key: 'refunded', labelAr: 'مسترجع', labelEn: 'Refunded' },
        { key: 'partial', labelAr: 'جزئي', labelEn: 'Partial' },
        { key: 'pending_payment', labelAr: 'انتظار الدفع', labelEn: 'Pending Payment' },
        { key: 'on_hold', labelAr: 'معلق', labelEn: 'On Hold' },
      ]
    }
    if (standardStoreTab === 'shopify') {
      return [
        { key: 'pending', labelAr: 'معلق', labelEn: 'Pending' },
        { key: 'authorized', labelAr: 'مقبول', labelEn: 'Authorized' },
        { key: 'partially_paid', labelAr: 'مدفوع جزئياً', labelEn: 'Partially Paid' },
        { key: 'paid', labelAr: 'مدفوع', labelEn: 'Paid' },
        { key: 'partially_refunded', labelAr: 'مسترجع جزئياً', labelEn: 'Partially Refunded' },
        { key: 'refunded', labelAr: 'مسترجع', labelEn: 'Refunded' },
        { key: 'voided', labelAr: 'ملغي', labelEn: 'Voided' },
      ]
    }
    // Default to Zid
    return [
      { key: 'new', labelAr: 'طلب جديد', labelEn: 'New Order' },
      { key: 'preparing', labelAr: 'جاري التجهيز', labelEn: 'Preparing' },
      { key: 'ready', labelAr: 'جاهز للاستلام', labelEn: 'Ready' },
      { key: 'indelivery', labelAr: 'جاري التوصيل', labelEn: 'In Delivery' },
      { key: 'delivered', labelAr: 'تم التوصيل (مكتمل)', labelEn: 'Delivered (Completed)' },
      { key: 'canceled', labelAr: 'ملغي', labelEn: 'Canceled' },
      { key: 'reversed', labelAr: 'مرتجع', labelEn: 'Reversed' },
      { key: 'partially_reversed', labelAr: 'مرتجع جزئياً', labelEn: 'Partially Reversed' },
      { key: 'reverse_in_progress', labelAr: 'جاري الإرجاع', labelEn: 'Reverse in Progress' },
    ]
  }

  // ── Customer Odoo fields ──
  const fetchOdooCustomerFields = useOdooModelFields(
    'res.partner',
    hasOdooConnection,
    setOdooCustomerFields,
    setIsLoadingCustomerFields
  )

  useEffect(() => {
    if (standardSubTab === 'customers') {
      fetchOdooCustomerFields(false)
    }
  }, [fetchOdooCustomerFields, standardSubTab])

  // ── Customer Accounts (Receivable/Payable) ──
  useEffect(() => {
    if (!hasOdooConnection || standardSubTab !== 'customers') return
    setIsLoadingAccounts(true)
    const companyIdNum = customerCompanyId ? Number(customerCompanyId) : undefined
    import('@/app/actions/odoo').then(({ getOdooAccountsByType }) => {
      Promise.all([
        getOdooAccountsByType('receivable', companyIdNum),
        getOdooAccountsByType('payable', companyIdNum),
      ]).then(([receivableRes, payableRes]) => {
        if (receivableRes.success) setReceivableAccountOptions(receivableRes.options || [])
        if (payableRes.success) setPayableAccountOptions(payableRes.options || [])
      }).finally(() => setIsLoadingAccounts(false))
    })
  }, [hasOdooConnection, customerCompanyId, standardSubTab])

  // ── Odoo Companies ──
  const fetchCompanies = useCallback(async () => {
    if (!hasOdooConnection) return
    setIsLoadingCompanies(true)
    try {
      const { getOdooFieldValueOptions } = await import('@/app/actions/odoo')
      const res = await getOdooFieldValueOptions('product.template', 'company_id')
      if (res.success) {
        setCompanyOptions(res.options || [])
      }
    } catch (error) {
      console.error('Failed to fetch Odoo companies:', error)
    } finally {
      setIsLoadingCompanies(false)
    }
  }, [hasOdooConnection])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  useEffect(() => {
    if (!hasOdooConnection || standardSubTab !== 'categories') return
    setIsLoadingOdooOpts(true)
    Promise.all([
      getOdooFieldValueOptions('product.category', 'property_cost_method'),
      getOdooFieldValueOptions('product.category', 'property_valuation'),
    ]).then(([costRes, valRes]) => {
      if (costRes.success) setCostMethodOptions(costRes.options)
      if (valRes.success) setValuationOptions(valRes.options)
    }).finally(() => setIsLoadingOdooOpts(false))
  }, [hasOdooConnection, standardSubTab])

  const fetchOdooCategoryFields = useOdooModelFields(
    'product.category',
    hasOdooConnection,
    setOdooCategoryFields,
    setIsLoadingOdooFields
  )

  useEffect(() => {
    if (standardSubTab === 'categories') {
      fetchOdooCategoryFields(false)
    }
  }, [fetchOdooCategoryFields, standardSubTab])

  // ── Product Odoo fields ──
  const fetchOdooProductFields = useOdooModelFields(
    'product.template',
    hasOdooConnection,
    setProductOdooFields,
    setIsLoadingProductFields
  )

  useEffect(() => {
    if (standardSubTab === 'products') {
      fetchOdooProductFields(false)
    }

    if (!hasOdooConnection || standardSubTab !== 'products') {
      setIsLoadingProductOpts(false)
      setIsLoadingTaxOpts(false)
      return
    }
    setIsLoadingProductOpts(true)
    setIsLoadingTaxOpts(true)
    import('@/app/actions/odoo').then(({ getOdooFieldValueOptions }) => Promise.all([
      getOdooFieldValueOptions('product.template', 'type'),
      getOdooFieldValueOptions('product.template', 'tracking'),
      getOdooFieldValueOptions('product.template', 'taxes_id'),
    ])).then(([typeRes, trackingRes, taxRes]) => {
      if (typeRes.success) setProductTypeOptions(typeRes.options || [])
      else setProductTypeOptions([{ value: 'consu', label: 'Consumable (مستهلك)' }, { value: 'service', label: 'Service (خدمة)' }, { value: 'product', label: 'Stockable Product (مخزون)' }])
      if (trackingRes.success) setTrackingOptions(trackingRes.options || [])
      else setTrackingOptions([{ value: 'lot', label: 'By Lots (دفعات)' }, { value: 'serial', label: 'By Serial Number (أرقام تسلسلية)' }])
      if (taxRes.success) setTaxOptions(taxRes.options || [])
    }).finally(() => {
      setIsLoadingProductOpts(false)
      setIsLoadingTaxOpts(false)
    })
  }, [hasOdooConnection, fetchOdooProductFields, standardSubTab])
  // ── Order Odoo fields & static mappings ──
  const fetchOdooOrderFields = useCallback(async (force = true) => {
    if (!hasOdooConnection) return
    setIsLoadingOrderFields(true)
    try {
      const { getOdooModelFields } = await import('@/app/actions/odoo')
      const res = await getOdooModelFields('sale.order', force)
      if (res.success && res.fields) {
        setOdooOrderFields(res.fields.map((f: any) => ({
          value: f.value,
          label: f.label && f.label !== f.value ? `${f.label} (${f.value})` : f.value,
          desc: f.desc || f.value,
        })))
      }
    } catch (error) {
      console.error('Failed to fetch Odoo order fields:', error)
    } finally {
      setIsLoadingOrderFields(false)
    }
  }, [hasOdooConnection])

  useEffect(() => {
    if (!hasOdooConnection || standardSubTab !== 'orders') return
    setIsLoadingWarehouses(true)
    setIsLoadingPricelists(true)
    setIsLoadingPaymentTerms(true)
    setIsLoadingProducts(true)
    setIsLoadingCustomers(true)

    fetchOdooOrderFields(false)

    // 1. Get customers (for default customer selection)
    getOdooCustomers(false)
      .then(res => {
        if (res.success && res.options) {
          setCustomerOptions(res.options)
        }
      })
      .catch(err => {
        console.error('Failed to load customers:', err)
      })
      .finally(() => setIsLoadingCustomers(false))

    // 2. Get warehouses
    getOdooWarehouses(false)
      .then(res => {
        if (res.success && res.warehouses) {
          setWarehouseOptions(res.warehouses.map((w: any) => ({ value: String(w.id), label: w.name })))
        }
      })
      .catch(err => {
        console.error('Failed to load warehouses:', err)
      })
      .finally(() => setIsLoadingWarehouses(false))

    // 3. Get pricelists
    getOdooFieldValueOptions('sale.order', 'pricelist_id')
      .then(res => {
        if (res.success && res.options) {
          setPricelistOptions(res.options)
        }
      })
      .catch(err => {
        console.error('Failed to load pricelists:', err)
      })
      .finally(() => setIsLoadingPricelists(false))

    // 4. Get payment terms
    getOdooFieldValueOptions('sale.order', 'payment_term_id')
      .then(res => {
        if (res.success && res.options) {
          setPaymentTermOptions(res.options)
        }
      })
      .catch(err => {
        console.error('Failed to load payment terms:', err)
      })
      .finally(() => setIsLoadingPaymentTerms(false))

    // 5. Get products (for shipping & discount & default product selection)
    getOdooProducts(false)
      .then(res => {
        if (res.success && res.options) {
          setProductOptions(res.options)
        }
      })
      .catch(err => {
        console.error('Failed to load products:', err)
      })
      .finally(() => setIsLoadingProducts(false))

    // 6. Get taxes (for VAT Saudi / Non-Saudi customer selection)
    setIsLoadingOrderTaxes(true)
    getOdooTaxes(false)
      .then(res => {
        if (res.success && res.taxes) {
          setOrderTaxOptions([
            { value: '', label: lang === 'ar' ? '— بدون ضريبة (0%) —' : '— No Tax (0%) —' },
            ...res.taxes,
          ])
        }
      })
      .catch(err => {
        console.error('Failed to load taxes for orders:', err)
      })
      .finally(() => setIsLoadingOrderTaxes(false))

    // 7. Get accounting journals (for the credit-note journal on store returns)
    setIsLoadingJournals(true)
    getOdooJournals(false)
      .then(res => {
        if (res.success && res.journals) {
          setJournalOptions(
            res.journals.map((j: any) => ({
              value: String(j.id),
              label: j.code ? `${j.name} — ${j.code}` : j.name || `Journal #${j.id}`,
            }))
          )
        }
      })
      .catch(err => {
        console.error('Failed to load Odoo journals:', err)
      })
      .finally(() => setIsLoadingJournals(false))

    // 7b. Get currencies (res.currency)
    setIsLoadingCurrencies(true)
    getOdooCurrencies(false)
      .then(res => {
        if (res.success && res.options) {
          setCurrencyOptions(res.options)
        }
      })
      .catch(err => {
        console.error('Failed to load Odoo currencies:', err)
      })
      .finally(() => setIsLoadingCurrencies(false))

    // 8. Get payment methods for the connected store
    if (standardStoreTab === 'zid' || standardStoreTab === 'salla') {
      setIsLoadingPaymentMethods(true)
      const fetchMethods = standardStoreTab === 'salla' ? getSallaPaymentMethods : getZidPaymentMethods
      fetchMethods(false, standardStoreId)
        .then(res => {
          if (res.success && res.methods) {
            setPaymentMethodOptions(res.methods.map(m => ({ value: m.value, label: m.label })))
          }
        })
        .catch(err => console.error('Failed to load payment methods:', err))
        .finally(() => setIsLoadingPaymentMethods(false))
    }
  }, [hasOdooConnection, standardSubTab, standardStoreTab, standardStoreId, fetchOdooOrderFields, lang])

  // Trigger customer fetch when switching to default_customer if not loaded yet
  useEffect(() => {
    if (
      standardSubTab === 'orders' &&
      orderCustomerFallbackPolicy === 'default_customer' &&
      customerOptions.length === 0 &&
      !isLoadingCustomers &&
      hasOdooConnection
    ) {
      handleRefreshCustomers(false)
    }
  }, [standardSubTab, orderCustomerFallbackPolicy, customerOptions.length, isLoadingCustomers, hasOdooConnection, handleRefreshCustomers])

  // Trigger product fetch when switching to default_product if not loaded yet
  useEffect(() => {
    if (
      standardSubTab === 'orders' &&
      orderProductFallbackPolicy === 'default_product' &&
      productOptions.length === 0 &&
      !isLoadingProducts &&
      hasOdooConnection
    ) {
      handleRefreshProducts(false)
    }
  }, [standardSubTab, orderProductFallbackPolicy, productOptions.length, isLoadingProducts, hasOdooConnection, handleRefreshProducts])

  // Load saved settings
  useEffect(() => {
    if (standardSubTab === 'orders') {
      setOrderStateMapping({})
    }
    getStandardMappingSettings(standardStoreTab, standardSubTab, standardStoreId).then(res => {
      if (!res.success || !res.settings) {
        if (standardSubTab === 'orders') {
          setOrderDisabled(false)
          setOrderEnabledActions(['create', 'update', 'cancel', 'deliver'])
          setOrderMatchZidField('')
          setOrderMatchOdooField('')
          setOrderCompanyId('')
          setOrderLinkCompany(true)
          setOrderWarehouseId('')
          setOrderPricelistId('')
          setOrderPaymentTermId('')
          setOrderMultiCurrencyEnabled(false)
          setOrderBaseCurrencyId('')
          setOrderAutoConfirm(false)
          setOrderAddShipping(false)
          setOrderShippingProductId('')
          setOrderShippingProductSku('')
          setOrderAddCod(false)
          setOrderCodProductId('')
          setOrderCodProductSku('')
          setOrderCodAmount('')
          setOrderAddDiscount(false)
          setOrderDiscountProductId('')
          setOrderDiscountProductSku('')
          setOrderDiscountMode('fixed')
          setOrderEnableVat(false)
          setOrderVatSaudiTaxId('')
          setOrderVatNonSaudiTaxId('')
          setOrderAutoInvoice(false)
          setOrderPartialFulfillment(false)
          setOrderReturnsMode('nothing')
          setOrderReturnsCreditNote(true)
          setOrderReturnsJournalId('')
          setOrderReturnsFallback('skip')
          setOrderReturnsReason('')
          setOrderReturnsReasonType('store_reason')
          setStoreWarehouseRules([])
          setOrderPaymentAutoSync(true)
          setOrderPaymentJournalMappings([])
          setOrderCustomerFallbackPolicy('create_new')
          setOrderDefaultCustomerId('')
          setOrderProductFallbackPolicy('create_new')
          setOrderDefaultProductId('')
          setOrderStateMapping({})
          setOrderUpdateCustomStatus(false)
          setOrderStatusCustomField('')
        } else if (standardSubTab === 'products') {
          setProductVariantSyncMode('AS_VARIANTS')
          setBomEnabled(false)
          setBomType('phantom')
          setInvSyncEnabled(false)
          setInvSyncMode('actual')
          setOdooStockWebhook(null)
          setInvSyncPairs([])
        }
        return
      }
      const s = res.settings
      if (standardSubTab === 'categories') {
        setCostMethod(s.costing_method || '')
        setInventoryValuation(s.inventory_valuation || '')
        setOnDeleteAction(s.on_delete || 'nothing')
        setMatchZidField(s.match_zid_field || '')
        setMatchOdooField(s.match_odoo_field || '')
        setEnabledActions(s.enabled_actions || (s.disabled ? [] : ['create', 'update', 'delete']))
        setDisabled(s.disabled || false)
        setCategoryCompanyId(s.company_id ? String(s.company_id) : '')
        setCategoryLinkCompany(s.link_company !== false)
      } else if (standardSubTab === 'products') {
        setProductType(s.product_type?.default_type || '')
        setTrackInventory(s.inventory?.track_inventory !== false)
        setTrackingMethod(s.inventory?.tracking || '')
        setMarkupPercent(s.price?.markup_percent || 0)
        setCostSource(s.price?.cost_source || 'cost')
        setPriceSource(s.price?.source || 'price')
        setRounding(s.price?.rounding || '')
        setDecimalPlaces(s.price?.decimal_places ?? 2)
        setNameLanguage(s.name?.language || 'ar')
        setNameFallback(s.name?.fallback_to_other !== false)
        setDescLanguage(s.description?.language || 'ar')
        setDescFallback(s.description?.fallback || 'none')
        setDescCustomText(s.description?.custom_text || '')
        setImageSyncMode(s.image?.sync_mode || 'all')
        setCategorySyncMode(s.category?.sync_mode || 'auto')
        setUomAutoCreate(s.uom?.auto_create !== false)
        setTaxSyncMode(s.tax?.sync_mode || 'auto_by_name')
        setDefaultTaxIds(s.tax?.default_tax_ids?.map(String) || [])
        setProductMatchZidField(s.match_zid_field || '')
        setProductMatchOdooField(s.match_odoo_field || '')
        setProductOnDelete(s.on_delete || 'nothing')
        setProductEnabledActions(
          Array.isArray(s.enabled_actions) && s.enabled_actions.length > 0
            ? s.enabled_actions
            : (s.disabled ? [] : ['create', 'update', 'delete'])
        )
        setProductDisabled(s.disabled || false)
        setProductCompanyId(s.company_id ? String(s.company_id) : '')
        setProductLinkCompany(s.link_company !== false)
        setProductVariantSyncMode(s.variant?.sync_mode || 'AS_VARIANTS')
        setBomEnabled(!!s.bom?.enabled)
        setBomType(s.bom?.type || 'phantom')
        setInvSyncEnabled(s.inventory?.sync_enabled === true)
        setInvSyncMode(s.inventory?.sync_mode === 'forecast' ? 'forecast' : 'actual')
        setOdooStockWebhook(s.inventory?.odoo_stock_webhook || null)
      } else if (standardSubTab === 'customers') {
        setCustomerOnDelete(s.on_delete || 'nothing')
        setCustomerMatchZidField(s.match_zid_field || '')
        setCustomerMatchOdooField(s.match_odoo_field || '')
        setCustomerEnabledActions(
          Array.isArray(s.enabled_actions) && s.enabled_actions.length > 0
            ? s.enabled_actions
            : (s.disabled ? [] : ['create', 'update', 'delete'])
        )
        setCustomerDisabled(s.disabled || false)
        setCustomerDefaultType(s.customer_type || 'auto')
        setReceivableAccountId(s.receivable_account_id ? String(s.receivable_account_id) : '')
        setPayableAccountId(s.payable_account_id ? String(s.payable_account_id) : '')
        setCustomerCompanyId(s.company_id ? String(s.company_id) : '')
        setCustomerLinkCompany(s.link_company !== false)
      } else if (standardSubTab === 'orders') {
        setOrderDisabled(s.disabled || false)
        setOrderEnabledActions(
          Array.isArray(s.enabled_actions) && s.enabled_actions.length > 0
            ? s.enabled_actions
            : (s.disabled ? [] : ['create', 'update', 'cancel', 'deliver'])
        )
        setOrderMatchZidField(s.match_zid_field || '')
        setOrderMatchOdooField(s.match_odoo_field || '')
        setOrderCompanyId(s.company_id ? String(s.company_id) : '')
        setOrderLinkCompany(s.link_company !== false)
        setOrderWarehouseId(s.order?.default_warehouse_id ? String(s.order.default_warehouse_id) : '')
        setOrderPricelistId(s.order?.default_pricelist_id ? String(s.order.default_pricelist_id) : '')
        setOrderPaymentTermId(s.order?.default_payment_term_id ? String(s.order.default_payment_term_id) : '')
        setOrderMultiCurrencyEnabled(
          s.multi_currency_enabled !== undefined
            ? !!s.multi_currency_enabled
            : !!s.order?.multi_currency_enabled
        )
        setOrderBaseCurrencyId(
          s.base_currency_id
            ? String(s.base_currency_id)
            : s.order?.base_currency_id
            ? String(s.order.base_currency_id)
            : ''
        )
        setOrderAutoConfirm(s.order?.auto_confirm || false)
        setOrderAutoInvoice(s.order?.auto_invoice || false)
        setOrderPartialFulfillment(s.order?.partial_fulfillment || false)
        {
          const returns = (s.order?.returns || {}) as Record<string, any>
          setOrderReturnsMode(
            returns.mode === 'negative_so' || returns.mode === 'stock_return_credit_note'
              ? returns.mode
              : 'nothing'
          )
          setOrderReturnsCreditNote(returns.create_credit_note !== false)
          setOrderReturnsJournalId(
            returns.credit_note_journal_id ? String(returns.credit_note_journal_id) : ''
          )
          setOrderReturnsFallback(returns.fallback_when_missing === 'negative_so' ? 'negative_so' : 'skip')
          setOrderReturnsReason(typeof returns.reason === 'string' ? returns.reason : '')
          setOrderReturnsReasonType(returns.reason_type === 'custom' ? 'custom' : 'store_reason')
        }
        setStoreWarehouseRules(
          Object.entries((s.order?.store_warehouse_mappings || {}) as Record<string, unknown>).map(
            ([locId, whId], i) => ({
              rowKey: `rule_${i}_${locId}`,
              zid_location_id: locId,
              odoo_warehouse_id: String(whId ?? ''),
            })
          )
        )

        const rawPayMappings = s.order?.payment_journal_mappings || s.payment_journal_mappings || []
        setOrderPaymentAutoSync(s.order?.payment_sync_enabled !== false && s.payment_sync_enabled !== false)
        setOrderPaymentJournalMappings(
          Array.isArray(rawPayMappings)
            ? rawPayMappings.map((m: any, idx: number) => ({
                rowKey: `pay_${idx}_${Math.random().toString(36).slice(2, 7)}`,
                zid_payment_method: String(m.zid_payment_method || ''),
                odoo_journal_id: String(m.odoo_journal_id || ''),
              }))
            : []
        )

        const analytic = (s.order?.analytic || s.analytic) as { enabled?: boolean; rules?: unknown[] } | undefined
        setOrderAnalyticEnabled(analytic?.enabled === true)
        setOrderAnalyticRules(
          (Array.isArray(analytic?.rules) ? analytic!.rules : []).map((raw, i) => {
            const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
            return {
              rowKey: `analytic_${i}_${Math.random().toString(36).slice(2, 7)}`,
              condition: row.condition === 'warehouse' || row.condition === 'payment' ? row.condition : 'all',
              source_value: row.source_value ? String(row.source_value) : '',
              source_label: row.source_label ? String(row.source_label) : '',
              odoo_analytic_account_id: row.odoo_analytic_account_id ? String(row.odoo_analytic_account_id) : '',
              percentage: row.percentage !== undefined && row.percentage !== null ? String(row.percentage) : '100',
            } as AnalyticRuleRow
          })
        )

        const hasShipping = !!(s.shipping_product_id || s.add_shipping_as_line)
        setOrderAddShipping(hasShipping)
        setOrderShippingProductId(s.shipping_product_id ? String(s.shipping_product_id) : '')
        setOrderShippingProductSku(s.shipping_product_sku || '')
        setOrderAddCod(s.add_cod_as_line || false)
        setOrderCodProductId(s.cod_product_id ? String(s.cod_product_id) : '')
        setOrderCodProductSku(s.cod_product_sku || '')
        setOrderCodAmount(s.cod_amount ? String(s.cod_amount) : '')
        setOrderAddDiscount(s.add_discount_as_line || false)
        setOrderDiscountProductId(s.discount_product_id ? String(s.discount_product_id) : '')
        setOrderDiscountProductSku(s.discount_product_sku || '')
        setOrderDiscountMode(s.discount_mode || 'fixed')
        setOrderEnableVat(s.enable_vat ?? s.order?.enable_vat ?? false)
        const loadedSaudiTaxId = s.vat_saudi_tax_id ? String(s.vat_saudi_tax_id) : (s.order?.vat_saudi_tax_id ? String(s.order.vat_saudi_tax_id) : '')
        const loadedNonSaudiTaxId = s.vat_non_saudi_tax_id ? String(s.vat_non_saudi_tax_id) : (s.order?.vat_non_saudi_tax_id ? String(s.order.vat_non_saudi_tax_id) : '')
        setOrderVatSaudiTaxId(loadedSaudiTaxId)
        setOrderVatNonSaudiTaxId(loadedNonSaudiTaxId)

        const rawVatRules = s.vat_country_rules ?? s.order?.vat_country_rules
        if (Array.isArray(rawVatRules) && rawVatRules.length > 0) {
          setOrderVatCountryRules(rawVatRules.map((r: any, idx: number) => ({
            rowKey: r.rowKey || `vat-rule-${idx}-${Date.now()}`,
            country_code: r.country_code || '',
            tax_id: r.tax_id !== undefined && r.tax_id !== null ? String(r.tax_id) : (r.odoo_tax_id ? String(r.odoo_tax_id) : ''),
            country_name: r.country_name || '',
          })))
        } else {
          setOrderVatCountryRules([
            { rowKey: 'vat-sa', country_code: 'SA', country_name: 'المملكة العربية السعودية', tax_id: loadedSaudiTaxId },
            { rowKey: 'vat-other', country_code: 'OTHER', country_name: 'باقي الدول', tax_id: loadedNonSaudiTaxId },
          ])
        }
        setOrderPricesIncludeTax(s.prices_include_tax ?? s.order?.prices_include_tax ?? false)
        setOrderTaxRatePercent(
          s.tax_rate_percent !== undefined && s.tax_rate_percent !== null
            ? String(s.tax_rate_percent)
            : (s.order?.tax_rate_percent !== undefined && s.order?.tax_rate_percent !== null ? String(s.order.tax_rate_percent) : '15')
        )
        const rawCountryRates = s.tax_rates_by_country ?? s.order?.tax_rates_by_country
        if (Array.isArray(rawCountryRates) && rawCountryRates.length > 0) {
          setOrderCountryTaxRates(rawCountryRates.map((r: any, idx: number) => ({
            rowKey: r.rowKey || `rule-${idx}-${Date.now()}`,
            country_code: r.country_code || 'SA',
            country_name: r.country_name || '',
            tax_rate: r.tax_rate !== undefined && r.tax_rate !== null ? String(r.tax_rate) : '15',
          })))
        } else {
          const legacyRate = s.tax_rate_percent !== undefined && s.tax_rate_percent !== null
            ? String(s.tax_rate_percent)
            : (s.order?.tax_rate_percent !== undefined && s.order?.tax_rate_percent !== null ? String(s.order.tax_rate_percent) : '15')
          setOrderCountryTaxRates([
            { rowKey: 'rule-sa', country_code: 'SA', country_name: 'السعودية', tax_rate: legacyRate }
          ])
        }

        setOrderCustomerFallbackPolicy(s.customer_fallback_policy || s.order?.customer_fallback_policy || 'create_new')
        setOrderDefaultCustomerId(s.default_customer_id ? String(s.default_customer_id) : (s.order?.default_customer_id ? String(s.order.default_customer_id) : ''))
        setOrderProductFallbackPolicy(s.product_fallback_policy || s.order?.product_fallback_policy || 'create_new')
        setOrderDefaultProductId(s.default_product_id ? String(s.default_product_id) : (s.order?.default_product_id ? String(s.order.default_product_id) : ''))

        const customStatusEnabled = !!(s.update_custom_status_field ?? s.order?.update_custom_status_field ?? false)
        const customFieldName = s.order_status_custom_field || s.order?.order_status_custom_field || ''
        setOrderUpdateCustomStatus(customStatusEnabled)
        setOrderStatusCustomField(customFieldName)

        if (hasOdooConnection) {
          // Platform-aware custom status field: Salla tabs check/create
          // x_salla_order_status with Salla statuses, Zid tabs the Zid ones.
          // Connected to both → each tab manages its own field and options.
          const statusPlatform = standardStoreTab === 'salla' ? 'salla' : 'zid'
          const statusFieldDefault = defaultOrderStatusFieldName(statusPlatform)
          checkZidOrderStatusField(customFieldName || statusFieldDefault, statusPlatform).then(chk => {
            if (chk.exists) {
              setStatusFieldExists(true)
              if (!customFieldName) setOrderStatusCustomField(chk.fieldName)
              if (chk.options && chk.options.length > 0) setStatusFieldOptions(chk.options)
            } else {
              setStatusFieldExists(false)
            }
          })
        }
      }

      // Load order status mappings from the dedicated table + fallback to JSON settings
      if (standardSubTab === 'orders') {
        const jsonStatusActions: Record<string, any> =
          res?.settings?.order?.status_actions || (res?.settings as any)?.status_actions || {}
        getOrderStatusMappings(standardStoreTab, standardStoreId).then(mRes => {
          const raw: Record<string, unknown> = (mRes.success ? (mRes.mappings || {}) : {}) as Record<string, unknown>
          const normalized: Record<
            string,
            { state: string; enabled: boolean; invoice_action?: string; picking_action?: string }
          > = {}

          // Combine status keys from both table mappings and JSON settings
          const allKeys = new Set([...Object.keys(raw), ...Object.keys(jsonStatusActions)])
          for (const k of allKeys) {
            const v = raw[k]
            const j = jsonStatusActions[k]
            let state = ''
            let enabled = true
            let invoice_action = ''
            let picking_action = ''

            if (typeof v === 'string') {
              state = v
            } else if (v && typeof v === 'object') {
              const o = v as {
                state?: unknown
                enabled?: unknown
                invoice_action?: unknown
                picking_action?: unknown
              }
              state = String(o.state || '')
              enabled = o.enabled !== false
              invoice_action = String(o.invoice_action || '')
              picking_action = String(o.picking_action || '')
            }

            if (j && typeof j === 'object') {
              if (!state && j.state) state = String(j.state)
              if (j.enabled !== undefined && !v) enabled = j.enabled !== false
              if (!invoice_action && j.invoice_action) invoice_action = String(j.invoice_action)
              if (!picking_action && j.picking_action) picking_action = String(j.picking_action)
            }

            normalized[k] = { state, enabled, invoice_action, picking_action }
          }
          setOrderStateMapping(normalized)
        })
      }
    })
  }, [standardStoreTab, standardStoreId, standardSubTab])

  // Load store locations (Zid or Salla), Odoo internal locations & existing
  // pairing rows for the Odoo → store inventory sync
  // (Products tab, Zid/Salla stores only).
  const loadInventorySyncData = useCallback(async () => {
    if ((standardStoreTab !== 'zid' && standardStoreTab !== 'salla') || standardSubTab !== 'products') return
    const isSalla = standardStoreTab === 'salla'
    setIsLoadingInvSync(true)
    try {
      const [locRes, oRes, wRes] = await Promise.all([
        isSalla ? getSallaLocations(false, standardStoreId) : getZidLocations(false, standardStoreId),
        getOdooLocations('internal'),
        getStaticMappings('warehouse_mappings', isSalla ? 'salla' : 'zid'),
      ])
      if (locRes.success && locRes.locations) {
        if (isSalla) setSallaLocations(locRes.locations as SallaLocation[])
        else setZidLocations(locRes.locations as ZidLocation[])
      }
      if (oRes.success && oRes.locations) setOdooLocations(oRes.locations)
      if (wRes.success && wRes.mappings) {
        setInvSyncPairs(
          (wRes.mappings as any[])
            .filter((m: any) => m.odoo_location_id && m.source_location_id)
            .map((m: any) => ({
              id: String(m.id || ''),
              source_location_id: String(m.source_location_id || ''),
              source_location_name: String(m.source_location_name || ''),
              odoo_location_id: String(m.odoo_location_id || ''),
            }))
        )
      }
    } catch (err) {
      console.error('[InventorySync] Failed to load locations/pairs:', err)
    } finally {
      setIsLoadingInvSync(false)
    }
  }, [standardStoreTab, standardStoreId, standardSubTab])

  useEffect(() => {
    loadInventorySyncData()
  }, [loadInventorySyncData])

  // Load the store locations used by the Orders tab multi-warehouse rules
  // (Zid locations for Zid stores, Salla branches for Salla stores).
  // The Odoo warehouses for those rules come from `warehouseOptions`, already
  // loaded by the Orders tab bootstrap.
  useEffect(() => {
    if (standardSubTab !== 'orders') return
    if (standardStoreTab === 'salla') {
      getSallaLocations(false, standardStoreId).then(res => {
        if (res.success && res.locations) setSallaLocations(res.locations)
      }).catch(err => console.error('[OrderWarehouseRules] Failed to load Salla branches:', err))
    } else if (standardStoreTab === 'zid') {
      getZidLocations(false, standardStoreId).then(res => {
        if (res.success && res.locations) setZidLocations(res.locations)
      }).catch(err => console.error('[OrderWarehouseRules] Failed to load Zid locations:', err))
    }
  }, [standardStoreTab, standardStoreId, standardSubTab])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    const res = await saveStandardMappingSettings(standardStoreTab, standardSubTab, {
      costing_method: costMethod,
      inventory_valuation: inventoryValuation,
      on_delete: onDeleteAction,
      match_zid_field: matchZidField,
      match_odoo_field: matchOdooField,
      enabled_actions: enabledActions,
      disabled,
      company_id: categoryCompanyId ? Number(categoryCompanyId) : null,
      link_company: categoryLinkCompany,
    }, standardStoreId)
    if (res?.success) {
      toast({
        title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
        description: lang === 'ar'
          ? 'تم حفظ إعدادات الربط الافتراضية بنجاح'
          : 'Standard mapping settings saved successfully',
      })
    } else {
      toast({
        title: lang === 'ar' ? 'خطأ في الحفظ' : 'Save Error',
        description: res?.error || (lang === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Something went wrong while saving'),
        variant: 'destructive',
      })
    }
    setIsSaving(false)
  }, [costMethod, inventoryValuation, onDeleteAction, matchZidField, matchOdooField, enabledActions, disabled, categoryCompanyId, categoryLinkCompany, standardStoreTab, standardStoreId, standardSubTab, lang, toast])

  const handleSaveProducts = useCallback(async () => {
    setIsSavingProducts(true)
    const settingsPayload: Record<string, any> = {
      product_type: { default_type: productType },
      inventory: {
        track_inventory: trackInventory,
        tracking: trackingMethod,
        // مزامنة المخزون (من أودو إلى المتجر) — أودو مصدر الحقيقة عند التفعيل
        sync_enabled: invSyncEnabled,
        sync_mode: invSyncMode,
        odoo_stock_webhook: odooStockWebhook,
      },
      price: {
        markup_percent: markupPercent,
        cost_source: costSource,
        source: priceSource,
        rounding,
        decimal_places: decimalPlaces,
      },
      name: {
        language: nameLanguage,
        fallback_to_other: nameFallback,
      },
      description: {
        language: descLanguage,
        fallback: descFallback,
        custom_text: descCustomText,
      },
      image: { sync_mode: imageSyncMode },
      category: { sync_mode: categorySyncMode },
      uom: { auto_create: uomAutoCreate },
      tax: {
        sync_mode: taxSyncMode,
        default_tax_ids: defaultTaxIds.filter(Boolean).map(Number),
      },
      variant: {
        sync_mode: productVariantSyncMode,
      },
      bom: {
        enabled: bomEnabled,
        type: bomType,
      },
      on_delete: productOnDelete,
      match_zid_field: productMatchZidField,
      match_odoo_field: productMatchOdooField,
      enabled_actions: (!productDisabled && productEnabledActions.length === 0) ? ['create', 'update', 'delete'] : productEnabledActions,
      disabled: productDisabled,
      company_id: productCompanyId ? Number(productCompanyId) : null,
      link_company: productLinkCompany,
    }
    const res = await saveStandardMappingSettings(standardStoreTab, standardSubTab, settingsPayload, standardStoreId)
    const saveOk = !!res?.success

    // Webhook lifecycle: register the stock.quant automation when the toggle
    // turns ON, unregister it when the toggle turns OFF
    // (Zid and Salla stores only — one webhook shared across both).
    if (saveOk && (standardStoreTab === 'zid' || standardStoreTab === 'salla')) {
      const invSyncStoreType = standardStoreTab === 'salla' ? 'salla' : 'zid'
      if (invSyncEnabled && !odooStockWebhook) {
        setIsSyncingWebhook(true)
        setInvSyncWebhookError('')
        try {
          const wRes = await enableOdooStockWebhook(invSyncStoreType)
          if (wRes.success && wRes.refs) {
            setOdooStockWebhook(wRes.refs)
          } else {
            setInvSyncWebhookError(wRes.error || 'Failed to register stock webhook')
          }
        } catch (err: any) {
          setInvSyncWebhookError(String(err?.message || err))
        } finally {
          setIsSyncingWebhook(false)
        }
      } else if (!invSyncEnabled && odooStockWebhook) {
        setIsSyncingWebhook(true)
        setInvSyncWebhookError('')
        try {
          const wRes = await disableOdooStockWebhook(invSyncStoreType)
          if (wRes.success) setOdooStockWebhook(null)
          else setInvSyncWebhookError(wRes.error || 'Failed to remove stock webhook')
        } catch (err: any) {
          setInvSyncWebhookError(String(err?.message || err))
        } finally {
          setIsSyncingWebhook(false)
        }
      }
    }

    if (saveOk) {
      toast({
        title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
        description: lang === 'ar'
          ? 'تم حفظ إعدادات ربط المنتجات الافتراضية بنجاح'
          : 'Product standard mapping settings saved successfully',
      })
    } else {
      toast({
        title: lang === 'ar' ? 'خطأ في الحفظ' : 'Save Error',
        description: res?.error || (lang === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Something went wrong while saving'),
        variant: 'destructive',
      })
    }
    setIsSavingProducts(false)
  }, [
    productType, trackInventory, trackingMethod,
    invSyncEnabled, invSyncMode, odooStockWebhook,
    markupPercent, costSource, priceSource, rounding, decimalPlaces,
    nameLanguage, nameFallback, descLanguage, descFallback, descCustomText,
    imageSyncMode, categorySyncMode, uomAutoCreate,
    taxSyncMode, defaultTaxIds,
    productVariantSyncMode, bomEnabled, bomType,
    productOnDelete, productMatchZidField, productMatchOdooField,
    productEnabledActions, productDisabled,
    productCompanyId, productLinkCompany,
    standardStoreTab, standardStoreId, standardSubTab, lang, toast,
  ])

  // ── Odoo → Zid/Salla inventory-sync pair handlers ─────────────────────────

  const handleAddPair = useCallback(() => {
    setInvSyncPairs(prev => [
      ...prev,
      { source_location_id: '', source_location_name: '', odoo_location_id: '', _removed: false },
    ])
  }, [])

  // ── Orders tab: multi-warehouse rules (Zid location ↔ Odoo warehouse) ───────

  const zidLocationOptions = useMemo(
    () => zidLocations.map(loc => ({ value: String(loc.id), label: loc.name || String(loc.id) })),
    [zidLocations]
  )

  // Salla counterpart of the above: branches are the per-location key for
  // Salla order warehouse rules (the engine matches them via
  // extractOrderLocationInfo: pickup_branch / shipment_branch / ship_from).
  const sallaOrderLocationOptions = useMemo(
    () => sallaLocations.map(loc => ({ value: String(loc.id), label: loc.name || String(loc.id) })),
    [sallaLocations]
  )

  const handleAddWarehouseRule = useCallback(() => {
    setStoreWarehouseRules(prev => [
      ...prev,
      { rowKey: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, zid_location_id: '', odoo_warehouse_id: '' },
    ])
  }, [])

  const handleWarehouseRuleChange = useCallback((
    rowKey: string,
    field: 'zid_location_id' | 'odoo_warehouse_id',
    value: string
  ) => {
    setStoreWarehouseRules(prev => prev.map(rule => {
      if (rule.rowKey === rowKey) return { ...rule, [field]: value }
      // One rule per store location — picking an already-used location on
      // another row clears it there instead of silently dropping a rule.
      if (field === 'zid_location_id' && value && rule.zid_location_id === value) {
        return { ...rule, zid_location_id: '', odoo_warehouse_id: '' }
      }
      return rule
    }))
  }, [])

  const handleRemoveWarehouseRule = useCallback((rowKey: string) => {
    setStoreWarehouseRules(prev => prev.filter(rule => rule.rowKey !== rowKey))
  }, [])

  const handleAddPaymentJournalMapping = useCallback(() => {
    setOrderPaymentJournalMappings(prev => [
      ...prev,
      {
        rowKey: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        zid_payment_method: '',
        odoo_journal_id: '',
      },
    ])
  }, [])

  const handlePaymentJournalMappingChange = useCallback(
    (rowKey: string, field: 'zid_payment_method' | 'odoo_journal_id', value: string) => {
      setOrderPaymentJournalMappings(prev =>
        prev.map(rule => (rule.rowKey === rowKey ? { ...rule, [field]: value } : rule))
      )
    },
    []
  )

  const handleRemovePaymentJournalMapping = useCallback((rowKey: string) => {
    setOrderPaymentJournalMappings(prev => prev.filter(rule => rule.rowKey !== rowKey))
  }, [])

  const handleRefreshPaymentOptions = useCallback(async () => {
    setIsLoadingPaymentMethods(true)
    setIsLoadingJournals(true)
    try {
      const [payRes, journRes] = await Promise.all([
        standardStoreTab === 'salla'
          ? getSallaPaymentMethods(true, standardStoreId)
          : getZidPaymentMethods(true, standardStoreId),
        getOdooJournals(true),
      ])
      if (payRes.success && payRes.methods) {
        setPaymentMethodOptions(payRes.methods.map(m => ({ value: m.value, label: m.label })))
      }
      if (journRes.success && journRes.journals) {
        setJournalOptions(
          journRes.journals.map((j: any) => ({
            value: String(j.id),
            label: j.code ? `${j.name} — ${j.code}` : j.name || `Journal #${j.id}`,
          }))
        )
      }
      toast({
        title: lang === 'ar' ? 'تم التحديث' : 'Refreshed',
        description:
          lang === 'ar'
            ? 'تم تحديث طرق الدفع ودفاتر اليومية'
            : 'Payment methods and journals refreshed',
      })
    } catch (err: any) {
      toast({
        title: lang === 'ar' ? 'خطأ في التحديث' : 'Refresh Error',
        description: err?.message || 'Failed to refresh',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingPaymentMethods(false)
      setIsLoadingJournals(false)
    }
  }, [standardStoreTab, standardStoreId, lang, toast])

  // ── Analytic distribution: option lists + row handlers ──

  const loadAnalyticOptions = useCallback(async (force = false) => {
    if (standardSubTab !== 'orders' || standardStoreTab === 'shopify') return
    setIsLoadingAnalyticOptions(true)
    setAnalyticOptionsError('')
    try {
      const [accountsRes, paymentsRes] = await Promise.all([
        getOdooAnalyticAccounts(force, orderCompanyId ? Number(orderCompanyId) : undefined),
        standardStoreTab === 'salla'
          ? getSallaPaymentMethods(force, standardStoreId)
          : getZidPaymentMethods(force, standardStoreId),
      ])

      if (accountsRes.success && accountsRes.accounts) {
        setAnalyticAccountOptions(
          accountsRes.accounts.map(account => ({
            value: String(account.id),
            label: [account.code, account.name, account.plan].filter(Boolean).join(' — '),
          }))
        )
      } else {
        setAnalyticOptionsError(
          accountsRes.error || (lang === 'ar' ? 'تعذر تحميل الحسابات التحليلية' : 'Failed to load analytic accounts')
        )
      }

      if (paymentsRes.success && paymentsRes.methods) {
        setPaymentMethodOptions(
          paymentsRes.methods.map(method => ({ value: method.value, label: method.label }))
        )
      } else {
        const paymentsError =
          paymentsRes.error || (lang === 'ar' ? 'تعذر تحميل طرق الدفع' : 'Failed to load payment methods')
        setAnalyticOptionsError(prev => prev || paymentsError)
      }
    } catch (err: any) {
      console.error('[AnalyticRules] Failed to load options:', err)
      setAnalyticOptionsError(
        lang === 'ar' ? 'تعذر تحميل خيارات الحسابات التحليلية' : 'Failed to load analytic options'
      )
    } finally {
      setIsLoadingAnalyticOptions(false)
    }
  }, [standardSubTab, standardStoreTab, standardStoreId, orderCompanyId, lang])

  // Only fetch while the section is actually enabled - the lists are useless
  // otherwise, and this keeps the orders tab light for stores without rules.
  useEffect(() => {
    if (standardSubTab !== 'orders' || standardStoreTab === 'shopify' || !orderAnalyticEnabled) return
    loadAnalyticOptions(false)
  }, [standardSubTab, standardStoreTab, orderAnalyticEnabled, loadAnalyticOptions])

  const handleRefreshAnalyticOptions = useCallback(async () => {
    await loadAnalyticOptions(true)
    toast({
      title: lang === 'ar' ? 'تم التحديث' : 'Refreshed',
      description: lang === 'ar'
        ? 'تم تحديث الحسابات التحليلية وطرق الدفع'
        : 'Analytic accounts and payment methods reloaded',
    })
  }, [loadAnalyticOptions, lang, toast])

  const handleAddAnalyticRule = useCallback(() => {
    setOrderAnalyticRules(prev => [
      ...prev,
      {
        rowKey: `analytic_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        condition: 'all',
        source_value: '',
        source_label: '',
        odoo_analytic_account_id: '',
        percentage: '100',
      },
    ])
  }, [])

  const handleAnalyticRuleChange = useCallback((rowKey: string, patch: Partial<AnalyticRuleRow>) => {
    setOrderAnalyticRules(prev => prev.map(rule => (rule.rowKey === rowKey ? { ...rule, ...patch } : rule)))
  }, [])

  const handleRemoveAnalyticRule = useCallback((rowKey: string) => {
    setOrderAnalyticRules(prev => prev.filter(rule => rule.rowKey !== rowKey))
  }, [])

  // Re-pull store locations + Odoo warehouses with no cache, so a warehouse
  // created in Odoo after opening the tab is selectable. Locations are
  // per-platform (Zid locations / Salla branches).
  const handleRefreshOrderWarehouses = useCallback(async () => {
    const isSallaTab = standardStoreTab === 'salla'
    setIsRefreshingOrderWarehouses(true)
    try {
      const [sRes, wRes] = await Promise.all([
        isSallaTab ? getSallaLocations(true, standardStoreId) : getZidLocations(true, standardStoreId),
        getOdooWarehouses(true),
      ])
      if (sRes.success && sRes.locations) {
        if (isSallaTab) setSallaLocations(sRes.locations as SallaLocation[])
        else setZidLocations(sRes.locations as ZidLocation[])
      }
      if (wRes.success && wRes.warehouses) {
        setWarehouseOptions(wRes.warehouses.map((w: any) => ({ value: String(w.id), label: w.name })))
      }
      toast({
        title: lang === 'ar' ? 'تم التحديث' : 'Refreshed',
        description: lang === 'ar'
          ? (isSallaTab ? 'تم تحديث فروع سلة ومستودعات أودو' : 'تم تحديث مستودعات زد وأودو')
          : (isSallaTab ? 'Salla branches and Odoo warehouses reloaded' : 'Zid locations and Odoo warehouses reloaded'),
      })
    } catch (err: any) {
      console.error('[OrderWarehouseRules] Refresh failed:', err)
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: lang === 'ar' ? 'فشل تحديث المستودعات' : 'Failed to refresh warehouses',
        variant: 'destructive',
      })
    } finally {
      setIsRefreshingOrderWarehouses(false)
    }
  }, [lang, toast, standardStoreTab, standardStoreId])

  // Re-pull Odoo accounting journals with no cache, so a journal created in
  // Odoo after opening the tab is selectable for the credit-note journal.
  const handleRefreshJournals = useCallback(async () => {
    setIsLoadingJournals(true)
    try {
      const res = await getOdooJournals(true)
      if (res.success && res.journals) {
        setJournalOptions(
          res.journals.map((j: any) => ({
            value: String(j.id),
            label: j.code ? `${j.name} — ${j.code}` : j.name || `Journal #${j.id}`,
          }))
        )
        toast({
          title: lang === 'ar' ? 'تم التحديث' : 'Refreshed',
          description: lang === 'ar'
            ? 'تم تحديث دفاتر اليومية من أودو'
            : 'Odoo accounting journals reloaded',
        })
      } else {
        toast({
          title: lang === 'ar' ? 'خطأ' : 'Error',
          description: res?.error || (lang === 'ar' ? 'فشل تحديث الدفاتر' : 'Failed to refresh journals'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('[OrderReturnsJournal] Refresh failed:', err)
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: lang === 'ar' ? 'فشل تحديث الدفاتر' : 'Failed to refresh journals',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingJournals(false)
    }
  }, [lang, toast])

  const handleRefreshCurrencies = useCallback(async (force = true) => {
    setIsLoadingCurrencies(true)
    try {
      const res = await getOdooCurrencies(force)
      if (res.success && res.options) {
        setCurrencyOptions(res.options)
        if (force) {
          toast({
            title: lang === 'ar' ? 'تم التحديث' : 'Refreshed',
            description: lang === 'ar' ? 'تم تحديث قائمة العملات المفعّلة من أودو' : 'Odoo active currencies reloaded',
          })
        }
      } else if (force) {
        toast({
          title: lang === 'ar' ? 'خطأ' : 'Error',
          description: res?.error || (lang === 'ar' ? 'فشل تحديث العملات' : 'Failed to refresh currencies'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      console.error('[OrderCurrency] Refresh failed:', err)
      if (force) {
        toast({
          title: lang === 'ar' ? 'خطأ' : 'Error',
          description: lang === 'ar' ? 'فشل تحديث العملات' : 'Failed to refresh currencies',
          variant: 'destructive',
        })
      }
    } finally {
      setIsLoadingCurrencies(false)
    }
  }, [lang, toast])

  // Re-pull store + Odoo locations straight from the APIs (no cache), so a
  // warehouse/location created in Odoo after opening the tab shows up.
  // Only the dropdown lists are touched — unsaved pair rows are left alone.
  const handleRefreshInvLocations = useCallback(async () => {
    const isSalla = standardStoreTab === 'salla'
    setIsRefreshingInvLocations(true)
    setInvSyncWebhookError('')
    try {
      const [locRes, oRes] = await Promise.all([
        isSalla ? getSallaLocations(true) : getZidLocations(true),
        getOdooLocations('internal', true),
      ])
      if (locRes.success && locRes.locations) {
        if (isSalla) setSallaLocations(locRes.locations as SallaLocation[])
        else setZidLocations(locRes.locations as ZidLocation[])
      }
      if (oRes.success && oRes.locations) setOdooLocations(oRes.locations)
      toast({
        title: lang === 'ar' ? 'تم التحديث' : 'Refreshed',
        description: lang === 'ar'
          ? (isSalla ? 'تم تحديث مواقع سلة وأودو' : 'تم تحديث مواقع زد وأودو')
          : (isSalla ? 'Salla and Odoo locations reloaded' : 'Zid and Odoo locations reloaded'),
      })
    } catch (err: any) {
      console.error('[InventorySync] Refresh failed:', err)
      setInvSyncWebhookError(
        lang === 'ar' ? 'فشل تحديث المواقع' : 'Failed to refresh locations'
      )
    } finally {
      setIsRefreshingInvLocations(false)
    }
  }, [lang, toast, standardStoreTab])

  const handlePairChange = useCallback((
    index: number,
    field: 'source_location_id' | 'source_location_name' | 'odoo_location_id',
    value: string
  ) => {
    const isSalla = standardStoreTab === 'salla'
    setInvSyncPairs(prev => prev.map((row, i) => {
      if (i !== index) return row
      const next = { ...row, [field]: value }
      if (field === 'source_location_id') {
        const locs = isSalla ? sallaLocations : zidLocations
        const loc = locs.find(l => l.id === value)
        next.source_location_name = loc ? loc.name : ''
      }
      return next
    }))
  }, [zidLocations, sallaLocations, standardStoreTab])

  const handleRemovePair = useCallback((index: number) => {
    setInvSyncPairs(prev => prev.map((row, i) => i === index ? { ...row, _removed: true } : row))
  }, [])

  // One pair per source location (DB unique on workspace/platform/source):
  // a location already paired in another visible row is disabled there, so
  // the save can never hit a unique conflict and silently keep one row.
  // The row's own value stays enabled so existing pairs remain editable.
  const usedPairSources = useMemo(
    () => new Set(
      invSyncPairs
        .filter(p => !p._removed && p.source_location_id)
        .map(p => String(p.source_location_id))
    ),
    [invSyncPairs]
  )

  // All store locations already paired → adding another row is pointless
  // (its dropdown would offer nothing selectable); show a hint instead.
  const allPairSourcesTaken = useMemo(() => {
    const locs = standardStoreTab === 'salla' ? sallaLocations : zidLocations
    return locs.length > 0 && locs.every(l => usedPairSources.has(String((l as { id: unknown }).id)))
  }, [standardStoreTab, sallaLocations, zidLocations, usedPairSources])

  const handleSavePairs = useCallback(async () => {
    const isSalla = standardStoreTab === 'salla'
    const platform = isSalla ? 'salla' : 'zid'
    setIsSavingPairs(true)
    setInvSyncWebhookError('')
    let failed = 0
    let skipped = 0
    try {
      for (const row of invSyncPairs) {
        if (row._removed) {
          if (row.id) {
            const del = await deleteStaticMapping('warehouse_mappings', row.id)
            if (!del.success) failed++
          }
          continue
        }
        const src = String(row.source_location_id || '').trim()
        const odoo = String(row.odoo_location_id || '').trim()
        // Incomplete rows are skipped (not an error): the selects force a
        // choice, but a freshly added untouched row has none yet.
        if (!src || !odoo) { skipped++; continue }
        const save = await saveStaticMapping(
          'warehouse_mappings',
          {
            id: row.id || undefined,
            source_location_id: src,
            source_location_name: row.source_location_name || row.source_location_id,
            odoo_location_id: Number(odoo),
          },
          platform
        )
        if (!save.success) failed++
      }
      await loadInventorySyncData()
      if (failed === 0) {
        toast({
          title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
          description: skipped > 0
            ? (lang === 'ar'
              ? `تم حفظ الأزواج المكتملة — تم تجاهل ${skipped} صف غير مكتمل (اختر موقع ${isSalla ? 'سلة' : 'زد'} وموقع أودو معًا)`
              : `Saved completed pairs — skipped ${skipped} incomplete row(s) (pick both locations)`)
            : (lang === 'ar' ? 'تم حفظ ربط المواقع بنجاح' : 'Location pairing saved successfully'),
        })
      } else {
        setInvSyncWebhookError(lang === 'ar' ? 'فشل حفظ بعض أزواج المواقع' : 'Some pairs failed to save')
      }
    } catch (err: any) {
      setInvSyncWebhookError(String(err?.message || err))
    } finally {
      setIsSavingPairs(false)
    }
  }, [invSyncPairs, loadInventorySyncData, lang, toast, standardStoreTab])

  // ── Odoo stock Webhook (إنشاء/حذف استقبال تغييرات الكميات) ─────────────────

  const handleCreateOdooWebhook = useCallback(async () => {
    const invSyncStoreType = standardStoreTab === 'salla' ? 'salla' : 'zid'
    setIsSyncingWebhook(true)
    setInvSyncWebhookError('')
    try {
      const wRes = await enableOdooStockWebhook(invSyncStoreType)
      if (wRes.success && wRes.refs) {
        setOdooStockWebhook(wRes.refs)
        toast({
          title: lang === 'ar' ? 'تم إنشاء Webhook أودو' : 'Odoo Webhook created',
          description: lang === 'ar'
            ? 'سيُراسل أودو ErpLink تلقائيًا عند أي تغيير على كميات الأصناف.'
            : 'Odoo will notify ErpLink automatically on any product quantity change.',
        })
      } else {
        setInvSyncWebhookError(wRes.error || (lang === 'ar' ? 'فشل إنشاء الـ Webhook' : 'Failed to create webhook'))
      }
    } catch (err: any) {
      console.error('[InventorySync] Create webhook failed:', err)
      setInvSyncWebhookError(String(err?.message || err))
    } finally {
      setIsSyncingWebhook(false)
    }
  }, [lang, toast, standardStoreTab])

  const handleDeleteOdooWebhook = useCallback(async () => {
    const invSyncStoreType = standardStoreTab === 'salla' ? 'salla' : 'zid'
    setIsSyncingWebhook(true)
    setInvSyncWebhookError('')
    try {
      const wRes = await disableOdooStockWebhook(invSyncStoreType)
      if (wRes.success) {
        setOdooStockWebhook(null)
        toast({
          title: lang === 'ar' ? 'تم حذف Webhook أودو' : 'Odoo Webhook deleted',
          description: lang === 'ar'
            ? 'لن يرسل أودو تحديثات المخزون بعد الآن.'
            : 'Odoo will no longer send stock updates.',
        })
      } else {
        setInvSyncWebhookError(wRes.error || (lang === 'ar' ? 'فشل حذف الـ Webhook' : 'Failed to delete webhook'))
      }
    } catch (err: any) {
      console.error('[InventorySync] Delete webhook failed:', err)
      setInvSyncWebhookError(String(err?.message || err))
    } finally {
      setIsSyncingWebhook(false)
    }
  }, [lang, toast, standardStoreTab])

  const handleSaveCustomers = useCallback(async () => {
    setIsSavingCustomers(true)
    const settingsPayload: Record<string, any> = {
      customer_type: customerDefaultType,
      on_delete: customerOnDelete,
      match_zid_field: customerMatchZidField,
      match_odoo_field: customerMatchOdooField,
      enabled_actions: (!customerDisabled && customerEnabledActions.length === 0) ? ['create', 'update', 'delete'] : customerEnabledActions,
      disabled: customerDisabled,
      receivable_account_id: receivableAccountId ? Number(receivableAccountId) : null,
      payable_account_id: payableAccountId ? Number(payableAccountId) : null,
      company_id: customerCompanyId ? Number(customerCompanyId) : null,
      link_company: customerLinkCompany,
    }
    const res = await saveStandardMappingSettings(standardStoreTab, standardSubTab, settingsPayload, standardStoreId)
    if (res?.success) {
      toast({
        title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
        description: lang === 'ar'
          ? 'تم حفظ إعدادات ربط العملاء الافتراضية بنجاح'
          : 'Customer standard mapping settings saved successfully',
      })
    } else {
      toast({
        title: lang === 'ar' ? 'خطأ في الحفظ' : 'Save Error',
        description: res?.error || (lang === 'ar' ? 'حدث خطأ أثناء الحفظ' : 'Something went wrong while saving'),
        variant: 'destructive',
      })
    }
    setIsSavingCustomers(false)
  }, [
    customerDefaultType,
    customerOnDelete,
    customerMatchZidField,
    customerMatchOdooField,
    customerEnabledActions,
    customerDisabled,
    receivableAccountId,
    payableAccountId,
    customerCompanyId,
    customerLinkCompany,
    standardStoreTab,
    standardStoreId,
    standardSubTab,
    lang,
    toast,
  ])

  const handleSaveOrders = useCallback(async () => {
    setIsSavingOrders(true)
    const warnings: string[] = []

    // Validation checks
    if (!orderDisabled && orderEnabledActions.includes('create')) {
      if (!orderWarehouseId) {
        warnings.push(lang === 'ar' ? 'المستودع الافتراضي غير محدد — قد يفشل إنشاء الطلب في أودو' : 'Default warehouse not set — order creation may fail in Odoo')
      }
      if (!orderPricelistId) {
        warnings.push(lang === 'ar' ? 'قائمة الأسعار الافتراضية غير محددة — قد يفشل إنشاء الطلب في أودو' : 'Default pricelist not set — order creation may fail in Odoo')
      }
    }
    if (orderAddShipping && !orderShippingProductId) {
      warnings.push(lang === 'ar' ? 'تم تحديد الشحن كبند لكن لم يتم اختيار منتج الشحن في أودو' : 'Shipping is enabled but no Odoo shipping product selected')
    }
    if (orderAddCod && !orderCodProductId) {
      warnings.push(lang === 'ar' ? 'تم تفعيل رسوم الدفع عند الاستلام لكن لم يتم تحديد منتج رسوم COD في أودو' : 'COD fee line is enabled but no Odoo COD product selected')
    }
    if (orderAddDiscount && orderDiscountMode === 'fixed' && !orderDiscountProductId) {
      warnings.push(lang === 'ar' ? 'تم تفعيل الخصم كقيمة ثابتة لكن لم يتم تحديد منتج الخصم في أودو' : 'Discount is enabled in fixed mode but no Odoo discount product selected')
    }
    if (orderCustomerFallbackPolicy === 'default_customer' && !orderDefaultCustomerId) {
      warnings.push(lang === 'ar' ? 'تم اختيار اعتماد عميل افتراضي لكن لم يتم تحديد العميل' : 'Default customer policy is selected but no customer selected')
    }
    if (orderProductFallbackPolicy === 'default_product' && !orderDefaultProductId) {
      warnings.push(lang === 'ar' ? 'تم اختيار اعتماد منتج افتراضي لكن لم يتم تحديد المنتج' : 'Default product policy is selected but no product selected')
    }

    // Drop half-filled analytic rows instead of persisting them: an empty
    // account or percentage would silently skew the distribution.
    const analyticRules = orderAnalyticRules.reduce<Array<{
      condition: 'all' | 'warehouse' | 'payment'
      source_value: string
      source_label: string
      odoo_analytic_account_id: number
      percentage: number
    }>>((acc, rule) => {
      const accountId = Number(rule.odoo_analytic_account_id)
      const percentage = Number(rule.percentage)
      if (!Number.isInteger(accountId) || accountId <= 0) return acc
      if (!Number.isFinite(percentage) || percentage <= 0) return acc

      const condition = rule.condition === 'warehouse' || rule.condition === 'payment' ? rule.condition : 'all'
      const sourceValue = condition === 'all' ? '' : String(rule.source_value || '').trim()
      if (condition !== 'all' && !sourceValue) return acc

      acc.push({
        condition,
        source_value: sourceValue,
        source_label: condition === 'all' ? '' : String(rule.source_label || '').trim() || sourceValue,
        odoo_analytic_account_id: accountId,
        percentage: Math.min(percentage, 100),
      })
      return acc
    }, [])

    if (orderAnalyticEnabled && analyticRules.length === 0) {
      warnings.push(
        lang === 'ar'
          ? 'التوزيع التحليلي مفعّل بدون أي صف مكتمل - لن يُطبَّق أي حساب'
          : 'Analytic distribution is enabled with no complete rule - no account will be applied'
      )
    } else if (orderAnalyticEnabled && analyticRules.length !== orderAnalyticRules.length) {
      warnings.push(
        lang === 'ar'
          ? 'تم تجاهل صفوف التوزيع التحليلي الناقصة'
          : 'Incomplete analytic-distribution rows were ignored'
      )
    }

    if (orderReturnsMode !== 'nothing' && orderReturnsReasonType === 'custom' && !orderReturnsReason.trim()) {
      toast({
        title: lang === 'ar' ? 'حقل إجباري مطلوب' : 'Required Field',
        description: lang === 'ar' ? 'يرجى كتابة سبب المرتجع المخصص' : 'Please enter the custom return reason',
        variant: 'destructive',
      })
      setIsSavingOrders(false)
      return
    }

    const paymentJournalMappings = orderPaymentJournalMappings
      .filter(m => m.zid_payment_method.trim() && m.odoo_journal_id.trim())
      .map(m => ({
        zid_payment_method: m.zid_payment_method.trim(),
        odoo_journal_id: m.odoo_journal_id.trim(),
      }))

    const cleanedCountryTaxRates = orderCountryTaxRates
      .filter(r => r.country_code && r.country_code.trim())
      .map(r => ({
        country_code: r.country_code.trim().toUpperCase(),
        country_name: r.country_name?.trim() || '',
        tax_rate: r.tax_rate !== '' && !isNaN(Number(r.tax_rate)) ? Number(r.tax_rate) : 0,
      }))

    const cleanedVatCountryRules = orderVatCountryRules
      .filter(r => r.country_code && r.country_code.trim())
      .map(r => ({
        country_code: r.country_code.trim().toUpperCase(),
        country_name: r.country_name?.trim() || '',
        tax_id: r.tax_id ? Number(r.tax_id) : null,
      }))

    const resolvedSaudiTax = cleanedVatCountryRules.find(r => r.country_code === 'SA')?.tax_id
      ?? (orderVatSaudiTaxId ? Number(orderVatSaudiTaxId) : null)
    const resolvedNonSaudiTax = cleanedVatCountryRules.find(r => r.country_code === 'OTHER' || r.country_code === '*')?.tax_id
      ?? (orderVatNonSaudiTaxId ? Number(orderVatNonSaudiTaxId) : null)

    const settingsPayload: Record<string, any> = {
      disabled: orderDisabled,
      enabled_actions: (!orderDisabled && orderEnabledActions.length === 0) ? ['create', 'update', 'cancel', 'deliver'] : orderEnabledActions,
      match_zid_field: orderMatchZidField,
      match_odoo_field: orderMatchOdooField,
      company_id: orderCompanyId ? Number(orderCompanyId) : null,
      link_company: orderLinkCompany,
      payment_sync_enabled: orderPaymentAutoSync,
      payment_journal_mappings: paymentJournalMappings,
      customer_fallback_policy: orderCustomerFallbackPolicy,
      default_customer_id: orderDefaultCustomerId ? Number(orderDefaultCustomerId) : null,
      product_fallback_policy: orderProductFallbackPolicy,
      default_product_id: orderDefaultProductId ? Number(orderDefaultProductId) : null,
      add_shipping_as_line: !!orderShippingProductId,
      shipping_product_id: orderShippingProductId ? Number(orderShippingProductId) : null,
      shipping_product_sku: orderShippingProductSku || null,
      add_cod_as_line: orderAddCod,
      cod_product_id: orderCodProductId ? Number(orderCodProductId) : null,
      cod_product_sku: orderCodProductSku || null,
      cod_amount: orderCodAmount ? Number(orderCodAmount) : null,
      add_discount_as_line: orderAddDiscount,
      discount_product_id: (orderAddDiscount && orderDiscountMode === 'fixed' && orderDiscountProductId) ? Number(orderDiscountProductId) : null,
      discount_product_sku: orderDiscountProductSku || null,
      discount_mode: orderDiscountMode,
      enable_vat: orderEnableVat,
      vat_country_rules: cleanedVatCountryRules,
      vat_saudi_tax_id: resolvedSaudiTax,
      vat_non_saudi_tax_id: resolvedNonSaudiTax,
      prices_include_tax: orderPricesIncludeTax,
      tax_rate_percent: orderTaxRatePercent !== '' && !isNaN(Number(orderTaxRatePercent)) ? Number(orderTaxRatePercent) : 15,
      tax_rates_by_country: cleanedCountryTaxRates,
      update_custom_status_field: orderUpdateCustomStatus,
      order_status_custom_field: orderStatusCustomField,
      multi_currency_enabled: orderMultiCurrencyEnabled,
      base_currency_id: orderBaseCurrencyId ? Number(orderBaseCurrencyId) : null,
      order: {
        default_warehouse_id: orderWarehouseId ? Number(orderWarehouseId) : null,
        default_pricelist_id: orderPricelistId ? Number(orderPricelistId) : null,
        default_payment_term_id: orderPaymentTermId ? Number(orderPaymentTermId) : null,
        multi_currency_enabled: orderMultiCurrencyEnabled,
        base_currency_id: orderBaseCurrencyId ? Number(orderBaseCurrencyId) : null,
        auto_confirm: orderAutoConfirm,
        auto_invoice: orderAutoInvoice,
        partial_fulfillment: orderPartialFulfillment,
        customer_fallback_policy: orderCustomerFallbackPolicy,
        default_customer_id: orderDefaultCustomerId ? Number(orderDefaultCustomerId) : null,
        product_fallback_policy: orderProductFallbackPolicy,
        default_product_id: orderDefaultProductId ? Number(orderDefaultProductId) : null,
        enable_vat: orderEnableVat,
        vat_country_rules: cleanedVatCountryRules,
        vat_saudi_tax_id: resolvedSaudiTax,
        vat_non_saudi_tax_id: resolvedNonSaudiTax,
        prices_include_tax: orderPricesIncludeTax,
        tax_rate_percent: orderTaxRatePercent !== '' && !isNaN(Number(orderTaxRatePercent)) ? Number(orderTaxRatePercent) : 15,
        update_custom_status_field: orderUpdateCustomStatus,
        order_status_custom_field: orderStatusCustomField,
        // Persisted as a plain Record (Zid location id → Odoo warehouse id);
        // half-filled rows are dropped so they never shadow a real rule.
        store_warehouse_mappings: storeWarehouseRules.reduce<Record<string, string>>((acc, rule) => {
          const src = String(rule.zid_location_id || '').trim()
          const wh = String(rule.odoo_warehouse_id || '').trim()
          if (src && wh) acc[src] = wh
          return acc
        }, {}),
        analytic: {
          enabled: orderAnalyticEnabled,
          rules: analyticRules,
        },
        // Consumed by the returns modules in src/lib/returns - no DB migration:
        // it is plain JSON in the existing settings blob.
        returns: {
          mode: orderReturnsMode,
          create_credit_note: orderReturnsCreditNote,
          credit_note_journal_id: orderReturnsJournalId ? Number(orderReturnsJournalId) : null,
          fallback_when_missing: orderReturnsFallback,
          reason: orderReturnsReason,
          reason_type: orderReturnsReasonType,
        },
        // Store status actions in JSON settings as well for 100% zero-migration reliability
        status_actions: orderStateMapping,
        payment_sync_enabled: orderPaymentAutoSync,
        payment_journal_mappings: paymentJournalMappings,
      }
    }
    // Save settings first, then mappings (if settings fails, stop early)
    const settingsRes = await saveStandardMappingSettings(standardStoreTab, standardSubTab, settingsPayload, standardStoreId)
    if (!settingsRes?.success) {
      toast({
        title: lang === 'ar' ? 'خطأ في حفظ الإعدادات' : 'Save Error',
        description: settingsRes?.error || (lang === 'ar' ? 'فشل حفظ الإعدادات' : 'Failed to save settings'),
        variant: 'destructive',
      })
      setIsSavingOrders(false)
      return
    }
      const mappingsRes = await saveOrderStatusMappings(standardStoreTab, orderStateMapping, standardStoreId)
    if (mappingsRes?.success) {
      const desc = warnings.length > 0
        ? (lang === 'ar' ? 'تم الحفظ. تحذيرات: ' : 'Saved. Warnings: ') + warnings.join(' | ')
        : (lang === 'ar' ? 'تم حفظ إعدادات ربط الطلبات الافتراضية بنجاح' : 'Order standard mapping settings saved successfully')
      toast({
        title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
        description: desc,
        ...(warnings.length > 0 ? { variant: 'warning' as any } : {}),
      })
    } else {
      toast({
        title: lang === 'ar' ? 'خطأ في حفظ حالات الطلب' : 'Mapping Save Error',
        description: mappingsRes?.error || (lang === 'ar' ? 'فشل حفظ حالات الطلب — الإعدادات الأخرى محفوظة' : 'Failed to save order status mappings — other settings saved'),
        variant: 'destructive',
      })
    }
    setIsSavingOrders(false)
  }, [
    orderDisabled, orderEnabledActions, orderMatchZidField, orderMatchOdooField,
    orderCompanyId, orderLinkCompany, orderWarehouseId, orderPricelistId, orderPaymentTermId,
    orderAutoConfirm, orderAutoInvoice, orderPartialFulfillment, storeWarehouseRules,
    orderReturnsMode, orderReturnsCreditNote, orderReturnsJournalId, orderReturnsFallback, orderReturnsReason,
    orderAnalyticEnabled, orderAnalyticRules,
    orderCustomerFallbackPolicy, orderDefaultCustomerId, orderProductFallbackPolicy, orderDefaultProductId,
    orderAddShipping, orderShippingProductId, orderShippingProductSku,
    orderAddCod, orderCodProductId, orderCodProductSku, orderCodAmount,
    orderAddDiscount, orderDiscountProductId, orderDiscountProductSku, orderDiscountMode,

    orderEnableVat, orderVatSaudiTaxId, orderVatNonSaudiTaxId, orderVatCountryRules,
    orderPricesIncludeTax, orderTaxRatePercent, orderCountryTaxRates,
    orderUpdateCustomStatus, orderStatusCustomField,
    orderPaymentAutoSync, orderPaymentJournalMappings,
    orderStateMapping, standardStoreTab, standardStoreId, standardSubTab, lang, toast
  ])

  const handleCreateStatusField = useCallback(async () => {
    if (!hasOdooConnection) {
      toast({
        title: lang === 'ar' ? 'غير متصل بنظام ERP' : 'ERP Not Connected',
        description: lang === 'ar' ? 'يرجى ربط نظام أودو أولاً لتتمكن من إنشاء الحقل' : 'Please connect to Odoo first',
        variant: 'destructive',
      })
      return
    }
    setIsCreatingStatusField(true)
    // Client-side ceiling: the action performs up to ~7 sequential Odoo
    // round-trips (10s timeout each) plus view injection, so a slow/unreachable
    // Odoo can keep this pending for a minute+. Bound it so the spinner can
    // never stick forever — on timeout the user gets a clear error instead.
    const STATUS_FIELD_TIMEOUT_MS = 60_000
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const timeoutError = new Error('__status_field_timeout__')
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(timeoutError), STATUS_FIELD_TIMEOUT_MS)
    })
    try {
      const statusPlatform = standardStoreTab === 'salla' ? 'salla' : 'zid'
      const statusFieldDefault = defaultOrderStatusFieldName(statusPlatform)
      const storeNameAr = statusPlatform === 'salla' ? 'سلة' : 'زد'
      const res = await Promise.race([
        createZidOrderStatusFieldInOdoo(orderStatusCustomField || statusFieldDefault, statusPlatform),
        timeout,
      ])
      if (res.success && res.fieldName) {
        setOrderStatusCustomField(res.fieldName)
        setOrderUpdateCustomStatus(true)
        setStatusFieldExists(true)
        if (res.options) setStatusFieldOptions(res.options)
        await fetchOdooOrderFields(true)
        toast({
          title: lang === 'ar' ? 'تم إنشاء الحقل بنجاح' : 'Field Created Successfully',
          description: lang === 'ar'
            ? `تم إنشاء الحقل (${res.fieldName}) من نوع Selection داخل أودو بنجاح وربطه بجميع حالات ${storeNameAr}.`
            : `Custom field (${res.fieldName}) created in Odoo on sale.order with all ${statusPlatform === 'salla' ? 'Salla' : 'Zid'} statuses.`,
        })
      } else {
        toast({
          title: lang === 'ar' ? 'خطأ في إنشاء الحقل' : 'Field Creation Failed',
          description: res.error || (lang === 'ar' ? 'تعذر إنشاء الحقل في أودو' : 'Failed to create field in Odoo'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      const isTimeout = err === timeoutError
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: isTimeout
          ? (lang === 'ar'
            ? 'استغرقت العملية أكثر من دقيقة — تحقق من سرعة الاتصال بأودو ثم أعد المحاولة (تابع سطر [order-custom-status] في طرفية السيرفر لمعرفة المرحلة المتوقفة).'
            : 'The operation took over a minute — check the Odoo connection speed and retry (watch [order-custom-status] lines in the server terminal for the stuck step).')
          : (err?.message || 'Error creating custom field'),
        variant: 'destructive',
      })
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setIsCreatingStatusField(false)
    }
  }, [hasOdooConnection, orderStatusCustomField, fetchOdooOrderFields, lang, toast, standardStoreTab])

  const platformLabel = (platform: string) =>
    platform === 'zid' ? (lang === 'ar' ? 'زد' : 'Zid')
    : platform === 'salla' ? (lang === 'ar' ? 'سله' : 'Salla')
    : (lang === 'ar' ? 'شوبيفاي' : 'Shopify')

  // One tab per connected STORE: name + merchant id + platform chip, e.g.
  // Demo(403476178) · سلة. Each tab reads/writes that store's own settings row
  // (inheriting the platform defaults until first save).
  const storeTabs = [
    ...(zidStores || []).map(s => ({ key: `zid:${s.id}`, platform: 'zid', storeId: s.id, name: s.name || 'زد' })),
    ...(sallaStores || []).map(s => ({ key: `salla:${s.id}`, platform: 'salla', storeId: s.id, name: s.name || 'سله' })),
    ...(shopifyStores || []).map(s => ({ key: `shopify:${s.id}`, platform: 'shopify', storeId: s.id, name: s.name || 'شوبيفاي' })),
  ]

  // Only connected stores get a tab — a disconnected platform is not shown
  // at all (previously all three rendered, dimmed). Empty = no store linked.
  // Active store tab (falls back to the first connected store if the
  // selection ever points at a store that is no longer linked).
  const activeStoreTab = storeTabs.find(t => t.platform === standardStoreTab && t.storeId === standardStoreId) ?? storeTabs[0] ?? null

  // Per-tab store naming for the Odoo → store inventory sync (Products tab,
  // Zid/Salla). Kept local so the section reads the active store, not 'زد'.
  const isSallaInvSync = standardStoreTab === 'salla'
  const invSyncStoreNameAr = isSallaInvSync ? 'سلة' : 'زد'
  const invSyncStoreNameEn = isSallaInvSync ? 'Salla' : 'Zid'

  // Per-tab platform for the order-status custom field section (4.5): Salla
  // tabs manage x_salla_order_status + Salla statuses, Zid tabs the Zid
  // ones. Connected to both → each tab drives its own field and options.
  const statusFieldPlatform = standardStoreTab === 'salla' ? 'salla' : 'zid'
  const statusFieldDefaultName = defaultOrderStatusFieldName(statusFieldPlatform)
  const statusStoreNameAr = statusFieldPlatform === 'salla' ? 'سلة' : 'زد'
  const statusStoreNameEn = statusFieldPlatform === 'salla' ? 'Salla' : 'Zid'

  // Logs + per-entity mapping dialogs (mounted once, opened from the
  // standard entity sections below)
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [isCategoryLogOpen, setIsCategoryLogOpen] = useState(false)
  const [isProductLogOpen, setIsProductLogOpen] = useState(false)
  const [isOrderLogOpen, setIsOrderLogOpen] = useState(false)

  // Per-Category Mapping dialog
  const [isCategoryMappingOpen, setIsCategoryMappingOpen] = useState(false)

  // Per-Product Mapping dialog
  const [isProductMappingOpen, setIsProductMappingOpen] = useState(false)

  // Load mappings on mount
  const loadMappings = async () => {
    setIsLoading(true)
    try {
      const res = await getFieldMappings()
      if (res.success) {
        setMappings(res.mappings || [])
      }
    } catch (err) {
      console.error('Failed to load mappings:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadMappings()
  }, [])

  return (
    <>
      {/* ── Sticky Navigation Header ─────────────────────── */}
      <div className="sticky top-0 z-30 -mx-4 md:-mx-8 px-4 md:px-8 border-b border-border/70 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 h-12">
          {/* Entity Tabs (Underline / Pill hybrid clean style) */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
            {[
              { key: 'categories', labelAr: 'التصنيفات (Categories)', labelEn: 'Categories', icon: <FolderTree className="h-4 w-4" /> },
              { key: 'products', labelAr: 'المنتجات (Products)', labelEn: 'Products', icon: <Package className="h-4 w-4" /> },
              { key: 'customers', labelAr: 'العملاء (Customers)', labelEn: 'Customers', icon: <Users className="h-4 w-4" /> },
              { key: 'orders', labelAr: 'الطلبات (Orders)', labelEn: 'Orders', icon: <ShoppingCart className="h-4 w-4" /> },
            ].map((item) => {
              const isActive = standardSubTab === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStandardSubTab(item.key as any)}
                  className={cn(
                    'flex items-center gap-2 px-3 h-8 rounded-none text-xs font-semibold transition-colors whitespace-nowrap border-b-2 -mb-px',
                    isActive
                      ? 'border-foreground text-foreground font-bold'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <span className={cn(isActive ? 'text-foreground' : 'text-muted-foreground/80')}>{item.icon}</span>
                  <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                </button>
              )
            })}
          </div>

          {/* Quick status badge if ERP connected */}
          {hasOdooConnection && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span>{lang === 'ar' ? 'أودو متصل' : 'Odoo Connected'}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content Area ──────────────────────────────── */}
      <div className="max-w-7xl mx-auto space-y-4 pt-2 pb-16 font-sans" dir={dir}>
        {/* Compact toolbar: which store the settings below apply to.
            The page title already comes from `mapping-center/page.tsx`
            (MappingCenterHeader), so this must not repeat it. */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">
              {lang === 'ar' ? 'المتجر المستهدف' : 'Active store'}
            </span>
            {hasOdooConnection && (
              <span className="hidden sm:inline-flex items-center gap-1 border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {lang === 'ar' ? 'أودو متصل' : 'Odoo connected'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 overflow-x-auto max-w-full">
            {storeTabs.length > 0 ? (
              storeTabs.map((store) => {
                const isActive = standardStoreTab === store.platform && standardStoreId === store.storeId
                return (
                  <button
                    key={store.key}
                    type="button"
                    onClick={() => selectStoreTab(store.platform, store.storeId)}
                    className={cn(
                      'flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap',
                      isActive
                        ? 'border-foreground/30 bg-muted text-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                    )}
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-emerald-500" />
                    <span dir="auto">{store.name}</span>
                    <span className="border border-border/60 bg-card px-1.5 py-0.5 text-[9px] font-mono font-normal text-muted-foreground">
                      {platformLabel(store.platform)}
                    </span>
                  </button>
                )
              })
            ) : (
              <Link
                href="/app/connect-store"
                className="flex items-center gap-1.5 border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full shrink-0 bg-muted-foreground/40" />
                <span>
                  {lang === 'ar'
                    ? 'لا يوجد متجر متصل — اربط متجراً أولاً'
                    : 'No store connected — connect a store first'}
                </span>
              </Link>
            )}
          </div>
        </div>

        {/* ── Active Store Content ────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${standardSubTab}-${standardStoreTab}-${standardStoreId}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {activeStoreTab ? (
              standardSubTab === 'categories' ? (
                <CategorySettingsTab
                  lang={lang}
                  dir={dir}
                  costMethod={costMethod}
                  setCostMethod={setCostMethod}
                  isLoadingOdooOpts={isLoadingOdooOpts}
                  costMethodOptions={costMethodOptions}
                  inventoryValuation={inventoryValuation}
                  setInventoryValuation={setInventoryValuation}
                  valuationOptions={valuationOptions}
                  categoryCompanyId={categoryCompanyId}
                  setCategoryCompanyId={setCategoryCompanyId}
                  categoryLinkCompany={categoryLinkCompany}
                  setCategoryLinkCompany={setCategoryLinkCompany}
                  isLoadingCompanies={isLoadingCompanies}
                  companyOptions={companyOptions}
                  onDeleteAction={onDeleteAction}
                  setOnDeleteAction={setOnDeleteAction}
                  matchZidField={matchZidField}
                  setMatchZidField={setMatchZidField}
                  matchOdooField={matchOdooField}
                  setMatchOdooField={setMatchOdooField}
                  categoryFields={categoryFields}
                  odooCategoryFields={odooCategoryFields}
                  isLoadingOdooFields={isLoadingOdooFields}
                  fetchOdooCategoryFields={fetchOdooCategoryFields}
                  enabledActions={enabledActions}
                  setEnabledActions={setEnabledActions}
                  disabled={disabled}
                  setDisabled={setDisabled}
                  isSaving={isSaving}
                  handleSave={handleSave}
                  setIsCategoryMappingOpen={setIsCategoryMappingOpen}
                  setIsCategoryLogOpen={setIsCategoryLogOpen}
                />
              ) : standardSubTab === 'products' ? (
                <ProductSettingsTab
                  lang={lang}
                  dir={dir}
                  standardStoreTab={standardStoreTab}
                  invSyncStoreNameAr={invSyncStoreNameAr}
                  invSyncStoreNameEn={invSyncStoreNameEn}
                  isSallaInvSync={isSallaInvSync}
                  productType={productType}
                  setProductType={setProductType}
                  productTypeOptions={productTypeOptions}
                  isLoadingProductOpts={isLoadingProductOpts}
                  trackInventory={trackInventory}
                  setTrackInventory={setTrackInventory}
                  trackingMethod={trackingMethod}
                  setTrackingMethod={setTrackingMethod}
                  trackingOptions={trackingOptions}
                  productCompanyId={productCompanyId}
                  setProductCompanyId={setProductCompanyId}
                  productLinkCompany={productLinkCompany}
                  setProductLinkCompany={setProductLinkCompany}
                  companyOptions={companyOptions}
                  isLoadingCompanies={isLoadingCompanies}
                  fetchCompanies={fetchCompanies}
                  markupPercent={markupPercent}
                  setMarkupPercent={setMarkupPercent}
                  costSource={costSource}
                  setCostSource={setCostSource}
                  priceSource={priceSource}
                  setPriceSource={setPriceSource}
                  rounding={rounding}
                  setRounding={setRounding}
                  decimalPlaces={decimalPlaces}
                  setDecimalPlaces={setDecimalPlaces}
                  nameLanguage={nameLanguage}
                  setNameLanguage={setNameLanguage}
                  nameFallback={nameFallback}
                  setNameFallback={setNameFallback}
                  descLanguage={descLanguage}
                  setDescLanguage={setDescLanguage}
                  descFallback={descFallback}
                  setDescFallback={setDescFallback}
                  descCustomText={descCustomText}
                  setDescCustomText={setDescCustomText}
                  productVariantSyncMode={productVariantSyncMode}
                  setProductVariantSyncMode={setProductVariantSyncMode}
                  bomEnabled={bomEnabled}
                  setBomEnabled={setBomEnabled}
                  bomType={bomType}
                  setBomType={setBomType}
                  imageSyncMode={imageSyncMode}
                  setImageSyncMode={setImageSyncMode}
                  categorySyncMode={categorySyncMode}
                  setCategorySyncMode={setCategorySyncMode}
                  uomAutoCreate={uomAutoCreate}
                  setUomAutoCreate={setUomAutoCreate}
                  taxSyncMode={taxSyncMode}
                  setTaxSyncMode={setTaxSyncMode}
                  defaultTaxIds={defaultTaxIds}
                  setDefaultTaxIds={setDefaultTaxIds}
                  taxOptions={taxOptions}
                  isLoadingTaxOpts={isLoadingTaxOpts}
                  productOnDelete={productOnDelete}
                  setProductOnDelete={setProductOnDelete}
                  invSyncEnabled={invSyncEnabled}
                  setInvSyncEnabled={setInvSyncEnabled}
                  invSyncMode={invSyncMode}
                  setInvSyncMode={setInvSyncMode}
                  odooStockWebhook={odooStockWebhook}
                  handleCreateOdooWebhook={handleCreateOdooWebhook}
                  handleDeleteOdooWebhook={handleDeleteOdooWebhook}
                  isSyncingWebhook={isSyncingWebhook}
                  invSyncWebhookError={invSyncWebhookError}
                  isLoadingInvSync={isLoadingInvSync}
                  invSyncPairs={invSyncPairs}
                  handlePairChange={handlePairChange}
                  handleRemovePair={handleRemovePair}
                  handleAddPair={handleAddPair}
                  handleSavePairs={handleSavePairs}
                  isSavingPairs={isSavingPairs}
                  handleRefreshInvLocations={handleRefreshInvLocations}
                  isRefreshingInvLocations={isRefreshingInvLocations}
                  usedPairSources={usedPairSources}
                  allPairSourcesTaken={allPairSourcesTaken}
                  zidLocations={zidLocations}
                  sallaLocations={sallaLocations}
                  odooLocations={odooLocations}
                  productFields={productFields}
                  productMatchZidField={productMatchZidField}
                  setProductMatchZidField={setProductMatchZidField}
                  productMatchOdooField={productMatchOdooField}
                  setProductMatchOdooField={setProductMatchOdooField}
                  productOdooFields={productOdooFields}
                  isLoadingProductFields={isLoadingProductFields}
                  fetchOdooProductFields={fetchOdooProductFields}
                  productEnabledActions={productEnabledActions}
                  setProductEnabledActions={setProductEnabledActions}
                  productDisabled={productDisabled}
                  setProductDisabled={setProductDisabled}
                  isSavingProducts={isSavingProducts}
                  handleSaveProducts={handleSaveProducts}
                  setIsProductMappingOpen={setIsProductMappingOpen}
                  setIsProductLogOpen={setIsProductLogOpen}
                />
              ) : standardSubTab === 'customers' ? (
                <CustomerSettingsTab
                  lang={lang}
                  dir={dir}
                  customerDefaultType={customerDefaultType}
                  setCustomerDefaultType={setCustomerDefaultType}
                  receivableAccountId={receivableAccountId}
                  setReceivableAccountId={setReceivableAccountId}
                  payableAccountId={payableAccountId}
                  setPayableAccountId={setPayableAccountId}
                  receivableAccountOptions={receivableAccountOptions}
                  payableAccountOptions={payableAccountOptions}
                  isLoadingAccounts={isLoadingAccounts}
                  customerCompanyId={customerCompanyId}
                  setCustomerCompanyId={setCustomerCompanyId}
                  customerLinkCompany={customerLinkCompany}
                  setCustomerLinkCompany={setCustomerLinkCompany}
                  isLoadingCompanies={isLoadingCompanies}
                  companyOptions={companyOptions}
                  customerOnDelete={customerOnDelete}
                  setCustomerOnDelete={setCustomerOnDelete}
                  customerMatchZidField={customerMatchZidField}
                  setCustomerMatchZidField={setCustomerMatchZidField}
                  customerMatchOdooField={customerMatchOdooField}
                  setCustomerMatchOdooField={setCustomerMatchOdooField}
                  customerFields={customerFields}
                  odooCustomerFields={odooCustomerFields}
                  isLoadingCustomerFields={isLoadingCustomerFields}
                  fetchOdooCustomerFields={fetchOdooCustomerFields}
                  customerEnabledActions={customerEnabledActions}
                  setCustomerEnabledActions={setCustomerEnabledActions}
                  customerDisabled={customerDisabled}
                  setCustomerDisabled={setCustomerDisabled}
                  isSavingCustomers={isSavingCustomers}
                  handleSaveCustomers={handleSaveCustomers}
                  setIsLogOpen={setIsLogOpen}
                />
              ) : (
                <OrderSettingsTab
                  lang={lang}
                  dir={dir}
                  standardStoreTab={standardStoreTab}
                  statusStoreNameAr={statusStoreNameAr}
                  statusStoreNameEn={statusStoreNameEn}
                  statusFieldDefaultName={statusFieldDefaultName}
                  orderDisabled={orderDisabled}
                  setOrderDisabled={setOrderDisabled}
                  orderEnabledActions={orderEnabledActions}
                  setOrderEnabledActions={setOrderEnabledActions}
                  orderMatchZidField={orderMatchZidField}
                  setOrderMatchZidField={setOrderMatchZidField}
                  orderMatchOdooField={orderMatchOdooField}
                  setOrderMatchOdooField={setOrderMatchOdooField}
                  orderFields={orderFields}
                  odooOrderFields={odooOrderFields}
                  isLoadingOrderFields={isLoadingOrderFields}
                  fetchOdooOrderFields={fetchOdooOrderFields}
                  orderCustomerFallbackPolicy={orderCustomerFallbackPolicy}
                  setOrderCustomerFallbackPolicy={setOrderCustomerFallbackPolicy}
                  orderDefaultCustomerId={orderDefaultCustomerId}
                  setOrderDefaultCustomerId={setOrderDefaultCustomerId}
                  customerOptions={customerOptions}
                  isLoadingCustomers={isLoadingCustomers}
                  handleRefreshCustomers={handleRefreshCustomers}
                  orderProductFallbackPolicy={orderProductFallbackPolicy}
                  setOrderProductFallbackPolicy={setOrderProductFallbackPolicy}
                  orderDefaultProductId={orderDefaultProductId}
                  setOrderDefaultProductId={setOrderDefaultProductId}
                  productOptions={productOptions}
                  isLoadingProducts={isLoadingProducts}
                  handleRefreshProducts={handleRefreshProducts}
                  orderWarehouseId={orderWarehouseId}
                  setOrderWarehouseId={setOrderWarehouseId}
                  warehouseOptions={warehouseOptions}
                  isLoadingWarehouses={isLoadingWarehouses}
                  orderPricelistId={orderPricelistId}
                  setOrderPricelistId={setOrderPricelistId}
                  pricelistOptions={pricelistOptions}
                  isLoadingPricelists={isLoadingPricelists}
                  orderPaymentTermId={orderPaymentTermId}
                  setOrderPaymentTermId={setOrderPaymentTermId}
                  paymentTermOptions={paymentTermOptions}
                  isLoadingPaymentTerms={isLoadingPaymentTerms}
                  orderMultiCurrencyEnabled={orderMultiCurrencyEnabled}
                  setOrderMultiCurrencyEnabled={setOrderMultiCurrencyEnabled}
                  orderBaseCurrencyId={orderBaseCurrencyId}
                  setOrderBaseCurrencyId={setOrderBaseCurrencyId}
                  currencyOptions={currencyOptions}
                  isLoadingCurrencies={isLoadingCurrencies}
                  handleRefreshCurrencies={handleRefreshCurrencies}
                  journalOptions={journalOptions}
                  isLoadingJournals={isLoadingJournals}
                  handleRefreshJournals={handleRefreshJournals}
                  orderPaymentAutoSync={orderPaymentAutoSync}
                  setOrderPaymentAutoSync={setOrderPaymentAutoSync}
                  orderPaymentJournalMappings={orderPaymentJournalMappings}
                  handlePaymentJournalMappingChange={handlePaymentJournalMappingChange}
                  handleRemovePaymentJournalMapping={handleRemovePaymentJournalMapping}
                  handleAddPaymentJournalMapping={handleAddPaymentJournalMapping}
                  handleRefreshPaymentOptions={handleRefreshPaymentOptions}
                  isLoadingPaymentMethods={isLoadingPaymentMethods}
                  orderCompanyId={orderCompanyId}
                  setOrderCompanyId={setOrderCompanyId}
                  orderLinkCompany={orderLinkCompany}
                  setOrderLinkCompany={setOrderLinkCompany}
                  companyOptions={companyOptions}
                  isLoadingCompanies={isLoadingCompanies}
                  orderReturnsMode={orderReturnsMode}
                  setOrderReturnsMode={setOrderReturnsMode}
                  orderReturnsCreditNote={orderReturnsCreditNote}
                  setOrderReturnsCreditNote={setOrderReturnsCreditNote}
                  orderReturnsJournalId={orderReturnsJournalId}
                  setOrderReturnsJournalId={setOrderReturnsJournalId}
                  orderReturnsFallback={orderReturnsFallback}
                  setOrderReturnsFallback={setOrderReturnsFallback}
                  orderReturnsReasonType={orderReturnsReasonType}
                  setOrderReturnsReasonType={setOrderReturnsReasonType}
                  orderReturnsReason={orderReturnsReason}
                  setOrderReturnsReason={setOrderReturnsReason}
                  storeWarehouseRules={storeWarehouseRules}
                  handleWarehouseRuleChange={handleWarehouseRuleChange}
                  handleRemoveWarehouseRule={handleRemoveWarehouseRule}
                  handleAddWarehouseRule={handleAddWarehouseRule}
                  handleRefreshOrderWarehouses={handleRefreshOrderWarehouses}
                  isRefreshingOrderWarehouses={isRefreshingOrderWarehouses}
                  sallaOrderLocationOptions={sallaOrderLocationOptions}
                  zidLocationOptions={zidLocationOptions}
                  orderAnalyticEnabled={orderAnalyticEnabled}
                  setOrderAnalyticEnabled={setOrderAnalyticEnabled}
                  orderAnalyticRules={orderAnalyticRules}
                  handleAnalyticRuleChange={handleAnalyticRuleChange}
                  handleRemoveAnalyticRule={handleRemoveAnalyticRule}
                  handleAddAnalyticRule={handleAddAnalyticRule}
                  handleRefreshAnalyticOptions={handleRefreshAnalyticOptions}
                  isLoadingAnalyticOptions={isLoadingAnalyticOptions}
                  analyticAccountOptions={analyticAccountOptions}
                  paymentMethodOptions={paymentMethodOptions}
                  analyticOptionsError={analyticOptionsError}
                  orderEnableVat={orderEnableVat}
                  setOrderEnableVat={setOrderEnableVat}
                  orderVatSaudiTaxId={orderVatSaudiTaxId}
                  setOrderVatSaudiTaxId={setOrderVatSaudiTaxId}
                  orderVatNonSaudiTaxId={orderVatNonSaudiTaxId}
                  setOrderVatNonSaudiTaxId={setOrderVatNonSaudiTaxId}
                  orderVatCountryRules={orderVatCountryRules}
                  setOrderVatCountryRules={setOrderVatCountryRules}
                  orderTaxOptions={orderTaxOptions}
                  isLoadingOrderTaxes={isLoadingOrderTaxes}
                  orderPricesIncludeTax={orderPricesIncludeTax}
                  setOrderPricesIncludeTax={setOrderPricesIncludeTax}
                  orderTaxRatePercent={orderTaxRatePercent}
                  setOrderTaxRatePercent={setOrderTaxRatePercent}
                  orderCountryTaxRates={orderCountryTaxRates}
                  setOrderCountryTaxRates={setOrderCountryTaxRates}
                  orderAddShipping={orderAddShipping}
                  setOrderAddShipping={setOrderAddShipping}
                  orderShippingProductId={orderShippingProductId}
                  setOrderShippingProductId={setOrderShippingProductId}
                  orderShippingProductSku={orderShippingProductSku}
                  setOrderShippingProductSku={setOrderShippingProductSku}
                  orderAddCod={orderAddCod}
                  setOrderAddCod={setOrderAddCod}
                  orderCodProductId={orderCodProductId}
                  setOrderCodProductId={setOrderCodProductId}
                  orderCodProductSku={orderCodProductSku}
                  setOrderCodProductSku={setOrderCodProductSku}
                  orderCodAmount={orderCodAmount}
                  setOrderCodAmount={setOrderCodAmount}
                  orderAddDiscount={orderAddDiscount}
                  setOrderAddDiscount={setOrderAddDiscount}
                  orderDiscountProductId={orderDiscountProductId}
                  setOrderDiscountProductId={setOrderDiscountProductId}
                  orderDiscountProductSku={orderDiscountProductSku}
                  setOrderDiscountProductSku={setOrderDiscountProductSku}
                  orderDiscountMode={orderDiscountMode}
                  setOrderDiscountMode={setOrderDiscountMode}

                  orderUpdateCustomStatus={orderUpdateCustomStatus}
                  setOrderUpdateCustomStatus={setOrderUpdateCustomStatus}
                  statusFieldExists={statusFieldExists}
                  orderStatusCustomField={orderStatusCustomField}
                  setOrderStatusCustomField={setOrderStatusCustomField}
                  statusFieldOptions={statusFieldOptions}
                  handleCreateStatusField={handleCreateStatusField}
                  isCreatingStatusField={isCreatingStatusField}
                  hasOdooConnection={hasOdooConnection}
                  orderStateMapping={orderStateMapping}
                  setOrderStateMapping={setOrderStateMapping}
                  getOrderPlatformStatuses={getOrderPlatformStatuses}
                  isSavingOrders={isSavingOrders}
                  handleSaveOrders={handleSaveOrders}
                  setIsOrderLogOpen={setIsOrderLogOpen}
                />
              )
            ) : (
              <div className="border border-dashed border-border p-12 text-center space-y-3">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <SlidersHorizontal className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-foreground">
                    {lang === 'ar' ? 'لا يوجد متجر متصل لإعداد الربط' : 'No connected store to configure'}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                    {lang === 'ar'
                      ? 'لتفعيل إعدادات الربط لهذا المتجر، يرجى ربط المتجر أولاً من صفحة إعدادات الاتصال.'
                      : 'To configure mapping for this store, please connect it first from the store settings.'}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

            <SyncLogModal 
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        mappingId={undefined}
        mappingName={undefined}
        mappingsList={mappings.map(m => ({ id: m.id, name: m.name }))}
      />
      <SyncLogModal 
        isOpen={isCategoryLogOpen}
        onClose={() => setIsCategoryLogOpen(false)}
        mappingId={undefined}
        mappingName={lang === 'ar' ? 'الكاتيجوري' : 'Categories'}
        mappingsList={mappings.filter(m => m.odoo_model === 'product.category').map(m => ({ id: m.id, name: m.name }))}
        eventFilter="category"
      />
      <CategoryMappingDialog
        isOpen={isCategoryMappingOpen}
        onClose={() => setIsCategoryMappingOpen(false)}
        platform={standardStoreTab}
        storeKey={standardStoreId}
      />
      <ProductMappingDialog
        isOpen={isProductMappingOpen}
        onClose={() => setIsProductMappingOpen(false)}
        platform={standardStoreTab}
        storeKey={standardStoreId}
        defaultStoreField={productMatchZidField || 'sku'}
        defaultOdooField={productMatchOdooField || 'default_code'}
        odooFieldOptions={productOdooFields}
      />
      <SyncLogModal 
        isOpen={isProductLogOpen}
        onClose={() => setIsProductLogOpen(false)}
        mappingId={undefined}
        mappingName={lang === 'ar' ? 'المنتجات' : 'Products'}
        mappingsList={mappings.filter(m => m.odoo_model === 'product.template').map(m => ({ id: m.id, name: m.name }))}
        eventFilter="product"
      />
      <SyncLogModal 
        isOpen={isOrderLogOpen}
        onClose={() => setIsOrderLogOpen(false)}
        mappingId={undefined}
        mappingName={lang === 'ar' ? 'الطلبات' : 'Orders'}
        mappingsList={mappings.filter(m => m.odoo_model === 'sale.order').map(m => ({ id: m.id, name: m.name }))}
        eventFilter="order"
      />
    </>
  )
}
