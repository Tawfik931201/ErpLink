'use client'

import {
  Play,
  Plus,
  Trash2,
  X,
  SlidersHorizontal,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  History,
  Info,
  ArrowRightLeft,
  AlertTriangle,
  Clock
} from 'lucide-react'
import React, { useState, useEffect, useRef } from 'react'

import { getOdooModelFields, getOdooFieldValueOptions } from '@/app/actions/odoo'
import { startInitialTransfer, getTransfers } from '@/app/actions/transfers'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { formatFieldLabel } from '@/lib/translations'

import SearchableSelect from '../mapping-center/searchable-select'

import type { ConnectedStore } from './page'

interface TransferClientProps {
  initialModels: Array<{ model: string; name: string }>
  hasOdooConnection: boolean
  preloadedFields: any[]
  connectedStores: ConnectedStore[]
}

const ZID_CATEGORY_FIELDS = [
  { value: 'id', label: 'Category ID (id)', type: 'number' },
  { value: 'name', label: 'Category Name (name)', type: 'string' },
  { value: 'names.ar', label: 'Category Name Arabic (names.ar)', type: 'string' },
  { value: 'names.en', label: 'Category Name English (names.en)', type: 'string' },
  { value: 'slug', label: 'SEO Slug (slug)', type: 'string' },
  { value: 'parent_id', label: 'Parent Category ID (parent_id)', type: 'string' },
  { value: 'flat_name', label: 'Flat Name (flat_name)', type: 'string' },
  { value: 'is_published', label: 'Is Published (is_published)', type: 'boolean' },
]

const ZID_PRODUCT_FIELDS = [
  { value: 'id', label: 'Product ID (id)', type: 'string' },
  { value: 'sku', label: 'SKU (sku)', type: 'string' },
  { value: 'barcode', label: 'Barcode (barcode)', type: 'string' },
  { value: 'name.ar', label: 'Product Name Arabic (name.ar)', type: 'string' },
  { value: 'name.en', label: 'Product Name English (name.en)', type: 'string' },
  { value: 'price', label: 'Price (price)', type: 'number' },
  { value: 'sale_price', label: 'Sale Price (sale_price)', type: 'number' },
  { value: 'cost', label: 'Cost Price (cost)', type: 'number' },
  { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
  { value: 'is_infinite', label: 'Infinite Stock (is_infinite)', type: 'boolean' },
  { value: 'weight.value', label: 'Weight Value (weight.value)', type: 'number' },
  { value: 'weight.unit', label: 'Weight Unit (weight.unit)', type: 'string' },
  { value: 'requires_shipping', label: 'Requires Shipping (requires_shipping)', type: 'boolean' },
]

const ZID_CUSTOMER_FIELDS = [
  { value: 'id', label: 'Customer ID (id)', type: 'number' },
  { value: 'name', label: 'Full Name (name)', type: 'string' },
  { value: 'email', label: 'Email (email)', type: 'string' },
  { value: 'mobile', label: 'Mobile Number (mobile)', type: 'string' },
  { value: 'telephone', label: 'Telephone (telephone)', type: 'string' },
  { value: 'gender', label: 'Gender (gender)', type: 'string' },
  { value: 'birth_date', label: 'Birth Date (birth_date)', type: 'string' },
  { value: 'verified', label: 'Is Verified (verified)', type: 'boolean' },
  { value: 'is_active', label: 'Is Active (is_active)', type: 'boolean' },
]

const SALLA_CATEGORY_FIELDS = [
  { value: 'id', label: 'Category ID (id)', type: 'number' },
  { value: 'name', label: 'Category Name (name)', type: 'string' },
  { value: 'slug', label: 'Slug (slug)', type: 'string' },
  { value: 'parent_id', label: 'Parent Category ID (parent_id)', type: 'number' },
  { value: 'is_published', label: 'Is Published (is_published)', type: 'boolean' },
]

const SALLA_PRODUCT_FIELDS = [
  { value: 'id', label: 'Product ID (id)', type: 'number' },
  { value: 'sku', label: 'SKU (sku)', type: 'string' },
  { value: 'name', label: 'Product Name (name)', type: 'string' },
  { value: 'price', label: 'Price (price)', type: 'number' },
  { value: 'quantity', label: 'Stock Quantity (quantity)', type: 'number' },
  { value: 'barcode', label: 'Barcode (barcode)', type: 'string' },
]

const SALLA_CUSTOMER_FIELDS = [
  { value: 'id', label: 'Customer ID (id)', type: 'number' },
  { value: 'name', label: 'Full Name (name)', type: 'string' },
  { value: 'email', label: 'Email (email)', type: 'string' },
  { value: 'phone', label: 'Phone (phone)', type: 'string' },
  { value: 'gender', label: 'Gender (gender)', type: 'string' },
]

const SHOPIFY_COLLECTION_FIELDS = [
  { value: 'id', label: 'Collection ID (id)', type: 'number' },
  { value: 'title', label: 'Title (title)', type: 'string' },
  { value: 'handle', label: 'Handle (handle)', type: 'string' },
  { value: 'body_html', label: 'Description (body_html)', type: 'string' },
]

const SHOPIFY_PRODUCT_FIELDS = [
  { value: 'id', label: 'Product ID (id)', type: 'number' },
  { value: 'title', label: 'Title (title)', type: 'string' },
  { value: 'variants.0.sku', label: 'SKU (variants.0.sku)', type: 'string' },
  { value: 'variants.0.price', label: 'Price (variants.0.price)', type: 'number' },
  { value: 'variants.0.barcode', label: 'Barcode (variants.0.barcode)', type: 'string' },
  { value: 'variants.0.inventory_quantity', label: 'Stock Qty (variants.0.inventory_quantity)', type: 'number' },
  { value: 'body_html', label: 'Description (body_html)', type: 'string' },
]

const SHOPIFY_CUSTOMER_FIELDS = [
  { value: 'id', label: 'Customer ID (id)', type: 'number' },
  { value: 'name', label: 'Full Name (name)', type: 'string' },
  { value: 'email', label: 'Email (email)', type: 'string' },
  { value: 'phone', label: 'Phone (phone)', type: 'string' },
  { value: 'orders_count', label: 'Orders Count (orders_count)', type: 'number' },
  { value: 'total_spent', label: 'Total Spent (total_spent)', type: 'number' },
]

const MOCK_ODOO_CATEGORY_FIELDS = [
  { value: 'name', label: 'Name (الاسم)', type: 'char' },
  { value: 'parent_id', label: 'Parent Category (التصنيف الأب)', type: 'many2one', relation: 'product.category' },
]

const MOCK_ODOO_PRODUCT_FIELDS = [
  { value: 'name', label: 'Name (الاسم)', type: 'char' },
  { value: 'list_price', label: 'Sales Price (سعر البيع)', type: 'float' },
  { value: 'standard_price', label: 'Cost Price (التكلفة)', type: 'float' },
  { value: 'default_code', label: 'SKU / Internal Reference (الرمز المرجعي)', type: 'char' },
  { value: 'barcode', label: 'Barcode (الباركود)', type: 'char' },
]

const MOCK_ODOO_CUSTOMER_FIELDS = [
  { value: 'name', label: 'Name (الاسم)', type: 'char' },
  { value: 'email', label: 'Email (البريد الإلكتروني)', type: 'char' },
  { value: 'phone', label: 'Phone (الهاتف)', type: 'char' },
  { value: 'mobile', label: 'Mobile (الجوال)', type: 'char' },
  { value: 'street', label: 'Street Address (الشارع)', type: 'char' },
  { value: 'city', label: 'City (المدينة)', type: 'char' },
  { value: 'zip', label: 'Zip Code (الرمز البريدي)', type: 'char' },
  { value: 'vat', label: 'Tax ID / VAT (الرقم الضريبي)', type: 'char' },
  { value: 'company_registry', label: 'Company Registry (السجل التجاري)', type: 'char' },
]

type MappingLine = {
  id: string
  erpField: string
  zidField?: string
  staticValue?: any
}

export default function TransferClient({
  initialModels,
  hasOdooConnection,
  preloadedFields,
  connectedStores
}: TransferClientProps) {
  const { t, lang, dir } = useLanguage()

  // Platform + store state — auto-select if only one store connected.
  // Multi-store: the picker selects a STORE (identifier), not just a platform.
  const defaultStore = connectedStores.length === 1
    ? connectedStores[0]
    : (connectedStores.find(s => s.platform === 'zid') || connectedStores[0])
  const [platform, setPlatform] = useState<'zid' | 'salla' | 'shopify'>(defaultStore?.platform || 'zid')
  const [selectedStoreId, setSelectedStoreId] = useState<string>(defaultStore?.identifier || '')
  const handleStoreChange = (identifier: string) => {
    const found = connectedStores.find(s => s.identifier === identifier)
    if (found) {
      setPlatform(found.platform)
      setSelectedStoreId(found.identifier)
    }
  }

  // Basic Settings State
  const [transferName, setTransferName] = useState(lang === 'ar' ? 'عملية نقل أولية' : 'Initial Transfer')
  const [directionState, setDirectionState] = useState<'store_to_odoo' | 'odoo_to_store'>('store_to_odoo')
  const [dataType, setDataType] = useState<'categories' | 'products' | 'customers'>('categories')
  const [odooModel, setOdooModel] = useState('product.category')

  // Mappings State
  const [mappings, setMappings] = useState<MappingLine[]>([
    { id: '1', erpField: 'name', zidField: 'names.ar' },
    { id: '2', erpField: 'parent_id', zidField: 'parent_id' }
  ])

  // Fields and Loading State
  const [odooFields, setOdooFields] = useState<any[]>(preloadedFields || [])
  const [, setIsLoadingFields] = useState(false)
  const [staticOptions, setStaticOptions] = useState<Record<string, any[]>>({})
  const [isLoadingStaticOptions, setIsLoadingStaticOptions] = useState<Record<string, boolean>>({})

  // History State
  const [transfers, setTransfers] = useState<any[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)

  // Execution State
  const [isStarting, setIsStarting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Modal State for Failure Log
  const [showLogModal, setShowLogModal] = useState(false)
  const [activeLog, setActiveLog] = useState('')

  const [mounted, setMounted] = useState(false)

  // Track loaded/loading status of many2one fields to prevent duplicate API requests & infinite loops
  const loadedFieldsRef = useRef<Record<string, boolean>>({})
  const loadingFieldsRef = useRef<Record<string, boolean>>({})

  // Reset static options states and refs when the Odoo connection or target model changes
  useEffect(() => {
    setStaticOptions({})
    setIsLoadingStaticOptions({})
    loadedFieldsRef.current = {}
    loadingFieldsRef.current = {}
  }, [odooModel, hasOdooConnection])

  // Load static options for many2one fields in mappings
  useEffect(() => {
    const loadNeededOptions = async () => {
      const many2oneLines = mappings.filter(line => {
        const fieldObj = odooFields.find(f => f.value === line.erpField)
        return fieldObj?.type === 'many2one'
      })

      for (const line of many2oneLines) {
        const erpFieldName = line.erpField
        
        if (loadedFieldsRef.current[erpFieldName] || loadingFieldsRef.current[erpFieldName]) {
          continue
        }

        if (!hasOdooConnection) {
          loadedFieldsRef.current[erpFieldName] = true
          setStaticOptions(prev => ({
            ...prev,
            [erpFieldName]: [
              { value: '1', label: lang === 'ar' ? 'تصنيف افتراضي' : 'Default Category' },
              { value: '2', label: lang === 'ar' ? 'تصنيف فرعي' : 'Sub Category' }
            ]
          }))
          continue
        }

        loadingFieldsRef.current[erpFieldName] = true
        setIsLoadingStaticOptions(prev => ({ ...prev, [erpFieldName]: true }))
        
        try {
          const res = await getOdooFieldValueOptions(odooModel, erpFieldName)
          if (res.success && res.options) {
            setStaticOptions(prev => ({ ...prev, [erpFieldName]: res.options }))
          } else {
            setStaticOptions(prev => ({ ...prev, [erpFieldName]: [] }))
          }
        } catch (err) {
          console.error('Failed to load static options:', err)
          setStaticOptions(prev => ({ ...prev, [erpFieldName]: [] }))
        } finally {
          loadingFieldsRef.current[erpFieldName] = false
          loadedFieldsRef.current[erpFieldName] = true
          setIsLoadingStaticOptions(prev => ({ ...prev, [erpFieldName]: false }))
        }
      }
    }

    loadNeededOptions()
  }, [mappings, odooFields, odooModel, hasOdooConnection, lang])

  // Sync transfer name dynamically when language changes
  useEffect(() => {
    setTransferName(lang === 'ar' ? 'عملية نقل أولية' : 'Initial Transfer')
  }, [lang])

  // Deletion countdown helper
  const getDeletionCountdown = (createdAtStr: string, status: string) => {
    const createdAt = new Date(createdAtStr).getTime()
    const now = Date.now()
    
    // completed transfers expire in 72 hours, other logs in 7 days
    const duration = status === 'completed' 
      ? 72 * 60 * 60 * 1000 // 72 hours
      : 7 * 24 * 60 * 60 * 1000 // 7 days
      
    const expiresAt = createdAt + duration
    const remainingMs = expiresAt - now
    
    if (remainingMs <= 0) {
      return lang === 'ar' ? 'جاري الحذف...' : 'Deleting soon...'
    }
    
    const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000))
    if (remainingHours >= 24) {
      const days = Math.floor(remainingHours / 24)
      const hours = remainingHours % 24
      if (lang === 'ar') {
        return `الحذف بعد: ${days} يوم و ${hours} ساعة`
      } else {
        return `Deletes in: ${days}d ${hours}h`
      }
    } else {
      const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000))
      if (lang === 'ar') {
        return `الحذف بعد: ${remainingHours} ساعة و ${minutes} دقيقة`
      } else {
        return `Deletes in: ${remainingHours}h ${minutes}m`
      }
    }
  }

  // 1. Fetch Transfer History
  const loadHistory = async (silent = false) => {
    if (!silent) setIsLoadingHistory(true)
    try {
      const res = await getTransfers()
      if (res.success && res.transfers) {
        setTransfers(res.transfers)
      }
    } catch (err) {
      console.error('Failed to load transfer history:', err)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  useEffect(() => {
    setMounted(true)
    loadHistory()
  }, [])

  // Poll status every 4 seconds to show live progress logs, ONLY if there is a pending or running transfer
  useEffect(() => {
    const hasActiveTransfer = transfers.some(
      t => t.status === 'pending' || t.status === 'running'
    )

    if (!hasActiveTransfer) return

    const interval = setInterval(() => {
      loadHistory(true)
    }, 4000)

    return () => clearInterval(interval)
  }, [transfers])

  // 2. Fetch Odoo Fields dynamically when model changes
  useEffect(() => {
    const fetchFields = async () => {
      if (!hasOdooConnection) {
        // Load offline demo fields
        if (odooModel === 'product.category') {
          setOdooFields(MOCK_ODOO_CATEGORY_FIELDS)
        } else if (odooModel === 'product.template') {
          setOdooFields(MOCK_ODOO_PRODUCT_FIELDS)
        } else {
          setOdooFields(MOCK_ODOO_CUSTOMER_FIELDS)
        }
        return
      }

      setIsLoadingFields(true)
      try {
        const res = await getOdooModelFields(odooModel)
        if (res.success && res.fields) {
          setOdooFields(res.fields)
        }
      } catch (err) {
        console.error('Failed to fetch Odoo fields:', err)
      } finally {
        setIsLoadingFields(false)
      }
    }

    fetchFields()
  }, [odooModel, hasOdooConnection])

  // 3. Sync default mappings when dataType changes
  useEffect(() => {
    if (dataType === 'categories') {
      setOdooModel('product.category')
      setMappings([
        { id: '1', erpField: 'name', zidField: 'names.ar' },
        { id: '2', erpField: 'parent_id', zidField: 'parent_id' }
      ])
    } else if (dataType === 'products') {
      setOdooModel('product.template')
      setMappings([
        { id: '1', erpField: 'name', zidField: 'name.ar' },
        { id: '2', erpField: 'list_price', zidField: 'price' },
        { id: '3', erpField: 'default_code', zidField: 'sku' }
      ])
    } else {
      setOdooModel('res.partner')
      setMappings([
        { id: '1', erpField: 'name', zidField: 'name' },
        { id: '2', erpField: 'email', zidField: 'email' },
        { id: '3', erpField: 'mobile', zidField: 'mobile' }
      ])
    }
  }, [dataType])

  // Get active fields depending on selected platform and datatype
  const currentStoreFields = (() => {
    if (platform === 'salla') {
      if (dataType === 'categories') return SALLA_CATEGORY_FIELDS
      if (dataType === 'products') return SALLA_PRODUCT_FIELDS
      return SALLA_CUSTOMER_FIELDS
    }
    if (platform === 'shopify') {
      if (dataType === 'categories') return SHOPIFY_COLLECTION_FIELDS
      if (dataType === 'products') return SHOPIFY_PRODUCT_FIELDS
      return SHOPIFY_CUSTOMER_FIELDS
    }
    // Zid (default)
    if (dataType === 'categories') return ZID_CATEGORY_FIELDS
    if (dataType === 'products') return ZID_PRODUCT_FIELDS
    return ZID_CUSTOMER_FIELDS
  })()

  const platformLabel = platform === 'zid' ? 'Zid' : platform === 'salla' ? 'Salla' : 'Shopify'



  // Mapping line modifications
  const handleFieldChange = (id: string, key: 'erpField' | 'zidField', value: string) => {
    setMappings(prev => prev.map(line => {
      if (line.id !== id) return line
      
      const updated = { ...line, [key]: value }
      if (key === 'erpField') {
        // Reset static values on ERP field change
        updated.staticValue = undefined
      }
      return updated
    }))
  }

  const handleStaticValueChange = (id: string, val: any) => {
    setMappings(prev => prev.map(line => {
      if (line.id !== id) return line
      return { ...line, staticValue: val, zidField: undefined } // Clear dynamic field if static value is set
    }))
  }

  const handleAddLine = () => {
    const nextId = (Math.max(...mappings.map(m => parseInt(m.id) || 0), 0) + 1).toString()
    setMappings(prev => [...prev, { id: nextId, erpField: odooFields[0]?.value || '' }])
  }

  const handleRemoveLine = (id: string) => {
    setMappings(prev => prev.filter(line => line.id !== id))
  }

  const hasStaticValue = (val: any) => {
    if (val === undefined || val === null || val === '') return false
    if (Array.isArray(val) && val.length === 0) return false
    return true
  }

  // Render static values inputs
  const renderStaticInput = (line: MappingLine) => {
    const fieldObj = odooFields.find(f => f.value === line.erpField)
    if (!fieldObj) return null

    const type = fieldObj.type
    const isStaticDisabled = !!line.zidField

    if (type === 'boolean') {
      const valStr = line.staticValue === undefined ? '' : String(line.staticValue)
      return (
        <SearchableSelect
          value={valStr}
          onChange={(val) => handleStaticValueChange(line.id, val === 'true')}
          disabled={isStaticDisabled}
          options={[
            { value: 'true', label: lang === 'ar' ? 'نعم (True)' : 'True' },
            { value: 'false', label: lang === 'ar' ? 'لا (False)' : 'False' }
          ]}
          placeholder={lang === 'ar' ? 'اختر قيمة بولية...' : 'Select boolean...'}
          variant="cell"
        />
      )
    }

    if (type === 'many2one') {
      const options = staticOptions[line.erpField] || []
      const isLoadingOpt = isLoadingStaticOptions[line.erpField]

      return (
        <div className="w-full flex items-center gap-1">
          <SearchableSelect
            value={line.staticValue === undefined ? '' : String(line.staticValue)}
            onChange={(val) => handleStaticValueChange(line.id, val)}
            disabled={isStaticDisabled || isLoadingOpt}
            options={options}
            placeholder={isLoadingOpt ? (lang === 'ar' ? 'جاري التحميل...' : 'Loading...') : (lang === 'ar' ? 'اختر سجلاً...' : 'Select record...')}
            variant="cell"
          />
          {isLoadingOpt && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
      )
    }

    if (['integer', 'float', 'monetary'].includes(type)) {
      return (
        <input
          type="number"
          value={Array.isArray(line.staticValue) ? '' : String(line.staticValue || '')}
          onChange={(e) => handleStaticValueChange(line.id, e.target.value)}
          disabled={isStaticDisabled}
          placeholder={lang === 'ar' ? 'رقم ثابت...' : 'Static number...'}
          className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-xs outline-none hover:bg-muted focus:border-foreground focus:ring-1 focus:ring-foreground disabled:opacity-50"
        />
      )
    }

    return (
      <input
        type="text"
        value={Array.isArray(line.staticValue) ? line.staticValue.join(', ') : String(line.staticValue || '')}
        onChange={(e) => handleStaticValueChange(line.id, e.target.value)}
        disabled={isStaticDisabled}
        placeholder={lang === 'ar' ? 'نص ثابت...' : 'Static text...'}
        className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-xs outline-none hover:bg-muted focus:border-foreground focus:ring-1 focus:ring-foreground disabled:opacity-50"
      />
    )
  }

  // Start Transfer execution
  const handleStartTransfer = async () => {
    setErrorMessage('')
    setSuccessMessage('')
    setIsStarting(true)

    if (!transferName || !transferName.trim()) {
      setErrorMessage(lang === 'ar' ? 'يرجى إدخال اسم لعملية النقل للرجوع إليها لاحقاً.' : 'Please enter a name for the transfer process.')
      setIsStarting(false)
      return
    }

    if (mappings.length === 0) {
      setErrorMessage(lang === 'ar' ? 'يجب إضافة ربط حقل واحد على الأقل للبدء.' : 'At least one field mapping is required to start.')
      setIsStarting(false)
      return
    }

    const invalidLine = mappings.find(m => !m.zidField && !hasStaticValue(m.staticValue))
    if (invalidLine) {
      const fieldLabel = odooFields.find(f => f.value === invalidLine.erpField)?.label || invalidLine.erpField
      setErrorMessage(
        lang === 'ar' 
          ? `يرجى تحديد حقل زد أو قيمة ثابتة للحقل المقابل في أودو: [${formatFieldLabel(fieldLabel, lang)}]` 
          : `Please specify a Zid field or static value for the corresponding Odoo field: [${formatFieldLabel(fieldLabel, lang)}]`
      )
      setIsStarting(false)
      return
    }

    try {
      const payloadMappings = {
        [odooModel]: mappings.map(m => ({
          id: m.id,
          erpField: m.erpField,
          zidField: m.zidField || undefined,
          staticValue: m.staticValue || undefined
        }))
      }

      const res = await startInitialTransfer({
        name: transferName,
        dataType: dataType as any,
        direction: directionState as any,
        platform,
        storeKey: selectedStoreId || undefined,
        odooModel,
        mappings: payloadMappings
      })

      if (res.success) {
        setSuccessMessage(lang === 'ar' ? 'تم بدء عملية النقل بنجاح! يمكنك متابعة التقدم في السجل أدناه.' : 'Initial transfer started successfully! You can monitor progress in the log below.')
        loadHistory()
      } else {
        setErrorMessage(res.error || (lang === 'ar' ? 'فشل تشغيل عملية النقل' : 'Failed to run the transfer process.'))
      }
    } catch (err: any) {
      console.error('Error starting initial transfer:', err)
      setErrorMessage(err.message || (lang === 'ar' ? 'حدث خطأ أثناء تشغيل عملية النقل' : 'An error occurred during the transfer process.'))
    } finally {
      setIsStarting(false)
    }
  }

  // Render Status Badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground border border-border">
            <Loader2 className="h-3 w-3 animate-spin" />
            {lang === 'ar' ? 'في الانتظار' : 'Pending'}
          </span>
        )
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold bg-muted text-foreground border border-border">
            <Loader2 className="h-3 w-3 animate-spin" />
            {lang === 'ar' ? 'جاري النقل' : 'Running'}
          </span>
        )
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold bg-muted text-foreground border border-border">
            <CheckCircle className="h-3 w-3" />
            {lang === 'ar' ? 'اكتمل' : 'Completed'}
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/20">
            <XCircle className="h-3 w-3" />
            {lang === 'ar' ? 'فشل' : 'Failed'}
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground">
            {status}
          </span>
        )
    }
  }

  if (!mounted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] bg-card border border-border rounded-lg p-8" dir={dir}>
        <Loader2 className="h-8 w-8 text-muted-foreground animate-spin mb-3" />
        <p className="text-xs text-muted-foreground font-semibold">{lang === 'ar' ? 'جاري تحميل واجهة النقل...' : 'Loading transfer interface...'}</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-foreground font-sans" dir={dir}>
      
      {/* Top Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          {lang === 'ar' ? 'نقل البيانات' : 'Initial Data Transfer'}
        </h1>
        <p className="mt-1 text-muted-foreground text-[11px] leading-relaxed">
          {lang === 'ar' 
            ? `استيراد وتحديث البيانات الموجودة مسبقاً في متجر ${platformLabel} إلى نظام أودو لأول مرة مباشرة عبر الـ APIs وبدون الحاجة لانتظار Webhooks.` 
            : `Import and update existing data from ${platformLabel} store to Odoo ERP for the first time directly via APIs without waiting for webhooks.`}
        </p>
      </div>

      {/* Main Settings Card */}
      <div className="bg-card border p-4 md:p-5 space-y-5">
        <h3 className="font-bold text-sm text-foreground pb-2 border-b border-border flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {lang === 'ar' ? 'خيارات المزامنة الأساسية' : 'Primary Sync Settings'}
        </h3>

        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 text-xs">
          {/* Platform Selector */}
          {connectedStores.length > 1 && (
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {lang === 'ar' ? 'المتجر' : 'Store'}
              </label>
              <SearchableSelect
                value={selectedStoreId}
                onChange={(val) => handleStoreChange(val as string)}
                options={connectedStores.map(s => ({
                  value: s.identifier,
                  label: `${s.platform === 'zid' ? 'Zid' : s.platform === 'salla' ? 'Salla' : 'Shopify'} — ${s.label}`
                }))}
                placeholder={lang === 'ar' ? 'اختر المتجر...' : 'Select store...'}
              />
            </div>
          )}

          {/* Transfer Name Input */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'اسم عملية النقل' : 'Transfer Name'}
            </label>
            <input
              type="text"
              value={transferName}
              onChange={(e) => setTransferName(e.target.value)}
              placeholder={lang === 'ar' ? 'اسم العملية (مثال: نقل المنتجات المبدئي)' : 'Process name (e.g. Initial Products Transfer)'}
              className="h-9.5 w-full rounded-lg border border-border px-3 text-xs outline-none focus:border-foreground focus:ring-1 focus:ring-foreground bg-transparent"
            />
          </div>

          {/* Direction Selector */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'اتجاه النقل' : 'Sync Direction'}
            </label>
            <SearchableSelect
              value={directionState}
              onChange={(val) => setDirectionState(val as any)}
              options={[
                { value: 'store_to_odoo', label: `${platformLabel} ➔ Odoo` },
                { value: 'odoo_to_store', label: `Odoo ➔ ${platformLabel}` }
              ]}
              placeholder={lang === 'ar' ? 'اختر اتجاه النقل...' : 'Select sync direction...'}
            />
          </div>

          {/* Data Type Selector */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'نوع البيانات' : 'Data Type'}
            </label>
            <SearchableSelect
              value={dataType}
              onChange={(val) => setDataType(val as any)}
              options={[
                { value: 'categories', label: lang === 'ar' ? 'التصنيفات' : 'Categories' },
                { value: 'products', label: lang === 'ar' ? 'المنتجات' : 'Products' },
                { value: 'customers', label: lang === 'ar' ? 'العملاء' : 'Customers' }
              ]}
              placeholder={lang === 'ar' ? 'اختر نوع البيانات...' : 'Select data type...'}
            />
          </div>

          {/* Odoo Model Selector */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              {lang === 'ar' ? 'نموذج أودو المستهدف' : 'Target Odoo Model'}
            </label>
            <SearchableSelect
              value={odooModel}
              onChange={(val) => setOdooModel(val)}
              options={
                hasOdooConnection && initialModels.length > 0
                  ? initialModels.map(model => ({
                      value: model.model,
                      label: model.name ? `${formatFieldLabel(model.name, lang)} (${model.model})` : model.model,
                      desc: model.model
                    }))
                  : [
                      { value: 'product.category', label: `${lang === 'ar' ? 'تصنيف المنتجات' : 'Product Category'} (product.category)` },
                      { value: 'product.template', label: `${lang === 'ar' ? 'قالب المنتجات' : 'Product Template'} (product.template)` },
                      { value: 'res.partner', label: `${lang === 'ar' ? 'العميل/شريك العمل' : 'Customer/Contact'} (res.partner)` }
                    ]
              }
              placeholder={lang === 'ar' ? 'اختر نموذج أودو...' : 'Select Odoo model...'}
            />
          </div>
        </div>
      </div>

      {/* Field Mapping Card */}
      <div className="bg-card border p-4 md:p-5 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <div>
            <h3 className="font-bold text-sm text-foreground flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
              {t('nav.fieldMapping')}
            </h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {lang === 'ar' ? 'قم بمطابقة حقول متجر زد بالحقول المقابلة لها في نظام أودو قبل البدء.' : 'Map Zid store fields to the corresponding Odoo fields before initiating transfer.'}
            </p>
          </div>
        </div>

        {/* Mappings Table */}
        <div className="border border-border rounded-lg overflow-visible bg-card">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="bg-muted/50 text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                <th className="py-2.5 px-4 font-bold text-start">{lang === 'ar' ? 'حقل أودو ERP' : 'Odoo ERP Field'}</th>
                <th className="py-2.5 px-4 font-bold text-start">{lang === 'ar' ? `حقل ${platformLabel}` : `${platformLabel} Field`}</th>
                <th className="py-2.5 px-4 font-bold text-start">{t('map.staticValue')}</th>
                <th className="py-2.5 px-4 w-12 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y border-border text-xs">
              {mappings.map((line) => (
                <tr key={line.id} className="hover:bg-muted/20 group transition-all">
                  
                  {/* Odoo Field */}
                  <td className="py-1 px-4 text-start">
                    <SearchableSelect
                      value={line.erpField}
                      onChange={(val) => handleFieldChange(line.id, 'erpField', val)}
                      options={odooFields.map(opt => ({
                        ...opt,
                        label: formatFieldLabel(opt.label, lang)
                      }))}
                      placeholder={t('map.selectField')}
                      variant="cell"
                    />
                  </td>

                  {/* Zid Field */}
                  <td className="py-1 px-4 text-start">
                    <div className="flex items-center gap-1">
                      <SearchableSelect
                        value={line.zidField || ''}
                        onChange={(val) => handleFieldChange(line.id, 'zidField', val)}
                        options={[
                          { value: '', label: t('map.clear') },
                          ...currentStoreFields.map(opt => ({
                            ...opt,
                            label: formatFieldLabel(opt.label, lang)
                          }))
                        ]}
                        placeholder={t('map.selectField')}
                        variant="cell"
                        disabled={hasStaticValue(line.staticValue)}
                      />
                      {line.zidField && (
                        <button
                          type="button"
                          onClick={() => handleFieldChange(line.id, 'zidField', '')}
                          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Static Value */}
                  <td className="py-1 px-4 text-start">
                    <div className="flex items-center gap-1">
                      {renderStaticInput(line)}
                      {hasStaticValue(line.staticValue) && (
                        <button
                          type="button"
                          onClick={() => handleStaticValueChange(line.id, Array.isArray(line.staticValue) ? [] : '')}
                          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Remove Action */}
                  <td className="py-1 px-4 text-left">
                    <button
                      onClick={() => handleRemoveLine(line.id)}
                      className="text-muted-foreground hover:text-destructive p-1.5 rounded-lg hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                      title={lang === 'ar' ? 'حذف السطر' : 'Remove Line'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}

              {mappings.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground italic">
                    {t('map.noMappings')}
                  </td>
                </tr>
              )}

              {/* Add Line Row */}
              <tr>
                <td colSpan={4} className="py-2.5 px-4 bg-muted/20 text-start">
                  <button
                    onClick={handleAddLine}
                    className="text-foreground hover:text-muted-foreground font-bold flex items-center gap-1.5 transition-all text-xs"
                  >
                    <Plus className="h-4 w-4" />
                    {t('map.addFieldBtn')}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Trigger Button & Messages */}
        <div className="pt-2 flex flex-col gap-3">
          {errorMessage && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive font-semibold flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {errorMessage}
            </div>
          )}
          {successMessage && (
            <div className="rounded-lg border bg-muted p-3 text-xs text-foreground font-semibold flex items-center gap-2">
              <CheckCircle className="h-4 w-4 shrink-0" />
              {successMessage}
            </div>
          )}

          <Button
            onClick={handleStartTransfer}
            disabled={isStarting || !hasOdooConnection}
            className="bg-foreground text-background gap-2 font-bold rounded-lg h-10 text-xs hover:opacity-90 transition-all self-start"
          >
            {isStarting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {lang === 'ar' ? 'جاري بدء المزامنة...' : 'Starting sync...'}
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {lang === 'ar' ? 'بدء النقل الآن' : 'Start Transfer Now'}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Transfer Logs/History Card */}
      <div className="bg-card border p-4 md:p-5 space-y-4">
        <h3 className="font-bold text-sm text-foreground pb-2 border-b border-border flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          {lang === 'ar' ? 'سجل عمليات النقل المباشر' : 'Live Data Transfer Log'}
        </h3>

        {isLoadingHistory ? (
          <div className="flex flex-col items-center justify-center py-10 bg-muted/30 border border-border rounded-lg">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
            <p className="text-xs text-muted-foreground font-semibold">{lang === 'ar' ? 'جاري تحميل السجلات...' : 'Loading transfer records...'}</p>
          </div>
        ) : transfers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-muted/10 border border-dashed border-border rounded-lg">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
              <Info className="h-5 w-5" />
            </div>
            <h4 className="text-xs font-bold text-foreground">{lang === 'ar' ? 'لا توجد عمليات نقل سابقة' : 'No previous transfer logs found'}</h4>
            <p className="text-[10px] text-muted-foreground max-w-sm mx-auto mt-1 leading-normal">
              {lang === 'ar' 
                ? 'لم تقم بتشغيل أي عملية نقل بيانات أولية من قبل. اضبط الإعدادات بالأعلى واضغط بدء المزامنة.' 
                : 'You have not run any data transfers yet. Adjust configurations and start sync above.'}
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-muted/50 text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                  <th className="py-2.5 px-4 font-bold text-start">{lang === 'ar' ? 'اسم العملية' : 'Process Name'}</th>
                  <th className="py-2.5 px-4 font-bold text-start">{lang === 'ar' ? 'النوع' : 'Type'}</th>
                  <th className="py-2.5 px-4 font-bold text-start">{lang === 'ar' ? 'الاتجاه' : 'Direction'}</th>
                  <th className="py-2.5 px-4 font-bold text-start">{lang === 'ar' ? 'الوقت والتاريخ' : 'Date & Time'}</th>
                  <th className="py-2.5 px-4 font-bold text-start">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                  <th className="py-2.5 px-4 font-bold text-center">{lang === 'ar' ? 'المجلوبة' : 'Fetched'}</th>
                  <th className="py-2.5 px-4 font-bold text-center">{lang === 'ar' ? 'المنشأة' : 'Created'}</th>
                  <th className="py-2.5 px-4 font-bold text-center">{lang === 'ar' ? 'الفاشلة' : 'Failed'}</th>
                  <th className="py-2.5 px-4 font-bold text-center">{lang === 'ar' ? 'سجل الأخطاء' : 'Error Log'}</th>
                </tr>
              </thead>
              <tbody className="divide-y border-border">
                {transfers.map((item) => {
                  const date = item.created_at
                    ? new Date(item.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : '-'

                  return (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4 font-bold text-foreground break-all text-start">{item.name}</td>
                      <td className="py-3 px-4 text-start">
                        <span className="font-semibold text-muted-foreground">
                          {item.data_type === 'categories' 
                            ? (lang === 'ar' ? 'التصنيفات' : 'Categories') 
                            : item.data_type === 'products' 
                              ? (lang === 'ar' ? 'المنتجات' : 'Products') 
                              : (lang === 'ar' ? 'العملاء' : 'Customers')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground font-mono text-[10px] text-start">{item.direction === 'store_to_odoo' || item.direction === 'zid_to_odoo' ? 'Store → Odoo' : 'Odoo → Store'}</td>
                      <td className="py-3 px-4 text-start">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-muted-foreground font-medium">{date}</span>
                          {(item.status === 'completed' || item.status === 'failed' || item.status === 'pending') && (
                            <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground font-bold bg-muted px-1.5 py-0.5 rounded w-fit border border-border">
                              <Clock className="h-2.5 w-2.5 text-muted-foreground" />
                              <span>{getDeletionCountdown(item.created_at, item.status)}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-start">{getStatusBadge(item.status)}</td>
                      <td className="py-3 px-4 font-bold text-center text-foreground">{item.records_fetched}</td>
                      <td className="py-3 px-4 font-bold text-center text-foreground">{item.records_created}</td>
                      <td className="py-3 px-4 font-bold text-center text-destructive">{item.records_failed}</td>
                      <td className="py-3 px-4 text-center">
                        {item.failure_reason ? (
                          <button
                            onClick={() => {
                              setActiveLog(item.failure_reason)
                              setShowLogModal(true)
                            }}
                            className="text-xs font-bold text-foreground hover:text-muted-foreground hover:underline"
                          >
                            {lang === 'ar' ? 'عرض السجل' : 'View Log'}
                          </button>
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-xl bg-card rounded-lg border border-border overflow-hidden flex flex-col">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-bold text-foreground text-sm flex items-center gap-2">
                <AlertTriangle className="h-4.5 w-4.5 text-muted-foreground" />
                {lang === 'ar' ? 'تفاصيل الأخطاء وسجل المزامنة' : 'Error Details & Sync Logs'}
              </h3>
              <button
                onClick={() => setShowLogModal(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4 flex-1">
              <div className="bg-foreground text-background p-4 rounded-lg font-mono text-xs overflow-y-auto max-h-[350px] leading-relaxed select-text" dir="ltr">
                {activeLog ? (
                  <pre className="whitespace-pre-wrap">{activeLog}</pre>
                ) : (
                  <p className="italic text-muted-foreground/60">{lang === 'ar' ? 'لا يوجد تفاصيل أخطاء مسجلة لهذه العملية.' : 'No failure details logged for this operation.'}</p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-muted/30 border-t border-border flex justify-end">
              <Button
                onClick={() => setShowLogModal(false)}
                className="h-8.5 text-xs font-bold rounded-lg px-4 border border-border bg-card hover:bg-muted text-foreground transition-all"
              >
                {lang === 'ar' ? 'إغلاق' : 'Close'}
              </Button>
            </div>

          </div>
        </div>
      )}

    </div>
  )
}
