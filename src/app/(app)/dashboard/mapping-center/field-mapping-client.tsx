'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { 
  Plus, 
  Edit, 
  Trash2, 
  SlidersHorizontal, 
  ArrowRight, 
  Database, 
  Layers, 
  Loader2,
  History,
  Puzzle,
  ArrowRightLeft,
  FolderTree,
  Package,
  Users,
  ShoppingCart,
  Activity,
  X,
  Search,
  Pencil,
  RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import React, { useState, useEffect, useCallback } from 'react'

import { getFieldMappings, deleteFieldMapping } from '@/app/actions/field-mappings'
import { disableOdooStockWebhook, enableOdooStockWebhook, type OdooStockWebhookRefs } from '@/app/actions/inventory-sync'
import { getOdooFieldValueOptions, getOdooLocations } from '@/app/actions/odoo'
import { saveOrderStatusMappings, getOrderStatusMappings } from '@/app/actions/order-status-mappings'
import { getStandardMappingSettings, saveStandardMappingSettings } from '@/app/actions/standard-mapping'
import { deleteStaticMapping, getStaticMappings, saveStaticMapping } from '@/app/actions/static-mappings'
import { getZidLocations, type ZidLocation } from '@/app/actions/zid'
import { useLanguage } from '@/components/language-provider'
import CategoryMappingDialog from '@/components/mapping/category-mapping-dialog'
import ProductMappingDialog from '@/components/mapping/product-mapping-dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { ZID_EVENTS, SALLA_EVENTS, SHOPIFY_EVENTS, ZID_FIELDS, SALLA_FIELDS, SHOPIFY_FIELDS } from '@/lib/mapping-constants'
import { formatFieldLabel } from '@/lib/translations'
import { cn } from '@/lib/utils'

import AddCustomFieldForm from './add-custom-field-form'
import FieldMappingForm from './field-mapping-form'
import SearchableSelect from './searchable-select'
import StaticMappingEditor from './static-mapping-editor'
import SyncLogModal from './sync-log-modal'

interface FieldMappingClientProps {
  initialModels: Array<{ model: string; name: string }>
  hasOdooConnection: boolean
  erpType?: string
  preloadedModel: string
  preloadedFields: any[]
  isZidConnected: boolean
  isSallaConnected: boolean
  isShopifyConnected: boolean
  zidStoreName?: string | null
  sallaStoreName?: string | null
  shopifyStoreName?: string | null
  initialSubTab?: 'categories' | 'products' | 'customers' | 'orders'
}

export default function FieldMappingClient({
  initialModels,
  hasOdooConnection,
  erpType = 'odoo',
  preloadedModel,
  preloadedFields,
  isZidConnected,
  isSallaConnected,
  isShopifyConnected,
  zidStoreName,
  sallaStoreName,
  shopifyStoreName,
  initialSubTab,
}: FieldMappingClientProps) {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [mappings, setMappings] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedMapping, setSelectedMapping] = useState<any>(null)
  const { t, lang, dir } = useLanguage()
  const router = useRouter()

  const [pageTab, setPageTab] = useState<'standard' | 'mapping' | 'addfield' | 'values'>('standard')
  
  // Filter tab state: 'all' | 'zid' | 'salla'
  const [platformFilter, setPlatformFilter] = useState<string[]>([])

  // Advanced Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [directionFilter, setDirectionFilter] = useState<string[]>([])
  const [operationFilter, setOperationFilter] = useState<string[]>([])

  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [, setIsDeleting] = useState(false)

  // Standard Mapping
  const [standardSubTab, setStandardSubTab] = useState<'categories' | 'products' | 'customers' | 'orders'>(initialSubTab || 'categories')
  const [standardStoreTab, setStandardStoreTab] = useState<string>('zid')

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
  const [odooLocations, setOdooLocations] = useState<Array<{ id: number; name: string; complete_name: string; usage: string }>>([])
  const [isLoadingInvSync, setIsLoadingInvSync] = useState(false)
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
  const [productEnabledActions, setProductEnabledActions] = useState<string[]>([])
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
  const [customerEnabledActions, setCustomerEnabledActions] = useState<string[]>([])
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
  const [orderEnabledActions, setOrderEnabledActions] = useState<string[]>([])
  const [orderMatchZidField, setOrderMatchZidField] = useState('')
  const [orderMatchOdooField, setOrderMatchOdooField] = useState('')
  const [orderCompanyId, setOrderCompanyId] = useState('')
  const [orderLinkCompany, setOrderLinkCompany] = useState(true)
  const [orderWarehouseId, setOrderWarehouseId] = useState('')
  const [orderPricelistId, setOrderPricelistId] = useState('')
  const [orderPaymentTermId, setOrderPaymentTermId] = useState('')
  const [orderAutoConfirm, setOrderAutoConfirm] = useState(false)
  const [orderAutoInvoice, setOrderAutoInvoice] = useState(false)
  const [orderPartialFulfillment, setOrderPartialFulfillment] = useState(false)
  const [storeWarehouseMappings, setStoreWarehouseMappings] = useState<Record<string, string>>({})

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

  // Status mapping
  const [orderStateMapping, setOrderStateMapping] = useState<Record<string, { state: string; enabled: boolean }>>({})

  // Odoo fields and options loading states
  const [odooOrderFields, setOdooOrderFields] = useState<{ value: string; label: string }[]>([])
  const [isLoadingOrderFields, setIsLoadingOrderFields] = useState(false)
  const [warehouseOptions, setWarehouseOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState(false)
  const [pricelistOptions, setPricelistOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingPricelists, setIsLoadingPricelists] = useState(false)
  const [paymentTermOptions, setPaymentTermOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingPaymentTerms, setIsLoadingPaymentTerms] = useState(false)
  const [productOptions, setProductOptions] = useState<{ value: string; label: string }[]>([])
  const [isLoadingProducts, setIsLoadingProducts] = useState(false)
  const [isSavingOrders, setIsSavingOrders] = useState(false)

  const { toast } = useToast()

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
      { key: 'delivered', labelAr: 'تم التوصيل', labelEn: 'Delivered' },
      { key: 'canceled', labelAr: 'ملغي', labelEn: 'Canceled' },
      { key: 'reversed', labelAr: 'مرتجع', labelEn: 'Reversed' },
      { key: 'partially_reversed', labelAr: 'مرتجع جزئياً', labelEn: 'Partially Reversed' },
      { key: 'reverse_in_progress', labelAr: 'جاري الإرجاع', labelEn: 'Reverse in Progress' },
    ]
  }

  // ── Customer Odoo fields ──
  const fetchOdooCustomerFields = useCallback(async (force = true) => {
    if (!hasOdooConnection) return
    setIsLoadingCustomerFields(true)
    try {
      const { getOdooModelFields } = await import('@/app/actions/odoo')
      const res = await getOdooModelFields('res.partner', force)
      if (res.success && res.fields) {
        setOdooCustomerFields(res.fields.map((f: any) => ({
          value: f.value,
          label: f.label && f.label !== f.value ? `${f.label} (${f.value})` : f.value,
          desc: f.desc || f.value,
        })))
      }
    } catch (error) {
      console.error('Failed to fetch Odoo customer fields:', error)
    } finally {
      setIsLoadingCustomerFields(false)
    }
  }, [hasOdooConnection])

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

  const fetchOdooCategoryFields = useCallback(async (force = true) => {
    if (!hasOdooConnection) return
    setIsLoadingOdooFields(true)
    try {
      const { getOdooModelFields } = await import('@/app/actions/odoo')
      const res = await getOdooModelFields('product.category', force)
      if (res.success && res.fields) {
        setOdooCategoryFields(res.fields.map((f: any) => ({
          value: f.value,
          label: f.label && f.label !== f.value ? `${f.label} (${f.value})` : f.value,
          desc: f.desc || f.value,
        })))
      }
    } catch (error) {
      console.error('Failed to fetch Odoo category fields:', error)
    } finally {
      setIsLoadingOdooFields(false)
    }
  }, [hasOdooConnection])

  useEffect(() => {
    if (standardSubTab === 'categories') {
      fetchOdooCategoryFields(false)
    }
  }, [fetchOdooCategoryFields, standardSubTab])

  // ── Product Odoo fields ──
  const fetchOdooProductFields = useCallback(async (force = true) => {
    if (!hasOdooConnection) return
    setIsLoadingProductFields(true)
    try {
      const { getOdooModelFields } = await import('@/app/actions/odoo')
      const res = await getOdooModelFields('product.template', force)
      if (res.success && res.fields) {
        setProductOdooFields(res.fields.map((f: any) => ({
          value: f.value,
          label: f.label && f.label !== f.value ? `${f.label} (${f.value})` : f.value,
          desc: f.desc || f.value,
        })))
      }
    } catch (error) {
      console.error('Failed to fetch Odoo product fields:', error)
    } finally {
      setIsLoadingProductFields(false)
    }
  }, [hasOdooConnection])

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

    fetchOdooOrderFields(false)

    import('@/app/actions/odoo').then(({ getOdooFieldValueOptions, getOdooWarehouses }) => {

      // 2. Get warehouses
      getOdooWarehouses().then(res => {
        if (res.success && res.warehouses) {
          setWarehouseOptions(res.warehouses.map((w: any) => ({ value: String(w.id), label: w.name })))
        }
      }).finally(() => setIsLoadingWarehouses(false))

      // 3. Get pricelists
      getOdooFieldValueOptions('sale.order', 'pricelist_id').then(res => {
        if (res.success && res.options) {
          setPricelistOptions(res.options)
        }
      }).finally(() => setIsLoadingPricelists(false))

      // 4. Get payment terms
      getOdooFieldValueOptions('sale.order', 'payment_term_id').then(res => {
        if (res.success && res.options) {
          setPaymentTermOptions(res.options)
        }
      }).finally(() => setIsLoadingPaymentTerms(false))

      // 5. Get products (for shipping & discount selection)
      getOdooFieldValueOptions('sale.order.line', 'product_id').then(res => {
        if (res.success && res.options) {
          setProductOptions(res.options)
        }
      }).finally(() => setIsLoadingProducts(false))
    })
  }, [hasOdooConnection, standardSubTab])

  // Load saved settings
  useEffect(() => {
    if (standardSubTab === 'orders') {
      setOrderStateMapping({})
    }
    getStandardMappingSettings(standardStoreTab, standardSubTab).then(res => {
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
          setOrderAutoInvoice(false)
          setOrderPartialFulfillment(false)
          setStoreWarehouseMappings({})
          setOrderStateMapping({})
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
        setProductEnabledActions(s.enabled_actions || (s.disabled ? [] : ['create', 'update', 'delete']))
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
        setCustomerEnabledActions(s.enabled_actions || (s.disabled ? [] : ['create', 'update', 'delete']))
        setCustomerDisabled(s.disabled || false)
        setCustomerDefaultType(s.customer_type || 'auto')
        setReceivableAccountId(s.receivable_account_id ? String(s.receivable_account_id) : '')
        setPayableAccountId(s.payable_account_id ? String(s.payable_account_id) : '')
        setCustomerCompanyId(s.company_id ? String(s.company_id) : '')
        setCustomerLinkCompany(s.link_company !== false)
      } else if (standardSubTab === 'orders') {
        setOrderDisabled(s.disabled || false)
        setOrderEnabledActions(s.enabled_actions || (s.disabled ? [] : ['create', 'update', 'cancel', 'deliver']))
        setOrderMatchZidField(s.match_zid_field || '')
        setOrderMatchOdooField(s.match_odoo_field || '')
        setOrderCompanyId(s.company_id ? String(s.company_id) : '')
        setOrderLinkCompany(s.link_company !== false)
        setOrderWarehouseId(s.order?.default_warehouse_id ? String(s.order.default_warehouse_id) : '')
        setOrderPricelistId(s.order?.default_pricelist_id ? String(s.order.default_pricelist_id) : '')
        setOrderPaymentTermId(s.order?.default_payment_term_id ? String(s.order.default_payment_term_id) : '')
        setOrderAutoConfirm(s.order?.auto_confirm || false)
        setOrderAutoInvoice(s.order?.auto_invoice || false)
        setOrderPartialFulfillment(s.order?.partial_fulfillment || false)
        setStoreWarehouseMappings(s.order?.store_warehouse_mappings || {})

        setOrderAddShipping(s.add_shipping_as_line || false)
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

      }
    })
    // Load order status mappings from the dedicated table for Orders
    if (standardSubTab === 'orders') {
      getOrderStatusMappings(standardStoreTab).then(res => {
        const raw: Record<string, unknown> = (res.success ? (res.mappings || {}) : {}) as Record<string, unknown>
        const normalized: Record<string, { state: string; enabled: boolean }> = {}
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === 'string') normalized[k] = { state: v, enabled: true }
          else if (v && typeof v === 'object') {
            const o = v as { state?: unknown; enabled?: unknown }
            normalized[k] = { state: String(o.state || ''), enabled: o.enabled !== false }
          }
        }
        setOrderStateMapping(normalized)
      })
    }
  }, [standardStoreTab, standardSubTab])

  // Load Zid locations, Odoo internal locations & existing pairing rows
  // for the Odoo → Zid inventory sync (Products tab, Zid store only).
  const loadInventorySyncData = useCallback(async () => {
    if (standardStoreTab !== 'zid' || standardSubTab !== 'products') return
    setIsLoadingInvSync(true)
    try {
      const [zRes, oRes, wRes] = await Promise.all([
        getZidLocations(),
        getOdooLocations('internal'),
        getStaticMappings('warehouse_mappings', 'zid'),
      ])
      if (zRes.success && zRes.locations) setZidLocations(zRes.locations)
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
  }, [standardStoreTab, standardSubTab])

  useEffect(() => {
    loadInventorySyncData()
  }, [loadInventorySyncData])

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
    })
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
  }, [costMethod, inventoryValuation, onDeleteAction, matchZidField, matchOdooField, enabledActions, disabled, categoryCompanyId, categoryLinkCompany, standardStoreTab, standardSubTab, lang, toast])

  const handleSaveProducts = useCallback(async () => {
    setIsSavingProducts(true)
    const settingsPayload: Record<string, any> = {
      product_type: { default_type: productType },
      inventory: {
        track_inventory: trackInventory,
        tracking: trackingMethod,
        // مزامنة المخزون (من أودو إلى زد) — أودو مصدر الحقيقة عند التفعيل
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
      enabled_actions: productEnabledActions,
      disabled: productDisabled,
      company_id: productCompanyId ? Number(productCompanyId) : null,
      link_company: productLinkCompany,
    }
    const res = await saveStandardMappingSettings(standardStoreTab, standardSubTab, settingsPayload)
    const saveOk = !!res?.success

    // Webhook lifecycle: register the stock.quant automation when the toggle
    // turns ON, unregister it when the toggle turns OFF (Zid store only).
    if (saveOk && standardStoreTab === 'zid') {
      if (invSyncEnabled && !odooStockWebhook) {
        setIsSyncingWebhook(true)
        setInvSyncWebhookError('')
        try {
          const wRes = await enableOdooStockWebhook()
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
          const wRes = await disableOdooStockWebhook()
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
    standardStoreTab, standardSubTab, lang, toast,
  ])

  // ── Odoo → Zid inventory-sync pair handlers ────────────────────────────────

  const handleAddPair = useCallback(() => {
    setInvSyncPairs(prev => [
      ...prev,
      { source_location_id: '', source_location_name: '', odoo_location_id: '', _removed: false },
    ])
  }, [])

  const handlePairChange = useCallback((
    index: number,
    field: 'source_location_id' | 'source_location_name' | 'odoo_location_id',
    value: string
  ) => {
    setInvSyncPairs(prev => prev.map((row, i) => {
      if (i !== index) return row
      const next = { ...row, [field]: value }
      if (field === 'source_location_id') {
        const loc = zidLocations.find(l => l.id === value)
        next.source_location_name = loc ? loc.name : ''
      }
      return next
    }))
  }, [zidLocations])

  const handleRemovePair = useCallback((index: number) => {
    setInvSyncPairs(prev => prev.map((row, i) => i === index ? { ...row, _removed: true } : row))
  }, [])

  const handleSavePairs = useCallback(async () => {
    setIsSavingPairs(true)
    setInvSyncWebhookError('')
    let failed = 0
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
        if (!src || !odoo) continue
        const save = await saveStaticMapping(
          'warehouse_mappings',
          {
            id: row.id || undefined,
            source_location_id: src,
            source_location_name: row.source_location_name || row.source_location_id,
            odoo_location_id: Number(odoo),
          },
          'zid'
        )
        if (!save.success) failed++
      }
      await loadInventorySyncData()
      if (failed === 0) {
        toast({
          title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
          description: lang === 'ar' ? 'تم حفظ ربط المواقع بنجاح' : 'Location pairing saved successfully',
        })
      } else {
        setInvSyncWebhookError(lang === 'ar' ? 'فشل حفظ بعض أزواج المواقع' : 'Some pairs failed to save')
      }
    } catch (err: any) {
      setInvSyncWebhookError(String(err?.message || err))
    } finally {
      setIsSavingPairs(false)
    }
  }, [invSyncPairs, loadInventorySyncData, lang, toast])

  // ── Odoo stock Webhook (إنشاء/حذف استقبال تغييرات الكميات) ─────────────────

  const handleCreateOdooWebhook = useCallback(async () => {
    setIsSyncingWebhook(true)
    setInvSyncWebhookError('')
    try {
      const wRes = await enableOdooStockWebhook()
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
  }, [lang, toast])

  const handleDeleteOdooWebhook = useCallback(async () => {
    setIsSyncingWebhook(true)
    setInvSyncWebhookError('')
    try {
      const wRes = await disableOdooStockWebhook()
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
  }, [lang, toast])

  const handleSaveCustomers = useCallback(async () => {
    setIsSavingCustomers(true)
    const settingsPayload: Record<string, any> = {
      customer_type: customerDefaultType,
      on_delete: customerOnDelete,
      match_zid_field: customerMatchZidField,
      match_odoo_field: customerMatchOdooField,
      enabled_actions: customerEnabledActions,
      disabled: customerDisabled,
      receivable_account_id: receivableAccountId ? Number(receivableAccountId) : null,
      payable_account_id: payableAccountId ? Number(payableAccountId) : null,
      company_id: customerCompanyId ? Number(customerCompanyId) : null,
      link_company: customerLinkCompany,
    }
    const res = await saveStandardMappingSettings(standardStoreTab, standardSubTab, settingsPayload)
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
    if (orderAddShipping && !orderShippingProductId && !orderShippingProductSku) {
      warnings.push(lang === 'ar' ? 'تم تفعيل الشحن كبند لكن لم يتم تحديد منتج الشحن أو SKU' : 'Shipping as line item is enabled but no shipping product or SKU set')
    }
    if (orderAddCod && !orderCodProductId && !orderCodProductSku) {
      warnings.push(lang === 'ar' ? 'تم تفعيل رسوم الدفع عند الاستلام لكن لم يتم تحديد المنتج أو SKU' : 'COD fee line is enabled but no COD product or SKU set')
    }
    if (orderAddDiscount && !orderDiscountProductId && !orderDiscountProductSku) {
      warnings.push(lang === 'ar' ? 'تم تفعيل الخصم كبند لكن لم يتم تحديد منتج الخصم أو SKU' : 'Discount as line item is enabled but no discount product or SKU set')
    }

    const settingsPayload: Record<string, any> = {
      disabled: orderDisabled,
      enabled_actions: orderEnabledActions,
      match_zid_field: orderMatchZidField,
      match_odoo_field: orderMatchOdooField,
      company_id: orderCompanyId ? Number(orderCompanyId) : null,
      link_company: orderLinkCompany,
      add_shipping_as_line: orderAddShipping,
      shipping_product_id: orderShippingProductId ? Number(orderShippingProductId) : null,
      shipping_product_sku: orderShippingProductSku,
      add_cod_as_line: orderAddCod,
      cod_product_id: orderCodProductId ? Number(orderCodProductId) : null,
      cod_product_sku: orderCodProductSku,
      cod_amount: orderCodAmount ? Number(orderCodAmount) : null,
      add_discount_as_line: orderAddDiscount,
      discount_product_id: orderDiscountProductId ? Number(orderDiscountProductId) : null,
      discount_product_sku: orderDiscountProductSku,
      discount_mode: orderDiscountMode,
      order: {
        default_warehouse_id: orderWarehouseId ? Number(orderWarehouseId) : null,
        default_pricelist_id: orderPricelistId ? Number(orderPricelistId) : null,
        default_payment_term_id: orderPaymentTermId ? Number(orderPaymentTermId) : null,
        auto_confirm: orderAutoConfirm,
        auto_invoice: orderAutoInvoice,
        partial_fulfillment: orderPartialFulfillment,
        store_warehouse_mappings: storeWarehouseMappings,
      }
    }
    // Save settings first, then mappings (if settings fails, stop early)
    const settingsRes = await saveStandardMappingSettings(standardStoreTab, standardSubTab, settingsPayload)
    if (!settingsRes?.success) {
      toast({
        title: lang === 'ar' ? 'خطأ في حفظ الإعدادات' : 'Save Error',
        description: settingsRes?.error || (lang === 'ar' ? 'فشل حفظ الإعدادات' : 'Failed to save settings'),
        variant: 'destructive',
      })
      setIsSavingOrders(false)
      return
    }
    const mappingsRes = await saveOrderStatusMappings(standardStoreTab, orderStateMapping)
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
    orderAutoConfirm, orderAutoInvoice, orderPartialFulfillment, storeWarehouseMappings, orderAddShipping, orderShippingProductId, orderShippingProductSku,
    orderAddCod, orderCodProductId, orderCodProductSku, orderCodAmount,
    orderAddDiscount, orderDiscountProductId, orderDiscountProductSku, orderDiscountMode,
    orderStateMapping, standardStoreTab, standardSubTab, lang, toast
  ])

  const storeTabs = [
    { key: 'zid', labelAr: 'زد', labelEn: 'Zid', connected: isZidConnected },
    { key: 'salla', labelAr: 'سله', labelEn: 'Salla', connected: isSallaConnected },
    { key: 'shopify', labelAr: 'شوبيفاي', labelEn: 'Shopify', connected: isShopifyConnected },
  ]

  // Logs state
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [logMappingId, setLogMappingId] = useState<string | undefined>(undefined)
  const [logMappingName, setLogMappingName] = useState<string | undefined>(undefined)
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

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const res = await deleteFieldMapping(id)
      if (res.success) {
        setMappings(prev => prev.filter(m => m.id !== id))
        setDeleteConfirmId(null)
      }
    } catch (err) {
      console.error('Failed to delete mapping:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  const getEventName = (eventId: string) => {
    const found = ZID_EVENTS.find((e: any) => e.id === eventId) || SALLA_EVENTS.find((e: any) => e.id === eventId) || SHOPIFY_EVENTS.find((e: any) => e.id === eventId)
    return found ? formatFieldLabel(found.name, lang) : eventId
  }

  // Detect if action belongs to Zid, Salla or Shopify
  const getPlatformSource = (action: string): 'zid' | 'salla' | 'shopify' => {
    if (action.includes('/') || action.startsWith('shopify:')) return 'shopify'
    if (SALLA_EVENTS.find(e => e.id === action)) return 'salla'
    if (SHOPIFY_EVENTS.find(e => e.id === action)) return 'shopify'
    return 'zid'
  }

  // Count total fields in all mappings nested object
  const countTotalMappedFields = (mappingsObj: any) => {
    if (!mappingsObj) return 0
    let total = 0
    Object.values(mappingsObj).forEach((arr: any) => {
      if (Array.isArray(arr)) {
        total += arr.length
      }
    })
    return total
  }

  // Filtered mappings based on selected filters
  const filteredMappings = mappings.filter(item => {
    // 1. Platform Filter (Store Filter)
    if (platformFilter.length > 0) {
      if (!platformFilter.includes(getPlatformSource(item.action))) return false
    }

    // 2. Search Query (Name, Model, Event Name)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const nameMatch = (item.name || '').toLowerCase().includes(q)
      const modelMatch = (item.odoo_model || '').toLowerCase().includes(q)
      const eventMatch = getEventName(item.action).toLowerCase().includes(q)
      if (!nameMatch && !modelMatch && !eventMatch) return false
    }

    // 3. Direction Filter
    if (directionFilter.length > 0) {
      const dirs = (item.sync_direction || 'store_to_erp').split(',').map((s: string) => s.trim())
      const hasMatch = directionFilter.some(dir => {
        if (dir === 'both') {
          return dirs.includes('store_to_erp') && dirs.includes('erp_to_store')
        }
        return dirs.includes(dir)
      })
      if (!hasMatch) return false
    }

    // 4. Operation Filter
    if (operationFilter.length > 0) {
      if (!operationFilter.includes(item.odoo_operation)) return false
    }

    return true
  })


  if (view === 'create') {
    return (
      <div className="space-y-4" dir={dir}>
        <Button 
          variant="ghost" 
          onClick={() => setView('list')} 
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg mb-2"
        >
          <ArrowRight className={cn("h-4 w-4", lang === 'ar' ? "rotate-0" : "rotate-180")} />
          {lang === 'ar' ? 'العودة للقائمة' : 'Back to List'}
        </Button>
        <FieldMappingForm
          initialModels={initialModels}
          hasOdooConnection={hasOdooConnection}
          erpType={erpType}
          preloadedModel={preloadedModel}
          preloadedFields={preloadedFields}
          isZidConnected={isZidConnected}
          isSallaConnected={isSallaConnected}
          isShopifyConnected={isShopifyConnected}
          allMappings={mappings}
          onCancel={() => setView('list')}
          onSuccess={() => {
            loadMappings()
            setView('list')
          }}
        />
      </div>
    )
  }

  if (view === 'edit' && selectedMapping) {
    // Extract related models from mappings keys other than primary odoo_model
    const allModelKeys = Object.keys(selectedMapping.mappings || {}).filter(k => k !== '__settings')
    const primaryModel = selectedMapping.odoo_model
    const initialRelated = allModelKeys.filter(k => k !== primaryModel)

    return (
      <div className="space-y-4" dir={dir}>
        <Button 
          variant="ghost" 
          onClick={() => {
            setSelectedMapping(null)
            setView('list')
          }} 
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg mb-2"
        >
          <ArrowRight className={cn("h-4 w-4", lang === 'ar' ? "rotate-0" : "rotate-180")} />
          {lang === 'ar' ? 'العودة للقائمة' : 'Back to List'}
        </Button>
        <FieldMappingForm
          initialModels={initialModels}
          hasOdooConnection={hasOdooConnection}
          erpType={erpType}
          preloadedModel={preloadedModel}
          preloadedFields={preloadedFields}
          isZidConnected={isZidConnected}
          isSallaConnected={isSallaConnected}
          isShopifyConnected={isShopifyConnected}
          editingId={selectedMapping.id}
          initialName={selectedMapping.name}
          initialAction={selectedMapping.action}
          initialOdooModel={selectedMapping.odoo_model}
          initialOdooOperation={selectedMapping.odoo_operation || 'create'}
          initialOdooMatchField={selectedMapping.odoo_match_field || ''}
          initialZidMatchField={selectedMapping.zid_match_field || ''}
          initialOdooFallbackPolicy={selectedMapping.odoo_fallback_policy || 'none'}
          initialOdooVariantSyncMode={selectedMapping.variant_sync_mode || 'AS_VARIANTS'}
          initialOdooVariantOdooMatchField={selectedMapping.variant_odoo_match_field || ''}
          initialOdooVariantZidMatchField={selectedMapping.variant_zid_match_field || ''}
          initialMappings={selectedMapping.mappings}
          initialRelatedModels={initialRelated}
          initialSyncDirection={selectedMapping.sync_direction || 'store_to_erp'}
          allMappings={mappings}
          onCancel={() => {
            setSelectedMapping(null)
            setView('list')
          }}
          onSuccess={() => {
            setSelectedMapping(null)
            loadMappings()
            setView('list')
          }}
        />
      </div>
    )
  }

  const storeOptions = [
    ...(isZidConnected ? [{ value: 'zid', label: zidStoreName || (lang === 'ar' ? 'متجر زد (Zid)' : 'Zid Store') }] : []),
    ...(isSallaConnected ? [{ value: 'salla', label: sallaStoreName || (lang === 'ar' ? 'متجر سلة (Salla)' : 'Salla Store') }] : []),
    ...(isShopifyConnected ? [{ value: 'shopify', label: shopifyStoreName || (lang === 'ar' ? 'متجر شوبيفاي (Shopify)' : 'Shopify Store') }] : [])
  ]

  const getErpLabel = (type: string) => {
    if (type === 'odoo') return lang === 'ar' ? 'لأودو' : 'Odoo'
    if (type === 'zoho') return lang === 'ar' ? 'لزهو' : 'Zoho'
    if (type === 'erpnext') return lang === 'ar' ? 'لـ ERPNext' : 'ERPNext'
    return lang === 'ar' ? 'لأودو' : 'Odoo'
  }
  const getErpFromLabel = (type: string) => {
    if (type === 'odoo') return lang === 'ar' ? 'أودو' : 'Odoo'
    if (type === 'zoho') return lang === 'ar' ? 'زوهو' : 'Zoho'
    if (type === 'erpnext') return lang === 'ar' ? 'ERPNext' : 'ERPNext'
    return lang === 'ar' ? 'أودو' : 'Odoo'
  }

  const directionOptions = [
    { value: 'store_to_erp', label: lang === 'ar' ? `من المتجر ${getErpLabel(erpType)}` : `Store to ${getErpFromLabel(erpType)}` },
    { value: 'erp_to_store', label: lang === 'ar' ? `من ${getErpFromLabel(erpType)} للمتجر` : `${getErpFromLabel(erpType)} to Store` },
    { value: 'both', label: lang === 'ar' ? 'كلا الاتجاهين (مزدوج)' : 'Both Directions (Dual)' }
  ]

  const operationOptions = [
    { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
    { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
    { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' }
  ]

  return (
    <>
      {/* ── Fixed Header ─────────────────────────────────────── */}
      <div
        className="fixed top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        style={{ insetInlineStart: '200px', insetInlineEnd: '0px' }}
      >
        {/* ── Row 1: Page Tabs ──────────────────────────────── */}
        <div className="flex items-center gap-0.5 px-6 h-14">
          {/* Page Title */}
          <span className={cn(
            'text-sm font-bold text-foreground tracking-tight shrink-0',
            dir === 'rtl' ? 'ml-6' : 'mr-6'
          )}>
            {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
          </span>
          <div className="h-5 w-px bg-border/60" />
          {[
            {
              key: 'standard' as const,
              labelAr: 'ستاندرد مابينج',
              labelEn: 'Standard Mapping',
              icon: <ArrowRightLeft className="h-4 w-4" />,
            },
            {
              key: 'mapping' as const,
              labelAr: 'تخصيص الربط',
              labelEn: 'Custom Mapping',
              icon: <SlidersHorizontal className="h-4 w-4" />,
            },
            ...(erpType === 'odoo' || erpType === 'erpnext' ? [{
              key: 'addfield' as const,
              labelAr: 'إضافة حقل',
              labelEn: 'Add Field',
              icon: <Puzzle className="h-4 w-4" />,
            }] : []),
            {
              key: 'values' as const,
              labelAr: 'تحويل القيم',
              labelEn: 'Value Mapping',
              icon: <Database className="h-4 w-4" />,
            },
          ].map((tab) => {
            const isActive = pageTab === tab.key
            const mappingCount = tab.key === 'mapping' ? mappings.length : null
            return (
            <button
              key={tab.key}
              onClick={() => setPageTab(tab.key as any)}
              className={cn(
                'relative flex items-center gap-2 px-4 h-14 text-sm font-semibold transition-all duration-200 border-b-2',
                isActive
                  ? 'text-foreground border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/30'
              )}
            >
              <span className="flex items-center gap-1.5">
                {tab.icon}
                <span>{lang === 'ar' ? tab.labelAr : tab.labelEn}</span>
              </span>
              {mappingCount !== null && (
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[9px] font-bold',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted-foreground/10 text-muted-foreground'
                )}>
                  {mappingCount}
                </span>
              )}
            </button>
            )
          })}
        </div>

        {/* ── Row 2: Standard Entity Tabs (only when on Standard tab) ── */}
        {pageTab === 'standard' && (
          <div className="flex items-center gap-0.5 px-6 h-10 border-t border-border/50 bg-muted/20">
            {[
              { key: 'categories', labelAr: 'كاتيجوري', labelEn: 'Categories', icon: <FolderTree className="h-3.5 w-3.5" /> },
              { key: 'products', labelAr: 'المنتجات', labelEn: 'Products', icon: <Package className="h-3.5 w-3.5" /> },
              { key: 'customers', labelAr: 'العملاء', labelEn: 'Customers', icon: <Users className="h-3.5 w-3.5" /> },
              { key: 'orders', labelAr: 'الاوردرات', labelEn: 'Orders', icon: <ShoppingCart className="h-3.5 w-3.5" /> },
            ].map((item) => {
              if (item.key === 'orders') {
                return (
                  <React.Fragment key="orders-group">
                    <button
                      onClick={() => setStandardSubTab('orders')}
                      className={cn(
                        'relative flex items-center gap-1.5 px-3 h-10 text-xs font-semibold transition-all duration-200 border-b-2',
                        standardSubTab === 'orders'
                          ? 'text-foreground border-primary'
                          : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/30'
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <ShoppingCart className="h-3.5 w-3.5" />
                        <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                      </span>
                    </button>
                    <Link
                      href="/dashboard/mapping-center/stock"
                      className="relative flex items-center gap-1.5 px-3 h-10 text-xs font-semibold transition-all duration-200 border-b-2 text-amber-600 border-transparent hover:text-amber-700 hover:border-amber-400/50"
                    >
                      <Activity className="h-3.5 w-3.5" />
                      <span>{lang === 'ar' ? 'المخزون' : 'Stock'}</span>
                    </Link>
                  </React.Fragment>
                )
              }
              return (
              <button
                key={item.key}
                onClick={() => setStandardSubTab(item.key as any)}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 h-10 text-xs font-semibold transition-all duration-200 border-b-2',
                  standardSubTab === item.key
                    ? 'text-foreground border-primary'
                    : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/30'
                )}
              >
                <span className="flex items-center gap-1.5">
                  {item.icon}
                  <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
                </span>
              </button>
            )
            })}
          </div>
        )}
      </div>

      {/* ── Scrollable Content ──────────────────────────────── */}
      <div className={cn("max-w-7xl mx-auto space-y-5 font-sans", pageTab === 'standard' ? 'pt-[73px] md:pt-[65px]' : 'pt-[33px] md:pt-[25px]')} dir={dir}>

      <AnimatePresence mode="wait">
      {pageTab === 'standard' ? (
        <motion.div
          key="standard-tab"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <div className="flex flex-col gap-4">

            {/* ── Title ────────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-muted-foreground">
                  {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
                </span>
                <span className="text-muted-foreground/30 text-xs">{'/'}</span>
                <h1 className="text-xl font-extrabold tracking-tight text-foreground">
                  {lang === 'ar'
                    ? ({ categories: 'كاتيجوري', products: 'المنتجات', customers: 'العملاء', orders: 'الاوردرات' } as any)[standardSubTab]
                    : ({ categories: 'Categories', products: 'Products', customers: 'Customers', orders: 'Orders' } as any)[standardSubTab]}
                </h1>
              </div>
              <p className="text-muted-foreground text-[11px]">
                {lang === 'ar' ? 'إعدادات الربط الافتراضية' : 'Default mapping settings'}
              </p>
            </div>

              {/* ── Settings Panel ─────────────────────────── */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={standardSubTab}
                      initial={{ opacity: 0, x: lang === 'ar' ? -20 : 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: lang === 'ar' ? -20 : 20 }}
                      transition={{ duration: 0.2 }}
                      className="space-y-4"
                    >
                      <div className="card-base overflow-hidden">
                        {/* ── Store Tabs ───────────────────────── */}
                        <div className="flex px-4 border-b border-border/50 bg-muted/20">
                          {storeTabs.map((store) => (
                            <button
                              key={store.key}
                              onClick={() => setStandardStoreTab(store.key)}
                              className={cn(
                                'relative flex items-center gap-2 px-3 h-9 text-xs font-semibold transition-all duration-200 border-b-2',
                                standardStoreTab === store.key
                                  ? 'text-foreground border-primary'
                                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/30',
                                !store.connected && 'opacity-35'
                              )}
                            >
                              <span className={cn(
                                'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                                store.connected ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                              )} />
                              <span>{lang === 'ar' ? store.labelAr : store.labelEn}</span>
                            </button>
                          ))}
                        </div>

                        {/* ── Store Content ────────────────────── */}
                        <div className="min-h-[250px] p-6">
                          {storeTabs.find(s => s.key === standardStoreTab)?.connected ? (
                            standardSubTab === 'categories' ? (
                              <div className="space-y-5">
                                {/* Section Header */}
                                <div>
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'تقييم المخزون' : 'Inventory Valuation'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {lang === 'ar'
                                      ? 'إعدادات تقييم المخزون الافتراضية عند إنشاء كاتيجوري جديدة في أودو'
                                      : 'Default inventory valuation settings when creating a new category in Odoo'}
                                  </p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                  {/* Costing Method */}
                                  <div className="space-y-1.5">
                                    <label className="block text-xs font-semibold text-muted-foreground">
                                      {lang === 'ar' ? 'Costing Method' : 'Costing Method'}
                                    </label>
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={costMethod}
                                      onChange={e => setCostMethod(e.target.value)}
                                    >
                                      <option value="">
                                        {lang === 'ar' ? '— استخدم الإعداد الافتراضي في أودو —' : '— Use Odoo default —'}
                                      </option>
                                      {isLoadingOdooOpts ? (
                                        <option disabled>
                                          {lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}
                                        </option>
                                      ) : costMethodOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Inventory Valuation */}
                                  <div className="space-y-1.5">
                                    <label className="block text-xs font-semibold text-muted-foreground">
                                      {lang === 'ar' ? 'Inventory Valuation' : 'Inventory Valuation'}
                                    </label>
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={inventoryValuation}
                                      onChange={e => setInventoryValuation(e.target.value)}
                                    >
                                      <option value="">
                                        {lang === 'ar' ? '— استخدم الإعداد الافتراضي في أودو —' : '— Use Odoo default —'}
                                      </option>
                                      {isLoadingOdooOpts ? (
                                        <option disabled>
                                          {lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}
                                        </option>
                                      ) : valuationOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                {/* Company Section */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'تحديد الشركة التابع لها عند إنشاء الكاتيجوري في أودو'
                                      : 'Specify the Odoo company associated with categories'}
                                  </p>
                                  <div className="space-y-1.5 max-w-xs">
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={categoryCompanyId}
                                      onChange={e => setCategoryCompanyId(e.target.value)}
                                      disabled={isLoadingCompanies}
                                    >
                                      <option value="">
                                        {lang === 'ar' ? '— اختر الشركة (اختياري) —' : '— Select Company (Optional) —'}
                                      </option>
                                      {companyOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  {categoryCompanyId && (
                                    <div className="flex items-center gap-2 mt-3">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={categoryLinkCompany}
                                        onClick={() => setCategoryLinkCompany(!categoryLinkCompany)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          categoryLinkCompany ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          categoryLinkCompany ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <span className="text-xs text-muted-foreground">
                                        {lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                {/* On Delete Section */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'عند حذف الكاتيجوري في زد' : 'On Category Deletion in Zid'}
                                  </h3>
                                  <div className="mt-3">
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={onDeleteAction}
                                      onChange={e => setOnDeleteAction(e.target.value)}
                                    >
                                      {[
                                        { value: 'nothing', labelAr: 'لا شيء', labelEn: 'Nothing' },
                                        { value: 'delete', labelAr: 'حذف', labelEn: 'Delete' },
                                        { value: 'archive', labelAr: 'أرشفة', labelEn: 'Archive' },
                                        { value: 'delete_or_archive', labelAr: 'محاولة الحذف فإن لم تنجح يعمل أرشفة', labelEn: 'Try Delete, then Archive' },
                                      ].map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                          {lang === 'ar' ? opt.labelAr : opt.labelEn}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                {/* Match Field Section */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'حقل المطابقة' : 'Match Field'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'حدد أي حقل من زد يطابق أي حقل في أودو للتعرف على الكاتيجوري'
                                      : 'Select which Zid field matches which Odoo field to identify the category'}
                                  </p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'حقل زد' : 'Zid Field'}
                                      </label>
                                      <SearchableSelect
                                        options={categoryFields}
                                        value={matchZidField}
                                        onChange={setMatchZidField}
                                        placeholder={lang === 'ar' ? '— اختر حقل زد —' : '— Select Zid field —'}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-xs font-semibold text-muted-foreground">
                                          {lang === 'ar' ? 'حقل أودو' : 'Odoo Field'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => fetchOdooCategoryFields(true)}
                                          disabled={isLoadingOdooFields}
                                          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                          title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
                                        >
                                          <RefreshCw className={cn("h-3 w-3", isLoadingOdooFields && "animate-spin")} />
                                        </button>
                                      </div>
                                      <SearchableSelect
                                        options={odooCategoryFields}
                                        value={matchOdooField}
                                        onChange={setMatchOdooField}
                                        placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
                                        disabled={isLoadingOdooFields}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Sync Actions Section */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'إعدادات المزامنة' : 'Sync Actions'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'حدد عمليات المزامنة المسموح بها للكاتيجوري'
                                      : 'Select which sync operations are enabled for categories'}
                                  </p>
                                  <div className="space-y-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'العمليات المسموح بها' : 'Allowed Operations'}
                                      </label>
                                      {(() => {
                                        const syncActionOptions = [
                                          { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
                                          { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
                                          { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
                                        ]
                                        return (
                                          <SearchableSelect
                                            multiple={true}
                                            collapseTags={false}
                                            value={enabledActions}
                                            onChange={setEnabledActions}
                                            options={syncActionOptions}
                                            disabled={disabled}
                                            placeholder={lang === 'ar'
                                              ? (disabled ? '— المزامنة معطلة —' : '— اختر العمليات —')
                                              : (disabled ? '— Sync is disabled —' : '— Select operations —')}
                                          />
                                        )
                                      })()}
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={!disabled}
                                        onClick={() => setDisabled(!disabled)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          !disabled ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span
                                          className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            !disabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )}
                                        />
                                      </button>
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar'
                                          ? (disabled ? 'تعطيل مزامنة الكاتيجوري' : 'تفعيل مزامنة الكاتيجوري')
                                          : (disabled ? 'Disable category sync' : 'Enable category sync')}
                                      </span>
                                    </div>
                                    {disabled && (
                                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                        {lang === 'ar'
                                          ? 'عند تعطيل المزامنة، لن يتم إنشاء أو تعديل أو حذف أي كاتيجوري في أودو.'
                                          : 'When disabled, no categories will be created, updated, or deleted in Odoo.'}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* ── Save & Log Buttons ───────────────── */}
                                <div className="border-t border-border/80 pt-5 flex items-center gap-2">
                                  <Button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="bg-foreground text-background gap-1.5 font-semibold rounded-lg h-9 text-xs px-6"
                                  >
                                    {isSaving ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <>{lang === 'ar' ? 'حفظ الإعدادات' : 'Save Settings'}</>
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsCategoryMappingOpen(true)}
                                    className="gap-1.5 rounded-lg h-9 text-xs px-4"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    {lang === 'ar' ? 'ربط يدوي' : 'Manual Mapping'}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsCategoryLogOpen(true)}
                                    className="gap-1.5 rounded-lg h-9 text-xs px-4"
                                  >
                                    <History className="h-3.5 w-3.5" />
                                    {lang === 'ar' ? 'سجل المزامنة' : 'Sync Log'}
                                  </Button>
                                </div>
                              </div>
                            ) : standardSubTab === 'products' ? (
                              <div className="space-y-5">

                                {/* ═══ 1. Product Type & Inventory ═══ */}
                                <div>
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'نوع المنتج والمخزون' : 'Product Type & Inventory'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {lang === 'ar'
                                      ? 'إعدادات نوع المنتج الافتراضية وتتبع المخزون'
                                      : 'Default product type and inventory tracking settings'}
                                  </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <label className="block text-xs font-semibold text-muted-foreground">
                                      {lang === 'ar' ? 'نوع المنتج الافتراضي' : 'Default Product Type'}
                                    </label>
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={productType}
                                      onChange={e => setProductType(e.target.value)}
                                    >
                                      <option value="">
                                        {lang === 'ar' ? '— استخدم الإعداد الافتراضي في أودو —' : '— Use Odoo default —'}
                                      </option>
                                      {isLoadingProductOpts ? (
                                        <option disabled>{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</option>
                                      ) : productTypeOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="block text-xs font-semibold text-muted-foreground">
                                      {lang === 'ar' ? 'تتبع المخزون' : 'Track Inventory'}
                                    </label>
                                    <div className="flex items-center gap-3 h-9">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={trackInventory}
                                        onClick={() => setTrackInventory(!trackInventory)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          trackInventory ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          trackInventory ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <span className="text-xs text-muted-foreground">
                                        {trackInventory
                                          ? (lang === 'ar' ? 'نعم' : 'Yes')
                                          : (lang === 'ar' ? 'لا' : 'No')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                {trackInventory && (
                                  <div className="grid grid-cols-1 gap-4">
                                    <div className="space-y-1.5 max-w-xs">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'طريقة التتبع' : 'Tracking Method'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={trackingMethod}
                                        onChange={e => setTrackingMethod(e.target.value)}
                                      >
                                        <option value="">
                                          {lang === 'ar' ? '— لا شيء —' : '— None —'}
                                        </option>
                                        {trackingOptions.map(opt => (
                                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                )}

                                 {/* Company Selection */}
                                 <div className="border-t border-border/80 pt-5">
                                   <div className="flex items-center gap-2 max-w-xs justify-between">
                                     <h3 className="text-sm font-bold text-muted-foreground">
                                       {lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'}
                                     </h3>
                                     <button
                                       type="button"
                                       onClick={fetchCompanies}
                                       disabled={isLoadingCompanies}
                                       className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                       title={lang === 'ar' ? 'تحديث الشركات' : 'Refresh Companies'}
                                     >
                                       <RefreshCw className={cn("h-3 w-3", isLoadingCompanies && "animate-spin")} />
                                     </button>
                                   </div>
                                   <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                     {lang === 'ar'
                                       ? 'تحديد الشركة التابع لها عند إنشاء المنتجات في أودو'
                                       : 'Specify the Odoo company associated with products'}
                                   </p>
                                   <div className="space-y-1.5 max-w-xs">
                                     <select
                                       className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                       value={productCompanyId}
                                       onChange={e => setProductCompanyId(e.target.value)}
                                       disabled={isLoadingCompanies}
                                     >
                                       <option value="">
                                         {lang === 'ar' ? '— اختر الشركة (اختياري) —' : '— Select Company (Optional) —'}
                                       </option>
                                       {companyOptions.map(opt => (
                                         <option key={opt.value} value={opt.value}>{opt.label}</option>
                                       ))}
                                     </select>
                                   </div>
                                    {productCompanyId && (
                                      <div className="flex items-center gap-2 mt-3">
                                        <button
                                          type="button"
                                          role="switch"
                                          dir="ltr"
                                          aria-checked={productLinkCompany}
                                          onClick={() => setProductLinkCompany(!productLinkCompany)}
                                          className={cn(
                                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                            productLinkCompany ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                          )}
                                        >
                                          <span className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            productLinkCompany ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )} />
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                          {lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                                        </span>
                                      </div>
                                    )}
                                 </div>

                                {/* ═══ 2. Pricing ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'التسعير' : 'Pricing'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'إعدادات تحويل الأسعار والعلامات التجارية'
                                      : 'Price transformation and markup settings'}
                                  </p>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'نسبة الربح/الخصم %' : 'Markup/Discount %'}
                                      </label>
                                      <input
                                        type="number"
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={markupPercent}
                                        onChange={e => setMarkupPercent(Number(e.target.value))}
                                        placeholder="0"
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'مصدر التكلفة' : 'Cost Source'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={costSource}
                                        onChange={e => setCostSource(e.target.value)}
                                      >
                                        <option value="cost">{lang === 'ar' ? 'حقل التكلفة (cost)' : 'Cost field'}</option>
                                        <option value="price">{lang === 'ar' ? 'حقل السعر (price)' : 'Price field'}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'مصدر السعر' : 'Price Source'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={priceSource}
                                        onChange={e => setPriceSource(e.target.value)}
                                      >
                                        <option value="price">{lang === 'ar' ? 'السعر (price)' : 'Price'}</option>
                                        <option value="sale_price">{lang === 'ar' ? 'سعر التخفيض (sale_price)' : 'Sale Price'}</option>
                                        <option value="cost">{lang === 'ar' ? 'التكلفة (cost)' : 'Cost'}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'التقريب' : 'Rounding'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={rounding}
                                        onChange={e => setRounding(e.target.value)}
                                      >
                                        <option value="">{lang === 'ar' ? '— لا شيء —' : '— None —'}</option>
                                        <option value="nearest">{lang === 'ar' ? 'أقرب رقم' : 'Nearest'}</option>
                                        <option value="ceil">{lang === 'ar' ? 'رفع (Ceil)' : 'Ceil'}</option>
                                        <option value="floor">{lang === 'ar' ? 'خفض (Floor)' : 'Floor'}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'الخانات العشرية' : 'Decimal Places'}
                                      </label>
                                      <input
                                        type="number"
                                        min="0"
                                        max="6"
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={decimalPlaces}
                                        onChange={e => setDecimalPlaces(Number(e.target.value))}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* ═══ 3. Name & Description ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'الاسم والوصف' : 'Name & Description'}
                                  </h3>
                                  <div className="grid grid-cols-2 gap-4 mt-3">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'لغة الاسم' : 'Name Language'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={nameLanguage}
                                        onChange={e => setNameLanguage(e.target.value)}
                                      >
                                        <option value="ar">{lang === 'ar' ? 'العربية' : 'Arabic'}</option>
                                        <option value="en">{lang === 'ar' ? 'الإنجليزية' : 'English'}</option>
                                        <option value="both">{lang === 'ar' ? 'الاثنتين معاً' : 'Both'}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'الرجوع للغة الأخرى' : 'Fallback to Other'}
                                      </label>
                                      <div className="flex items-center gap-3 h-9">
                                        <button
                                          type="button"
                                          role="switch"
                                          dir="ltr"
                                          aria-checked={nameFallback}
                                          onClick={() => setNameFallback(!nameFallback)}
                                          className={cn(
                                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                            nameFallback ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                          )}
                                        >
                                          <span className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            nameFallback ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )} />
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                          {nameFallback
                                            ? (lang === 'ar' ? 'نعم' : 'Yes')
                                            : (lang === 'ar' ? 'لا' : 'No')}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'لغة الوصف' : 'Description Language'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={descLanguage}
                                        onChange={e => setDescLanguage(e.target.value)}
                                      >
                                        <option value="ar">{lang === 'ar' ? 'العربية' : 'Arabic'}</option>
                                        <option value="en">{lang === 'ar' ? 'الإنجليزية' : 'English'}</option>
                                        <option value="both">{lang === 'ar' ? 'الاثنتين معاً' : 'Both'}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'الرجوع في الوصف' : 'Description Fallback'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={descFallback}
                                        onChange={e => setDescFallback(e.target.value)}
                                      >
                                        <option value="none">{lang === 'ar' ? '— لا شيء —' : '— None —'}</option>
                                        <option value="name">{lang === 'ar' ? 'استخدام الاسم' : 'Use Name'}</option>
                                        <option value="custom">{lang === 'ar' ? 'نص مخصص' : 'Custom Text'}</option>
                                        <option value="empty">{lang === 'ar' ? 'ترك فارغاً' : 'Leave Empty'}</option>
                                      </select>
                                    </div>
                                    {descFallback === 'custom' && (
                                      <div className="col-span-2 space-y-1.5">
                                        <label className="block text-xs font-semibold text-muted-foreground">
                                          {lang === 'ar' ? 'النص المخصص' : 'Custom Text'}
                                        </label>
                                        <textarea
                                          className="w-full h-20 px-3 py-2 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all resize-none"
                                          value={descCustomText}
                                          onChange={e => setDescCustomText(e.target.value)}
                                          placeholder={lang === 'ar' ? 'أدخل نص الوصف المخصص...' : 'Enter custom description text...'}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* ═══ 4. Match Field ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'حقل المطابقة' : 'Match Field'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'حدد أي حقل من زد يطابق أي حقل في أودو للتعرف على المنتج'
                                      : 'Select which Zid field matches which Odoo field to identify the product'}
                                  </p>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'حقل زد' : 'Zid Field'}
                                      </label>
                                      <SearchableSelect
                                        options={productFields}
                                        value={productMatchZidField}
                                        onChange={setProductMatchZidField}
                                        placeholder={lang === 'ar' ? '— اختر حقل زد —' : '— Select Zid field —'}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-xs font-semibold text-muted-foreground">
                                          {lang === 'ar' ? 'حقل أودو' : 'Odoo Field'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => fetchOdooProductFields(true)}
                                          disabled={isLoadingProductFields}
                                          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                          title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
                                        >
                                          <RefreshCw className={cn("h-3 w-3", isLoadingProductFields && "animate-spin")} />
                                        </button>
                                      </div>
                                      <SearchableSelect
                                        options={productOdooFields}
                                        value={productMatchOdooField}
                                        onChange={setProductMatchOdooField}
                                        placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
                                        disabled={isLoadingProductFields}
                                      />
                                    </div>
                                  </div>
                                </div>
                                {/* ═══ 4.5. Product Variants Sync Mode ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground mb-3">
                                    {lang === 'ar' ? '📦 خيارات مزامنة المتغيرات (Product Variants)' : '📦 Product Variant Sync Mode'}
                                  </h3>
                                  <div className="space-y-3 text-start">
                                    <span className="text-[11px] text-muted-foreground block font-medium">
                                      {lang === 'ar' 
                                        ? 'حدد كيفية مزامنة المنتجات التي تحتوي على خيارات متعددة (مثل المقاس أو اللون) في أودو:' 
                                        : 'Choose how products with multiple variants (e.g. size or color) should be synced in Odoo:'}
                                    </span>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                                      <label className={cn(
                                        "flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 shadow-sm hover:shadow",
                                        productVariantSyncMode === 'AS_VARIANTS' 
                                          ? "bg-foreground/5 border-foreground text-foreground ring-1 ring-foreground/20" 
                                          : "bg-background border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground"
                                      )}>
                                        <input
                                          type="radio"
                                          name="productVariantSyncMode"
                                          value="AS_VARIANTS"
                                          checked={productVariantSyncMode === 'AS_VARIANTS'}
                                          onChange={() => setProductVariantSyncMode('AS_VARIANTS')}
                                          className="mt-1 h-4 w-4 text-foreground border-border focus:ring-foreground focus:ring-offset-0 focus:ring-0 cursor-pointer"
                                        />
                                        <div className="space-y-1">
                                          <span className="font-semibold block text-xs">
                                            {lang === 'ar' ? 'مزامنة كمنتج بمتغيرات (AS_VARIANTS)' : 'Sync as Product with Variants'}
                                          </span>
                                          <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                                            {lang === 'ar' 
                                              ? 'يتم إنشاء منتج رئيسي واحد في Odoo وربط الخيارات به كمتغيرات (مثل اللون والمقاس).' 
                                              : 'Creates a single main product template in Odoo and groups all option variants under it.'}
                                          </span>
                                        </div>
                                      </label>

                                      <label className={cn(
                                        "flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 shadow-sm hover:shadow",
                                        productVariantSyncMode === 'AS_SEPARATE_PRODUCTS' 
                                          ? "bg-foreground/5 border-foreground text-foreground ring-1 ring-foreground/20" 
                                          : "bg-background border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground"
                                      )}>
                                        <input
                                          type="radio"
                                          name="productVariantSyncMode"
                                          value="AS_SEPARATE_PRODUCTS"
                                          checked={productVariantSyncMode === 'AS_SEPARATE_PRODUCTS'}
                                          onChange={() => setProductVariantSyncMode('AS_SEPARATE_PRODUCTS')}
                                          className="mt-1 h-4 w-4 text-foreground border-border focus:ring-foreground focus:ring-offset-0 focus:ring-0 cursor-pointer"
                                        />
                                        <div className="space-y-1">
                                          <span className="font-semibold block text-xs">
                                            {lang === 'ar' ? 'مزامنة كمنتجات منفصلة (AS_SEPARATE_PRODUCTS)' : 'Sync as Separate Products'}
                                          </span>
                                          <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                                            {lang === 'ar' 
                                              ? 'يتم إنشاء كل متغير كمنتج مستقل تماماً في Odoo، ودمج اسم المتغير في اسم المنتج.' 
                                              : 'Creates a completely standalone product in Odoo for each variant option.'}
                                          </span>
                                        </div>
                                      </label>
                                    </div>
                                  </div>
                                </div>

                                {/* ═══ 4.6. Grouped Products & BoM (Bill of Materials) ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground mb-3">
                                    {lang === 'ar' ? '🛠️ خيارات المنتجات المجمعة (Bundles / BoM)' : '🛠️ Grouped Products & BoM (Kits)'}
                                  </h3>
                                  <div className="space-y-3 text-start">
                                    <span className="text-[11px] text-muted-foreground block font-medium">
                                      {lang === 'ar' 
                                        ? 'تفعيل خيار إنشاء قائمة المواد (BoM / Kit) للمنتجات المجمعة في Odoo:' 
                                        : 'Enable Bill of Materials (BoM / Kit) creation for grouped products in Odoo:'}
                                    </span>
                                    
                                    <div className="flex items-center gap-3 p-3.5 rounded-xl border bg-background border-border shadow-sm">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={bomEnabled}
                                        aria-label={lang === 'ar' ? 'تفعيل إنشاء قائمة المواد BoM' : 'Enable BoM Creation'}
                                        onClick={() => setBomEnabled(!bomEnabled)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          bomEnabled ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          bomEnabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <button type="button" onClick={() => setBomEnabled(!bomEnabled)} className="space-y-1 cursor-pointer text-start">
                                        <span className="font-semibold block text-xs">
                                          {lang === 'ar' ? 'تفعيل إنشاء قائمة المواد BoM' : 'Enable BoM Creation'}
                                        </span>
                                        <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                                          {lang === 'ar' 
                                            ? 'عند التفعيل، سيقوم النظام تلقائياً بإنشاء قائمة المواد BoM بالنوع المحدد أدناه.' 
                                            : 'When enabled, the system will automatically create a BoM with the type specified below.'}
                                        </span>
                                      </button>
                                    </div>

                                    {bomEnabled && (
                                      <div className="mt-3 pl-7 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                          {lang === 'ar' ? 'نوع قائمة المواد BoM:' : 'BoM Type:'}
                                        </label>
                                        <div className="grid grid-cols-2 gap-4">
                                          <label className={cn(
                                            "flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 shadow-sm",
                                            bomType === 'phantom' 
                                              ? "bg-foreground/5 border-foreground text-foreground ring-1 ring-foreground/20" 
                                              : "bg-background border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground"
                                          )}>
                                            <input
                                              type="radio"
                                              name="bomType"
                                              value="phantom"
                                              checked={bomType === 'phantom'}
                                              onChange={() => setBomType('phantom')}
                                              className="mt-1 h-3.5 w-3.5 text-foreground border-border focus:ring-foreground focus:ring-offset-0 focus:ring-0 cursor-pointer"
                                            />
                                            <div className="space-y-0.5">
                                              <span className="font-semibold block text-[11px]">
                                                {lang === 'ar' ? 'تجمع (Kit / Phantom)' : 'Kit (Phantom)'}
                                              </span>
                                              <span className="text-[10px] leading-relaxed block text-muted-foreground font-normal">
                                                {lang === 'ar' 
                                                  ? 'تُباع كمجموعة ويتم خصم مكوناتها مباشرة من المخزن.' 
                                                  : 'Sold as a kit and component stock is deducted directly.'}
                                              </span>
                                            </div>
                                          </label>

                                          <label className={cn(
                                            "flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200 shadow-sm",
                                            bomType === 'normal' 
                                              ? "bg-foreground/5 border-foreground text-foreground ring-1 ring-foreground/20" 
                                              : "bg-background border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground"
                                          )}>
                                            <input
                                              type="radio"
                                              name="bomType"
                                              value="normal"
                                              checked={bomType === 'normal'}
                                              onChange={() => setBomType('normal')}
                                              className="mt-1 h-3.5 w-3.5 text-foreground border-border focus:ring-foreground focus:ring-offset-0 focus:ring-0 cursor-pointer"
                                            />
                                            <div className="space-y-0.5">
                                              <span className="font-semibold block text-[11px]">
                                                {lang === 'ar' ? 'تصنيع (Manufacture / Normal)' : 'Manufacture (Normal)'}
                                              </span>
                                              <span className="text-[10px] leading-relaxed block text-muted-foreground font-normal">
                                                {lang === 'ar' 
                                                  ? 'منتج يتم تصنيعه من المكونات عبر أمر تصنيع في التصنيع.' 
                                                  : 'Produced from components via a manufacturing order.'}
                                              </span>
                                            </div>
                                          </label>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* ═══ 5. Media & Categories ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'الوسائط والتصنيفات' : 'Media & Categories'}
                                  </h3>
                                  <div className="grid grid-cols-3 gap-4 mt-3">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'مزامنة الصور' : 'Image Sync Mode'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={imageSyncMode}
                                        onChange={e => setImageSyncMode(e.target.value)}
                                      >
                                        <option value="all">{lang === 'ar' ? 'الكل' : 'All'}</option>
                                        <option value="main_only">{lang === 'ar' ? 'الأساسية فقط' : 'Main Only'}</option>
                                        <option value="skip">{lang === 'ar' ? 'تخطي' : 'Skip'}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'مزامنة التصنيفات' : 'Category Sync'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={categorySyncMode}
                                        onChange={e => setCategorySyncMode(e.target.value)}
                                      >
                                        <option value="auto">{lang === 'ar' ? 'تلقائي' : 'Auto'}</option>
                                        <option value="skip">{lang === 'ar' ? 'تخطي' : 'Skip'}</option>
                                        <option value="map_existing">{lang === 'ar' ? 'ربط الموجود' : 'Map Existing'}</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'إنشاء وحدة قياس' : 'UOM Auto Create'}
                                      </label>
                                      <div className="flex items-center gap-3 h-9">
                                        <button
                                          type="button"
                                          role="switch"
                                          dir="ltr"
                                          aria-checked={uomAutoCreate}
                                          onClick={() => setUomAutoCreate(!uomAutoCreate)}
                                          className={cn(
                                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                            uomAutoCreate ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                          )}
                                        >
                                          <span className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            uomAutoCreate ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )} />
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                          {uomAutoCreate
                                            ? (lang === 'ar' ? 'نعم' : 'Yes')
                                            : (lang === 'ar' ? 'لا' : 'No')}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* ═══ 6. Tax ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'الضريبة' : 'Tax'}
                                  </h3>
                                  <div className="grid grid-cols-2 gap-4 mt-3">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'طريقة مزامنة الضريبة' : 'Tax Sync Mode'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={taxSyncMode}
                                        onChange={e => setTaxSyncMode(e.target.value)}
                                      >
                                        <option value="auto_by_name">{lang === 'ar' ? 'تلقائي حسب الاسم' : 'Auto by Name'}</option>
                                        <option value="static_ids">{lang === 'ar' ? 'معرفات ثابتة' : 'Static IDs'}</option>
                                        <option value="skip">{lang === 'ar' ? 'تخطي' : 'Skip'}</option>
                                      </select>
                                    </div>
                                    {taxSyncMode === 'static_ids' && (
                                      <div className="space-y-1.5">
                                        <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                          {lang === 'ar' ? 'معرفات الضريبة الافتراضية' : 'Default Tax IDs'}
                                        </label>
                                        <SearchableSelect
                                          multiple={true}
                                          collapseTags={true}
                                          value={defaultTaxIds}
                                          onChange={setDefaultTaxIds}
                                          options={taxOptions}
                                          disabled={isLoadingTaxOpts}
                                          placeholder={lang === 'ar' ? '— اختر الضرائب —' : '— Select taxes —'}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* ═══ 7. Sync Actions ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'إعدادات المزامنة' : 'Sync Actions'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'حدد عمليات المزامنة المسموح بها للمنتجات'
                                      : 'Select which sync operations are enabled for products'}
                                  </p>
                                  <div className="space-y-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'العمليات المسموح بها' : 'Allowed Operations'}
                                      </label>
                                      {(() => {
                                        const syncActionOptions = [
                                          { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
                                          { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
                                          { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
                                        ]
                                        return (
                                          <SearchableSelect
                                            multiple={true}
                                            collapseTags={false}
                                            value={productEnabledActions}
                                            onChange={setProductEnabledActions}
                                            options={syncActionOptions}
                                            disabled={productDisabled}
                                            placeholder={lang === 'ar'
                                              ? (productDisabled ? '— المزامنة معطلة —' : '— اختر العمليات —')
                                              : (productDisabled ? '— Sync is disabled —' : '— Select operations —')}
                                          />
                                        )
                                      })()}
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={!productDisabled}
                                        onClick={() => setProductDisabled(!productDisabled)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          !productDisabled ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          !productDisabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar'
                                          ? (productDisabled ? 'تعطيل مزامنة المنتجات' : 'تفعيل مزامنة المنتجات')
                                          : (productDisabled ? 'Disable product sync' : 'Enable product sync')}
                                      </span>
                                    </div>
                                    {productDisabled && (
                                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                        {lang === 'ar'
                                          ? 'عند تعطيل المزامنة، لن يتم إنشاء أو تعديل أو حذف أي منتج في أودو.'
                                          : 'When disabled, no products will be created, updated, or deleted in Odoo.'}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* ═══ 8. On Deletion ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'عند حذف المنتج في زد' : 'On Product Deletion in Zid'}
                                  </h3>
                                  <div className="mt-3">
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={productOnDelete}
                                      onChange={e => setProductOnDelete(e.target.value)}
                                    >
                                      {[
                                        { value: 'nothing', labelAr: 'لا شيء', labelEn: 'Nothing' },
                                        { value: 'delete', labelAr: 'حذف', labelEn: 'Delete' },
                                        { value: 'archive', labelAr: 'أرشفة', labelEn: 'Archive' },
                                        { value: 'delete_or_archive', labelAr: 'محاولة الحذف فإن لم تنجح يعمل أرشفة', labelEn: 'Try Delete, then Archive' },
                                      ].map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                          {lang === 'ar' ? opt.labelAr : opt.labelEn}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                {standardStoreTab === 'zid' && (
                                  <div className="border-t border-border/80 pt-5">
                                    <h3 className="text-sm font-bold text-muted-foreground">
                                      {lang === 'ar' ? 'مزامنة المخزون (من أودو إلى زد)' : 'Inventory Sync (Odoo → Zid)'}
                                    </h3>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">
                                      {lang === 'ar'
                                        ? 'عند التفعيل: أي تغيير في مخزون أودو (مشتريات/مبيعات/جرد) يُحدّث مخزون زد تلقائيًا. أودو هو مصدر الحقيقة للمخزون، ولا تُرسل الكميات من زد إلى أودو.'
                                        : 'When enabled: any Odoo stock change (purchases/sales/stock counts) updates Zid automatically. Odoo is the source of truth — quantities are never pushed Zid → Odoo.'}
                                    </p>

                                    {/* Toggle */}
                                    <div className="flex items-center justify-between gap-3 mt-4">
                                      <div>
                                        <div className="text-xs font-semibold text-foreground">
                                          {lang === 'ar' ? 'تفعيل مزامنة المخزون' : 'Enable inventory sync'}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground mt-0.5">
                                          {lang === 'ar' ? 'مزامنة تلقائية فورية عند تغيّر الكميات في أودو' : 'Instant automatic sync when Odoo quantities change'}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={invSyncEnabled}
                                        onClick={() => setInvSyncEnabled(!invSyncEnabled)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          invSyncEnabled ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          invSyncEnabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                    </div>

                                    {/* Odoo stock Webhook buttons */}
                                    <div className="mt-3 rounded-lg border border-border/80 bg-inputBg/40 p-3">
                                      <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div className="min-w-[220px]">
                                          <div className="text-xs font-semibold text-foreground">
                                            {lang === 'ar' ? 'استقبال تحديثات الكميات من أودو' : 'Odoo stock Webhook'}
                                          </div>
                                          <div className="text-[11px] text-muted-foreground mt-0.5">
                                            {odooStockWebhook?.base_automation_id ? (
                                              lang === 'ar'
                                                ? `تم إنشاؤه — القاعدة الآلية #${odooStockWebhook.base_automation_id}`
                                                : `Created — base automation #${odooStockWebhook.base_automation_id}`
                                            ) : (
                                              lang === 'ar'
                                                ? 'لإرسال أي تغيير على كميات الأصناف من أودو تلقائيًا، أنشئ الـ Webhook ثم فعّل المزامنة.'
                                                : 'Create the Webhook so Odoo sends every product quantity change, then enable sync.'
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleCreateOdooWebhook}
                                            disabled={isSyncingWebhook || !!odooStockWebhook}
                                          >
                                            <Plus className="h-3.5 w-3.5" />
                                            {lang === 'ar' ? 'إنشاء Webhook' : 'Create Webhook'}
                                          </Button>
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleDeleteOdooWebhook}
                                            disabled={isSyncingWebhook || !odooStockWebhook}
                                            className="text-destructive hover:text-destructive"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            {lang === 'ar' ? 'حذف' : 'Delete'}
                                          </Button>
                                        </div>
                                      </div>
                                    </div>

                                    {isSyncingWebhook && (
                                      <div className="flex items-center gap-2 mt-3 text-[11px] text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        {lang === 'ar'
                                          ? 'جاري إعداد الاستقبال الآلي للمخزون في أودو...'
                                          : 'Registering the Odoo stock webhook…'}
                                      </div>
                                    )}
                                    {invSyncWebhookError && (
                                      <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                                        {invSyncWebhookError}
                                      </div>
                                    )}

                                    {invSyncEnabled && (
                                      <>
                                        {/* Balance mode */}
                                        <div className="mt-5">
                                          <div className="text-xs font-semibold text-muted-foreground mb-2">
                                            {lang === 'ar' ? 'الرصيد المراد مزامنته' : 'Balance to sync'}
                                          </div>
                                          <div className="flex flex-col gap-2">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                              <input
                                                type="radio"
                                                name="invSyncMode"
                                                checked={invSyncMode === 'actual'}
                                                onChange={() => setInvSyncMode('actual')}
                                                className="accent-foreground"
                                              />
                                              <span className="text-xs text-foreground">
                                                {lang === 'ar' ? 'الرصيد الفعلي (On Hand)' : 'Actual balance (On Hand)'}
                                              </span>
                                            </label>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                              <input
                                                type="radio"
                                                name="invSyncMode"
                                                checked={invSyncMode === 'forecast'}
                                                onChange={() => setInvSyncMode('forecast')}
                                                className="accent-foreground"
                                              />
                                              <span className="text-xs text-foreground">
                                                {lang === 'ar' ? 'الفوركاست المتوقع (Forecasted)' : 'Forecasted balance'}
                                              </span>
                                            </label>
                                            {invSyncMode === 'forecast' && (
                                              <p className="text-[11px] text-muted-foreground">
                                                {lang === 'ar'
                                                  ? 'الرصيد الفعلي + الوارد – الصادر (كما يظهر في تقرير المخزون المتوقع بأودو).'
                                                  : 'On hand + incoming − outgoing (as shown in the Odoo Forecasted report).'}
                                              </p>
                                            )}
                                          </div>
                                        </div>

                                        {/* Location pairing */}
                                        <div className="mt-5">
                                          <div className="text-xs font-semibold text-muted-foreground">
                                            {lang === 'ar' ? 'ربط المستودعات/المواقع' : 'Warehouse / Location pairing'}
                                          </div>
                                          <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                            {lang === 'ar'
                                              ? 'اربط موقع زد بموقع أودو — يُحدَّث مخزون زد في هذا الموقع حسب رصيد أودو فقط.'
                                              : 'Pair a Zid location with an Odoo location — Zid stock at that location is updated from the paired Odoo balance only.'}
                                          </p>

                                          {isLoadingInvSync ? (
                                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                              {lang === 'ar' ? 'جاري تحميل المواقع...' : 'Loading locations…'}
                                            </div>
                                          ) : (
                                            <div className="space-y-2">
                                              {invSyncPairs.map((row, index) =>
                                                row._removed ? null : (
                                                  <div key={row.id || `new-${index}`} className="flex items-center gap-2">
                                                    <select
                                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                                      value={row.source_location_id}
                                                      onChange={(e) => handlePairChange(index, 'source_location_id', e.target.value)}
                                                    >
                                                      <option value="">
                                                        {lang === 'ar' ? '— موقع زد —' : '— Zid location —'}
                                                      </option>
                                                      {zidLocations.map(loc => (
                                                        <option key={loc.id} value={loc.id}>
                                                          {loc.name || loc.id}
                                                        </option>
                                                      ))}
                                                    </select>
                                                    <ArrowRightLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
                                                    <select
                                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                                      value={row.odoo_location_id}
                                                      onChange={(e) => handlePairChange(index, 'odoo_location_id', e.target.value)}
                                                    >
                                                      <option value="">
                                                        {lang === 'ar' ? '— موقع أودو —' : '— Odoo location —'}
                                                      </option>
                                                      {odooLocations.map(loc => (
                                                        <option key={loc.id} value={String(loc.id)}>
                                                          {loc.complete_name || loc.name}
                                                        </option>
                                                      ))}
                                                    </select>
                                                    <button
                                                      type="button"
                                                      onClick={() => handleRemovePair(index)}
                                                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1"
                                                      title={lang === 'ar' ? 'حذف' : 'Remove'}
                                                    >
                                                      <Trash2 className="h-4 w-4" />
                                                    </button>
                                                  </div>
                                                )
                                              )}
                                              {invSyncPairs.filter(p => !p._removed).length === 0 && (
                                                <p className="text-[11px] text-muted-foreground">
                                                  {lang === 'ar'
                                                    ? 'لا توجد أزواج بعد — أضف زوجًا لبدء المزامنة.'
                                                    : 'No pairs yet — add one to start syncing.'}
                                                </p>
                                              )}
                                            </div>
                                          )}

                                          <div className="mt-3 flex flex-wrap items-center gap-2">
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              onClick={handleAddPair}
                                            >
                                              <Plus className="h-3.5 w-3.5" />
                                              {lang === 'ar' ? 'إضافة زوج' : 'Add pair'}
                                            </Button>
                                            <Button
                                              type="button"
                                              size="sm"
                                              onClick={handleSavePairs}
                                              disabled={isSavingPairs || isLoadingInvSync}
                                            >
                                              {isSavingPairs ? (
                                                <>
                                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                  {lang === 'ar' ? 'حفظ...' : 'Saving…'}
                                                </>
                                              ) : (
                                                lang === 'ar' ? 'حفظ مواقع الربط' : 'Save location pairs'
                                              )}
                                            </Button>
                                          </div>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}

                                {/* ── Save & Log Buttons ───────────────── */}
                                <div className="border-t border-border/80 pt-5 flex items-center gap-2">
                                  <Button
                                    onClick={handleSaveProducts}
                                    disabled={isSavingProducts}
                                    className="bg-foreground text-background gap-1.5 font-semibold rounded-lg h-9 text-xs px-6"
                                  >
                                    {isSavingProducts ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <>{lang === 'ar' ? 'حفظ إعدادات المنتجات' : 'Save Product Settings'}</>
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsProductMappingOpen(true)}
                                    className="gap-1.5 rounded-lg h-9 text-xs px-4"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    {lang === 'ar' ? 'ربط يدوي' : 'Manual Mapping'}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsProductLogOpen(true)}
                                    className="gap-1.5 rounded-lg h-9 text-xs px-4"
                                  >
                                    <History className="h-3.5 w-3.5" />
                                    {lang === 'ar' ? 'سجل المزامنة' : 'Sync Log'}
                                  </Button>
                                </div>
                              </div>
                            ) : standardSubTab === 'customers' ? (
                              <div className="space-y-5">
                                {/* ═══ 1. Customer Type ═══ */}
                                <div>
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'نوع العميل الافتراضي' : 'Default Customer Type'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {lang === 'ar'
                                      ? 'تحديد نوع الحساب الافتراضي عند إنشاء عميل جديد في أودو'
                                      : 'Specify the default account type when creating a new customer in Odoo'}
                                  </p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="space-y-1.5 max-w-xs">
                                    <label className="block text-xs font-semibold text-muted-foreground">
                                      {lang === 'ar' ? 'نوع العميل' : 'Customer Type'}
                                    </label>
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={customerDefaultType}
                                      onChange={e => setCustomerDefaultType(e.target.value)}
                                    >
                                      <option value="auto">
                                        {lang === 'ar' ? 'تلقائي (تحديد فرد أو شركة حسب الحقول)' : 'Auto (Detect individual/company)'}
                                      </option>
                                      <option value="person">
                                        {lang === 'ar' ? 'فرد (Individual)' : 'Individual (Person)'}
                                      </option>
                                      <option value="company">
                                        {lang === 'ar' ? 'شركة (Company)' : 'Company'}
                                      </option>
                                    </select>
                                  </div>
                                </div>

                                {/* ═══ 1b. Default Accounts ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'الحسابات الافتراضية' : 'Default Accounts'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'تحديد حسابات المدينين والدائنين الافتراضية للعملاء الجدد في أودو'
                                      : 'Specify the default receivable and payable accounts for new customers in Odoo'}
                                  </p>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'حساب المدينين (Receivable)' : 'Account Receivable'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={receivableAccountId}
                                        onChange={e => setReceivableAccountId(e.target.value)}
                                        disabled={isLoadingAccounts}
                                      >
                                        <option value="">
                                          {lang === 'ar' ? '— اختر حساب المدينين —' : '— Select Account Receivable —'}
                                        </option>
                                        {receivableAccountOptions.map(opt => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'حساب الدائنين (Payable)' : 'Account Payable'}
                                      </label>
                                      <select
                                        className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                        value={payableAccountId}
                                        onChange={e => setPayableAccountId(e.target.value)}
                                        disabled={isLoadingAccounts}
                                      >
                                        <option value="">
                                          {lang === 'ar' ? '— اختر حساب الدائنين —' : '— Select Account Payable —'}
                                        </option>
                                        {payableAccountOptions.map(opt => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                </div>

                                {/* ═══ 1c. Default Company ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'تحديد الشركة التابع لها عند إنشاء العملاء في أودو لضمان توافق الحسابات'
                                      : 'Specify the Odoo company associated with customers to prevent account inconsistencies'}
                                  </p>
                                  <div className="space-y-1.5 max-w-xs">
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={customerCompanyId}
                                      onChange={e => setCustomerCompanyId(e.target.value)}
                                      disabled={isLoadingCompanies}
                                    >
                                      <option value="">
                                        {lang === 'ar' ? '— اختر الشركة (اختياري) —' : '— Select Company (Optional) —'}
                                      </option>
                                      {companyOptions.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                   {customerCompanyId && (
                                     <div className="flex items-center gap-2 mt-3">
                                       <button
                                         type="button"
                                         role="switch"
                                          dir="ltr"
                                         aria-checked={customerLinkCompany}
                                         onClick={() => setCustomerLinkCompany(!customerLinkCompany)}
                                         className={cn(
                                           'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                           customerLinkCompany ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                         )}
                                       >
                                         <span className={cn(
                                           'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                           customerLinkCompany ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                         )} />
                                       </button>
                                       <span className="text-xs text-muted-foreground">
                                         {lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                                       </span>
                                     </div>
                                   )}
                                </div>

                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'عند حذف العميل في زد' : 'On Customer Deletion in Zid'}
                                  </h3>
                                  <div className="mt-3">
                                    <select
                                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                      value={customerOnDelete}
                                      onChange={e => setCustomerOnDelete(e.target.value)}
                                    >
                                      {[
                                        { value: 'nothing', labelAr: 'لا شيء', labelEn: 'Nothing' },
                                        { value: 'delete', labelAr: 'حذف', labelEn: 'Delete' },
                                        { value: 'archive', labelAr: 'أرشفة (نشط = false)', labelEn: 'Archive (Active = false)' },
                                        { value: 'delete_or_archive', labelAr: 'محاولة الحذف فإن لم تنجح يعمل أرشفة', labelEn: 'Try Delete, then Archive' },
                                      ].map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                          {lang === 'ar' ? opt.labelAr : opt.labelEn}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                {/* ═══ 3. Match Field Section ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'حقل المطابقة' : 'Match Field'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'حدد أي حقل من زد يطابق أي حقل في أودو للتعرف على العميل وتجنب تكراره'
                                      : 'Select which Zid field matches which Odoo field to identify the customer and avoid duplicates'}
                                  </p>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'حقل زد' : 'Zid Field'}
                                      </label>
                                      <SearchableSelect
                                        options={customerFields}
                                        value={customerMatchZidField}
                                        onChange={setCustomerMatchZidField}
                                        placeholder={lang === 'ar' ? '— اختر حقل زد —' : '— Select Zid field —'}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-xs font-semibold text-muted-foreground">
                                          {lang === 'ar' ? 'حقل أودو' : 'Odoo Field'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => fetchOdooCustomerFields(true)}
                                          disabled={isLoadingCustomerFields}
                                          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                          title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
                                        >
                                          <RefreshCw className={cn("h-3 w-3", isLoadingCustomerFields && "animate-spin")} />
                                        </button>
                                      </div>
                                      <SearchableSelect
                                        options={odooCustomerFields}
                                        value={customerMatchOdooField}
                                        onChange={setCustomerMatchOdooField}
                                        placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
                                        disabled={isLoadingCustomerFields}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* ═══ 4. Sync Actions ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'إعدادات المزامنة' : 'Sync Actions'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'حدد عمليات المزامنة المسموح بها للعملاء'
                                      : 'Select which sync operations are enabled for customers'}
                                  </p>
                                  <div className="space-y-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'العمليات المسموح بها' : 'Allowed Operations'}
                                      </label>
                                      {(() => {
                                        const syncActionOptions = [
                                          { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
                                          { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
                                          { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
                                        ]
                                        return (
                                          <SearchableSelect
                                            multiple={true}
                                            collapseTags={false}
                                            value={customerEnabledActions}
                                            onChange={setCustomerEnabledActions}
                                            options={syncActionOptions}
                                            disabled={customerDisabled}
                                            placeholder={lang === 'ar'
                                              ? (customerDisabled ? '— المزامنة معطلة —' : '— اختر العمليات —')
                                              : (customerDisabled ? '— Sync is disabled —' : '— Select operations —')}
                                          />
                                        )
                                      })()}
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={!customerDisabled}
                                        onClick={() => setCustomerDisabled(!customerDisabled)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          !customerDisabled ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          !customerDisabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar'
                                          ? (customerDisabled ? 'تعطيل مزامنة العملاء' : 'تفعيل مزامنة العملاء')
                                          : (customerDisabled ? 'Disable customer sync' : 'Enable customer sync')}
                                      </span>
                                    </div>
                                    {customerDisabled && (
                                      <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                        {lang === 'ar'
                                          ? 'عند تعطيل المزامنة، لن يتم إنشاء أو تعديل أو حذف أي عميل في أودو.'
                                          : 'When disabled, no customers will be created, updated, or deleted in Odoo.'}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* ── Save & Log Buttons ───────────────── */}
                                <div className="border-t border-border/80 pt-5 flex items-center gap-2">
                                  <Button
                                    onClick={handleSaveCustomers}
                                    disabled={isSavingCustomers}
                                    className="bg-foreground text-background gap-1.5 font-semibold rounded-lg h-9 text-xs px-6"
                                  >
                                    {isSavingCustomers ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <>{lang === 'ar' ? 'حفظ إعدادات العملاء' : 'Save Customer Settings'}</>
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsLogOpen(true)}
                                    className="gap-1.5 rounded-lg h-9 text-xs px-4"
                                  >
                                    <History className="h-3.5 w-3.5" />
                                    {lang === 'ar' ? 'سجل المزامنة' : 'Sync Log'}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-5">
                                {/* ═══ 1. Müzamene & Operations ═══ */}
                                <div>
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'إعدادات مزامنة الطلبات' : 'Order Sync Settings'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    {lang === 'ar'
                                      ? 'تفعيل مزامنة الطلبات وتحديد العمليات المسموح بها'
                                      : 'Enable order synchronization and specify allowed operations'}
                                  </p>
                                </div>
                                <div className="space-y-4">
                                  <div className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      role="switch"
                                          dir="ltr"
                                      aria-checked={!orderDisabled}
                                      onClick={() => setOrderDisabled(!orderDisabled)}
                                      className={cn(
                                        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                        !orderDisabled ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                      )}
                                    >
                                      <span className={cn(
                                        'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                        !orderDisabled ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                      )} />
                                    </button>
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      {lang === 'ar'
                                        ? (orderDisabled ? 'تعطيل مزامنة الطلبات' : 'تفعيل مزامنة الطلبات')
                                        : (orderDisabled ? 'Disable Order Sync' : 'Enable Order Sync')}
                                    </span>
                                  </div>
                                  {!orderDisabled && (
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'العمليات المسموح بها' : 'Allowed Operations'}
                                      </label>
                                      {(() => {
                                        const syncActionOptions = [
                                          { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
                                          { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
                                          { value: 'cancel', label: lang === 'ar' ? 'إلغاء (Cancel)' : 'Cancel' },
                                          { value: 'deliver', label: lang === 'ar' ? 'توصيل (Deliver)' : 'Deliver' },
                                        ]
                                        return (
                                          <SearchableSelect
                                            multiple={true}
                                            collapseTags={false}
                                            value={orderEnabledActions}
                                            onChange={setOrderEnabledActions}
                                            options={syncActionOptions}
                                            placeholder={lang === 'ar' ? '— اختر العمليات —' : '— Select operations —'}
                                          />
                                        )
                                      })()}
                                    </div>
                                  )}
                                </div>

                                {/* ═══ 2. Match Field Section ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'حقل المطابقة' : 'Match Field'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'حدد أي حقل من المتجر يطابق أي حقل في أودو للتعرف على الطلب وتجنب التكرار'
                                      : 'Select which Store field matches which Odoo field to identify the order and avoid duplicates'}
                                  </p>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground mb-1">
                                        {lang === 'ar' ? 'حقل المتجر' : 'Store Field'}
                                      </label>
                                      <SearchableSelect
                                        options={orderFields}
                                        value={orderMatchZidField}
                                        onChange={setOrderMatchZidField}
                                        placeholder={lang === 'ar' ? '— اختر حقل المتجر —' : '— Select Store field —'}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="block text-xs font-semibold text-muted-foreground">
                                          {lang === 'ar' ? 'حقل أودو' : 'Odoo Field'}
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => fetchOdooOrderFields(true)}
                                          disabled={isLoadingOrderFields}
                                          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                          title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
                                        >
                                          <RefreshCw className={cn("h-3 w-3", isLoadingOrderFields && "animate-spin")} />
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
                                </div>

                                {/* ═══ 3. Defaults ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'القيم والخصائص الافتراضية' : 'Default Values & Configurations'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'تحديد المستودع الافتراضي، قائمة الأسعار، شروط الدفع، والشركة في أودو للطلب الجديد'
                                      : 'Specify default warehouse, pricelist, payment terms, and company in Odoo for new orders'}
                                  </p>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="block text-xs font-semibold text-muted-foreground">
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
                                      <label className="block text-xs font-semibold text-muted-foreground">
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
                                      <label className="block text-xs font-semibold text-muted-foreground">
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
                                      <label className="block text-xs font-semibold text-muted-foreground">
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
                                      <div className="flex items-center gap-2 col-span-2 mt-2">
                                        <button
                                          type="button"
                                          role="switch"
                                          dir="ltr"
                                          aria-checked={orderLinkCompany}
                                          onClick={() => setOrderLinkCompany(!orderLinkCompany)}
                                          className={cn(
                                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                            orderLinkCompany ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                          )}
                                        >
                                          <span className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            orderLinkCompany ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )} />
                                        </button>
                                        <span className="text-xs text-muted-foreground">
                                          {lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex items-center gap-2 col-span-2 mt-2 border-t border-border/50 pt-3">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={orderAutoConfirm}
                                        onClick={() => setOrderAutoConfirm(!orderAutoConfirm)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          orderAutoConfirm ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          orderAutoConfirm ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'تأكيد الطلب تلقائياً (تحويل من مسودة إلى أمر مبيعات مؤكد)' : 'Auto Confirm Order (Convert Draft to Sales Order)'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 col-span-2 border-t border-border/50 pt-3">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={orderAutoInvoice}
                                        onClick={() => setOrderAutoInvoice(!orderAutoInvoice)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          orderAutoInvoice ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          orderAutoInvoice ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'إنشاء الفاتورة تلقائياً بعد تأكيد الطلب' : 'Auto Create Invoice After Order Confirmation'}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 col-span-2 border-t border-border/50 pt-3">
                                      <button
                                        type="button"
                                        role="switch"
                                          dir="ltr"
                                        aria-checked={orderPartialFulfillment}
                                        onClick={() => setOrderPartialFulfillment(!orderPartialFulfillment)}
                                        className={cn(
                                          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                          orderPartialFulfillment ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                        )}
                                      >
                                        <span className={cn(
                                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                          orderPartialFulfillment ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                        )} />
                                      </button>
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        {lang === 'ar' ? 'تفعيل التنفيذ الجزئي (شحنات متعددة)' : 'Enable Partial Fulfillment (Multiple Shipments)'}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* ═══ Multi-Warehouse Rules ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'قواعد المستودعات المتعددة' : 'Multi-Warehouse Rules'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'تحديد مستودع مختلف لكل متجر (الخيار الافتراضي أعلاه يُستخدم إن لم يُحدد)'
                                      : 'Assign a specific warehouse per store (the default warehouse above is used when no rule matches)'}
                                  </p>
                                  <div className="space-y-2">
                                    {Object.entries(storeWarehouseMappings).map(([storeId, whId]) => (
                                      <div key={storeId} className="flex items-center gap-2">
                                        <input
                                          type="text"
                                          value={storeId}
                                          onChange={(e) => {
                                            const next: Record<string, string> = {}
                                            for (const [k, v] of Object.entries(storeWarehouseMappings)) {
                                              if (k === storeId) continue
                                              next[k] = v
                                            }
                                            next[e.target.value] = whId
                                            setStoreWarehouseMappings(next)
                                          }}
                                          placeholder={lang === 'ar' ? 'معرف المتجر' : 'Store ID'}
                                          className="flex-1 h-8 px-2.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/50 transition-colors"
                                        />
                                        <input
                                          type="number"
                                          value={whId}
                                          onChange={(e) => setStoreWarehouseMappings(prev => ({ ...prev, [storeId]: e.target.value }))}
                                          placeholder={lang === 'ar' ? 'معرف المستودع' : 'Warehouse ID'}
                                          className="w-[120px] h-8 px-2.5 text-xs rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/50 transition-colors"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const next = { ...storeWarehouseMappings }
                                            delete next[storeId]
                                            setStoreWarehouseMappings(next)
                                          }}
                                          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ))}
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const key = `store_${Date.now()}`
                                        setStoreWarehouseMappings(prev => ({ ...prev, [key]: '' }))
                                      }}
                                      className="h-7 text-[10px] gap-1"
                                    >
                                      <Plus className="h-3 w-3" />
                                      {lang === 'ar' ? 'إضافة قاعدة' : 'Add Rule'}
                                    </Button>
                                  </div>
                                </div>

                                {/* ═══ 4. Shipping & Discount Options ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'بنود الشحن والخصومات' : 'Shipping & Discount Lines'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">
                                    {lang === 'ar'
                                      ? 'تحديد كيفية إضافة تكلفة الشحن ومبالغ الخصومات كبنود مستقلة في الفاتورة'
                                      : 'Specify how to append shipping costs and discount amounts as line items in the order'}
                                  </p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    {/* Shipping section */}
                                    <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/10">
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          role="switch"
                                          dir="ltr"
                                          aria-checked={orderAddShipping}
                                          onClick={() => setOrderAddShipping(!orderAddShipping)}
                                          className={cn(
                                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                            orderAddShipping ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                          )}
                                        >
                                          <span className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            orderAddShipping ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )} />
                                        </button>
                                        <span className="text-xs font-bold text-foreground">
                                          {lang === 'ar' ? 'إضافة الشحن كبند مستقل' : 'Add Shipping as Line Item'}
                                        </span>
                                      </div>
                                      {orderAddShipping && (
                                        <div className="space-y-3 pt-2">
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
                                              {lang === 'ar' ? 'منتج الشحن في أودو' : 'Odoo Shipping Product'}
                                            </label>
                                            <SearchableSelect
                                              options={productOptions}
                                              value={orderShippingProductId}
                                              onChange={setOrderShippingProductId}
                                              placeholder={lang === 'ar' ? '— اختر منتج الشحن —' : '— Select Shipping Product —'}
                                              disabled={isLoadingProducts}
                                            />
                                          </div>
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
                                              {lang === 'ar' ? 'رمز المنتج المرجعي للشحن (SKU)' : 'Shipping Product SKU Fallback'}
                                            </label>
                                            <input
                                              type="text"
                                              className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                              value={orderShippingProductSku}
                                              onChange={e => setOrderShippingProductSku(e.target.value)}
                                              placeholder={lang === 'ar' ? 'مثال: shipping-product' : 'e.g. shipping-product'}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* COD section */}
                                    <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/10">
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          role="switch"
                                          dir="ltr"
                                          aria-checked={orderAddCod}
                                          onClick={() => setOrderAddCod(!orderAddCod)}
                                          className={cn(
                                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                            orderAddCod ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                          )}
                                        >
                                          <span className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            orderAddCod ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )} />
                                        </button>
                                        <span className="text-xs font-bold text-foreground">
                                          {lang === 'ar' ? 'إضافة رسوم الدفع عند الاستلام كبند' : 'Add COD Fee as Line Item'}
                                        </span>
                                      </div>
                                      {orderAddCod && (
                                        <div className="space-y-3 pt-2">
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
                                              {lang === 'ar' ? 'منتج رسوم الدفع عند الاستلام في أودو' : 'Odoo COD Fee Product'}
                                            </label>
                                            <SearchableSelect
                                              options={productOptions}
                                              value={orderCodProductId}
                                              onChange={setOrderCodProductId}
                                              placeholder={lang === 'ar' ? '— اختر منتج رسوم COD —' : '— Select COD Fee Product —'}
                                              disabled={isLoadingProducts}
                                            />
                                          </div>
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
                                              {lang === 'ar' ? 'رمز المنتج المرجعي (SKU)' : 'COD Product SKU Fallback'}
                                            </label>
                                            <input
                                              type="text"
                                              className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                              value={orderCodProductSku}
                                              onChange={e => setOrderCodProductSku(e.target.value)}
                                              placeholder={lang === 'ar' ? 'مثال: cod-fee-product' : 'e.g. cod-fee-product'}
                                            />
                                          </div>
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
                                              {lang === 'ar' ? 'مبلغ احتياطي (يُستخدم عند غياب المبلغ من زد)' : 'Fallback Amount (used when Zid sends none)'}
                                            </label>
                                            <input
                                              type="number"
                                              min="0"
                                              step="0.01"
                                              className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                              value={orderCodAmount}
                                              onChange={e => setOrderCodAmount(e.target.value)}
                                              placeholder={lang === 'ar' ? 'مثال: 10' : 'e.g. 10'}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Discount section */}
                                    <div className="space-y-4 p-4 rounded-xl border border-border bg-muted/10">
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          role="switch"
                                          dir="ltr"
                                          aria-checked={orderAddDiscount}
                                          onClick={() => setOrderAddDiscount(!orderAddDiscount)}
                                          className={cn(
                                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                            orderAddDiscount ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                          )}
                                        >
                                          <span className={cn(
                                            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                            orderAddDiscount ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                          )} />
                                        </button>
                                        <span className="text-xs font-bold text-foreground">
                                          {lang === 'ar' ? 'إضافة الخصم كبند مستقل' : 'Add Discount as Line Item'}
                                        </span>
                                      </div>
                                      {orderAddDiscount && (
                                        <div className="space-y-3 pt-2">
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
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
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
                                              {lang === 'ar' ? 'رمز منتج الخصم المرجعي (SKU)' : 'Discount Product SKU Fallback'}
                                            </label>
                                            <input
                                              type="text"
                                              className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                              value={orderDiscountProductSku}
                                              onChange={e => setOrderDiscountProductSku(e.target.value)}
                                              placeholder={lang === 'ar' ? 'مثال: discount-product' : 'e.g. discount-product'}
                                            />
                                          </div>
                                          <div className="space-y-1.5">
                                            <label className="block text-[11px] font-semibold text-muted-foreground">
                                              {lang === 'ar' ? 'طريقة الخصم' : 'Discount Mode'}
                                            </label>
                                            <select
                                              className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                              value={orderDiscountMode}
                                              onChange={e => setOrderDiscountMode(e.target.value)}
                                            >
                                              <option value="fixed">{lang === 'ar' ? 'قيمة ثابتة سالبة' : 'Negative Fixed Value'}</option>
                                              <option value="percent">{lang === 'ar' ? 'نسبة مئوية' : 'Percentage'}</option>
                                            </select>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* ═══ 5. Order Status Mapping ═══ */}
                                <div className="border-t border-border/80 pt-5">
                                  <h3 className="text-sm font-bold text-muted-foreground">
                                    {lang === 'ar' ? 'ربط حالات الطلب' : 'Order Status Mapping'}
                                  </h3>
                                  <p className="text-[11px] text-muted-foreground mt-0.5 mb-4">
                                    {lang === 'ar'
                                      ? 'مواءمة وتحديد الحالة المقابلة in Odoo لكل حالة من حالات الطلب في المتجر الإلكتروني'
                                      : 'Align and specify the corresponding Odoo state for each store order status'}
                                  </p>
                                  <div className="rounded-xl border border-border overflow-hidden">
                                    <table className="w-full text-xs text-left border-collapse" dir={dir}>
                                      <thead>
                                        <tr className="bg-muted/40 text-muted-foreground border-b border-border/60">
                                          <th className="px-4 py-2.5 font-bold">
                                            {lang === 'ar' ? 'حالة الطلب في المتجر' : 'Store Order Status'}
                                          </th>
                                          <th className="px-4 py-2.5 font-bold">
                                            {lang === 'ar' ? 'الحالة المقابلة في أودو' : 'Odoo Target State'}
                                          </th>
                                          <th className="px-4 py-2.5 font-bold w-20 text-center">
                                            {lang === 'ar' ? 'تفعيل' : 'Enabled'}
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-border/40">
                                        {getOrderPlatformStatuses().map((status) => {
                                          const odooStates = [
                                            { value: 'draft', label: lang === 'ar' ? 'مسودة (Quotation)' : 'Quotation (Draft)' },
                                            { value: 'sent', label: lang === 'ar' ? 'تم إرسال العرض (Sent)' : 'Quotation Sent (Sent)' },
                                            { value: 'sale', label: lang === 'ar' ? 'طلب مبيعات مؤكد (Sales Order)' : 'Sales Order (Sale)' },
                                            { value: 'done', label: lang === 'ar' ? 'مغلق (Locked)' : 'Locked (Done)' },
                                            { value: 'cancel', label: lang === 'ar' ? 'ملغي (Cancelled)' : 'Cancelled (Cancel)' },
                                          ]
                                          return (
                                            <tr key={status.key} className="hover:bg-muted/10">
                                              <td className="px-4 py-2 font-semibold text-foreground">
                                                {lang === 'ar' ? status.labelAr : status.labelEn}
                                                <span className="text-[9px] text-muted-foreground/60 block font-normal">
                                                  key: {status.key}
                                                </span>
                                              </td>
                                              <td className="px-4 py-2">
                                                <select
                                                  className="w-full h-8 px-2 rounded-md border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                                                  value={orderStateMapping[status.key]?.state || ''}
                                                  onChange={(e) => {
                                                    const val = e.target.value
                                                    setOrderStateMapping(prev => ({
                                                      ...prev,
                                                      [status.key]: { state: val, enabled: prev[status.key]?.enabled ?? true },
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
                                              <td className="px-4 py-2 text-center">
                                                <button
                                                  type="button"
                                                  role="switch"
                                          dir="ltr"
                                                  aria-checked={orderStateMapping[status.key]?.enabled ?? true}
                                                  title={lang === 'ar' ? 'تفعيل/تعطيل هذه الحالة — المعطلة لا تؤثر في أودو' : 'Enable/disable this status — disabled statuses leave Odoo untouched'}
                                                  onClick={() => {
                                                    const cur = orderStateMapping[status.key]
                                                    setOrderStateMapping(prev => ({
                                                      ...prev,
                                                      [status.key]: { state: cur?.state || '', enabled: !(cur?.enabled ?? true) },
                                                    }))
                                                  }}
                                                  className={cn(
                                                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
                                                    (orderStateMapping[status.key]?.enabled ?? true) ? 'border-transparent bg-emerald-500 shadow-sm' : 'border-border bg-muted-foreground/25'
                                                  )}
                                                >
                                                  <span className={cn(
                                                    'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200',
                                                    (orderStateMapping[status.key]?.enabled ?? true) ? 'translate-x-[20px]' : 'translate-x-[2px]'
                                                  )} />
                                                </button>
                                              </td>
                                            </tr>
                                          )
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* ── Save & Log Buttons ───────────────── */}
                                <div className="border-t border-border/80 pt-5 flex items-center gap-2">
                                  <Button
                                    onClick={handleSaveOrders}
                                    disabled={isSavingOrders}
                                    className="bg-foreground text-background gap-1.5 font-semibold rounded-lg h-9 text-xs px-6"
                                  >
                                    {isSavingOrders ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <>{lang === 'ar' ? 'حفظ إعدادات الطلبات' : 'Save Order Settings'}</>
                                    )}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsOrderLogOpen(true)}
                                    className="gap-1.5 rounded-lg h-9 text-xs px-4"
                                  >
                                    <History className="h-3.5 w-3.5" />
                                    {lang === 'ar' ? 'سجل المزامنة' : 'Sync Log'}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => router.push('/dashboard/mapping-center/orders')}
                                    className="gap-1.5 rounded-lg h-9 text-xs px-4"
                                  >
                                    <ShoppingCart className="h-3.5 w-3.5" />
                                    {lang === 'ar' ? 'لوحة الطلبات' : 'Order Dashboard'}
                                  </Button>
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="space-y-3 text-center">
                              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                                <SlidersHorizontal className="h-6 w-6 text-muted-foreground/50" />
                              </div>
                              <div className="text-center">
                                <p className="text-sm font-bold text-foreground">
                                  {lang === 'ar'
                                    ? `أنت غير متصل بمتجر ${storeTabs.find(s => s.key === standardStoreTab)?.labelAr}`
                                    : `You are not connected to ${storeTabs.find(s => s.key === standardStoreTab)?.labelEn}`}
                                </p>
                                <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed max-w-xs mx-auto">
                                  {lang === 'ar'
                                    ? 'لتفعيل إعدادات الربط لهذا المتجر، يرجى ربط المتجر أولاً من صفحة إعدادات الاتصال.'
                                    : 'To configure mapping for this store, please connect it first from the connection settings page.'}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>
            </div>
        </motion.div>
      ) : pageTab === 'addfield' ? (
        <motion.div
          key="addfield-tab"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-muted-foreground">
                  {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
                </span>
                <span className="text-muted-foreground/30 text-xs">{'/'}</span>
                <h1 className="text-xl font-extrabold tracking-tight text-foreground">
                  {lang === 'ar' ? 'إضافة حقل' : 'Add Field'}
                </h1>
              </div>
              <p className="text-muted-foreground text-[11px]">
                {lang === 'ar' ? 'إضافة حقل مخصص لنظام ERP' : 'Add a custom field to your ERP system'}
              </p>
            </div>
            <AddCustomFieldForm
              initialModels={initialModels}
              hasOdooConnection={hasOdooConnection}
              erpType={erpType}
            />
          </div>
        </motion.div>
      ) : pageTab === 'values' ? (
        <motion.div
          key="values-tab"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-muted-foreground">
                  {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
                </span>
                <span className="text-muted-foreground/30 text-xs">{'/'}</span>
                <h1 className="text-xl font-extrabold tracking-tight text-foreground">
                  {lang === 'ar' ? 'تحويل القيم' : 'Value Mapping'}
                </h1>
              </div>
              <p className="text-muted-foreground text-[11px]">
                {lang === 'ar'
                  ? 'ربط القيم الثابتة بين المتجر ونظام ERP (طرق الدفع، الشحن، المستودعات، العملات، الضرائب)'
                  : 'Map static values between store and ERP (payment methods, shipping, warehouses, currencies, taxes)'}
              </p>
            </div>
            <StaticMappingEditor storeType={standardStoreTab} />
          </div>
        </motion.div>
      ) : (
      <motion.div
        key="mapping-tab"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2 }}
        className="space-y-4"
      >
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-semibold text-muted-foreground">
              {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
            </span>
            <span className="text-muted-foreground/30 text-xs">{'/'}</span>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              {lang === 'ar' ? 'تخصيص الربط' : 'Custom Mapping'}
            </h1>
          </div>
          <p className="text-muted-foreground text-[11px]">
            {t('map.desc')}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            onClick={() => {
              setLogMappingId(undefined)
              setLogMappingName(undefined)
              setIsLogOpen(true)
            }}
            className="border-border hover:bg-muted dark:border-border dark:hover:bg-card gap-1.5 font-medium rounded-lg h-9 text-xs"
          >
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            {lang === 'ar' ? 'سجل المزامنة العام' : 'Global Sync Log'}
          </Button>
          <Button 
            onClick={() => setView('create')}
            className="bg-foreground text-background gap-1.5 font-medium rounded-lg h-9 text-xs transition-transform duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'إضافة ربط جديد' : 'Add New Mapping'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] card-base p-10">
          <div className="shimmer h-12 w-12 rounded-2xl mb-4" />
          <div className="shimmer h-4 w-48 rounded-lg mb-2" />
          <div className="shimmer h-3 w-32 rounded-lg" />
        </div>
      ) : mappings.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center text-center min-h-[280px] p-10">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center mb-5">
            <SlidersHorizontal className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-base font-bold text-foreground mb-1.5">{lang === 'ar' ? 'لا يوجد تخصيص ربط حالياً' : 'No Custom Mappings Found'}</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto mb-5 leading-relaxed">
            {lang === 'ar' 
              ? `قم بربط وتخصيص كيفية انتقال الحقول بين متجرك ونظام ${getErpFromLabel(erpType)} لإيقاف المزامنة اليدوية وبدء المزامنة التلقائية.` 
              : `Map and customize how fields flow between your store and ${getErpFromLabel(erpType)} to automate data synchronization.`}
          </p>
          <Button 
            onClick={() => setView('create')}
            className="bg-foreground text-background gap-1.5 font-semibold rounded-xl h-10 text-xs shadow-sm hover:shadow-md transition-all duration-200"
          >
            <Plus className="h-4 w-4" />
            {lang === 'ar' ? 'ابدأ تخصيص الربط الآن' : 'Start Custom Mapping'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Results bar */}
          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] text-muted-foreground font-medium">
              {lang === 'ar'
                ? `عرض ${filteredMappings.length} من ${mappings.length} ربط`
                : `Showing ${filteredMappings.length} of ${mappings.length} mappings`}
            </p>
            {(searchQuery || platformFilter.length > 0 || directionFilter.length > 0 || operationFilter.length > 0) && (
              <button
                onClick={() => {
                  setSearchQuery('')
                  setPlatformFilter([])
                  setDirectionFilter([])
                  setOperationFilter([])
                }}
                className="text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors"
              >
                {lang === 'ar' ? 'مسح الكل' : 'Clear all'}
              </button>
            )}
          </div>
          {/* Advanced Filter Bar */}
          <div className="card-base p-4 space-y-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                {lang === 'ar' ? 'تصفية' : 'Filters'}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              {/* Search Input */}
              <div className="sm:col-span-2 md:col-span-1 relative">
                <input
                  type="text"
                  placeholder={lang === 'ar' ? 'بحث باسم الربط، النموذج...' : 'Search mapping, model...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full text-xs h-9 px-3 pr-8 rounded-lg border border-input bg-inputBg text-foreground placeholder:text-muted-foreground/50 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Store Filter */}
              <div>
                <SearchableSelect
                  multiple={true}
                  collapseTags={true}
                  value={platformFilter}
                  onChange={setPlatformFilter}
                  options={storeOptions}
                  placeholder={lang === 'ar' ? 'كل المتاجر المتصلة' : 'All Connected Stores'}
                />
              </div>

              {/* Sync Direction Filter */}
              <div>
                <SearchableSelect
                  multiple={true}
                  collapseTags={true}
                  value={directionFilter}
                  onChange={setDirectionFilter}
                  options={directionOptions}
                  placeholder={lang === 'ar' ? 'كل الاتجاهات' : 'All Directions'}
                />
              </div>

              {/* Odoo Operation Filter */}
              <div>
                <SearchableSelect
                  multiple={true}
                  collapseTags={true}
                  value={operationFilter}
                  onChange={setOperationFilter}
                  options={operationOptions}
                  placeholder={lang === 'ar' ? 'جميع العمليات' : 'All Operations'}
                />
              </div>
            </div>
          </div>

          {/* Mappings List */}
          <AnimatePresence mode="popLayout">
          <div className="card-base overflow-hidden divide-y divide-border/50">
          {filteredMappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center min-h-[120px] p-8">
              <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center mb-3">
                <Search className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                {lang === 'ar' ? 'لا توجد روابط تطابق التصفية' : 'No mappings match your filters'}
              </p>
            </div>
          ) : filteredMappings.map((item, idx) => {
            const totalFields = countTotalMappedFields(item.mappings)
            const platform = getPlatformSource(item.action)
            const platformColor = platform === 'shopify' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : platform === 'salla' ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
              : 'bg-zid-500/10 text-zid-600 dark:text-zid-400 border-zid-500/20'
            const operationColor = item.odoo_operation === 'delete' ? 'bg-destructive/10 text-destructive border-destructive/20'
              : item.odoo_operation === 'update' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
            const directionColors: Record<string, string> = {
              'store_to_erp': 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
              'erp_to_store': 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
              'both': 'bg-gradient-to-r from-blue-500/10 to-violet-500/10 text-primary border-primary/20',
            }
            return (
              <motion.div 
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, delay: idx * 0.02 }}
                className="p-4 hover:bg-muted/10 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* Details */}
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-colors mt-0.5',
                    platform === 'shopify' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                      : platform === 'salla' ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
                      : 'bg-zid-50 dark:bg-zid-900/20 text-zid-600 dark:text-zid-400'
                  )}>
                    <SlidersHorizontal className="h-5 w-5" />
                  </div>
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-sm text-foreground break-all">
                        {item.name || (lang === 'ar' ? 'ربط حقول غير مسمى' : 'Unnamed field mapping')}
                      </span>
                      {/* Platform Source Badge */}
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border',
                        platformColor
                      )}>
                        <span className={cn(
                          'inline-block w-1.5 h-1.5 rounded-full',
                          platform === 'shopify' ? 'bg-emerald-500'
                            : platform === 'salla' ? 'bg-orange-500'
                            : 'bg-zid-500'
                        )} />
                        {platform === 'shopify' ? (lang === 'ar' ? 'شوبيفاي' : 'Shopify') : platform === 'salla' ? (lang === 'ar' ? 'سله' : 'Salla') : (lang === 'ar' ? 'زد' : 'Zid')}
                      </span>
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border",
                        operationColor
                      )}>
                        {item.odoo_operation === 'delete'
                          ? t('map.operationDelete')
                          : item.odoo_operation === 'update'
                            ? t('map.operationUpdate')
                            : t('map.operationCreate')}
                      </span>
                      {/* Sync Direction Badge */}
                      {(item.sync_direction || 'store_to_erp').split(',').map((dir: string) => (
                        <span key={dir} className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border",
                          directionColors[dir] || directionColors['store_to_erp']
                        )}>
                          {dir === 'erp_to_store'
                            ? (lang === 'ar' ? '↔ من أودو للمتجر' : 'Odoo → Store')
                            : dir === 'both'
                              ? (lang === 'ar' ? '↔ كلا الاتجاهين' : '↔ Both Ways')
                              : (lang === 'ar' ? '↔ من المتجر لأودو' : 'Store → Odoo')}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Database className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <span>{lang === 'ar' ? `نموذج ${getErpFromLabel(erpType)}: ` : `${getErpFromLabel(erpType)} Model: `}<span className="font-mono text-foreground font-semibold">{item.odoo_model}</span></span>
                      </span>
                      {(item.odoo_operation === 'update' || item.odoo_operation === 'delete' || (item.sync_direction || '').split(',').includes('erp_to_store')) && (item.odoo_match_field || item.zid_match_field) && (
                        <span className="flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground/60" />
                          <span>{lang === 'ar' ? 'مطابقة: ' : 'Matching: '}<span className="font-mono text-foreground font-semibold">{item.odoo_match_field || '-'} ⇄ {item.zid_match_field || '-'}</span></span>
                        </span>
                      )}
                      <span className="flex items-center gap-1.5">
                        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground/60" />
                        <span>{lang === 'ar' ? 'الحقول المربوطة: ' : 'Mapped fields: '}<span className="font-semibold text-foreground">{totalFields}</span></span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Operations */}
                <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                  <div className="flex items-center gap-0.5 bg-muted/40 dark:bg-card/40 border border-border/50 rounded-xl p-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setLogMappingId(item.id)
                        setLogMappingName(item.name)
                        setIsLogOpen(true)
                      }}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg hover:bg-background dark:hover:bg-card transition-all"
                      title={lang === 'ar' ? 'سجل المزامنة' : 'Sync Log'}
                    >
                      <History className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setSelectedMapping(item)
                        setView('edit')
                      }}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg hover:bg-background dark:hover:bg-card transition-all"
                      title={t('ws.editBtn')}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteConfirmId(item.id)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10 transition-all"
                      title={t('ws.deleteBtn')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {deleteConfirmId === item.id && (
                    <ConfirmDialog
                      open={true}
                      onOpenChange={(open) => { if (!open) setDeleteConfirmId(null) }}
                      title={lang === 'ar' ? 'حذف الربط' : 'Delete Mapping'}
                      description={lang === 'ar'
                        ? 'هل أنت متأكد من حذف هذا الربط؟ لا يمكن التراجع عن هذا الإجراء.'
                        : 'Are you sure you want to delete this mapping? This action cannot be undone.'}
                      confirmText={lang === 'ar' ? 'حذف' : 'Delete'}
                      cancelText={lang === 'ar' ? 'إلغاء' : 'Cancel'}
                      variant="destructive"
                      onConfirm={() => handleDelete(item.id)}
                    />
                  )}
                </div>
              </motion.div>
            )
          })}
          </div>
          </AnimatePresence>
        </div>
      )}
      
      </motion.div>
      )}
      </AnimatePresence>

      <SyncLogModal 
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        mappingId={logMappingId}
        mappingName={logMappingName}
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
      />
      <ProductMappingDialog
        isOpen={isProductMappingOpen}
        onClose={() => setIsProductMappingOpen(false)}
        platform={standardStoreTab}
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
    </div>
    </>
  )
}
