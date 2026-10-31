'use client'

import {
  Activity,
  ArrowRightLeft,
  Boxes,
  Building2,
  Calculator,
  Coins,
  CreditCard,
  GitCompare,
  History,
  Info,
  Loader2,
  Package,
  PackageCheck,
  PackagePlus,
  PackageX,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  Save,
  Sliders,
  TableProperties,
  Trash2,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  Wand2,
} from 'lucide-react'
import React from 'react'

import { Button } from '@/components/ui/button'
import type { ZidStatusOption } from '@/lib/order-custom-status-constants'
import { cn } from '@/lib/utils'

import SearchableSelect from '../searchable-select'

import { SettingCard, SettingToggle } from './setting-card'

interface AnalyticRuleRow {
  rowKey: string
  condition: 'all' | 'warehouse' | 'payment'
  source_value: string
  source_label: string
  odoo_analytic_account_id: string
  percentage: string
}

export interface CountryTaxRateRule {
  rowKey: string
  country_code: string
  country_name?: string
  tax_rate: number | string
}

export interface VatCountryRuleRow {
  rowKey: string
  country_code: string
  tax_id: string
  country_name?: string
}

export const COMMON_VAT_COUNTRIES = [
  { code: 'SA', name_ar: 'المملكة العربية السعودية (SA)', name_en: 'Saudi Arabia (SA)' },
  { code: 'OTHER', name_ar: 'باقي الدول (الافتراضي الدولي / غير المحددة)', name_en: 'Other Countries (Rest of world / unselected)' },
  { code: 'AE', name_ar: 'الإمارات العربية المتحدة (AE)', name_en: 'United Arab Emirates (AE)' },
  { code: 'KW', name_ar: 'الكويت (KW)', name_en: 'Kuwait (KW)' },
  { code: 'BH', name_ar: 'البحرين (BH)', name_en: 'Bahrain (BH)' },
  { code: 'QA', name_ar: 'قطر (QA)', name_en: 'Qatar (QA)' },
  { code: 'OM', name_ar: 'سلطنة عمان (OM)', name_en: 'Oman (OM)' },
  { code: 'EG', name_ar: 'مصر (EG)', name_en: 'Egypt (EG)' },
  { code: 'JO', name_ar: 'الأردن (JO)', name_en: 'Jordan (JO)' },
  { code: 'US', name_ar: 'الولايات المتحدة (US)', name_en: 'United States (US)' },
  { code: 'GB', name_ar: 'المملكة المتحدة (GB)', name_en: 'United Kingdom (GB)' },
  { code: 'CUSTOM', name_ar: 'دولة أخرى (رمز مخصص)...', name_en: 'Other Country (Custom code)...' },
]

export const COMMON_TAX_COUNTRIES = [
  { code: 'SA', name_ar: 'المملكة العربية السعودية (15%)', name_en: 'Saudi Arabia (15%)', default_rate: '15' },
  { code: 'EG', name_ar: 'مصر (14%)', name_en: 'Egypt (14%)', default_rate: '14' },
  { code: 'AE', name_ar: 'الإمارات العربية المتحدة (5%)', name_en: 'United Arab Emirates (5%)', default_rate: '5' },
  { code: 'BH', name_ar: 'البحرين (10%)', name_en: 'Bahrain (10%)', default_rate: '10' },
  { code: 'OM', name_ar: 'سلطنة عمان (5%)', name_en: 'Oman (5%)', default_rate: '5' },
  { code: 'KW', name_ar: 'الكويت (0%)', name_en: 'Kuwait (0%)', default_rate: '0' },
  { code: 'QA', name_ar: 'قطر (0%)', name_en: 'Qatar (0%)', default_rate: '0' },
  { code: 'JO', name_ar: 'الأردن (16%)', name_en: 'Jordan (16%)', default_rate: '16' },
  { code: 'US', name_ar: 'الولايات المتحدة (0%)', name_en: 'United States (0%)', default_rate: '0' },
  { code: 'GB', name_ar: 'المملكة المتحدة (20%)', name_en: 'United Kingdom (20%)', default_rate: '20' },
  { code: 'CUSTOM', name_ar: 'دولة أخرى (رمز مخصص)', name_en: 'Other Country (Custom code)', default_rate: '0' },
]

interface OrderSettingsTabProps {
  lang: string
  dir: string
  standardStoreTab: string
  statusStoreNameAr: string
  statusStoreNameEn: string
  statusFieldDefaultName: string
  // Sync toggle & allowed operations
  orderDisabled: boolean
  setOrderDisabled: (val: boolean) => void
  orderEnabledActions: string[]
  setOrderEnabledActions: (val: string[]) => void
  // Match fields
  orderMatchZidField: string
  setOrderMatchZidField: (val: string) => void
  orderMatchOdooField: string
  setOrderMatchOdooField: (val: string) => void
  orderFields: { value: string; label: string }[]
  odooOrderFields: { value: string; label: string }[]
  isLoadingOrderFields: boolean
  fetchOdooOrderFields: (force?: boolean) => void
  // Customer fallback policy
  orderCustomerFallbackPolicy: 'create_new' | 'skip_order' | 'default_customer'
  setOrderCustomerFallbackPolicy: (val: 'create_new' | 'skip_order' | 'default_customer') => void
  orderDefaultCustomerId: string
  setOrderDefaultCustomerId: (val: string) => void
  customerOptions: { value: string; label: string }[]
  isLoadingCustomers: boolean
  handleRefreshCustomers: (force?: boolean) => void
  // Product fallback policy
  orderProductFallbackPolicy: 'create_new' | 'skip_order' | 'default_product'
  setOrderProductFallbackPolicy: (val: 'create_new' | 'skip_order' | 'default_product') => void
  orderDefaultProductId: string
  setOrderDefaultProductId: (val: string) => void
  productOptions: { value: string; label: string }[]
  isLoadingProducts: boolean
  handleRefreshProducts: (force?: boolean) => void
  // Order defaults
  orderWarehouseId: string
  setOrderWarehouseId: (val: string) => void
  warehouseOptions: { value: string; label: string }[]
  isLoadingWarehouses: boolean
  orderPricelistId: string
  setOrderPricelistId: (val: string) => void
  pricelistOptions: { value: string; label: string }[]
  isLoadingPricelists: boolean
  orderPaymentTermId: string
  setOrderPaymentTermId: (val: string) => void
  paymentTermOptions: { value: string; label: string }[]
  isLoadingPaymentTerms: boolean
  // Multi-currency
  orderMultiCurrencyEnabled: boolean
  setOrderMultiCurrencyEnabled: (val: boolean) => void
  orderBaseCurrencyId: string
  setOrderBaseCurrencyId: (val: string) => void
  currencyOptions: { value: string; label: string }[]
  isLoadingCurrencies?: boolean
  handleRefreshCurrencies?: () => void
  // Credit-note journal (fetched from Odoo)
  journalOptions: { value: string; label: string }[]
  isLoadingJournals: boolean
  handleRefreshJournals: () => void
  // Payment methods & journals mapping
  orderPaymentAutoSync: boolean
  setOrderPaymentAutoSync: (val: boolean) => void
  orderPaymentJournalMappings: Array<{ rowKey: string; zid_payment_method: string; odoo_journal_id: string }>
  handlePaymentJournalMappingChange: (
    rowKey: string,
    field: 'zid_payment_method' | 'odoo_journal_id',
    value: string
  ) => void
  handleRemovePaymentJournalMapping: (rowKey: string) => void
  handleAddPaymentJournalMapping: () => void
  handleRefreshPaymentOptions: () => void
  isLoadingPaymentMethods: boolean
  orderCompanyId: string
  setOrderCompanyId: (val: string) => void
  orderLinkCompany: boolean
  setOrderLinkCompany: (val: boolean) => void
  companyOptions: { value: string; label: string }[]
  isLoadingCompanies: boolean
  // Store returns
  orderReturnsMode: 'nothing' | 'negative_so' | 'stock_return_credit_note'
  setOrderReturnsMode: (val: 'nothing' | 'negative_so' | 'stock_return_credit_note') => void
  orderReturnsCreditNote: boolean
  setOrderReturnsCreditNote: (val: boolean) => void
  orderReturnsJournalId: string
  setOrderReturnsJournalId: (val: string) => void
  orderReturnsFallback: 'skip' | 'negative_so'
  setOrderReturnsFallback: (val: 'skip' | 'negative_so') => void
  orderReturnsReasonType: 'store_reason' | 'custom'
  setOrderReturnsReasonType: (val: 'store_reason' | 'custom') => void
  orderReturnsReason: string
  setOrderReturnsReason: (val: string) => void
  // Multi-warehouse rules
  storeWarehouseRules: Array<{ rowKey: string; zid_location_id: string; odoo_warehouse_id: string }>
  handleWarehouseRuleChange: (
    rowKey: string,
    field: 'zid_location_id' | 'odoo_warehouse_id',
    value: string
  ) => void
  handleRemoveWarehouseRule: (rowKey: string) => void
  handleAddWarehouseRule: () => void
  handleRefreshOrderWarehouses: () => void
  isRefreshingOrderWarehouses: boolean
  sallaOrderLocationOptions: { value: string; label: string }[]
  zidLocationOptions: { value: string; label: string }[]
  // Analytic distribution
  orderAnalyticEnabled: boolean
  setOrderAnalyticEnabled: (val: boolean) => void
  orderAnalyticRules: AnalyticRuleRow[]
  handleAnalyticRuleChange: (rowKey: string, patch: Partial<AnalyticRuleRow>) => void
  handleRemoveAnalyticRule: (rowKey: string) => void
  handleAddAnalyticRule: () => void
  handleRefreshAnalyticOptions: () => void
  isLoadingAnalyticOptions: boolean
  analyticAccountOptions: { value: string; label: string }[]
  paymentMethodOptions: { value: string; label: string }[]
  analyticOptionsError: string
  // VAT
  orderEnableVat: boolean
  setOrderEnableVat: (val: boolean) => void
  orderVatSaudiTaxId: string
  setOrderVatSaudiTaxId: (val: string) => void
  orderVatNonSaudiTaxId: string
  setOrderVatNonSaudiTaxId: (val: string) => void
  orderTaxOptions: { value: string; label: string }[]
  isLoadingOrderTaxes: boolean
  orderVatCountryRules?: VatCountryRuleRow[]
  setOrderVatCountryRules?: React.Dispatch<React.SetStateAction<VatCountryRuleRow[]>>
  handleAddVatCountryRule?: () => void
  handleRemoveVatCountryRule?: (rowKey: string) => void
  handleVatCountryRuleChange?: (rowKey: string, field: 'country_code' | 'tax_id', value: string) => void
  // Prices include tax
  orderPricesIncludeTax: boolean
  setOrderPricesIncludeTax: (val: boolean) => void
  orderTaxRatePercent: string
  setOrderTaxRatePercent: (val: string) => void
  orderCountryTaxRates?: CountryTaxRateRule[]
  setOrderCountryTaxRates?: React.Dispatch<React.SetStateAction<CountryTaxRateRule[]>>
  // Shipping & Discount & COD lines
  orderAddShipping: boolean
  setOrderAddShipping: (val: boolean) => void
  orderShippingProductId: string
  setOrderShippingProductId: (val: string) => void
  orderShippingProductSku: string
  setOrderShippingProductSku: (val: string) => void
  orderAddCod: boolean
  setOrderAddCod: (val: boolean) => void
  orderCodProductId: string
  setOrderCodProductId: (val: string) => void
  orderCodProductSku: string
  setOrderCodProductSku: (val: string) => void
  orderCodAmount: string
  setOrderCodAmount: (val: string) => void
  orderAddDiscount: boolean
  setOrderAddDiscount: (val: boolean) => void
  orderDiscountProductId: string
  setOrderDiscountProductId: (val: string) => void
  orderDiscountProductSku: string
  setOrderDiscountProductSku: (val: string) => void
  orderDiscountMode: string
  setOrderDiscountMode: (val: string) => void

  // Status custom field in Odoo
  orderUpdateCustomStatus: boolean
  setOrderUpdateCustomStatus: (val: boolean) => void
  statusFieldExists: boolean
  orderStatusCustomField: string
  setOrderStatusCustomField: (val: string) => void
  statusFieldOptions: ZidStatusOption[]
  handleCreateStatusField: () => void
  isCreatingStatusField: boolean
  hasOdooConnection: boolean
  // Status mapping
  orderStateMapping: Record<
    string,
    { state: string; enabled: boolean; invoice_action?: string; picking_action?: string }
  >
  setOrderStateMapping: React.Dispatch<
    React.SetStateAction<
      Record<string, { state: string; enabled: boolean; invoice_action?: string; picking_action?: string }>
    >
  >
  getOrderPlatformStatuses: () => { key: string; labelAr: string; labelEn: string }[]
  // Save & Modals
  isSavingOrders: boolean
  handleSaveOrders: () => void
  setIsOrderLogOpen: (val: boolean) => void
}

export function OrderSettingsTab({
  lang,
  dir,
  standardStoreTab,
  statusStoreNameAr,
  statusStoreNameEn,
  statusFieldDefaultName,
  orderDisabled,
  setOrderDisabled,
  orderEnabledActions,
  setOrderEnabledActions,
  orderMatchZidField,
  setOrderMatchZidField,
  orderMatchOdooField,
  setOrderMatchOdooField,
  orderFields,
  odooOrderFields,
  isLoadingOrderFields,
  fetchOdooOrderFields,
  orderCustomerFallbackPolicy,
  setOrderCustomerFallbackPolicy,
  orderDefaultCustomerId,
  setOrderDefaultCustomerId,
  customerOptions,
  isLoadingCustomers,
  handleRefreshCustomers,
  orderProductFallbackPolicy,
  setOrderProductFallbackPolicy,
  orderDefaultProductId,
  setOrderDefaultProductId,
  productOptions,
  isLoadingProducts,
  handleRefreshProducts,
  orderWarehouseId,
  setOrderWarehouseId,
  warehouseOptions,
  isLoadingWarehouses,
  orderPricelistId,
  setOrderPricelistId,
  pricelistOptions,
  isLoadingPricelists,
  orderPaymentTermId,
  setOrderPaymentTermId,
  paymentTermOptions,
  isLoadingPaymentTerms,
  orderMultiCurrencyEnabled,
  setOrderMultiCurrencyEnabled,
  orderBaseCurrencyId,
  setOrderBaseCurrencyId,
  currencyOptions,
  isLoadingCurrencies = false,
  handleRefreshCurrencies,
  journalOptions,
  isLoadingJournals,
  handleRefreshJournals,
  orderPaymentAutoSync,
  setOrderPaymentAutoSync,
  orderPaymentJournalMappings,
  handlePaymentJournalMappingChange,
  handleRemovePaymentJournalMapping,
  handleAddPaymentJournalMapping,
  handleRefreshPaymentOptions,
  isLoadingPaymentMethods,
  orderCompanyId,
  setOrderCompanyId,
  orderLinkCompany,
  setOrderLinkCompany,
  companyOptions,
  isLoadingCompanies,
  orderReturnsMode,
  setOrderReturnsMode,
  orderReturnsCreditNote,
  setOrderReturnsCreditNote,
  orderReturnsJournalId,
  setOrderReturnsJournalId,
  orderReturnsFallback,
  setOrderReturnsFallback,
  orderReturnsReasonType,
  setOrderReturnsReasonType,
  orderReturnsReason,
  setOrderReturnsReason,
  storeWarehouseRules,
  handleWarehouseRuleChange,
  handleRemoveWarehouseRule,
  handleAddWarehouseRule,
  handleRefreshOrderWarehouses,
  isRefreshingOrderWarehouses,
  sallaOrderLocationOptions,
  zidLocationOptions,
  orderAnalyticEnabled,
  setOrderAnalyticEnabled,
  orderAnalyticRules,
  handleAnalyticRuleChange,
  handleRemoveAnalyticRule,
  handleAddAnalyticRule,
  handleRefreshAnalyticOptions,
  isLoadingAnalyticOptions,
  analyticAccountOptions,
  paymentMethodOptions,
  analyticOptionsError,
  orderEnableVat,
  setOrderEnableVat,
  orderVatSaudiTaxId,
  setOrderVatSaudiTaxId,
  orderVatNonSaudiTaxId,
  setOrderVatNonSaudiTaxId,
  orderTaxOptions,
  isLoadingOrderTaxes,
  orderVatCountryRules,
  setOrderVatCountryRules,
  handleAddVatCountryRule,
  handleRemoveVatCountryRule,
  handleVatCountryRuleChange,
  orderPricesIncludeTax,
  setOrderPricesIncludeTax,
  orderTaxRatePercent,
  setOrderTaxRatePercent,
  orderCountryTaxRates,
  setOrderCountryTaxRates,
  orderAddShipping: _orderAddShipping,
  setOrderAddShipping,
  orderShippingProductId,
  setOrderShippingProductId,
  orderShippingProductSku: _orderShippingProductSku,
  setOrderShippingProductSku: _setOrderShippingProductSku,
  orderAddCod,
  setOrderAddCod,
  orderCodProductId,
  setOrderCodProductId,
  orderCodProductSku: _orderCodProductSku,
  setOrderCodProductSku: _setOrderCodProductSku,
  orderCodAmount,
  setOrderCodAmount,
  orderAddDiscount,
  setOrderAddDiscount,
  orderDiscountProductId,
  setOrderDiscountProductId,
  orderDiscountProductSku: _orderDiscountProductSku,
  setOrderDiscountProductSku: _setOrderDiscountProductSku,
  orderDiscountMode,
  setOrderDiscountMode,

  orderUpdateCustomStatus,
  setOrderUpdateCustomStatus,
  statusFieldExists,
  orderStatusCustomField,
  setOrderStatusCustomField,
  statusFieldOptions,
  handleCreateStatusField,
  isCreatingStatusField,
  hasOdooConnection,
  orderStateMapping,
  setOrderStateMapping,
  getOrderPlatformStatuses,
  isSavingOrders,
  handleSaveOrders,
  setIsOrderLogOpen,
}: OrderSettingsTabProps) {
  const syncActionOptions = [
    { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
    { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
    { value: 'cancel', label: lang === 'ar' ? 'إلغاء (Cancel)' : 'Cancel' },
    { value: 'deliver', label: lang === 'ar' ? 'توصيل (Deliver)' : 'Deliver' },
  ]

  const defaultZidPaymentMethods = React.useMemo(
    () => [
      { value: 'zid_cod', label: lang === 'ar' ? 'الدفع عند الاستلام (COD)' : 'Cash on Delivery (COD)' },
      { value: 'credit_card', label: lang === 'ar' ? 'بطاقة ائتمانية (Credit Card)' : 'Credit Card' },
      { value: 'mada', label: lang === 'ar' ? 'مدى (Mada)' : 'Mada' },
      { value: 'apple_pay', label: lang === 'ar' ? 'أبل باي (Apple Pay)' : 'Apple Pay' },
      { value: 'bank_transfer', label: lang === 'ar' ? 'تحويل بنكي (Bank Transfer)' : 'Bank Transfer' },
      { value: 'tamara', label: lang === 'ar' ? 'تمارا (Tamara)' : 'Tamara' },
      { value: 'tabby', label: lang === 'ar' ? 'تابي (Tabby)' : 'Tabby' },
      { value: 'stc_pay', label: lang === 'ar' ? 'STC Pay' : 'STC Pay' },
      { value: 'pos', label: lang === 'ar' ? 'نقاط البيع (POS)' : 'Point of Sale (POS)' },
    ],
    [lang]
  )

  const availablePaymentMethodOptions = React.useMemo(() => {
    const list = [...paymentMethodOptions]
    const seen = new Set(list.map(p => p.value.toLowerCase()))
    for (const def of defaultZidPaymentMethods) {
      if (!seen.has(def.value.toLowerCase())) {
        list.push(def)
      }
    }
    return list
  }, [paymentMethodOptions, defaultZidPaymentMethods])

  const odooStates = [
    { value: 'draft', label: lang === 'ar' ? 'مسودة (Quotation)' : 'Quotation (Draft)' },
    { value: 'sent', label: lang === 'ar' ? 'تم إرسال العرض (Sent)' : 'Quotation Sent (Sent)' },
    { value: 'sale', label: lang === 'ar' ? 'طلب مبيعات مؤكد (Sales Order)' : 'Sales Order (Sale)' },
    { value: 'done', label: lang === 'ar' ? 'مغلق (Locked)' : 'Locked (Done)' },
    { value: 'cancel', label: lang === 'ar' ? 'ملغي (Cancelled)' : 'Cancelled (Cancel)' },
  ]

  const pickingActionOptions = [
    { value: '', label: lang === 'ar' ? '— بدون إجراء —' : '— No Action —' },
    { value: 'create', label: lang === 'ar' ? 'إنشاء إذن الصرف فقط' : 'Create Picking Only' },
    { value: 'validate', label: lang === 'ar' ? 'تصديق إذن الصرف فقط' : 'Validate Picking Only' },
    { value: 'create_and_validate', label: lang === 'ar' ? 'إنشاء وتصديق إذن الصرف' : 'Create & Validate Picking' },
    { value: 'cancel', label: lang === 'ar' ? 'إلغاء إذن الصرف' : 'Cancel Picking' },
  ]

  const invoiceActionOptions = [
    { value: '', label: lang === 'ar' ? '— بدون إجراء —' : '— No Action —' },
    { value: 'create', label: lang === 'ar' ? 'إنشاء مسودة الفاتورة فقط' : 'Create Draft Invoice Only' },
    { value: 'post', label: lang === 'ar' ? 'تأكيد/ترحيل الفاتورة فقط' : 'Post Invoice Only' },
    { value: 'create_and_post', label: lang === 'ar' ? 'إنشاء وتأكيد الفاتورة' : 'Create & Post Invoice' },
    { value: 'cancel', label: lang === 'ar' ? 'إلغاء الفاتورة' : 'Cancel Invoice' },
  ]

  const countryRules = orderCountryTaxRates || []

  const handleAddCountryRule = () => {
    if (!setOrderCountryTaxRates) return
    const existingCodes = new Set(countryRules.map(r => r.country_code.toUpperCase()))
    const nextPick = COMMON_TAX_COUNTRIES.find(c => c.code !== 'CUSTOM' && !existingCodes.has(c.code))
      || { code: 'EG', name_ar: 'مصر', name_en: 'Egypt', default_rate: '14' }

    const updated = [
      ...countryRules,
      {
        rowKey: "rule-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        country_code: nextPick.code,
        country_name: lang === 'ar' ? nextPick.name_ar : nextPick.name_en,
        tax_rate: nextPick.default_rate,
      }
    ]
    setOrderCountryTaxRates(updated)
  }

  const handleRemoveCountryRule = (rowKey: string) => {
    if (!setOrderCountryTaxRates) return
    const updated = countryRules.filter(r => r.rowKey !== rowKey)
    setOrderCountryTaxRates(updated)
  }

  const handleCountryRuleChange = (rowKey: string, field: 'country_code' | 'tax_rate' | 'country_name', value: string) => {
    if (!setOrderCountryTaxRates) return
    const updated = countryRules.map(rule => {
      if (rule.rowKey !== rowKey) return rule
      if (field === 'country_code') {
        const found = COMMON_TAX_COUNTRIES.find(c => c.code === value)
        return {
          ...rule,
          country_code: value,
          country_name: found ? (lang === 'ar' ? found.name_ar : found.name_en) : rule.country_name,
          tax_rate: (rule.tax_rate === '' || rule.tax_rate === '0' || rule.tax_rate === '15') && found ? found.default_rate : rule.tax_rate,
        }
      }
      return { ...rule, [field]: value }
    })
    setOrderCountryTaxRates(updated)

    const saRule = updated.find(r => r.country_code.toUpperCase() === 'SA') || updated[0]
    if (saRule && saRule.tax_rate !== undefined && saRule.tax_rate !== '') {
      setOrderTaxRatePercent(String(saRule.tax_rate))
    }
  }

  const vatRules = orderVatCountryRules || []

  const onAddVatCountryRule = () => {
    if (handleAddVatCountryRule) {
      handleAddVatCountryRule()
      return
    }
    if (!setOrderVatCountryRules) return
    const existingCodes = new Set(vatRules.map(r => r.country_code.toUpperCase()))
    const nextPick = COMMON_VAT_COUNTRIES.find(c => c.code !== 'CUSTOM' && !existingCodes.has(c.code))
      || { code: 'AE', name_ar: 'الإمارات العربية المتحدة (AE)', name_en: 'United Arab Emirates (AE)' }
    const updated = [
      ...vatRules,
      {
        rowKey: "vat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        country_code: nextPick.code,
        country_name: lang === 'ar' ? nextPick.name_ar : nextPick.name_en,
        tax_id: '',
      }
    ]
    setOrderVatCountryRules(updated)
  }

  const onRemoveVatCountryRule = (rowKey: string) => {
    if (handleRemoveVatCountryRule) {
      handleRemoveVatCountryRule(rowKey)
      return
    }
    if (!setOrderVatCountryRules) return
    const updated = vatRules.filter(r => r.rowKey !== rowKey)
    setOrderVatCountryRules(updated)
    const saRule = updated.find(r => r.country_code.toUpperCase() === 'SA')
    setOrderVatSaudiTaxId(saRule?.tax_id || '')
    const otherRule = updated.find(r => r.country_code.toUpperCase() === 'OTHER')
    setOrderVatNonSaudiTaxId(otherRule?.tax_id || '')
  }

  const onVatCountryRuleChange = (rowKey: string, field: 'country_code' | 'tax_id', value: string) => {
    if (handleVatCountryRuleChange) {
      handleVatCountryRuleChange(rowKey, field, value)
      return
    }
    if (!setOrderVatCountryRules) return
    const updated = vatRules.map(rule => {
      if (rule.rowKey !== rowKey) return rule
      if (field === 'country_code') {
        const found = COMMON_VAT_COUNTRIES.find(c => c.code === value)
        return {
          ...rule,
          country_code: value,
          country_name: found ? (lang === 'ar' ? found.name_ar : found.name_en) : rule.country_name,
        }
      }
      return { ...rule, [field]: value }
    })
    setOrderVatCountryRules(updated)
    const saRule = updated.find(r => r.country_code.toUpperCase() === 'SA')
    if (saRule) setOrderVatSaudiTaxId(saRule.tax_id || '')
    const otherRule = updated.find(r => r.country_code.toUpperCase() === 'OTHER')
    if (otherRule) setOrderVatNonSaudiTaxId(otherRule.tax_id || '')
  }

  return (
    <div className="space-y-4">
      {/* 1. Order Sync & Actions */}
      <SettingCard
        icon={<Sliders className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'إعدادات وعمليات مزامنة الطلبات' : 'Order Sync & Operations'}
        description={
          lang === 'ar'
            ? 'تفعيل مزامنة الطلبات الواردة من المتجر وتحديد العمليات المسموح بتنفيذها'
            : 'Enable order synchronization and select permitted operations in Odoo'
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={!orderDisabled}
            onChange={(active) => setOrderDisabled(!active)}
            label={lang === 'ar' ? 'تفعيل مزامنة الطلبات' : 'Enable Order Sync'}
            description={
              lang === 'ar'
                ? 'استقبال الطلبات الجديدة وتحديثاتها تلقائياً في أودو'
                : 'Receive incoming orders and updates automatically in Odoo'
            }
          />

          {!orderDisabled && (
            <div className="space-y-1.5 pt-1">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'العمليات المسموح بها' : 'Allowed Operations'}
              </label>
              <SearchableSelect
                multiple={true}
                collapseTags={false}
                value={orderEnabledActions}
                onChange={setOrderEnabledActions}
                options={syncActionOptions}
                placeholder={lang === 'ar' ? '— اختر العمليات المصرح بها —' : '— Select operations —'}
              />
            </div>
          )}
        </div>
      </SettingCard>

      {/* 2. Match Field */}
      <SettingCard
        icon={<GitCompare className="h-4 w-4 text-indigo-600" />}
        title={lang === 'ar' ? 'حقل المطابقة وتجنب تكرار الطلب' : 'Order Matching Field'}
        description={
          lang === 'ar'
            ? 'حدد الحقل في المتجر المقابل لحقل أودو للتعرف على الطلب ومنع التكرار'
            : 'Select store and Odoo fields used to identify existing sales orders'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'حقل المتجر' : 'Store Field'}
            </label>
            <SearchableSelect
              options={orderFields}
              value={orderMatchZidField}
              onChange={setOrderMatchZidField}
              placeholder={lang === 'ar' ? '— اختر حقل المتجر —' : '— Select store field —'}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'حقل أودو المقابل' : 'Odoo Field'}
              </label>
              <button
                type="button"
                onClick={() => fetchOdooOrderFields(true)}
                disabled={isLoadingOrderFields}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 text-[11px] flex items-center gap-1"
                title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
              >
                <RefreshCw className={cn('h-3 w-3', isLoadingOrderFields && 'animate-spin')} />
                <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
              </button>
            </div>
            <SearchableSelect
              options={odooOrderFields}
              value={orderMatchOdooField}
              onChange={setOrderMatchOdooField}
              placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
              disabled={isLoadingOrderFields}
            />
          </div>
        </div>
      </SettingCard>

      {/* 3. Customer Fallback Policy */}
      <SettingCard
        icon={<Users className="h-4 w-4 text-sky-600" />}
        title={lang === 'ar' ? 'سلوك مطابقة العميل في الطلب' : 'Customer Matching Policy'}
        description={
          lang === 'ar'
            ? 'الإجراء المتخذ عند وصول طلب ولم يتم العثور على العميل مسبقاً في أودو'
            : 'Fallback strategy when an order customer is not matched in Odoo'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-none border cursor-pointer transition-all duration-200',
              orderCustomerFallbackPolicy === 'create_new'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="orderCustomerFallbackPolicy"
              value="create_new"
              checked={orderCustomerFallbackPolicy === 'create_new'}
              onChange={() => setOrderCustomerFallbackPolicy('create_new')}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <UserPlus className="h-3.5 w-3.5 text-emerald-600" />
                <span>{lang === 'ar' ? 'إنشاء عميل جديد' : 'Create Customer'}</span>
              </div>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'إنشاء سجل عميل جديد تلقائياً في أودو ببيانات العميل المرسلة مع الطلب.'
                  : 'Automatically create a new partner in Odoo from order data.'}
              </span>
            </div>
          </label>

          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-none border cursor-pointer transition-all duration-200',
              orderCustomerFallbackPolicy === 'skip_order'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="orderCustomerFallbackPolicy"
              value="skip_order"
              checked={orderCustomerFallbackPolicy === 'skip_order'}
              onChange={() => setOrderCustomerFallbackPolicy('skip_order')}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <UserX className="h-3.5 w-3.5 text-amber-600" />
                <span>{lang === 'ar' ? 'إلغاء وتسجيل تخطي' : 'Cancel/Skip Order'}</span>
              </div>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'تخطي تسجيل الطلب في أودو إذا لم يكن العميل مسجلاً مسبقاً.'
                  : 'Skip order sync if customer does not already exist.'}
              </span>
            </div>
          </label>

          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-none border cursor-pointer transition-all duration-200',
              orderCustomerFallbackPolicy === 'default_customer'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="orderCustomerFallbackPolicy"
              value="default_customer"
              checked={orderCustomerFallbackPolicy === 'default_customer'}
              onChange={() => {
                setOrderCustomerFallbackPolicy('default_customer')
                if (customerOptions.length === 0 && !isLoadingCustomers) {
                  handleRefreshCustomers(false)
                }
              }}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <UserCheck className="h-3.5 w-3.5 text-primary" />
                <span>{lang === 'ar' ? 'تعيين عميل افتراضي' : 'Default Customer'}</span>
              </div>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'ربط الطلب بعميل عام أو افتراضي ثابت في أودو.'
                  : 'Assign the order to a fixed default customer record in Odoo.'}
              </span>
            </div>
          </label>
        </div>

        {orderCustomerFallbackPolicy === 'default_customer' && (
          <div className="pt-2 max-w-md space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'العميل الافتراضي في أودو' : 'Default Customer in Odoo'}
                <span className="text-red-500 mx-1">*</span>
              </label>
              <button
                type="button"
                onClick={() => handleRefreshCustomers(true)}
                disabled={isLoadingCustomers}
                className="text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 transition-colors"
              >
                <RefreshCw className={cn('h-3 w-3', isLoadingCustomers && 'animate-spin')} />
                <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
              </button>
            </div>
            <SearchableSelect
              options={customerOptions}
              value={orderDefaultCustomerId}
              onChange={setOrderDefaultCustomerId}
              placeholder={lang === 'ar' ? '— اختر العميل الافتراضي —' : '— Select default customer —'}
              disabled={isLoadingCustomers}
            />
          </div>
        )}
      </SettingCard>

      {/* 4. Product Fallback Policy */}
      <SettingCard
        icon={<Package className="h-4 w-4 text-indigo-600" />}
        title={lang === 'ar' ? 'سلوك مطابقة المنتجات في الطلب' : 'Product Matching Policy'}
        description={
          lang === 'ar'
            ? 'الإجراء المتخذ عند احتواء الطلب على بند غير مطابق في أودو (عدم تطابق الـ SKU أو الباركود)'
            : 'Fallback strategy when an order line item is not matched in Odoo'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-none border cursor-pointer transition-all duration-200',
              orderProductFallbackPolicy === 'create_new'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="orderProductFallbackPolicy"
              value="create_new"
              checked={orderProductFallbackPolicy === 'create_new'}
              onChange={() => setOrderProductFallbackPolicy('create_new')}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <PackagePlus className="h-3.5 w-3.5 text-emerald-600" />
                <span>{lang === 'ar' ? 'إنشاء منتج جديد' : 'Create Product'}</span>
              </div>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'إنشاء منتج جديد تلقائياً في أودو بالاسم والـ SKU والسعر الوارد في الطلب.'
                  : 'Automatically create a new product in Odoo with item name, SKU, and price.'}
              </span>
            </div>
          </label>

          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-none border cursor-pointer transition-all duration-200',
              orderProductFallbackPolicy === 'skip_order'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="orderProductFallbackPolicy"
              value="skip_order"
              checked={orderProductFallbackPolicy === 'skip_order'}
              onChange={() => setOrderProductFallbackPolicy('skip_order')}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <PackageX className="h-3.5 w-3.5 text-amber-600" />
                <span>{lang === 'ar' ? 'إلغاء وتسجيل تخطي' : 'Cancel/Skip Order'}</span>
              </div>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'تخطي تسجيل الطلب في أودو إذا احتوى على منتج غير مطابق.'
                  : 'Skip order sync if any product in the order is unmapped.'}
              </span>
            </div>
          </label>

          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-none border cursor-pointer transition-all duration-200',
              orderProductFallbackPolicy === 'default_product'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="orderProductFallbackPolicy"
              value="default_product"
              checked={orderProductFallbackPolicy === 'default_product'}
              onChange={() => {
                setOrderProductFallbackPolicy('default_product')
                if (productOptions.length === 0 && !isLoadingProducts) {
                  handleRefreshProducts(false)
                }
              }}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                <PackageCheck className="h-3.5 w-3.5 text-primary" />
                <span>{lang === 'ar' ? 'تعيين منتج افتراضي' : 'Default Product'}</span>
              </div>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'استخدام منتج عام محدد مسبقاً في البنود مع الاحتفاظ بالاسم الأصلي في الوصف.'
                  : 'Assign unmapped order lines to a designated default product in Odoo.'}
              </span>
            </div>
          </label>
        </div>

        {orderProductFallbackPolicy === 'default_product' && (
          <div className="pt-2 max-w-md space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'المنتج الافتراضي في أودو' : 'Default Product in Odoo'}
                <span className="text-red-500 mx-1">*</span>
              </label>
              <button
                type="button"
                onClick={() => handleRefreshProducts(true)}
                disabled={isLoadingProducts}
                className="text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 transition-colors"
              >
                <RefreshCw className={cn('h-3 w-3', isLoadingProducts && 'animate-spin')} />
                <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
              </button>
            </div>
            <SearchableSelect
              options={productOptions}
              value={orderDefaultProductId}
              onChange={setOrderDefaultProductId}
              placeholder={lang === 'ar' ? '— اختر المنتج الافتراضي —' : '— Select default product —'}
              disabled={isLoadingProducts}
            />
          </div>
        )}
      </SettingCard>

      {/* 5. Default Values & Automation */}
      <SettingCard
        icon={<Building2 className="h-4 w-4 text-primary" />}
        title={lang === 'ar' ? 'القيم الافتراضية والأتمتة' : 'Default Values & Automation'}
        description={
          lang === 'ar'
            ? 'تحديد المستودع، قائمة الأسعار، شروط الدفع، والشركة الافتراضية، وإجراءات التأكيد والفوترة'
            : 'Configure default warehouse, pricelist, payment terms, company, and auto-confirm/invoice settings'
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'المستودع الافتراضي' : 'Default Warehouse'}
            </label>
            <SearchableSelect
              options={warehouseOptions}
              value={orderWarehouseId}
              onChange={setOrderWarehouseId}
              placeholder={lang === 'ar' ? '— اختر المستودع —' : '— Select Warehouse —'}
              disabled={isLoadingWarehouses}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'قائمة الأسعار الافتراضية' : 'Default Pricelist'}
            </label>
            <SearchableSelect
              options={pricelistOptions}
              value={orderPricelistId}
              onChange={setOrderPricelistId}
              placeholder={lang === 'ar' ? '— اختر قائمة الأسعار —' : '— Select Pricelist —'}
              disabled={isLoadingPricelists}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'شروط الدفع الافتراضية' : 'Default Payment Terms'}
            </label>
            <SearchableSelect
              options={paymentTermOptions}
              value={orderPaymentTermId}
              onChange={setOrderPaymentTermId}
              placeholder={lang === 'ar' ? '— اختر شروط الدفع —' : '— Select Payment Terms —'}
              disabled={isLoadingPaymentTerms}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'}
            </label>
            <SearchableSelect
              options={companyOptions}
              value={orderCompanyId}
              onChange={setOrderCompanyId}
              placeholder={lang === 'ar' ? '— اختر الشركة (اختياري) —' : '— Select Company (Optional) —'}
              disabled={isLoadingCompanies}
            />
          </div>

          {orderCompanyId && (
            <div className="sm:col-span-2 pt-1">
              <SettingToggle
                checked={orderLinkCompany}
                onChange={setOrderLinkCompany}
                label={lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                description={
                  lang === 'ar'
                    ? 'يضمن قصر طلب المبيعات على الشركة المختارة داخل أودو'
                    : 'Restricts the sales order to the selected company in Odoo'
                }
              />
            </div>
          )}
        </div>
      </SettingCard>

      {/* Multi-Currency & Base Currency Settings */}
      <SettingCard
        icon={<Coins className="h-4 w-4 text-amber-500" />}
        title={lang === 'ar' ? 'العملات والعملات المتعددة (Multi-Currency)' : 'Currencies & Multi-Currency'}
        description={
          lang === 'ar'
            ? 'التحكم في تسجيل الطلبات وفق العملة المرسلة من المتجر وتحديد العملة الأساسية البديلة'
            : 'Configure multi-currency order handling and the fallback base currency'
        }
        headerAction={
          handleRefreshCurrencies && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefreshCurrencies}
              disabled={isLoadingCurrencies}
              className="h-8 text-xs gap-1.5"
              title={lang === 'ar' ? 'تحديث قائمة العملات من أودو' : 'Refresh currencies from Odoo'}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoadingCurrencies && 'animate-spin')} />
              <span>{lang === 'ar' ? 'تحديث العملات' : 'Refresh'}</span>
            </Button>
          )
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={orderMultiCurrencyEnabled}
            onChange={setOrderMultiCurrencyEnabled}
            label={lang === 'ar' ? 'تفعيل العملات المتعددة (Multi-Currency)' : 'Enable Multi-Currency'}
            description={
              lang === 'ar'
                ? 'تسجيل الطلب في أودو بنفس العملة المرسلة من زد (مثل: درهم إماراتي AED، دولار USD، دينار كويتي KWD). إذا كانت العملة مفعّلة في أودو، يتم تسجيل الطلب والفواتير والمرتجعات بها مباشرة.'
                : 'Record orders in Odoo with the currency sent by Zid. If active in Odoo, orders, invoices and returns are recorded in that currency.'
            }
          />

          {orderMultiCurrencyEnabled && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-foreground/90 space-y-2">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold text-amber-600 dark:text-amber-400">
                    {lang === 'ar' ? 'تنبيه هام حول العملات غير المفعّلة في أودو:' : 'Important Note on Inactive Currencies in Odoo:'}
                  </span>
                  <p className="text-muted-foreground leading-relaxed">
                    {lang === 'ar'
                      ? 'أي عملة غير مفعّلة في أودو يتم تسجيل الطلب تلقائياً بالعملة الأساسية (بدون تحديد العملة ليعتمد أودو عملته الأساسية)، ويقوم النظام تلقائياً بتعديل مبالغ سطور الطلب والشحن والرسوم والخصومات إلى ما يقابلها بالعملة الأساسية بناءً على سعر الصرف لمنع اختلاف القيمة المالية (مثال: طلب بـ 200 درهم يُعدل مبلغه للريال بدلاً من تسجيل 200 ريال خطأً).'
                      : 'Any currency not active in Odoo will be recorded in the base currency (defaulting in Odoo), and line item prices, shipping, COD fees, and discounts will be converted automatically to the base currency according to the exchange rate to prevent value discrepancies.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div className="space-y-1.5 sm:col-span-2 md:col-span-1">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'العملة الأساسية البديلة (Fallback Currency)' : 'Base / Fallback Currency'}
              </label>
              <SearchableSelect
                options={currencyOptions}
                value={orderBaseCurrencyId}
                onChange={setOrderBaseCurrencyId}
                placeholder={lang === 'ar' ? '— اختر العملة الأساسية (الافتراضي: الريال السعودي SAR) —' : '— Select Base Currency (Default: SAR) —'}
                disabled={isLoadingCurrencies}
              />
              <p className="text-[11px] text-muted-foreground">
                {lang === 'ar'
                  ? 'العملة المعتمدة لتعديل المبالغ إليها في حال كانت عملة الطلب غير مفعلة بأودو (غالباً SAR - الريال السعودي).'
                  : 'The fallback currency used for converting amounts when order currency is inactive in Odoo (usually SAR).'}
              </p>
            </div>
          </div>
        </div>
      </SettingCard>

      {/* 5b. Payment Methods & Journals Mapping */}
      <SettingCard
        icon={<CreditCard className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'إعدادات المدفوعات وطرق الدفع' : 'Payment Methods & Journals'}
        description={
          lang === 'ar'
            ? 'ربط طرق الدفع في متجر زد بدفاتر اليومية (Journals) المقابلة في أودوو لتسجيل استلام الأموال وتسوية الفواتير تلقائياً'
            : 'Map Zid payment methods to Odoo journals to automatically register inbound payments and reconcile invoices'
        }
        headerAction={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefreshPaymentOptions}
              disabled={isLoadingPaymentMethods || isLoadingJournals}
              className="h-8 text-xs gap-1.5"
              title={lang === 'ar' ? 'تحديث طرق الدفع والدفاتر' : 'Refresh Methods & Journals'}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', (isLoadingPaymentMethods || isLoadingJournals) && 'animate-spin')} />
              <span>{lang === 'ar' ? 'تحديث الخيارات' : 'Refresh'}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddPaymentJournalMapping}
              className="h-8 text-xs gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{lang === 'ar' ? 'إضافة طريقة دفع' : 'Add Payment Method'}</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={orderPaymentAutoSync}
            onChange={setOrderPaymentAutoSync}
            label={
              lang === 'ar'
                ? 'تسجيل المدفوعات تلقائياً في أودوو عند الدفع في زد'
                : 'Auto-create inbound payments in Odoo when order is paid in Zid'
            }
            description={
              lang === 'ar'
                ? 'إنشاء دفعة استلام أموال (Inbound Payment) في دفتر اليومية المربوط وتسويتها تلقائياً مع الفاتورة فور صدورها.'
                : 'Create an inbound payment in the mapped journal and automatically reconcile it with the invoice.'
            }
          />

          {orderPaymentAutoSync && (
            <div className="space-y-3 pt-2">
              {/* Table header */}
              <div className="hidden sm:grid grid-cols-12 gap-2 px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/40 border border-border/40">
                <div className="col-span-5">
                  {lang === 'ar' ? 'طريقة الدفع في متجر زد' : 'Zid Payment Method'}
                </div>
                <div className="col-span-1 text-center">⇄</div>
                <div className="col-span-5">
                  {lang === 'ar' ? 'دفتر اليومية في أودوو (Journal)' : 'Odoo Journal'}
                </div>
                <div className="col-span-1 text-center">
                  {lang === 'ar' ? 'إجراء' : 'Action'}
                </div>
              </div>

              {/* Rows */}
              <div className="space-y-2">
                {orderPaymentJournalMappings.map((mapping) => (
                  <div
                    key={mapping.rowKey}
                    className="flex flex-col sm:grid sm:grid-cols-12 gap-2 p-2 border border-border/60 bg-background/60 items-center"
                  >
                    <div className="w-full sm:col-span-5">
                      <label className="sm:hidden text-xs text-muted-foreground mb-1 block">
                        {lang === 'ar' ? 'طريقة الدفع في زد:' : 'Zid Payment Method:'}
                      </label>
                      <SearchableSelect
                        className="w-full"
                        options={availablePaymentMethodOptions}
                        value={mapping.zid_payment_method}
                        onChange={(v: string) =>
                          handlePaymentJournalMappingChange(mapping.rowKey, 'zid_payment_method', String(v ?? ''))
                        }
                        placeholder={lang === 'ar' ? '— اختر طريقة الدفع في زد —' : '— Select Zid Payment Method —'}
                        disabled={isLoadingPaymentMethods}
                      />
                    </div>
                    <div className="hidden sm:flex col-span-1 justify-center items-center">
                      <ArrowRightLeft className="h-4 w-4 text-muted-foreground/70" />
                    </div>
                    <div className="w-full sm:col-span-5">
                      <label className="sm:hidden text-xs text-muted-foreground mb-1 block">
                        {lang === 'ar' ? 'دفتر اليومية في أودوو:' : 'Odoo Journal:'}
                      </label>
                      <SearchableSelect
                        className="w-full"
                        options={journalOptions}
                        value={mapping.odoo_journal_id}
                        onChange={(v: string) =>
                          handlePaymentJournalMappingChange(mapping.rowKey, 'odoo_journal_id', String(v ?? ''))
                        }
                        placeholder={lang === 'ar' ? '— اختر دفتر اليومية في أودوو —' : '— Select Odoo Journal —'}
                        disabled={isLoadingJournals}
                      />
                    </div>
                    <div className="w-full sm:col-span-1 flex justify-end sm:justify-center">
                      <button
                        type="button"
                        onClick={() => handleRemovePaymentJournalMapping(mapping.rowKey)}
                        title={lang === 'ar' ? 'حذف' : 'Remove'}
                        className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}

                {orderPaymentJournalMappings.length === 0 && (
                  <div className="p-4 text-center border border-dashed border-border/80 text-xs text-muted-foreground space-y-2">
                    <p>
                      {lang === 'ar'
                        ? 'لم يتم إضافة أي ربط لطرق الدفع بعد. انقر على "+ إضافة طريقة دفع" لربط طرق دفع متجر زد بدفاتر أودوو.'
                        : 'No payment method mappings added yet. Click "+ Add Payment Method" to map Zid payment methods to Odoo journals.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Informative note */}
              <div className="p-3 bg-muted/40 border border-border/50 text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                <span className="text-primary font-bold shrink-0">ℹ</span>
                <span>
                  {lang === 'ar'
                    ? 'عندما يسجل العميل الدفع في متجر زد، سيتم إنشاء دفعة (استلام أموال - Inbound Payment) في دفتر اليومية المربوط وتسويتها تلقائياً مع فاتورة الطلب. وإذا تم تسجيل الدفع قبل إنشاء الفاتورة، ستتم التسوية التلقائية فور إنشاء الفاتورة لاحقاً.'
                    : 'When the customer pays in Zid, an inbound payment will be created in the mapped Odoo journal and reconciled with the invoice. If payment occurs before invoicing, automatic reconciliation will run as soon as the invoice is created.'}
                </span>
              </div>
            </div>
          )}
        </div>
      </SettingCard>

      {/* 6. Multi-Warehouse Routing */}
      <SettingCard
        icon={<Boxes className="h-4 w-4 text-amber-600" />}
        title={lang === 'ar' ? 'توجيه المستودعات المتعددة' : 'Multi-Warehouse Routing'}
        description={
          lang === 'ar'
            ? `توجيه الطلب لمستودع أودو المقابل حسب موقع أو فرع ${standardStoreTab === 'salla' ? 'سلة' : 'زد'} (وفي حال عدم التطابق يُستخدم الافتراضي أعلاه)`
            : 'Route orders to specific Odoo warehouses based on the store branch/location'
        }
        headerAction={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAddWarehouseRule}
            className="h-8 text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{lang === 'ar' ? 'إضافة قاعدة' : 'Add Rule'}</span>
          </Button>
        }
      >
        <div className="space-y-2">
          {storeWarehouseRules.map((rule) => (
            <div
              key={rule.rowKey}
              className="flex items-center gap-2 p-2 rounded-none border border-border/60 bg-background/60"
            >
              <SearchableSelect
                className="flex-1 min-w-0"
                options={standardStoreTab === 'salla' ? sallaOrderLocationOptions : zidLocationOptions}
                value={rule.zid_location_id}
                onChange={(v: string) =>
                  handleWarehouseRuleChange(rule.rowKey, 'zid_location_id', String(v ?? ''))
                }
                placeholder={
                  lang === 'ar'
                    ? standardStoreTab === 'salla'
                      ? '— فرع سلة —'
                      : '— موقع زد —'
                    : standardStoreTab === 'salla'
                    ? '— Salla branch —'
                    : '— Zid location —'
                }
              />
              <ArrowRightLeft className="h-4 w-4 shrink-0 text-muted-foreground/70" />
              <SearchableSelect
                className="flex-1 min-w-0"
                options={warehouseOptions}
                value={rule.odoo_warehouse_id}
                onChange={(v: string) =>
                  handleWarehouseRuleChange(rule.rowKey, 'odoo_warehouse_id', String(v ?? ''))
                }
                placeholder={lang === 'ar' ? '— مستودع أودو المقابل —' : '— Odoo warehouse —'}
                disabled={isLoadingWarehouses}
              />
              <button
                type="button"
                onClick={() => handleRemoveWarehouseRule(rule.rowKey)}
                title={lang === 'ar' ? 'حذف' : 'Remove'}
                className="h-8 w-8 shrink-0 flex items-center justify-center rounded-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          {storeWarehouseRules.length === 0 && (
            <div className="p-3 text-center border border-dashed border-border/80 rounded-none text-xs text-muted-foreground">
              {lang === 'ar'
                ? 'لا توجد قواعد مخصصة — سيتم توجيه جميع الطلبات للمستودع الافتراضي.'
                : 'No custom routing rules — all orders go to the default warehouse.'}
            </div>
          )}

          <div className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefreshOrderWarehouses}
              disabled={isRefreshingOrderWarehouses || isLoadingWarehouses}
              className="h-8 px-2.5 text-xs gap-1.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshingOrderWarehouses && 'animate-spin')} />
              <span>{lang === 'ar' ? 'تحديث المستودعات والفروع' : 'Refresh Warehouses'}</span>
            </Button>
          </div>
        </div>
      </SettingCard>

      {/* 7. Analytic Distribution */}
      {standardStoreTab !== 'shopify' && (
        <SettingCard
          icon={<Calculator className="h-4 w-4 text-emerald-600" />}
          title={lang === 'ar' ? 'التوزيع التحليلي (الحسابات التحليلية)' : 'Analytic Distribution'}
          description={
            lang === 'ar'
              ? 'توزيع تكاليف وإيرادات بنود الطلب في أودو على الحسابات التحليلية حسب المستودع أو طريقة الدفع'
              : 'Allocate sales order lines to Odoo analytic accounts by warehouse or payment method'
          }
          headerAction={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddAnalyticRule}
              disabled={!orderAnalyticEnabled}
              className="h-8 text-xs gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{lang === 'ar' ? 'إضافة قاعدة' : 'Add Rule'}</span>
            </Button>
          }
        >
          <div className="space-y-4">
            <SettingToggle
              checked={orderAnalyticEnabled}
              onChange={setOrderAnalyticEnabled}
              label={lang === 'ar' ? 'تفعيل التوزيع التحليلي' : 'Enable Analytic Distribution'}
              description={
                lang === 'ar'
                  ? 'إرفاق الحساب التحليلي المناسب بكل بند طلب عند المزامنة'
                  : 'Appends analytic distribution percentages to order lines'
              }
            />

            {orderAnalyticEnabled && (
              <div className="space-y-2 pt-2 border-t border-border/60">
                {orderAnalyticRules.map((rule) => {
                  const sourceOptions =
                    rule.condition === 'warehouse'
                      ? standardStoreTab === 'salla'
                        ? sallaOrderLocationOptions
                        : zidLocationOptions
                      : paymentMethodOptions

                  return (
                    <div
                      key={rule.rowKey}
                      className="grid grid-cols-1 sm:grid-cols-[1.1fr_1.3fr_1.5fr_90px_36px] items-center gap-2 p-2 rounded-none border border-border/60 bg-background/60"
                    >
                      <SearchableSelect
                        options={[
                          { value: 'all', label: lang === 'ar' ? 'جميع الطلبات (عام)' : 'All orders (general)' },
                          { value: 'warehouse', label: lang === 'ar' ? 'حسب المستودع' : 'By warehouse' },
                          { value: 'payment', label: lang === 'ar' ? 'حسب طريقة الدفع' : 'By payment method' },
                        ]}
                        value={rule.condition}
                        onChange={(v: string) =>
                          handleAnalyticRuleChange(rule.rowKey, {
                            condition: v === 'warehouse' || v === 'payment' ? v : 'all',
                            source_value: '',
                            source_label: '',
                          })
                        }
                      />

                      {rule.condition === 'all' ? (
                        <div className="flex h-9 items-center rounded-none border border-dashed border-border px-3 text-xs text-muted-foreground bg-muted/20">
                          {lang === 'ar' ? 'لكل الطلبات' : 'Applies to all'}
                        </div>
                      ) : (
                        <SearchableSelect
                          options={sourceOptions}
                          value={rule.source_value}
                          onChange={(v: string) => {
                            const selected = sourceOptions.find((opt) => opt.value === String(v ?? ''))
                            handleAnalyticRuleChange(rule.rowKey, {
                              source_value: String(v ?? ''),
                              source_label: selected?.label || String(v ?? ''),
                            })
                          }}
                          placeholder={
                            isLoadingAnalyticOptions
                              ? lang === 'ar'
                                ? 'جارٍ التحميل…'
                                : 'Loading…'
                              : rule.condition === 'warehouse'
                              ? standardStoreTab === 'salla'
                                ? lang === 'ar'
                                  ? '- الفرع -'
                                  : '- Branch -'
                                : lang === 'ar'
                                ? '- المخزن -'
                                : '- Location -'
                              : lang === 'ar'
                              ? '- طريقة الدفع -'
                              : '- Payment -'
                          }
                          disabled={isLoadingAnalyticOptions}
                        />
                      )}

                      <SearchableSelect
                        options={analyticAccountOptions}
                        value={rule.odoo_analytic_account_id}
                        onChange={(v: string) =>
                          handleAnalyticRuleChange(rule.rowKey, {
                            odoo_analytic_account_id: String(v ?? ''),
                          })
                        }
                        placeholder={lang === 'ar' ? '- الحساب التحليلي -' : '- Analytic account -'}
                        disabled={isLoadingAnalyticOptions}
                      />

                      <div className="relative">
                        <input
                          type="number"
                          min="0.01"
                          max="100"
                          step="0.01"
                          className="w-full h-9 px-2.5 pe-6 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                          value={rule.percentage}
                          onChange={(e) =>
                            handleAnalyticRuleChange(rule.rowKey, { percentage: e.target.value })
                          }
                          placeholder="100"
                        />
                        <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-[10px] text-muted-foreground">
                          %
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveAnalyticRule(rule.rowKey)}
                        title={lang === 'ar' ? 'حذف' : 'Remove'}
                        className="h-8 w-8 flex items-center justify-center rounded-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )
                })}

                {orderAnalyticRules.length === 0 && (
                  <div className="p-3 text-center border border-dashed border-border/80 rounded-none text-xs text-muted-foreground">
                    {lang === 'ar'
                      ? 'لا توجد قواعد توزيع تحليلي بعد — اضغط "إضافة قاعدة" لتخصيص حساب تحليلي.'
                      : 'No analytic rules yet — click "Add Rule" to configure.'}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleRefreshAnalyticOptions}
                    disabled={isLoadingAnalyticOptions}
                    className="h-8 px-2.5 text-xs gap-1.5"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', isLoadingAnalyticOptions && 'animate-spin')} />
                    <span>{lang === 'ar' ? 'تحديث الحسابات وطرق الدفع' : 'Refresh Accounts'}</span>
                  </Button>
                </div>

                {analyticOptionsError && (
                  <p className="text-xs text-destructive pt-1">{analyticOptionsError}</p>
                )}
              </div>
            )}
          </div>
        </SettingCard>
      )}

      {/* 8. VAT Settings */}
      <SettingCard
        icon={<Receipt className="h-4 w-4 text-blue-600" />}
        title={lang === 'ar' ? 'ضريبة القيمة المضافة (VAT)' : 'Value Added Tax (VAT)'}
        description={
          lang === 'ar'
            ? 'تطبيق الضريبة في أودو تلقائياً حسب عنوان شحن العميل (داخل أو خارج السعودية)'
            : 'Configure taxes based on customer destination (Saudi vs Non-Saudi shipping address)'
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={orderEnableVat}
            onChange={setOrderEnableVat}
            label={lang === 'ar' ? 'تفعيل احتساب ضريبة القيمة المضافة' : 'Enable VAT Mapping'}
            description={
              lang === 'ar'
                ? 'تطبيق الضرائب المحددة أدناه على بنود الطلب في أودو'
                : 'Applies selected tax rates to sales order lines in Odoo'
            }
          />

          {orderEnableVat ? (
            setOrderVatCountryRules || orderVatCountryRules ? (
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-foreground/90">
                      {lang === 'ar' ? 'جدول ضرائب أودو حسب دولة شحن الطلب' : 'Odoo Taxes by Destination Country'}
                    </label>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                      {lang === 'ar'
                        ? 'حدد الضريبة المطبقة في أودو لكل دولة شحن. خيار "باقي الدول" يمثل أي دولة أخرى غير مختارة بالجدول. في حال عدم تحديد ضريبة لدولة معينة، سيُرسل الطلب بدون خانة الضريبة ليقوم أودو بتطبيق الضريبة الافتراضية.'
                        : 'Set the Odoo tax applied for each shipping destination. "Other Countries" applies to any unlisted destination. If no tax is set, order lines are sent without a tax field so Odoo applies its default tax.'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAddVatCountryRule}
                    className="h-7 text-xs gap-1 shrink-0 border-blue-300 dark:border-blue-800 hover:bg-blue-100/50 dark:hover:bg-blue-900/40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{lang === 'ar' ? 'إضافة دولة' : 'Add Country'}</span>
                  </Button>
                </div>

                {vatRules.length > 0 ? (
                  <div className="space-y-2">
                    {vatRules.map((rule) => {
                      const isCustom = !COMMON_VAT_COUNTRIES.some(c => c.code === rule.country_code) || rule.country_code === 'CUSTOM'
                      return (
                        <div
                          key={rule.rowKey}
                          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 border border-border/80 bg-background/80"
                        >
                          {/* Country Selector */}
                          <div className="w-full sm:w-64 shrink-0">
                            <select
                              className="w-full h-8 px-2 border border-input bg-background text-xs text-foreground focus:border-primary outline-none transition-all"
                              value={isCustom ? 'CUSTOM' : rule.country_code}
                              onChange={(e) => {
                                const val = e.target.value
                                if (val === 'CUSTOM') {
                                  onVatCountryRuleChange(rule.rowKey, 'country_code', '')
                                } else {
                                  onVatCountryRuleChange(rule.rowKey, 'country_code', val)
                                }
                              }}
                            >
                              {COMMON_VAT_COUNTRIES.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {lang === 'ar' ? c.name_ar : c.name_en}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Custom ISO Code Input */}
                          {isCustom && (
                            <div className="w-full sm:w-28 shrink-0">
                              <input
                                type="text"
                                placeholder={lang === 'ar' ? 'رمز (مثال: KW)' : 'Code (e.g. KW)'}
                                maxLength={5}
                                value={rule.country_code === 'CUSTOM' ? '' : rule.country_code}
                                onChange={(e) => onVatCountryRuleChange(rule.rowKey, 'country_code', e.target.value.toUpperCase())}
                                className="w-full h-8 px-2 border border-input bg-background text-xs text-foreground uppercase font-mono"
                              />
                            </div>
                          )}

                          {/* Odoo Tax SearchableSelect */}
                          <div className="flex-1 min-w-[200px]">
                            <SearchableSelect
                              options={orderTaxOptions}
                              value={rule.tax_id}
                              onChange={(val) => onVatCountryRuleChange(rule.rowKey, 'tax_id', val)}
                              placeholder={
                                rule.country_code === 'SA'
                                  ? (lang === 'ar' ? '— ضريبة العميل داخل السعودية (أودو) —' : '— Saudi Customer Tax in Odoo —')
                                  : rule.country_code === 'OTHER'
                                  ? (lang === 'ar' ? '— ضريبة باقي الدول (أودو) —' : '— Other Countries Tax in Odoo —')
                                  : (lang === 'ar' ? '— اختر الضريبة في أودو —' : '— Select Odoo Tax —')
                              }
                              disabled={isLoadingOrderTaxes}
                            />
                          </div>

                          {/* Trash Button */}
                          <button
                            type="button"
                            onClick={() => onRemoveVatCountryRule(rule.rowKey)}
                            title={lang === 'ar' ? 'حذف الدولة' : 'Remove Country'}
                            className="h-8 w-8 shrink-0 flex items-center justify-center self-end sm:self-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="p-3 text-center border border-dashed border-border text-xs text-muted-foreground">
                    {lang === 'ar'
                      ? 'لا توجد قواعد ضرائب مضافة. اضغط "إضافة دولة" لتعيين ضريبة لدولة معينة أو لباقي الدول.'
                      : 'No tax rules added. Click "Add Country" to assign taxes for specific destinations or rest of world.'}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/60">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground/80">
                    {lang === 'ar' ? 'ضريبة العميل السعودي (داخل المملكة)' : 'Saudi Customer Tax'}
                  </label>
                  <SearchableSelect
                    options={orderTaxOptions}
                    value={orderVatSaudiTaxId}
                    onChange={setOrderVatSaudiTaxId}
                    placeholder={lang === 'ar' ? '— اختر ضريبة العميل السعودي —' : '— Select Saudi Tax —'}
                    disabled={isLoadingOrderTaxes}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground/80">
                    {lang === 'ar' ? 'ضريبة العميل غير السعودي (شحن دولي)' : 'Non-Saudi Customer Tax'}
                  </label>
                  <SearchableSelect
                    options={orderTaxOptions}
                    value={orderVatNonSaudiTaxId}
                    onChange={setOrderVatNonSaudiTaxId}
                    placeholder={lang === 'ar' ? '— اختر ضريبة العميل الدولي —' : '— Select Non-Saudi Tax —'}
                    disabled={isLoadingOrderTaxes}
                  />
                </div>
              </div>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              {lang === 'ar'
                ? 'الضريبة غير مفعلة: ستُرسل بنود الطلب إلى أودو بدون ضرائب.'
                : 'VAT mapping is disabled: order lines will be created without taxes in Odoo.'}
            </p>
          )}

          {/* Tax-inclusive store prices setting */}
          <div className="pt-3 border-t border-border/60 space-y-3">
            <SettingToggle
              checked={orderPricesIncludeTax}
              onChange={setOrderPricesIncludeTax}
              label={
                lang === 'ar'
                  ? 'أسعار المتجر تشمل الضريبة (استخراج المبالغ قبل الضريبة لكافة البنود والخدمات لأودو)'
                  : 'Store prices include tax (extract pre-tax amounts for all items & services for Odoo)'
              }
              description={
                lang === 'ar'
                  ? 'يُطبق على كافة الصفوف في أمر البيع (المنتجات، خدمات الشحن والتوصيل، رسوم الدفع عند الاستلام، وبنود الخصم) لاستخراج المبلغ الصافي قبل الضريبة'
                  : 'Applies to all sales order lines (products, delivery/shipping, COD fees, and discount lines) to extract net amounts before tax'
              }
            />

            {orderPricesIncludeTax ? (
              <div className="space-y-3 p-3.5 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/50 text-xs">
                <div className="flex items-start gap-2.5 text-blue-900 dark:text-blue-200">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                  <div className="space-y-1">
                    <p className="font-semibold text-blue-950 dark:text-blue-100">
                      {lang === 'ar'
                        ? 'تنبيه وتوصية: يُنصح بتفعيل هذا الإعداد عند مطابقة الشروط التالية:'
                        : 'Notice & Recommendation: Recommended when the following conditions match:'}
                    </p>
                    <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                      {lang === 'ar'
                        ? '1. أسعار البيع المعروضة بمتجرك شاملة لضريبة القيمة المضافة.\n2. إعدادات الضرائب في أودو محددة بأن الأسعار قبل الضريبة (Tax Excluded).'
                        : '1. Store product sales prices are tax-inclusive.\n2. Odoo taxes are configured as tax-excluded.'}
                    </p>
                    <p className="text-blue-900/90 dark:text-blue-300/90 leading-relaxed font-medium pt-1">
                      {lang === 'ar'
                        ? '💡 نطاق التطبيق الشامل: يتم احتساب السعر قبل الضريبة لجميع صفوف الطلب بدون استثناء:\n• منتجات الطلب (مثال: سعر 115 ر.س يسجل في أودو 100 ر.س).\n• رسوم الشحن والتوصيل (مثال: شحن 23 ر.س يسجل في أودو 20 ر.س لتضاف ضريبة الـ 15% ويصل لـ 23 ر.س).\n• خدمة ورسوم الدفع عند الاستلام (COD).\n• بنود الخصم بالقيمة السالبة (مثال: خصم 23 ر.س يسجل في أودو -20 ر.س لتخصم الضريبة ويصل صافي الخصم لـ -23 ر.س).'
                        : '💡 Comprehensive Scope: Pre-tax extraction applies across all order lines without exception:\n• Order products (e.g. 115 SAR price records as 100 SAR in Odoo).\n• Delivery and shipping charges (e.g. 23 SAR delivery records as 20 SAR).\n• Cash on Delivery (COD) collection fees.\n• Fixed discount lines with negative value (e.g. 23 SAR discount records as -20 SAR so tax is discounted proportionally).'}
                    </p>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-blue-200/60 dark:border-blue-900/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-semibold text-foreground/90">
                        {lang === 'ar' ? 'جدول نسب الضريبة حسب دولة الشحن' : 'Tax Rates by Destination Country'}
                      </label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {lang === 'ar'
                          ? 'حدد نسبة الضريبة لكل دولة شحن. أي دولة غير مضافة بالجدول (مثل التصدير) تُعتبر نسبة ضريبتها 0% تلقائياً ولا يتم تقسيم السعر عليها.'
                          : 'Set tax rate per destination. Any unlisted country (e.g. export) defaults to 0% with no deductions.'}
                      </p>
                    </div>
                    {setOrderCountryTaxRates && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddCountryRule}
                        className="h-7 text-xs gap-1 border-blue-300 dark:border-blue-800 hover:bg-blue-100/50 dark:hover:bg-blue-900/40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>{lang === 'ar' ? 'إضافة دولة' : 'Add Country'}</span>
                      </Button>
                    )}
                  </div>

                  {setOrderCountryTaxRates ? (
                    <div className="space-y-2">
                      {countryRules.map((rule) => {
                        const isCustom = !COMMON_TAX_COUNTRIES.some(c => c.code === rule.country_code) || rule.country_code === 'CUSTOM'
                        return (
                          <div
                            key={rule.rowKey}
                            className="flex items-center gap-2 p-2 rounded-none border border-blue-200/80 dark:border-blue-900/60 bg-background/80"
                          >
                            <div className="flex-1 min-w-0">
                              <select
                                className="w-full h-8 px-2 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary outline-none transition-all"
                                value={isCustom ? 'CUSTOM' : rule.country_code}
                                onChange={(e) => {
                                  const val = e.target.value
                                  if (val === 'CUSTOM') {
                                    handleCountryRuleChange(rule.rowKey, 'country_code', '')
                                  } else {
                                    handleCountryRuleChange(rule.rowKey, 'country_code', val)
                                  }
                                }}
                              >
                                {COMMON_TAX_COUNTRIES.map((c) => (
                                  <option key={c.code} value={c.code}>
                                    {lang === 'ar' ? c.name_ar : c.name_en}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {isCustom && (
                              <div className="w-24 shrink-0">
                                <input
                                  type="text"
                                  placeholder="رمز (مثال: KW)"
                                  maxLength={5}
                                  value={rule.country_code === 'CUSTOM' ? '' : rule.country_code}
                                  onChange={(e) => handleCountryRuleChange(rule.rowKey, 'country_code', e.target.value.toUpperCase())}
                                  className="w-full h-8 px-2 rounded-none border border-input bg-background text-xs text-foreground uppercase font-mono"
                                />
                              </div>
                            )}

                            <div className="w-28 shrink-0 relative">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                placeholder="15"
                                value={rule.tax_rate}
                                onChange={(e) => handleCountryRuleChange(rule.rowKey, 'tax_rate', e.target.value)}
                                className="w-full h-8 px-2 pe-6 rounded-none border border-input bg-background text-xs text-foreground font-mono focus:border-primary outline-none"
                              />
                              <span className="absolute end-2 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none select-none">
                                %
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveCountryRule(rule.rowKey)}
                              title={lang === 'ar' ? 'حذف الدولة' : 'Remove Country'}
                              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-none text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      })}

                      {countryRules.length === 0 && (
                        <div className="p-3 text-center border border-dashed border-blue-200 dark:border-blue-900/60 rounded-none text-xs text-muted-foreground">
                          {lang === 'ar'
                            ? 'لا توجد دول مضافة — سيتم اعتبار نسبة الضريبة 0% لكافة الطلبات دون أي تقسيم.'
                            : 'No countries configured — all orders will default to 0% tax rate with no division.'}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className={setOrderCountryTaxRates ? "hidden" : "max-w-xs space-y-1.5"}>
                    <label className="block text-xs font-medium text-foreground/90">
                      {lang === 'ar' ? 'نسبة الضريبة بالمتجر' : 'Store Tax Rate'}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className="w-full h-9 px-3 pe-8 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all font-mono"
                        value={orderTaxRatePercent}
                        onChange={(e) => setOrderTaxRatePercent(e.target.value)}
                        placeholder="15"
                      />
                      <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none select-none">
                        %
                      </span>
                    </div>
                  </div>

                  <div className="p-2 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-[11px] text-emerald-900 dark:text-emerald-200 flex items-start gap-1.5">
                    <span className="font-bold shrink-0">✓</span>
                    <span>
                      {lang === 'ar'
                        ? 'حماية مبيعات التصدير: أي طلب شحن دولي لدولة خارج هذا الجدول يُعامل بنسبة ضريبة 0%، بحيث يُسجل السعر كاملاً في أودو دون قسمة على (1 + 15%) لمنع أي خسارة على التاجر.'
                        : 'Export Protection: Any international order outside this table receives a 0% tax rate; full amounts are recorded in Odoo without division to protect export revenue.'}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-2.5 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <span>
                  {lang === 'ar'
                    ? 'تنبيه: يُنصح بتفعيل هذا الخيار عندما تكون الأسعار بالمتجر شاملة للضريبة وإعدادات أودو في الضريبة أن الأسعار قبل الضريبة، لتفادي تسجيل السعر شاملاً وإضافة أودو ضريبة أخرى فوقه.'
                    : 'Notice: Recommended when store prices include VAT and Odoo taxes expect tax-exclusive amounts, to avoid double-taxation.'}
                </span>
              </div>
            )}
          </div>
        </div>
      </SettingCard>

      {/* 9. Shipping, COD & Discount Line Items */}
      <SettingCard
        icon={<Truck className="h-4 w-4 text-sky-600" />}
        title={lang === 'ar' ? 'بنود الشحن والدفع عند الاستلام والخصومات' : 'Shipping, COD & Discounts'}
        description={
          lang === 'ar'
            ? 'تحديد منتجات أودو المستخدمة لتمثيل رسوم الشحن وخدمة الدفع عند الاستلام وكوبونات الخصم'
            : 'Configure dedicated Odoo products to represent delivery fees, COD charges, and discounts'
        }
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Shipping */}
          <div className="rounded-none border border-border/80 bg-background/60 p-4 space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">
                {lang === 'ar' ? 'رسوم الشحن' : 'Shipping Fee'}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lang === 'ar' ? 'تسجيل رسوم الشحن كبند في أمر البيع عند تحديد منتج الشحن' : 'Append delivery fee as order line when shipping product is selected'}
              </p>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-border/60">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'منتج الشحن في أودو' : 'Odoo Shipping Product'}
              </label>
              <SearchableSelect
                options={productOptions}
                value={orderShippingProductId}
                onChange={(val) => {
                  setOrderShippingProductId(val)
                  setOrderAddShipping(!!val)
                }}
                placeholder={lang === 'ar' ? '— اختر منتج الشحن —' : '— Select Shipping Product —'}
                disabled={isLoadingProducts}
              />
            </div>
          </div>

          {/* COD */}
          <div className="rounded-none border border-border/80 bg-background/60 p-4 space-y-3">
            <SettingToggle
              checked={orderAddCod}
              onChange={setOrderAddCod}
              label={lang === 'ar' ? 'إضافة رسوم COD كبند' : 'Add COD Fee Line'}
              description={lang === 'ar' ? 'رسوم الدفع عند الاستلام' : 'Cash on delivery fee line'}
            />

            {orderAddCod && (
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground/80">
                    {lang === 'ar' ? 'منتج رسوم COD في أودو' : 'Odoo COD Product'}
                  </label>
                  <SearchableSelect
                    options={productOptions}
                    value={orderCodProductId}
                    onChange={setOrderCodProductId}
                    placeholder={lang === 'ar' ? '— اختر منتج COD —' : '— Select COD Product —'}
                    disabled={isLoadingProducts}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground/80">
                    {lang === 'ar' ? 'مبلغ احتياطي ثابت' : 'Fallback Amount'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full h-9 px-3 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    value={orderCodAmount}
                    onChange={(e) => setOrderCodAmount(e.target.value)}
                    placeholder="10"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Discount */}
          <div className="rounded-none border border-border/80 bg-background/60 p-4 space-y-3">
            <SettingToggle
              checked={orderAddDiscount}
              onChange={setOrderAddDiscount}
              label={lang === 'ar' ? 'إضافة الخصم' : 'Add Discount'}
              description={lang === 'ar' ? 'كوبونات وخصومات الطلب' : 'Coupons and order discounts'}
            />

            {orderAddDiscount && (
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground/80">
                    {lang === 'ar' ? 'طريقة الخصم' : 'Discount Mode'}
                  </label>
                  <select
                    className="w-full h-9 px-3 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    value={orderDiscountMode}
                    onChange={(e) => setOrderDiscountMode(e.target.value)}
                  >
                    <option value="percent">{lang === 'ar' ? 'نسبة مئوية (على أسطر الطلب)' : 'Percentage (on order lines)'}</option>
                    <option value="fixed">{lang === 'ar' ? 'قيمة ثابتة سالبة (كبند مستقل)' : 'Negative Fixed Value (as line item)'}</option>
                  </select>
                </div>

                {orderDiscountMode === 'fixed' ? (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/80">
                      {lang === 'ar' ? 'منتج الخصم في أودو' : 'Odoo Discount Product'}
                    </label>
                    <SearchableSelect
                      options={productOptions}
                      value={orderDiscountProductId}
                      onChange={setOrderDiscountProductId}
                      placeholder={lang === 'ar' ? '— اختر منتج الخصم —' : '— Select Discount Product —'}
                      disabled={isLoadingProducts}
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground bg-muted/40 p-2 border border-border/50">
                    {lang === 'ar'
                      ? 'يتم تطبيق الخصم كنسبة مئوية على أسطر أمر البيع مباشرة (في حقل نسبة الخصم الافتراضي بأودو) دون إضافة صنف مستقل.'
                      : 'Discount will be applied as a percentage directly on sales order lines (Odoo default Discount % field) without adding a separate product.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </SettingCard>

      {/* 10. Store Returns Policy */}
      <SettingCard
        icon={<RotateCcw className="h-4 w-4 text-amber-600" />}
        title={lang === 'ar' ? 'سياسة مرتجعات المتجر' : 'Store Returns Policy'}
        description={
          lang === 'ar'
            ? 'الإجراء التلقائي المتخذ في أودو عند إرجاع أو استرداد طلب من المتجر'
            : 'Handling strategy in Odoo when a customer returns or refunds an order'
        }
      >
        <div className="space-y-4">
          <div className="max-w-md space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'طريقة معالجة المرتجع في أودو' : 'Return Handling Mode'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-none border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={orderReturnsMode}
              onChange={(e) => setOrderReturnsMode(e.target.value as typeof orderReturnsMode)}
            >
              <option value="nothing">{lang === 'ar' ? 'لا شيء (تجاهل المرتجعات)' : 'Nothing (Ignore)'}</option>
              <option value="negative_so">
                {lang === 'ar' ? 'إنشاء أمر بيع جديد بكميات سالبة' : 'Create Negative Sale Order'}
              </option>
              <option value="stock_return_credit_note">
                {lang === 'ar' ? 'مرتجع مخزون على نفس الطلب + إشعار دائن (Credit Note)' : 'Stock Return + Credit Note'}
              </option>
            </select>
          </div>

          {orderReturnsMode !== 'nothing' && (
            <div className="space-y-4 pt-2 border-t border-border/60">
              {orderReturnsMode === 'stock_return_credit_note' && (
                <div className="space-y-3">
                  <SettingToggle
                    checked={orderReturnsCreditNote}
                    onChange={setOrderReturnsCreditNote}
                    label={lang === 'ar' ? 'إنشاء إشعار دائن (Credit Note) بمبلغ المرتجع' : 'Generate Credit Note'}
                    description={
                      lang === 'ar'
                        ? 'إصدار قيد كريدت نوت محاسبي تلقائياً'
                        : 'Creates credit note draft in accounting journal'
                    }
                  />

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-foreground/80">
                        {lang === 'ar' ? 'معرّف دفتر يومية كريدت نوت (اختياري)' : 'Credit Note Journal ID (Optional)'}
                      </label>
                      <button
                        type="button"
                        onClick={() => handleRefreshJournals()}
                        disabled={isLoadingJournals}
                        className="text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw className={cn('h-3 w-3', isLoadingJournals && 'animate-spin')} />
                        <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
                      </button>
                    </div>
                    <SearchableSelect
                      options={journalOptions}
                      value={orderReturnsJournalId}
                      onChange={setOrderReturnsJournalId}
                      placeholder={lang === 'ar' ? '— اختر دفتر اليومية —' : '— Select Journal —'}
                      disabled={isLoadingJournals}
                    />
                    {journalOptions.length === 0 && !isLoadingJournals && (
                      <span className="text-[11px] text-muted-foreground">
                        {lang === 'ar'
                          ? 'لا توجد دفاتر يومية — أضف دفتراً في أودو ثم اضغط تحديث'
                          : 'No journals found — add one in Odoo then refresh'}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/80">
                      {lang === 'ar' ? 'إذا لم يوجد الأمر الأصلي في أودو' : 'If Original Order Missing'}
                    </label>
                    <select
                      className="w-full h-9 px-3 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                      value={orderReturnsFallback}
                      onChange={(e) => setOrderReturnsFallback(e.target.value as typeof orderReturnsFallback)}
                    >
                      <option value="skip">{lang === 'ar' ? 'تجاهل المرتجع' : 'Skip Return'}</option>
                      <option value="negative_so">
                        {lang === 'ar' ? 'أمر بيع سالب مستقل' : 'Standalone Negative Order'}
                      </option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/80">
                      {lang === 'ar' ? 'مصدر سبب المرتجع' : 'Return Reason Source'}
                    </label>
                    <select
                      className="w-full h-9 px-3 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                      value={orderReturnsReasonType}
                      onChange={(e) => setOrderReturnsReasonType(e.target.value as 'store_reason' | 'custom')}
                    >
                      <option value="store_reason">
                        {lang === 'ar'
                          ? `سبب المرتجع الوارد من ${statusStoreNameAr || 'المتجر'} تلقائياً`
                          : 'Use store return reason automatically'}
                      </option>
                      <option value="custom">
                        {lang === 'ar' ? 'كتابة سبب مخصص (إجباري)' : 'Custom Return Reason (Required)'}
                      </option>
                    </select>
                  </div>
                </div>

                {orderReturnsReasonType === 'custom' ? (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/80">
                      {lang === 'ar' ? 'سبب المرتجع المخصص' : 'Custom Return Reason'}
                      <span className="text-red-500 mr-1 ml-1">*</span>
                    </label>
                    <input
                      type="text"
                      className={cn(
                        'w-full h-9 px-3 rounded-none border bg-background text-xs text-foreground focus:ring-1 outline-none transition-all',
                        !orderReturnsReason.trim()
                          ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                          : 'border-input focus:border-primary focus:ring-primary'
                      )}
                      value={orderReturnsReason}
                      onChange={(e) => setOrderReturnsReason(e.target.value)}
                      placeholder={
                        lang === 'ar'
                          ? 'اكتب سبب المرتجع هنا (إجباري طالما تم تفعيل المرتجع)'
                          : 'Enter return reason (required when returns enabled)'
                      }
                    />
                    {!orderReturnsReason.trim() && (
                      <span className="text-[11px] text-red-500 font-medium">
                        {lang === 'ar'
                          ? 'سبب المرتجع إجباري عند اختيار تحديد سبب مخصص'
                          : 'Return reason is required when custom is selected'}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-muted-foreground bg-muted/40 p-2.5 border border-border/50">
                      {lang === 'ar'
                        ? `سيتم إرفاق وتضمين سبب المرتجع الذي يرسله ${statusStoreNameAr || 'المتجر'} تلقائياً على سجلات المرتجع في أودو.`
                        : 'The return reason sent from the store will be automatically attached to Odoo records.'}
                    </div>
                    <input
                      type="text"
                      className="w-full h-8 px-3 rounded-none border border-input bg-background/60 text-[11px] text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                      value={orderReturnsReason}
                      onChange={(e) => setOrderReturnsReason(e.target.value)}
                      placeholder={
                        lang === 'ar'
                          ? 'سبب احتياطي بديل في حال لم يرسل المتجر سبباً (اختياري)'
                          : 'Fallback reason if store sends none (optional)'
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </SettingCard>

      {/* 11. Custom Status Field in Odoo */}
      <SettingCard
        icon={<Activity className="h-4 w-4 text-purple-600" />}
        title={
          lang === 'ar'
            ? `تحديث حالة طلب ${statusStoreNameAr} داخل أودو (حقل مخصص)`
            : `Sync ${statusStoreNameEn} Status to Odoo (Custom Field)`
        }
        description={
          lang === 'ar'
            ? `إنشاء حقل Selection على أمر المبيعات في أودو لعرض حالة طلب ${statusStoreNameAr} الحالية فورياً`
            : `Live Selection field on sale.order reflecting exact ${statusStoreNameEn} status`
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={orderUpdateCustomStatus}
            onChange={setOrderUpdateCustomStatus}
            label={lang === 'ar' ? 'تحديث حقل حالة الطلب المخصص في أودو' : 'Update Status Field in Odoo'}
            description={
              lang === 'ar'
                ? `ينعكس كل تغير لحالة طلب ${statusStoreNameAr} على الحقل مباشرة`
                : `Reflects store status changes directly in the Odoo sale.order record`
            }
          />

          {orderUpdateCustomStatus && (
            <div className="space-y-4 pt-2 border-t border-border/60">
              {statusFieldExists ? (
                <div className="rounded-none border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>
                        {lang === 'ar'
                          ? `الحقل متوفر في أودو: ${orderStatusCustomField || statusFieldDefaultName}`
                          : `Field active in Odoo: ${orderStatusCustomField || statusFieldDefaultName}`}
                      </span>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCreateStatusField}
                      disabled={isCreatingStatusField}
                      className="h-7 text-[11px] gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                    >
                      <RefreshCw className={cn('h-3 w-3', isCreatingStatusField && 'animate-spin')} />
                      <span>{lang === 'ar' ? 'تحديث الخيارات من المتجر' : 'Update Options'}</span>
                    </Button>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-foreground/80">
                        {lang === 'ar' ? 'الحقل المستهدف في أودو' : 'Target Odoo Field'}
                      </label>
                      <button
                        type="button"
                        onClick={() => fetchOdooOrderFields(true)}
                        disabled={isLoadingOrderFields}
                        className="text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 transition-colors"
                      >
                        <RefreshCw className={cn('h-3 w-3', isLoadingOrderFields && 'animate-spin')} />
                        <span>{lang === 'ar' ? 'تحديث الحقول' : 'Refresh'}</span>
                      </button>
                    </div>
                    <SearchableSelect
                      options={odooOrderFields}
                      value={orderStatusCustomField || statusFieldDefaultName}
                      onChange={setOrderStatusCustomField}
                      placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
                      disabled={isLoadingOrderFields}
                    />
                  </div>

                  <div className="space-y-1 pt-1">
                    <label className="block text-[11px] font-medium text-muted-foreground">
                      {lang === 'ar' ? 'الحالات المربوطة داخل الخانة:' : 'Linked Statuses in Selection:'}
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {statusFieldOptions.map((opt) => (
                        <span
                          key={opt.key}
                          className="inline-flex items-center px-2 py-0.5 rounded-none text-[10px] font-medium bg-background border border-border/70 text-foreground"
                        >
                          <span className="font-semibold text-primary me-1">{opt.key}:</span>
                          {opt.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-none border border-dashed border-primary/30 bg-primary/5">
                  <div className="space-y-1">
                    <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                      <Wand2 className="h-4 w-4 text-primary" />
                      <span>
                        {lang === 'ar'
                          ? `إنشاء خانة حالة طلب ${statusStoreNameAr} في أودو`
                          : `Create ${statusStoreNameEn} Order Status Field in Odoo`}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {lang === 'ar'
                        ? `سيتم إنشاء حقل (${statusFieldDefaultName}) من نوع Selection داخل أودو وتعبئة حالات الطلبات تلقائياً.`
                        : `A new selection field (${statusFieldDefaultName}) will be created automatically in Odoo.`}
                    </p>
                  </div>

                  <Button
                    type="button"
                    onClick={handleCreateStatusField}
                    disabled={isCreatingStatusField || !hasOdooConnection}
                    className="shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-none h-9 text-xs px-4 gap-1.5"
                  >
                    {isCreatingStatusField ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>{lang === 'ar' ? 'جاري الإنشاء...' : 'Creating...'}</span>
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        <span>{lang === 'ar' ? 'إنشاء الخانة في أودو الآن' : 'Create Field in Odoo'}</span>
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </SettingCard>

      {/* 12. Order Status State Mapping Table */}
      <SettingCard
        icon={<TableProperties className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'مواءمة وربط حالات الطلب' : 'Order Status Mapping Table'}
        description={
          lang === 'ar'
            ? 'تحديد الحالة المقابلة في أمر بيع أودو (مسودة، مؤكد، مغلق، إلخ) لكل حالة طلب في المتجر'
            : 'Map each store order status to its target lifecycle stage in Odoo'
        }
      >
        <div className="rounded-none border border-border/80 overflow-x-auto bg-background">
          <table className="w-full text-xs text-left border-collapse" dir={dir}>
            <thead>
              <tr className="bg-muted/40 text-muted-foreground border-b border-border/60">
                <th className="px-4 py-3 font-semibold text-start whitespace-nowrap">
                  {lang === 'ar' ? 'حالة الطلب في المتجر' : 'Store Status'}
                </th>
                <th className="px-4 py-3 font-semibold text-start whitespace-nowrap min-w-[170px]">
                  {lang === 'ar' ? 'حالة أمر البيع في أودو' : 'Target Odoo State'}
                </th>
                <th className="px-4 py-3 font-semibold text-start whitespace-nowrap min-w-[190px]">
                  {lang === 'ar' ? 'إذن المخزن (الشحن والتسليم)' : 'Stock Picking'}
                </th>
                <th className="px-4 py-3 font-semibold text-start whitespace-nowrap min-w-[190px]">
                  {lang === 'ar' ? 'الفاتورة' : 'Invoice'}
                </th>
                <th className="px-4 py-3 font-semibold w-20 text-center whitespace-nowrap">
                  {lang === 'ar' ? 'تفعيل' : 'Enabled'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {getOrderPlatformStatuses().map((status) => {
                const current = orderStateMapping[status.key]
                const isEnabled = current?.enabled ?? true

                return (
                  <tr
                    key={status.key}
                    className={cn(
                      'hover:bg-muted/30 transition-colors',
                      !isEnabled && 'opacity-50 bg-muted/10'
                    )}
                  >
                    <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">
                      <span>{lang === 'ar' ? status.labelAr : status.labelEn}</span>
                      <span className="text-[10px] text-muted-foreground block font-mono">
                        {status.key}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className="w-full h-8 px-2.5 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                        value={current?.state || ''}
                        disabled={!isEnabled}
                        onChange={(e) => {
                          const val = e.target.value
                          setOrderStateMapping((prev) => ({
                            ...prev,
                            [status.key]: {
                              state: val,
                              enabled: prev[status.key]?.enabled ?? true,
                              picking_action: prev[status.key]?.picking_action || '',
                              invoice_action: prev[status.key]?.invoice_action || '',
                            },
                          }))
                        }}
                      >
                        <option value="">
                          {lang === 'ar' ? '— استخدم الافتراضي —' : '— Use Default —'}
                        </option>
                        {odooStates.map((st) => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className="w-full h-8 px-2.5 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                        value={current?.picking_action || ''}
                        disabled={!isEnabled}
                        onChange={(e) => {
                          const val = e.target.value
                          setOrderStateMapping((prev) => ({
                            ...prev,
                            [status.key]: {
                              state: prev[status.key]?.state || '',
                              enabled: prev[status.key]?.enabled ?? true,
                              picking_action: val,
                              invoice_action: prev[status.key]?.invoice_action || '',
                            },
                          }))
                        }}
                      >
                        {pickingActionOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        className="w-full h-8 px-2.5 rounded-none border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                        value={current?.invoice_action || ''}
                        disabled={!isEnabled}
                        onChange={(e) => {
                          const val = e.target.value
                          setOrderStateMapping((prev) => ({
                            ...prev,
                            [status.key]: {
                              state: prev[status.key]?.state || '',
                              enabled: prev[status.key]?.enabled ?? true,
                              picking_action: prev[status.key]?.picking_action || '',
                              invoice_action: val,
                            },
                          }))
                        }}
                      >
                        {invoiceActionOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        role="switch"
                        dir="ltr"
                        aria-checked={isEnabled}
                        onClick={() => {
                          const cur = orderStateMapping[status.key]
                          setOrderStateMapping((prev) => ({
                            ...prev,
                            [status.key]: {
                              state: cur?.state || '',
                              enabled: !(cur?.enabled ?? true),
                              picking_action: cur?.picking_action || '',
                              invoice_action: cur?.invoice_action || '',
                            },
                          }))
                        }}
                        className={cn(
                          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary',
                          isEnabled ? 'border-transparent bg-primary' : 'border-border bg-muted-foreground/25'
                        )}
                      >
                        <span
                          className={cn(
                            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform duration-200',
                            isEnabled ? 'translate-x-[17px]' : 'translate-x-[2px]'
                          )}
                        />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SettingCard>

      {/* Action Footer */}
      <div className="pt-2 flex flex-wrap items-center gap-2.5">
        <Button
          onClick={handleSaveOrders}
          disabled={isSavingOrders}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-none h-10 px-6 text-xs shadow-sm gap-2 transition-all"
        >
          {isSavingOrders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{lang === 'ar' ? 'حفظ إعدادات الطلبات' : 'Save Order Settings'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsOrderLogOpen(true)}
          className="rounded-none h-10 px-4 text-xs gap-2 border-border/80 hover:bg-muted/50"
        >
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'سجل مزامنة الطلبات' : 'Order Sync Log'}</span>
        </Button>
      </div>
    </div>
  )
}
