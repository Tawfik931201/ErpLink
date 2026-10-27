'use client'

import { motion, AnimatePresence } from 'framer-motion'
import {
  SlidersHorizontal,
  Trash2,
  Plus,
  Check,
  Save,
  RotateCcw,
  HelpCircle,
  ArrowRightLeft,
  Layers,
  Loader2,
  X
} from 'lucide-react'
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

import { getEntityLinkStats } from '@/app/actions/entity-links'
import { saveFieldMapping } from '@/app/actions/field-mappings'
import { getOdooFieldValueOptions, getOdooModelFields, refreshOdooCache } from '@/app/actions/odoo'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import {
  ODOO_MODELS,
  ODOO_FIELDS,
  STORE_VARIANT_FIELDS,
  ZID_EVENTS,
  SALLA_EVENTS,
  SHOPIFY_EVENTS,
  ZID_FIELDS,
  ZID_SUB_FIELDS,
  SALLA_FIELDS,
  SHOPIFY_FIELDS,
} from '@/lib/mapping-constants'
import { formatFieldLabel } from '@/lib/translations'
import { cn } from '@/lib/utils'

import RelationsGraph from './relations-graph'
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

export {
  ODOO_MODELS,
  ODOO_FIELDS,
  STORE_VARIANT_FIELDS,
  ZID_EVENTS,
  SALLA_EVENTS,
  SHOPIFY_EVENTS,
  ZID_FIELDS,
  ZID_SUB_FIELDS,
  SALLA_FIELDS,
  SHOPIFY_FIELDS,
}


const ODOO_OPERATIONS = [
  { value: 'create', label: 'Create (إنشاء)' },
  { value: 'update', label: 'Update (تعديل)' },
  { value: 'delete', label: 'Delete (حذف)' },
]

const EMPTY_SELECT_OPTION = { value: '', label: 'فارغ (Clear)' }

// Reserved platform-side match field meaning "the Odoo id saved for this
// record" (see STORED_ODOO_ID_FIELD in src/lib/entity-links.ts — pinned
// equal by tests/unit/entity-links.test.ts). Literal here on purpose:
// importing entity-links would drag the Supabase client into this browser
// bundle for a single string.
const STORED_ODOO_ID_LITERAL = '__odoo_record_id'

type MappingLine = {
  id: string
  erpField: string
  zidField?: string
  staticValue?: string | string[] | number | boolean
  policy?: 'create' | 'default' | 'block' | 'none'
  createMappingId?: string
  fuzzyMatchMappings?: Array<{ erpField: string; platformField: string }>
  matchOperator?: 'OR' | 'AND'
  inlineSubMapping?: {
    relation: string
    lines: Array<{ erpField: string; zidField?: string; staticValue?: string }>
  }
  inlineMatch?: {
    erpField: string
    platformField: string
  }
}

/**
 * One labelled cell of the record header grid. It is deliberately identical to
 * the read-only record page's InfoField (tiny uppercase caption + value), so the
 * form and the display are the same sheet — only the value is a live control.
 */
function FormCell({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 break-all text-xs text-foreground">{children}</div>
      {hint ? <div className="mt-1 space-y-0.5 empty:hidden">{hint}</div> : null}
    </div>
  )
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
  initialOdooFallbackPolicy,
  initialOdooVariantSyncMode,
  initialOdooVariantOdooMatchField,
  initialOdooVariantZidMatchField,
  initialMappings,
  initialRelatedModels,
  initialName,
  isZidConnected = false,
  isSallaConnected = false,
  isShopifyConnected = false,
  onCancel,
  onSuccess,
  fixedMappings = [],
  initialSyncDirection,
  allMappings = [],
  initialStoreKey = '',
  zidStores = [],
  sallaStores = [],
  shopifyStores = []
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
  initialOdooFallbackPolicy?: 'none' | 'create' | 'block'
  initialOdooVariantSyncMode?: 'AS_VARIANTS' | 'AS_SEPARATE_PRODUCTS'
  initialOdooVariantOdooMatchField?: string
  initialOdooVariantZidMatchField?: string
  initialMappings?: any
  initialRelatedModels?: string[]
  initialName?: string
  isZidConnected?: boolean
  isSallaConnected?: boolean
  isShopifyConnected?: boolean
  onCancel?: () => void
  onSuccess?: () => void
  fixedMappings?: any[]
  initialSyncDirection?: string
  allMappings?: any[]
  /** Multi-store: merchant_id / shop_domain the new mapping attaches to (create view). */
  initialStoreKey?: string
  /** Multi-store: every linked store per platform, for the create-view store picker. */
  zidStores?: { id: string; name: string | null }[]
  sallaStores?: { id: string; name: string | null }[]
  shopifyStores?: { id: string; name: string | null }[]
}) {
  const { t, lang, dir } = useLanguage()
  const [name, setName] = useState(initialName || '')

  // Determine starting platform dynamically
  const [platform, setPlatform] = useState<'zid' | 'salla' | 'shopify'>(() => {
    if (initialAction) {
      const isSallaEvent = SALLA_EVENTS.some(e => e.id === initialAction)
      const isZidEvent = ZID_EVENTS.some(e => e.id === initialAction)
      const isShopifyEvent = SHOPIFY_EVENTS.some(e => e.id === initialAction)
      if (isSallaEvent) return 'salla'
      if (isShopifyEvent) return 'shopify'
      if (isZidEvent) return 'zid'
    }
    return isShopifyConnected && !isZidConnected && !isSallaConnected
      ? 'shopify'
      : isSallaConnected && !isZidConnected
        ? 'salla'
        : 'zid'
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
  const [odooFallbackPolicy, setOdooFallbackPolicy] = useState<'none' | 'create' | 'block'>(initialOdooFallbackPolicy || 'none')
  const [variantSyncMode, setVariantSyncMode] = useState<'AS_VARIANTS' | 'AS_SEPARATE_PRODUCTS'>(() => {
    return initialOdooVariantSyncMode || (initialMappings as any)?.__settings?.variantSyncMode || 'AS_VARIANTS'
  })
  const [variantOdooMatchField, setVariantOdooMatchField] = useState<string>(() => {
    return initialOdooVariantOdooMatchField || (initialMappings as any)?.__settings?.variantOdooMatchField || ''
  })
  const [variantZidMatchField, setVariantZidMatchField] = useState<string>(() => {
    return initialOdooVariantZidMatchField || (initialMappings as any)?.__settings?.variantZidMatchField || ''
  })
  const [syncDirection, setSyncDirection] = useState<string>(initialSyncDirection || 'store_to_erp')
  // Multi-store: the store a NEW mapping attaches to (merchant_id / shop_domain).
  // Editing keeps the row's own store server-side unless the platform changes,
  // which resets to the platform default (newest store).
  const [storeKey, setStoreKey] = useState<string>(initialStoreKey || '')

  // Stores of a platform, for the create-view store picker.
  const storesOf = (p: string): { id: string; name: string | null }[] =>
    p === 'zid' ? (zidStores || []) : p === 'salla' ? (sallaStores || []) : (shopifyStores || [])
  const platformStores = storesOf(platform)
  const firstStoreIdOf = (p: string): string => storesOf(p)[0]?.id || ''

  // Normalize once on mount: the incoming store key may belong to another
  // platform than the form's initial one — snap it to this platform so the
  // picker and the saved row never disagree.
  useEffect(() => {
    if (storeKey && !storesOf(platform).some(s => s.id === storeKey)) {
      setStoreKey(firstStoreIdOf(platform))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchPlatform = (p: 'zid' | 'salla' | 'shopify', defaultEvent: string) => {
    setPlatform(p)
    setStoreKey(firstStoreIdOf(p))
    setZidEvent(defaultEvent)
    setIsSaved(false)
  }
  const [zidEvent, setZidEvent] = useState(initialAction || (isSallaConnected && !isZidConnected ? 'product.created' : 'product.create'))

  // Selected related models array (chips/tags state)
  const [relatedOdooModels, setRelatedOdooModels] = useState<string[]>(initialRelatedModels || [])

  // Notebook/Tabs active tab state
  const [activeTab, setActiveTab] = useState<string>(initialOdooModel || defaultModel)

  // Relations linkage configuration
  const [relations] = useState<Array<{ sourceModel: string; relationField: string; targetModel: string }>>(() => {
    return (initialMappings as any)?.__settings?.relations || []
  })

  // Webhook payload paths for child models
  const [payloadPaths, setPayloadPaths] = useState<Record<string, string>>(() => {
    return (initialMappings as any)?.__settings?.payloadPaths || {}
  })

  // Shipping cost line configuration
  const [addShippingAsLine, setAddShippingAsLine] = useState<boolean>(() => {
    return !!(initialMappings as any)?.__settings?.addShippingAsLine
  })
  const [shippingProductId, setShippingProductId] = useState<string>(() => {
    return (initialMappings as any)?.__settings?.shippingProductId || ''
  })
  const [shippingProductSku, setShippingProductSku] = useState<string>(() => {
    return (initialMappings as any)?.__settings?.shippingProductSku || ''
  })

  // Discount line configuration (Line B: Order-Level Discount-as-Line)
  const [addDiscountAsLine, setAddDiscountAsLine] = useState<boolean>(() => {
    return !!(initialMappings as any)?.__settings?.addDiscountAsLine
  })
  const [discountProductId, setDiscountProductId] = useState<string>(() => {
    return (initialMappings as any)?.__settings?.discountProductId || ''
  })
  const [discountProductSku, setDiscountProductSku] = useState<string>(() => {
    return (initialMappings as any)?.__settings?.discountProductSku || ''
  })
  const [discountMode, setDiscountMode] = useState<'fixed' | 'percent'>(() => {
    return (initialMappings as any)?.__settings?.discountMode || 'fixed'
  })

  // Delete event behavior setting
  const [deleteBehavior, setDeleteBehavior] = useState<string[]>(() => {
    const raw = (initialMappings as any)?.__settings?.deleteBehavior
    if (Array.isArray(raw)) return raw
    if (raw === 'update_only') return ['run_map']
    if (raw === 'both') return ['delete', 'run_map']
    return ['delete'] // default for 'delete_only' or undefined
  })

  const toggleDeleteBehavior = (option: string) => {
    setDeleteBehavior(prev => {
      let next: string[]
      if (prev.includes(option)) {
        next = prev.filter(x => x !== option)
      } else {
        next = [...prev, option]
      }
      setIsSaved(false)
      return next
    })
  }

  // Fields loaded from Odoo connection (grouped by model) - initialized with preloaded server fields
  const [modelFields, setModelFields] = useState<Record<string, Array<{ value: string; label: string; desc?: string; type: string; relation?: string }>>>(
    preloadedModel && preloadedFields.length > 0
      ? { [preloadedModel]: preloadedFields }
      : {}
  )
  const [isLoadingFields, setIsLoadingFields] = useState<Record<string, boolean>>({})
  const [staticOptions, setStaticOptions] = useState<Record<string, Array<{ value: string; label: string; desc?: string }>>>({})
  const [isLoadingStaticOptions, setIsLoadingStaticOptions] = useState<Record<string, boolean>>({})

  // Column visibility settings (saved in localStorage)
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('field_mapping_columns_visibility')
      if (saved) {
        try {
          return JSON.parse(saved)
        } catch (e) {
          // ignore
        }
      }
    }
    return {
      erpField: true,
      zidField: true,
      policy: true,
      staticValue: true
    }
  })

  const [isColumnSettingsOpen, setIsColumnSettingsOpen] = useState(false)
  // Which mapping row has its relational extras (inline match, creation
  // mapping, multi-field match) expanded underneath it. One at a time keeps
  // the table looking like the read-only view until it is actually needed.
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null)
  // Switching model tabs must not leave a row of the previous model expanded.
  useEffect(() => {
    setExpandedLineId(null)
  }, [activeTab])
  const columnSettingsRef = useRef<HTMLTableHeaderCellElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number } | null>(null)

  const updatePopoverCoords = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      if (lang === 'ar') {
        setPopoverCoords({
          top: rect.bottom + 6,
          left: rect.right - 220
        })
      } else {
        setPopoverCoords({
          top: rect.bottom + 6,
          left: rect.left
        })
      }
    }
  }, [lang])

  useEffect(() => {
    if (isColumnSettingsOpen) {
      updatePopoverCoords()
      
      window.addEventListener('scroll', updatePopoverCoords, true)
      window.addEventListener('resize', updatePopoverCoords)
      
      return () => {
        window.removeEventListener('scroll', updatePopoverCoords, true)
        window.removeEventListener('resize', updatePopoverCoords)
      }
    }
  }, [isColumnSettingsOpen, updatePopoverCoords])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node
      if (
        columnSettingsRef.current && !columnSettingsRef.current.contains(target) &&
        (!popoverRef.current || !popoverRef.current.contains(target))
      ) {
        setIsColumnSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleColumn = (col: string) => {
    setVisibleColumns(prev => {
      const updated = { ...prev, [col]: !prev[col] }
      localStorage.setItem('field_mapping_columns_visibility', JSON.stringify(updated))
      return updated
    })
    setTimeout(updatePopoverCoords, 0)
  }

  const visibleColumnsCount = Object.values(visibleColumns).filter(Boolean).length
  const totalColSpan = visibleColumnsCount + 1 // +1 for the sticky actions column

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

  // Durable Odoo-link stats for the picked store (update/delete hint).
  const [linkStats, setLinkStats] = useState<{
    count: number
    last: { storeEntityId: string; odooRecordId: number; lastSyncedAt: string } | null
  } | null>(null)
  const [isLoadingLinkStats, setIsLoadingLinkStats] = useState(false)

  // Smart match modal states
  const [activeFuzzyLine, setActiveFuzzyLine] = useState<MappingLine | null>(null)
  const [fuzzyModalMappings, setFuzzyModalMappings] = useState<Array<{ erpField: string; platformField: string }>>([])
  const [showDryRunModal, setShowDryRunModal] = useState(false)
  const [dryRunResult, setDryRunResult] = useState<{ phase: string; matchedId?: number; willCreate?: boolean; error?: string } | null>(null)
  const [dryRunSampleData, setDryRunSampleData] = useState('')
  const [isRunningDryRun, setIsRunningDryRun] = useState(false)
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

    const activeFixedMappings = fixedMappings.filter(
      m => m.platform === platform && m.odoo_model === odooModel && m.action === zidEvent && m.active === true
    )
    if (activeFixedMappings.length === 0) return

    // 1. Auto-inject all field pairs into mappings state if not already present
    setMappings(prev => {
      const currentLines = prev[odooModel] || []
      let changed = false

      // Flatten field_rows from all active preset rows
      const fieldPairs: Array<{ odoo_field: string; platform_field: string }> = []
      for (const fm of activeFixedMappings) {
        if ((fm as any).field_rows && Array.isArray((fm as any).field_rows)) {
          for (const fr of (fm as any).field_rows) {
            if (fr.odoo_field && fr.platform_field) {
              fieldPairs.push({ odoo_field: fr.odoo_field, platform_field: fr.platform_field })
            }
          }
        } else if (fm.odoo_field && fm.platform_field) {
          // Fallback for legacy scalar rows
          fieldPairs.push({ odoo_field: fm.odoo_field, platform_field: fm.platform_field })
        }
      }

      const newLines = fieldPairs
        .filter(fp => !currentLines.some(l => l.erpField === fp.odoo_field))
        .map(fp => {
          changed = true
          return {
            id: Math.random().toString(36).substring(2, 9),
            erpField: fp.odoo_field,
            zidField: fp.platform_field,
            staticValue: ''
          } as MappingLine
        })
      if (!changed) return prev
      return {
        ...prev,
        [odooModel]: [...currentLines, ...newLines]
      }
    })

    // 2. Set match fields from first matching row for update/delete operations
    const firstFm = activeFixedMappings[0]
    const firstFieldPair = (firstFm as any)?.field_rows?.[0] || firstFm
    if (odooOperation === 'update' || odooOperation === 'delete') {
      setOdooMatchField(firstFieldPair.odoo_field || '')
      setZidMatchField(firstFieldPair.platform_field || '')
    } else {
      setOdooMatchField((prev: string) => prev || firstFieldPair.odoo_field || '')
      setZidMatchField((prev: string) => prev || firstFieldPair.platform_field || '')
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
    const modelsToFetch = [
      odooModel, 
      ...relatedOdooModels,
      odooModel === 'product.template' ? 'product.product' : ''
    ].filter(Boolean)

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
    const eventsList = platform === 'salla' ? SALLA_EVENTS : platform === 'shopify' ? SHOPIFY_EVENTS : ZID_EVENTS
    const fallbackEvent = platform === 'salla' ? 'product.created' : platform === 'shopify' ? 'products/create' : 'product.create'
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

  // Dynamically load target model fields for fuzzy matching popup
  useEffect(() => {
    if (!activeFuzzyLine) return
    const meta = getFieldMeta(currentModelKey, activeFuzzyLine.erpField)
    const relation = meta?.relation
    if (!relation) return

    if (!modelFields[relation] && !isLoadingFields[relation] && hasOdooConnection) {
      setIsLoadingFields(prev => ({ ...prev, [relation]: true }))
      getOdooModelFields(relation).then(res => {
        if (res.success && res.fields) {
          setModelFields(prev => ({ ...prev, [relation]: res.fields }))
        } else {
          setModelFields(prev => ({ ...prev, [relation]: ODOO_FIELDS[relation] || [] }))
        }
      }).catch(err => {
        console.error(`Failed to load fuzzy relation fields:`, err)
        setModelFields(prev => ({ ...prev, [relation]: ODOO_FIELDS[relation] || [] }))
      }).finally(() => {
        setIsLoadingFields(prev => ({ ...prev, [relation]: false }))
      })
    } else if (!modelFields[relation] && !hasOdooConnection) {
      setModelFields(prev => ({ ...prev, [relation]: ODOO_FIELDS[relation] || [] }))
    }
  }, [activeFuzzyLine, modelFields, currentModelKey, hasOdooConnection])
  const resolvePlatformFields = (eventId: string, platformType: string, activeTabKey: string, activeTabLower: string, odooModelKey: string) => {
    const fieldsMap = platformType === 'salla' ? SALLA_FIELDS : platformType === 'shopify' ? SHOPIFY_FIELDS : ZID_FIELDS
    const isSalla = platformType === 'salla'
    const isShopify = platformType === 'shopify'

    // Direct match
    if (fieldsMap[eventId]) return fieldsMap[eventId]

    // Shopify-specific fallbacks (collections = categories)
    if (isShopify) {
      if (eventId.startsWith('collections')) return SHOPIFY_FIELDS['collections/create'] || SHOPIFY_FIELDS['products/create'] || []
      if (eventId.startsWith('product')) return SHOPIFY_FIELDS['products/create'] || []
      if (eventId.startsWith('order')) return SHOPIFY_FIELDS['orders/create'] || []
      if (eventId.startsWith('customer')) return SHOPIFY_FIELDS['customers/create'] || []
      return SHOPIFY_FIELDS['products/create'] || []
    }

    // Salla-specific fallbacks
    if (isSalla) {
      if (eventId === 'product.deleted') return SALLA_FIELDS['product.deleted'] || []
      if (eventId === 'product.updated' || eventId === 'product.publish' || eventId === 'product.available' || eventId === 'product.quantity.low') return SALLA_FIELDS['product.updated'] || []
      if (eventId.startsWith('product')) return SALLA_FIELDS['product.template'] || []
      if (eventId.startsWith('order') || eventId.startsWith('abandoned.cart')) return SALLA_FIELDS['sale.order'] || []
      if (eventId.startsWith('customer') || eventId.startsWith('store.branch')) return SALLA_FIELDS['res.partner'] || []
      if (eventId.startsWith('category')) return SALLA_FIELDS['product.category'] || []
    }

    // Zid-specific fallbacks
    if (ZID_FIELDS[eventId]) return ZID_FIELDS[eventId]
    if (eventId === 'product.delete') return ZID_FIELDS['product.delete'] || []
    if (eventId === 'product.update' || eventId === 'product.publish') return ZID_FIELDS['product.update'] || []
    if (eventId === 'category.delete') return ZID_FIELDS['product.category.delete'] || []
    if (eventId.startsWith('product') || eventId.startsWith('category')) {
      if (activeTabLower.includes('category') || activeTabLower.includes('group') || (activeTabKey === odooModelKey && eventId.startsWith('category'))) {
        return ZID_FIELDS['product.category'] || []
      }
      return ZID_FIELDS['product.template'] || []
    }
    if (eventId === 'cart.abandoned') return ZID_FIELDS['cart.abandoned'] || []
    if (eventId.startsWith('order')) return ZID_FIELDS['sale.order'] || []
    if (eventId.startsWith('customer')) return ZID_FIELDS['res.partner'] || []

    // Fallback based on model namespace
    if (activeTabLower.includes('partner') || activeTabLower.includes('customer')) return fieldsMap['res.partner'] || []
    if (activeTabLower.includes('order')) return fieldsMap['sale.order'] || []
    if (activeTabLower.includes('category') || activeTabLower.includes('group') || (activeTabKey === odooModelKey && eventId.startsWith('category'))) return fieldsMap['product.category'] || []
    return fieldsMap['product.template'] || []
  }

  const currentZidFields = (() => {
    const activeTabLower = currentModelKey.toLowerCase()

    // 1b. If we are on Zid and mapping a related model, dynamically resolve sub-fields of the mapped group
    // ⚠️ This MUST come first — before the sale.order.line check — so that child tabs like
    //    product.template.attribute.line get their parent-linked zid group fields, not order line fields.
    if (platform === 'zid' && currentModelKey !== odooModel) {
      const targetCreateId = `internal:${currentModelKey}`
      let parentZidField: string | undefined

      for (const parentModel of Object.keys(mappings)) {
        if (parentModel === currentModelKey) continue
        const parentMappings = mappings[parentModel]
        if (!Array.isArray(parentMappings)) continue
        const parentLine = parentMappings.find(
          line => line.policy === 'create' && line.createMappingId === targetCreateId && !!line.zidField
        )
        if (parentLine && parentLine.zidField) {
          parentZidField = parentLine.zidField
          break
        }
      }

      if (parentZidField) {
        const subFields = ZID_SUB_FIELDS[parentZidField]
        if (subFields && subFields.length > 0) {
          return subFields
        }
      }
    }

    // 1c. Order-line tab: offer the line-item catalogue (incl. the line `id`)
    // for every platform and every order event/operation. The shared resolver
    // below is header-oriented (sale.order / orders/create), so without this
    // the line tab shows header fields and the line `id` is unreachable —
    // while the engine already reads any mapped path (incl. `id`) from each
    // item via resolvePath over the products/items/line_items candidates.
    if (currentModelKey === 'sale.order.line') {
      const lineFields =
        platform === 'salla' ? SALLA_FIELDS['sale.order.line']
        : platform === 'shopify' ? SHOPIFY_FIELDS['sale.order.line']
        : ZID_FIELDS['sale.order.line']
      if (lineFields && lineFields.length > 0) return lineFields
    }

    // 2. Use shared resolver for all platforms
    return resolvePlatformFields(zidEvent, platform, activeTab, activeTabLower, odooModel)
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
  const primaryMatchZidFields = resolvePlatformFields(zidEvent, platform, activeTab, odooModel.toLowerCase(), odooModel)

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

  // Saved-Odoo-ID auto-suggest: for a NEW sale.order update/delete mapping,
  // default the match pair to (id, __odoo_record_id) so the update targets
  // the record the create flow saved — per store, no manual lookup.
  // Transition-based (fires when the operation SWITCHES into update/delete),
  // because the generic defaults effect above fills (id, id) first and a
  // fill-blanks-only approach would never win that race. A later manual
  // pick is never overwritten — only the switch moment suggests.
  const prevSuggestOp = useRef(odooOperation)
  const prevSuggestModel = useRef(odooModel)
  useEffect(() => {
    const switched =
      prevSuggestOp.current !== odooOperation || prevSuggestModel.current !== odooModel
    prevSuggestOp.current = odooOperation
    prevSuggestModel.current = odooModel
    if (!switched) return
    if (editingId) return
    if (odooModel !== 'sale.order') return
    if (odooOperation !== 'update' && odooOperation !== 'delete') return
    if (!primaryMatchErpFields.some(field => field.value === 'id')) return
    if (!primaryMatchZidFields.some(field => field.value === STORED_ODOO_ID_LITERAL)) return
    setOdooMatchField('id')
    setZidMatchField(STORED_ODOO_ID_LITERAL)
    setIsSaved(false)
  }, [
    odooOperation,
    odooModel,
    editingId,
    platform,
    primaryMatchErpFields,
    primaryMatchZidFields,
  ])

  // Durable-link stats for the picked store: shown under the match fields so
  // the merchant sees how many orders already have a saved Odoo id.
  useEffect(() => {
    const needsMatch = odooOperation === 'update' || odooOperation === 'delete' ||
      syncDirection.split(',').map(s => s.trim()).includes('erp_to_store')
    if (!needsMatch || odooModel !== 'sale.order' || !storeKey) {
      setLinkStats(null)
      return
    }
    let cancelled = false
    setIsLoadingLinkStats(true)
    getEntityLinkStats({ platform, storeKey, odooModel })
      .then(res => {
        if (cancelled) return
        if (res.success) {
          setLinkStats({ count: res.count ?? 0, last: res.last ?? null })
        } else {
          setLinkStats(null)
        }
      })
      .catch(() => {
        if (!cancelled) setLinkStats(null)
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLinkStats(false)
      })
    return () => {
      cancelled = true
    }
  }, [odooOperation, odooModel, syncDirection, platform, storeKey])

  const AUTO_PAYLOAD_PATHS: Record<string, string> = {
    'sale.order.line': 'products',
    'product.product': 'variants',
    'res.partner': 'customer',
    'res.partner.address': 'shipping_address',
    'account.move.line': 'invoice_lines',
    'stock.move': 'stock_moves',
    'product.attribute.line': 'attribute_lines',
  }

  const resolveAutoPayloadPath = (relatedModel: string): string => {
    return AUTO_PAYLOAD_PATHS[relatedModel] || ''
  }

  const resolveAutoZidField = (relatedModel: string): string => {
    return resolveAutoPayloadPath(relatedModel)
  }

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

    // Auto-wire one2many link field on primary model when adding a related model
    if (added.length > 0) {
      setMappings(prev => {
        const updated = { ...prev }
        const primaryLines = [...(prev[odooModel] || [])]
        let changed = false

        for (const relModel of added) {
          // Find the one2many/many2many field on the primary model that points to this related model
          const allParentFields = modelFields[odooModel] || ODOO_FIELDS[odooModel] || []
          const linkField = allParentFields.find(
            f => (f.type === 'one2many' || f.type === 'many2many') && f.relation === relModel
          )

          if (linkField) {
            // Prevent duplicate: skip if already mapped
            const alreadyMapped = primaryLines.some(l => l.erpField === linkField.value)
            if (!alreadyMapped) {
              const autoZidField = resolveAutoZidField(relModel)
              primaryLines.push({
                id: Math.random().toString(36).substring(2, 9),
                erpField: linkField.value,
                zidField: autoZidField,
                policy: 'create' as const,
                staticValue: ''
              })
              changed = true
            }
          }
        }

        if (changed) updated[odooModel] = primaryLines
        return updated
      })

      setActiveTab(added[added.length - 1])

      for (const relModel of added) {
        const autoPath = resolveAutoPayloadPath(relModel)
        if (autoPath && !payloadPaths[relModel]) {
          setPayloadPaths(prev => ({ ...prev, [relModel]: autoPath }))
        }
      }
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
    setMappings(prev => {
      const currentList = prev[modelKey] || []
      const updatedList = currentList.map(m => {
        if (m.id === id) {
          if (column === 'erpField') {
            return { ...m, erpField: value, zidField: '', staticValue: '', policy: undefined as any, fuzzyMatchMappings: [], matchOperator: 'OR' as const, inlineSubMapping: undefined, createMappingId: undefined, inlineMatch: undefined }
          }
          const meta = getFieldMeta(modelKey, m.erpField)
          const isRel = meta?.type === 'many2one' || meta?.type === 'many2many' || meta?.type === 'one2many'
          return {
            ...m,
            zidField: value,
            staticValue: (isRel || !value) ? m.staticValue : ''
          }
        }
        return m
      })

      if (column === 'zidField' && value) {
        const line = updatedList.find(m => m.id === id)
        if (line) {
          const meta = getFieldMeta(modelKey, line.erpField)
          if (meta?.type === 'many2one' && meta.relation) {
            const relFields = modelFields[meta.relation] || ODOO_FIELDS[meta.relation] || []
            const defaultRelField =
              relFields.find(f => f.value === 'name') ||
              relFields.find(f => f.value === 'id') ||
              relFields.find(f => !['one2many','many2one','many2many'].includes(f.type)) ||
              relFields[0]
            if (!line.inlineMatch && defaultRelField) {
              const lineIdx = updatedList.findIndex(m => m.id === id)
              if (lineIdx !== -1) {
                updatedList[lineIdx] = {
                  ...updatedList[lineIdx],
                  inlineMatch: { erpField: defaultRelField.value, platformField: value }
                }
              }
            }
          }
        }
      }

      return {
        ...prev,
        [modelKey]: updatedList
      }
    })
    setIsSaved(false)
  }

  const hasStaticValue = (value: MappingLine['staticValue']) => (
    Array.isArray(value) ? value.length > 0 : value !== '' && value !== undefined && value !== null
  )

  const handleStaticValueChange = (id: string, value: MappingLine['staticValue']) => {
    const modelKey = activeTab
    setMappings(prev => ({
      ...prev,
      [modelKey]: (prev[modelKey] || []).map(m => {
        if (m.id === id) {
          const sv = hasStaticValue(value)
          const meta = getFieldMeta(modelKey, m.erpField)
          const isRel = meta?.type === 'many2one' || meta?.type === 'many2many' || meta?.type === 'one2many'
          return {
            ...m,
            staticValue: value,
            zidField: (isRel || !sv) ? m.zidField : ''
          }
        }
        return m
      })
    }))
    setIsSaved(false)
  }

  const renderStaticValueInput = (mapping: MappingLine) => {
    const meta = getFieldMeta(currentModelKey, mapping.erpField)
    const type = meta?.type || 'char'
    const optionKey = `${currentModelKey}.${mapping.erpField}`
    const options = staticOptions[optionKey] || []
    const isRelational = meta?.type === 'many2one' || meta?.type === 'many2many' || meta?.type === 'one2many'
    const isStaticDisabled = isRelational
      ? mapping.policy !== 'default'
      : Boolean(mapping.zidField)

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
          compact
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
          compact
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
          compact
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
          className="h-7 w-full rounded-none border border-transparent bg-transparent px-2 font-mono text-[11px] outline-none hover:border-input hover:bg-muted/30 focus:border-foreground focus:ring-1 focus:ring-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
        className="h-7 w-full rounded-none border border-transparent bg-transparent px-2 font-mono text-[11px] outline-none hover:border-input hover:bg-muted/30 focus:border-foreground focus:ring-1 focus:ring-foreground disabled:cursor-not-allowed disabled:opacity-50"
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

    // Validate relational policies
    for (const [modelKey, lines] of Object.entries(mappings)) {
      if (!Array.isArray(lines)) continue
      for (const line of lines) {
        const meta = getFieldMeta(modelKey, line.erpField)
        const isRel = meta?.type === 'many2one' || meta?.type === 'many2many'
        if (isRel) {
          const activePolicy = line.policy
          if (!activePolicy) {
            setErrorMessage(
              lang === 'ar'
                ? `يرجى تحديد مسار السياسة البديلة في حال عدم مطابقة الحقل العلائقي "${line.erpField}".`
                : `Please specify a fallback policy in case relational field "${line.erpField}" is not matched.`
            )
            setIsSaving(false)
            return
          }
          if (activePolicy === 'default') {
            const hasVal = Array.isArray(line.staticValue) 
              ? line.staticValue.length > 0 
              : line.staticValue !== '' && line.staticValue !== undefined && line.staticValue !== null
            if (!hasVal) {
              setErrorMessage(
                lang === 'ar'
                  ? `الحقل العلائقي "${line.erpField}" مهيأ لسياسة "القيمة الافتراضية"، يرجى تحديد قيمة ثابتة.`
                  : `Relational field "${line.erpField}" is configured with "Default" policy; please specify a static value.`
              )
              setIsSaving(false)
              return
            }
          }
          // Removed strict validation requiring createMappingId if relationMappings exist.
          // The sync engine gracefully falls back to creating a minimal record (e.g. { name: ... }).
        }
      }
    }

    try {
      const cleanedMappings = { ...mappings }
      const allowedKeys = [odooModel, ...relatedOdooModels]
      
      // Clean mappings keys to exclude models that were removed from related models
      for (const key of Object.keys(cleanedMappings)) {
        if (key !== '__settings' && !allowedKeys.includes(key)) {
          delete cleanedMappings[key]
        }
      }

      // Clean relations to exclude relations referencing removed models
      const cleanedRelations = relations.filter(r => 
        allowedKeys.includes(r.sourceModel) && allowedKeys.includes(r.targetModel)
      )

      // Clean payloadPaths to exclude paths of removed models
      const cleanedPayloadPaths = { ...payloadPaths }
      for (const model of Object.keys(cleanedPayloadPaths)) {
        if (!allowedKeys.includes(model)) {
          delete cleanedPayloadPaths[model]
        }
      }

      const mappingsWithSettings = {
        ...cleanedMappings,
        __settings: {
          allowedPolicies: [],
          relations: cleanedRelations,
          payloadPaths: cleanedPayloadPaths,
          addShippingAsLine: addShippingAsLine,
          shippingProductId: shippingProductId,
          shippingProductSku: shippingProductSku,
          addDiscountAsLine: addDiscountAsLine,
          discountProductId: discountProductId,
          discountProductSku: discountProductSku,
          discountMode: discountMode,
          deleteBehavior: deleteBehavior,
          variantSyncMode: variantSyncMode,
          variantOdooMatchField: variantOdooMatchField,
          variantZidMatchField: variantZidMatchField
        }
      }

      const res = await saveFieldMapping({
        id: editingId,
        name: name,
        action: zidEvent,
        odooModel: odooModel,
        odooOperation,
        odooMatchField,
        zidMatchField,
        odooFallbackPolicy,
        mappings: mappingsWithSettings,
        platform,
        storeKey: storeKey || undefined,
        syncDirection,
        variantSyncMode,
        variantOdooMatchField,
        variantZidMatchField
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
    setOdooFallbackPolicy('none')
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

  const handleRefreshFields = useCallback(async () => {
    if (!currentModelKey || !hasOdooConnection) return
    setIsLoadingFields(prev => ({ ...prev, [currentModelKey]: true }))
    const refreshRes = await refreshOdooCache()
    if (!refreshRes.success) {
      console.error('Failed to refresh Odoo cache:', refreshRes.error)
    }
    const res = await getOdooModelFields(currentModelKey, true)
    if (res.success && res.fields) {
      setModelFields(prev => ({ ...prev, [currentModelKey]: res.fields }))
    }
    setIsLoadingFields(prev => ({ ...prev, [currentModelKey]: false }))
    setToastMessage(lang === 'ar' ? 'تم تحديث الحقول من أودو' : 'Fields refreshed from Odoo')
    setShowToast(true)
    setTimeout(() => setShowToast(false), 3000)
  }, [currentModelKey, hasOdooConnection, lang])

  return (
    <div className="relative space-y-4 text-foreground font-sans" dir={dir}>

      {/* Top Button Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            variant="default"
            className="bg-foreground text-background font-medium rounded-none px-3.5 py-1.5 h-8.5 text-xs transition-transform duration-200"
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
            className="border-border hover:bg-muted font-medium rounded-none px-3.5 py-1.5 h-8.5 text-xs text-muted-foreground transition-all"
          >
            <RotateCcw className={cn("h-3.5 w-3.5", lang === 'ar' ? "ml-1.5" : "mr-1.5")} />
            {lang === 'ar' ? 'إلغاء التغييرات' : 'Discard'}
          </Button>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">{lang === 'ar' ? 'الحالة:' : 'Status:'}</span>
          <span className={cn(
            "inline-flex items-center border px-1.5 py-0.5 text-[10px] font-bold",
            isSaved
              ? "border-border bg-muted text-foreground"
              : "border-border bg-muted text-muted-foreground"
          )}>
            {isSaved ? (lang === 'ar' ? 'تم الحفظ' : 'Saved') : (lang === 'ar' ? 'مسودة' : 'Draft')}
          </span>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-none border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      {/* Main Odoo-style Form Sheet — the record page's header grid (tiny
          uppercase caption + value), except every value is the live control. */}
      <div className="space-y-4">

        {/* Name — the record page's title, editable in place. */}
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setIsSaved(false)
          }}
          placeholder={lang === 'ar' ? 'اسم إعداد الربط...' : 'Mapping name...'}
          className="w-full max-w-xl border border-transparent bg-transparent px-0.5 py-0.5 text-base font-bold text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 hover:border-border focus:border-foreground"
        />

        <div className="border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">

            {/* Event */}
            <FormCell label={platform === 'salla'
              ? (lang === 'ar' ? 'حدث سلة' : 'Salla event')
              : platform === 'shopify'
                ? (lang === 'ar' ? 'حدث شوبيفاي' : 'Shopify event')
                : (lang === 'ar' ? 'حدث زد' : 'Zid event')}>
              <SearchableSelect
                value={zidEvent}
                onChange={(val) => {
                  setZidEvent(val)
                  setIsSaved(false)
                }}
                options={(platform === 'salla' ? SALLA_EVENTS : platform === 'shopify' ? SHOPIFY_EVENTS : ZID_EVENTS).map(event => ({
                  value: event.id,
                  label: formatFieldLabel(event.name, lang),
                }))}
                placeholder={t('map.selectEventPlaceholder')}
                variant="inline"
              />
            </FormCell>

            {/* ERP model */}
            <FormCell label={lang === 'ar' ? `نموذج ${getErpName(erpType)}` : `${getErpNameEn(erpType)} model`}>
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
                placeholder={lang === 'ar' ? 'اختر النموذج...' : 'Select model...'}
                variant="inline"
              />
            </FormCell>

            {/* Operation */}
            <FormCell label={lang === 'ar' ? 'العملية' : 'Operation'}>
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
                variant="inline"
              />
            </FormCell>

            {/* Direction */}
            <FormCell label={lang === 'ar' ? 'الاتجاه' : 'Direction'}>
              <SearchableSelect
                multiple={true}
                value={syncDirection ? syncDirection.split(',').filter(Boolean) : []}
                onChange={(vals: string[]) => {
                  setSyncDirection(vals.join(','))
                  setIsSaved(false)
                }}
                options={SYNC_DIRECTIONS}
                placeholder={lang === 'ar' ? 'اختر الاتجاه...' : 'Select direction...'}
                variant="inline"
              />
            </FormCell>

            {/* ERP match field */}
            {(odooOperation === 'update' || odooOperation === 'delete' || syncDirection.split(',').map(s => s.trim()).includes('erp_to_store')) && (
              <FormCell label={lang === 'ar' ? 'حقل المطابقة في ERP' : 'ERP match field'}>
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
                  variant="inline"
                />
              </FormCell>
            )}

            {/* Store match field */}
            {(odooOperation === 'update' || odooOperation === 'delete' || syncDirection.split(',').map(s => s.trim()).includes('erp_to_store')) && (
              <FormCell
                label={platform === 'salla'
                  ? (lang === 'ar' ? 'حقل المطابقة في سلة' : 'Salla match field')
                  : platform === 'shopify'
                    ? (lang === 'ar' ? 'حقل المطابقة في شوبيفاي' : 'Shopify match field')
                    : (lang === 'ar' ? 'حقل المطابقة في زد' : 'Zid match field')}
                hint={
                  <>
                    {zidMatchField === STORED_ODOO_ID_LITERAL && (
                      <p className="text-[10px] font-semibold text-foreground/80">
                        {lang === 'ar'
                          ? 'الحقل المحفوظ: يُحل تلقائياً إلى رقم الأوردر في أودوو — خاص بهذا المتجر فقط.'
                          : 'Saved-ID field: resolves automatically to the Odoo order number — scoped to this store only.'}
                      </p>
                    )}
                    {isLoadingLinkStats ? (
                      <p className="text-[10px] text-muted-foreground">
                        {lang === 'ar' ? 'جارٍ قراءة الروابط المحفوظة...' : 'Loading saved links...'}
                      </p>
                    ) : linkStats && linkStats.count > 0 && linkStats.last ? (
                      <p className="text-[10px] text-muted-foreground">
                        {lang === 'ar'
                          ? `${linkStats.count}${linkStats.count >= 50 ? '+' : ''} طلب مربوط — آخرها ${linkStats.last.storeEntityId} ← أودوو #${linkStats.last.odooRecordId}.`
                          : `${linkStats.count}${linkStats.count >= 50 ? '+' : ''} linked orders — latest: ${linkStats.last.storeEntityId} → Odoo #${linkStats.last.odooRecordId}.`}
                      </p>
                    ) : linkStats && linkStats.count === 0 ? (
                      <p className="text-[10px] text-muted-foreground">
                        {lang === 'ar'
                          ? 'لا روابط محفوظة بعد — نفّذ مزامنة إنشاء أولاً.'
                          : 'No saved links yet — run a create sync first.'}
                      </p>
                    ) : null}
                  </>
                }
              >
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
                  variant="inline"
                />
              </FormCell>
            )}

            {/* Fallback policy */}
            {(odooOperation === 'update' || odooOperation === 'delete') && (
              <FormCell label={lang === 'ar' ? 'سياسة الغياب' : 'Fallback policy'}>
                <SearchableSelect
                  value={odooFallbackPolicy}
                  onChange={(val) => {
                    if (val === 'none' || val === 'create' || val === 'block') {
                      setOdooFallbackPolicy(val)
                      setIsSaved(false)
                    }
                  }}
                  options={[
                    { value: 'none', label: lang === 'ar' ? 'تجاهل صامت' : 'Skip silently' },
                    { value: 'create', label: lang === 'ar' ? 'إنشاء السجل' : 'Create record' },
                    { value: 'block', label: lang === 'ar' ? 'إيقاف مع خطأ' : 'Block with error' },
                  ]}
                  placeholder={lang === 'ar' ? 'اختر السياسة...' : 'Select policy...'}
                  variant="inline"
                />
              </FormCell>
            )}

            {/* Related models */}
            <FormCell label={lang === 'ar' ? 'النماذج الفرعية المرتبطة' : `Related ${getErpNameEn(erpType)} models`}>
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
                placeholder={lang === 'ar' ? 'ابحث واختر نماذج...' : 'Search and select models...'}
                variant="inline"
              />
            </FormCell>

            {/* Store platform */}
            <FormCell label={lang === 'ar' ? 'منصة المتجر' : 'Store platform'}>
              {((isZidConnected ? 1 : 0) + (isSallaConnected ? 1 : 0) + (isShopifyConnected ? 1 : 0) >= 2) && !editingId ? (
                <div className="flex flex-wrap gap-1">
                  {isZidConnected && (
                    <button
                      type="button"
                      onClick={() => switchPlatform('zid', 'product.create')}
                      className={cn(
                        'border px-2 py-0.5 text-[11px] font-bold transition-colors',
                        platform === 'zid'
                          ? 'border-border bg-muted text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      {lang === 'ar' ? 'زد (Zid)' : 'Zid'}
                    </button>
                  )}
                  {isSallaConnected && (
                    <button
                      type="button"
                      onClick={() => switchPlatform('salla', 'product.created')}
                      className={cn(
                        'border px-2 py-0.5 text-[11px] font-bold transition-colors',
                        platform === 'salla'
                          ? 'border-border bg-muted text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      {lang === 'ar' ? 'سلة (Salla)' : 'Salla'}
                    </button>
                  )}
                  {isShopifyConnected && (
                    <button
                      type="button"
                      onClick={() => switchPlatform('shopify', 'products/create')}
                      className={cn(
                        'border px-2 py-0.5 text-[11px] font-bold transition-colors',
                        platform === 'shopify'
                          ? 'border-border bg-muted text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      )}
                    >
                      {lang === 'ar' ? 'شوبيفاي (Shopify)' : 'Shopify'}
                    </button>
                  )}
                </div>
              ) : (
                <span className="font-mono">
                  {platform === 'salla'
                    ? (lang === 'ar' ? 'سلة (Salla)' : 'Salla')
                    : platform === 'shopify'
                      ? (lang === 'ar' ? 'شوبيفاي (Shopify)' : 'Shopify')
                      : (lang === 'ar' ? 'زد (Zid)' : 'Zid')}
                </span>
              )}
            </FormCell>

            {/* Store (create view, when the platform links several stores) */}
            {!editingId && platformStores.length > 1 && (
              <FormCell label={lang === 'ar' ? 'المتجر' : 'Store'}>
                <select
                  value={platformStores.some(s => s.id === storeKey) ? storeKey : (platformStores[0]?.id || '')}
                  onChange={e => {
                    setStoreKey(e.target.value)
                    setIsSaved(false)
                  }}
                  className="h-6 w-full cursor-pointer border border-transparent bg-transparent px-0.5 font-mono text-xs text-foreground outline-none transition-colors hover:border-border hover:bg-muted/40 focus:border-foreground"
                >
                  {platformStores.map(s => (
                    <option key={s.id} value={s.id} dir="auto">
                      {(s.name || platform) + ` (${s.id})`}
                    </option>
                  ))}
                </select>
              </FormCell>
            )}
          </div>
        </div>

        {/* Relations graph — same card language, only when there are relations. */}
        {activeRelatedModels.length > 0 && (
          <div className="border border-border bg-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-1.5">
              <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-bold text-foreground/80">
                {lang === 'ar' ? 'مخطط العلاقات' : 'Relations graph'}
              </span>
            </div>
            <div className="p-3">
              <RelationsGraph
                primaryModel={odooModel}
                relatedModels={activeRelatedModels.map(m => ({ model: m.model, label: m.label }))}
                relations={relations.map(r => ({
                  sourceModel: r.sourceModel,
                  targetModel: r.targetModel,
                  relationField: r.relationField,
                  relationType: modelFields[r.sourceModel]?.find(f => f.value === r.relationField)?.type || 'one2many'
                }))}
                activeModel={activeTab}
                onSelectModel={(m) => setActiveTab(m)}
                lang={lang}
                dir={dir}
                className="w-full"
              />
            </div>
          </div>
        )}

        {/* Notebook / Tabs Selector — compact segments, same square
            aesthetic as the mapping table underneath. */}
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-border/60 pb-2">
          <div className="flex gap-1 overflow-x-auto">
            {/* Primary Model Tab */}
            <button
              onClick={() => setActiveTab(odooModel)}
              className={cn(
                "whitespace-nowrap border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                activeTab === odooModel
                  ? "border-foreground/25 bg-card text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
                  "whitespace-nowrap border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  activeTab === rel.model
                    ? "border-foreground/25 bg-card text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {formatFieldLabel(rel.label, lang)}
              </button>
            ))}

            {/* Settings Tab */}
            <button
              onClick={() => setActiveTab('settings')}
              className={cn(
                "whitespace-nowrap border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                activeTab === 'settings'
                  ? "border-foreground/25 bg-card text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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

                {/* Mapping table — exactly the read-only presentation, but every
                    cell is editable and rows can be added or removed. */}
                <div className="overflow-hidden border border-border bg-card">
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-foreground/80">
                      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                      {lang === 'ar' ? 'الحقول المربوطة' : 'Mapped fields'}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {lang === 'ar'
                          ? `${currentModelMappings.length} حقل · ${currentModelKey}`
                          : `${currentModelMappings.length} fields · ${currentModelKey}`}
                      </span>
                      {hasOdooConnection && (
                        <button
                          type="button"
                          onClick={handleRefreshFields}
                          disabled={isLoadingFields[currentModelKey]}
                          className="p-0.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                          title={lang === 'ar' ? 'تحديث الحقول من أودو' : 'Refresh fields from Odoo'}
                        >
                          {isLoadingFields[currentModelKey]
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RotateCcw className="h-3 w-3" />}
                        </button>
                      )}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] table-fixed text-xs">
                      <thead>
                        <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-foreground/60">
                          {visibleColumns.erpField && (
                            <th className="w-[30%] px-3 py-1.5 text-start font-bold">
                              {lang === 'ar' ? 'حقل ERP' : 'ERP field'}
                            </th>
                          )}
                          {visibleColumns.zidField && (
                            <th className="w-[27%] px-3 py-1.5 text-start font-bold">
                              {lang === 'ar' ? 'حقل المتجر' : 'Store field'}
                            </th>
                          )}
                          {visibleColumns.staticValue && (
                            <th className="w-[18%] px-3 py-1.5 text-start font-bold">
                              {lang === 'ar' ? 'قيمة ثابتة' : 'Static value'}
                            </th>
                          )}
                          {visibleColumns.policy && (
                            <th className="w-[20%] px-3 py-1.5 text-start font-bold">
                              {lang === 'ar' ? 'السياسة' : 'Policy'}
                            </th>
                          )}
                          <th
                            ref={columnSettingsRef}
                            className="w-[56px] px-2 py-1.5 text-end font-bold"
                          >
                            <button
                              ref={buttonRef}
                              type="button"
                              onClick={() => setIsColumnSettingsOpen(!isColumnSettingsOpen)}
                              className="inline-flex items-center justify-end p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
                              title={lang === 'ar' ? 'إعدادات الأعمدة' : 'Column settings'}
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                            </button>

                            {/* Column Settings Popover - Rendered via React Portal */}
                            {typeof document !== 'undefined' && createPortal(
                              <AnimatePresence>
                                {isColumnSettingsOpen && (
                                  <motion.div
                                    ref={popoverRef}
                                    initial={{ opacity: 0, scale: 0.95, y: 5 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                    style={{
                                      position: 'fixed',
                                      top: popoverCoords?.top ?? 0,
                                      left: popoverCoords?.left ?? 0,
                                    }}
                                    className="calm-ui z-[9999] min-w-[220px] bg-card border border-border rounded-none p-3.5 space-y-2.5 text-start font-normal text-xs normal-case text-foreground"
                                  >
                                    <h4 className="font-bold text-[11px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-border/60">
                                      {lang === 'ar' ? 'إعدادات الأعمدة' : 'Column Visibility'}
                                    </h4>
                                    <div className="space-y-2">
                                      <label className="flex items-center gap-2.5 cursor-pointer hover:bg-muted/30 p-1.5 rounded-none transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={visibleColumns.erpField}
                                          onChange={() => toggleColumn('erpField')}
                                          className="rounded border-border text-foreground focus:ring-foreground h-3.5 w-3.5"
                                        />
                                        <span>{lang === 'ar' ? 'حقل أودو (Odoo)' : 'Odoo Field'}</span>
                                      </label>
                                      <label className="flex items-center gap-2.5 cursor-pointer hover:bg-muted/30 p-1.5 rounded-none transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={visibleColumns.zidField}
                                          onChange={() => toggleColumn('zidField')}
                                          className="rounded border-border text-foreground focus:ring-foreground h-3.5 w-3.5"
                                        />
                                        <span>
                                          {platform === 'salla'
                                            ? (lang === 'ar' ? 'حقل سلة (Salla)' : 'Salla Field')
                                            : platform === 'shopify'
                                              ? (lang === 'ar' ? 'حقل شوبيفاي (Shopify)' : 'Shopify Field')
                                              : (lang === 'ar' ? 'حقل زد (Zid)' : 'Zid Field')
                                          }
                                        </span>
                                      </label>
                                      <label className="flex items-center gap-2.5 cursor-pointer hover:bg-muted/30 p-1.5 rounded-none transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={visibleColumns.policy}
                                          onChange={() => toggleColumn('policy')}
                                          className="rounded border-border text-foreground focus:ring-foreground h-3.5 w-3.5"
                                        />
                                        <span>{lang === 'ar' ? 'سياسة المطابقة' : 'Match Policy'}</span>
                                      </label>
                                      <label className="flex items-center gap-2.5 cursor-pointer hover:bg-muted/30 p-1.5 rounded-none transition-colors">
                                        <input
                                          type="checkbox"
                                          checked={visibleColumns.staticValue}
                                          onChange={() => toggleColumn('staticValue')}
                                          className="rounded border-border text-foreground focus:ring-foreground h-3.5 w-3.5"
                                        />
                                        <span>{lang === 'ar' ? 'القيمة الثابتة' : 'Static Value'}</span>
                                      </label>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>,
                              document.body
                            )}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentModelMappings.length === 0 && (
                          <tr>
                            <td colSpan={totalColSpan} className="px-3 py-8 text-center text-[11px] text-muted-foreground">
                              {t('map.noMappings')}
                            </td>
                          </tr>
                        )}

                        {currentModelMappings.map((mapping) => {
                          const rowMeta = getFieldMeta(currentModelKey, mapping.erpField)
                          const rowIsRelational =
                            rowMeta?.type === 'many2one' ||
                            rowMeta?.type === 'many2many' ||
                            rowMeta?.type === 'one2many'
                          const hasDetails = rowIsRelational && Boolean(
                            mapping.inlineMatch?.erpField ||
                            mapping.inlineMatch?.platformField ||
                            (mapping.fuzzyMatchMappings && mapping.fuzzyMatchMappings.length > 0) ||
                            mapping.createMappingId
                          )
                          const isExpanded = expandedLineId === mapping.id

                          return (
                            <React.Fragment key={mapping.id}>
                              <tr className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                                {/* ERP field */}
                                {visibleColumns.erpField && (
                                  <td className="px-3 py-1 align-top">
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
                                      compact
                                    />
                                  </td>
                                )}

                                {/* Store field */}
                                {visibleColumns.zidField && (
                                  <td className="px-3 py-1 align-top">
                                    <div className="flex items-center gap-0.5">
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
                                        compact
                                        disabled={!rowIsRelational && hasStaticValue(mapping.staticValue)}
                                      />
                                      {mapping.zidField && (
                                        <button
                                          type="button"
                                          onClick={() => handleFieldChange(mapping.id, 'zidField', '')}
                                          className="shrink-0 p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
                                          title={lang === 'ar' ? 'إزالة حقل المتجر' : 'Clear store field'}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                )}

                                {/* Static value */}
                                {visibleColumns.staticValue && (
                                  <td className="px-3 py-1 align-top">
                                    <div className="flex items-center gap-0.5">
                                      {renderStaticValueInput(mapping)}
                                      {hasStaticValue(mapping.staticValue) && (
                                        <button
                                          type="button"
                                          onClick={() => handleStaticValueChange(mapping.id, Array.isArray(mapping.staticValue) ? [] : '')}
                                          className="shrink-0 p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
                                          title={lang === 'ar' ? 'إزالة القيمة الثابتة' : 'Clear static value'}
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                )}

                                {/* Policy */}
                                {visibleColumns.policy && (
                                  <td className="px-3 py-1 align-top">
                                    {rowIsRelational ? (
                                      <SearchableSelect
                                        value={mapping.policy || ''}
                                        onChange={(val) => {
                                          const newPolicy = val as any
                                          setMappings(prev => {
                                            const currentList = prev[currentModelKey] || []
                                            const updatedList = currentList.map(m => {
                                              if (m.id === mapping.id) {
                                                let newCreateMappingId = m.createMappingId
                                                if (newPolicy === 'create') {
                                                  newCreateMappingId = `internal:${rowMeta?.relation}`
                                                } else {
                                                  newCreateMappingId = undefined
                                                }
                                                return {
                                                  ...m,
                                                  policy: newPolicy,
                                                  createMappingId: newCreateMappingId,
                                                  staticValue: newPolicy === 'default' ? m.staticValue : ''
                                                }
                                              }
                                              return m
                                            })
                                            return {
                                              ...prev,
                                              [currentModelKey]: updatedList
                                            }
                                          })

                                          if (newPolicy === 'create' && rowMeta?.relation) {
                                            // Add relation model to relatedOdooModels if not present
                                            if (!relatedOdooModels.includes(rowMeta.relation) && rowMeta.relation !== odooModel) {
                                              handleRelatedModelsChange([...relatedOdooModels, rowMeta.relation])
                                            } else {
                                              setActiveTab(rowMeta.relation)
                                            }
                                          }

                                          setIsSaved(false)
                                        }}
                                        options={[
                                          { value: 'create', label: lang === 'ar' ? 'إنشاء سجل جديد' : 'Create new' },
                                          { value: 'default', label: lang === 'ar' ? 'قيمة افتراضية' : 'Default value' },
                                          { value: 'block', label: lang === 'ar' ? 'إيقاف/تعليق' : 'Block/Skip' },
                                          { value: 'none', label: lang === 'ar' ? 'تجاهل صامت' : 'Silent skip' }
                                        ]}
                                        placeholder={lang === 'ar' ? 'اختر السياسة...' : 'Select policy...'}
                                        variant="cell"
                                        compact
                                      />
                                    ) : (
                                      <span className="px-1 text-[11px] text-muted-foreground">—</span>
                                    )}
                                  </td>
                                )}

                                {/* Row actions */}
                                <td className="px-2 py-1 align-top">
                                  <div className="flex items-center justify-end gap-0.5">
                                    {rowIsRelational && (
                                      <button
                                        type="button"
                                        onClick={() => setExpandedLineId(isExpanded ? null : mapping.id)}
                                        className={cn(
                                          'p-1 transition-colors hover:bg-muted',
                                          hasDetails ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground'
                                        )}
                                        title={lang === 'ar' ? 'تفاصيل المطابقة' : 'Match details'}
                                        aria-expanded={isExpanded}
                                      >
                                        <SlidersHorizontal className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveLine(mapping.id)}
                                      className="p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
                                      title={lang === 'ar' ? 'حذف حقل الربط' : 'Remove Mapping Rule'}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Expanded row: the relational extras that would
                                  otherwise make the table unreadable. */}
                              {rowIsRelational && isExpanded && (
                                <tr className="border-b border-border/40 bg-muted/20">
                                  <td colSpan={totalColSpan} className="px-3 py-2.5">
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                      {/* Inline match */}
                                      <div className="space-y-1">
                                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                          {lang === 'ar' ? 'مطابقة السجل المرتبط' : 'Linked record match'}
                                        </span>
                                        <div className="grid grid-cols-2 gap-2">
                                          <SearchableSelect
                                            value={mapping.inlineMatch?.erpField || ''}
                                            onChange={(val) => {
                                              setMappings(prev => {
                                                const updated = { ...prev }
                                                const list = (updated[currentModelKey] || []).map(m =>
                                                  m.id === mapping.id
                                                    ? { ...m, inlineMatch: { erpField: val, platformField: mapping.inlineMatch?.platformField || mapping.zidField || '' } }
                                                    : m
                                                )
                                                updated[currentModelKey] = list
                                                return updated
                                              })
                                              setIsSaved(false)
                                            }}
                                            options={[
                                              { value: '', label: lang === 'ar' ? 'حقل المطابقة...' : 'Match field...' },
                                              ...(modelFields[rowMeta?.relation || ''] || ODOO_FIELDS[rowMeta?.relation || ''] || []).map(f => ({ value: f.value, label: formatFieldLabel(f.label, lang) }))
                                            ]}
                                            placeholder={lang === 'ar' ? 'حقل أودو...' : 'Odoo field...'}
                                            variant="cell"
                                            compact
                                          />
                                          <SearchableSelect
                                            value={mapping.inlineMatch?.platformField || ''}
                                            onChange={(val) => {
                                              setMappings(prev => {
                                                const updated = { ...prev }
                                                const list = (updated[currentModelKey] || []).map(m =>
                                                  m.id === mapping.id
                                                    ? { ...m, inlineMatch: { erpField: mapping.inlineMatch?.erpField || '', platformField: val } }
                                                    : m
                                                )
                                                updated[currentModelKey] = list
                                                return updated
                                              })
                                              setIsSaved(false)
                                            }}
                                            options={[
                                              { value: '', label: lang === 'ar' ? 'حقل المتجر...' : 'Store field...' },
                                              ...currentZidFields.map(f => ({ ...f, label: formatFieldLabel(f.label, lang) }))
                                            ]}
                                            placeholder={lang === 'ar' ? 'حقل المتجر...' : 'Store field...'}
                                            variant="cell"
                                            compact
                                          />
                                        </div>
                                      </div>

                                      {/* Creation mapping (create policy only) */}
                                      {mapping.policy === 'create' && (
                                        <div className="space-y-1">
                                          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            {lang === 'ar' ? 'ماب الإنشاء (داخلي أو خارجي)' : 'Creation mapping (internal or external)'}
                                          </span>
                                          <SearchableSelect
                                            value={mapping.createMappingId || ''}
                                            onChange={(val) => {
                                              setMappings(prev => ({
                                                ...prev,
                                                [currentModelKey]: (prev[currentModelKey] || []).map(m =>
                                                  m.id === mapping.id ? { ...m, createMappingId: val } : m
                                                )
                                              }))
                                              setIsSaved(false)
                                            }}
                                            options={[
                                              { value: '', label: lang === 'ar' ? 'اختر ماب...' : 'Select mapping...' },
                                              // Internal tabs
                                              ...Object.keys(mappings).map(key => ({
                                                value: `internal:${key}`,
                                                label: lang === 'ar' ? `(داخلي) ${key}` : `(Internal) ${key}`
                                              })),
                                              // External saved mappings
                                              ...(allMappings || [])
                                                .filter(m => m.id !== editingId)
                                                .map(m => ({
                                                  value: m.id,
                                                  label: lang === 'ar' ? `(خارجي) ${m.name} [${m.odoo_model}]` : `(External) ${m.name} [${m.odoo_model}]`
                                                }))
                                            ]}
                                            placeholder={lang === 'ar' ? 'اختر ماب الإنشاء...' : 'Select creation mapping...'}
                                            variant="cell"
                                            compact
                                          />
                                        </div>
                                      )}

                                      {/* Multi-field match designer */}
                                      <div className="space-y-1 md:col-span-2">
                                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                          {lang === 'ar' ? 'مطابقة متقدمة (متعدد الحقول)' : 'Advanced match (multi-field)'}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActiveFuzzyLine(mapping)
                                            setFuzzyModalMappings(mapping.fuzzyMatchMappings || [])
                                          }}
                                          className="flex items-center gap-1.5 border border-border bg-card px-2 py-1 text-[11px] font-semibold text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
                                        >
                                          <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                                          {mapping.fuzzyMatchMappings && mapping.fuzzyMatchMappings.length > 0
                                            ? (lang === 'ar' ? `${mapping.fuzzyMatchMappings.length} حقل مطابقة` : `${mapping.fuzzyMatchMappings.length} match fields`)
                                            : (lang === 'ar' ? 'إعداد المطابقة' : 'Configure match')}
                                        </button>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          )
                        })}

                        {/* Add a line */}
                        <tr className="border-t border-border/40 bg-muted/30">
                          <td colSpan={totalColSpan} className="px-3 py-2">
                            <button
                              type="button"
                              onClick={handleAddLine}
                              className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80 transition-colors hover:text-foreground"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {t('map.addFieldBtn')}
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'settings' ? (
              <motion.div
                key="settings-tab"
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                transition={{ duration: 0.15 }}
                className="p-4 border border-border rounded-none bg-muted/20 space-y-5 text-sm text-start"
              >
                <h3 className="font-semibold text-muted-foreground flex items-center gap-2">
                  <HelpCircle className="h-4 w-4 text-foreground" />
                  {t('map.advancedSettings')}
                </h3>
                <div className="space-y-4 max-w-xl">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" id="sync-bi" className="mt-1 h-4 w-4 rounded border-border text-foreground focus:ring-foreground" defaultChecked />
                    <div>
                      <label htmlFor="sync-bi" className="font-semibold block text-muted-foreground">{lang === 'ar' ? 'مزامنة ثنائية الاتجاه' : 'Bi-directional Sync'}</label>
                      <span className="text-xs text-muted-foreground">{lang === 'ar' ? 'إبقاء المنصتين متزامنتين عند تعديل البيانات في أي منهما.' : 'Keep both platforms synchronized when either side is modified.'}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" id="sync-delete" className="mt-1 h-4 w-4 rounded border-border text-foreground focus:ring-foreground" />
                    <div>
                      <label htmlFor="sync-delete" className="font-semibold block text-muted-foreground">{lang === 'ar' ? 'مزامنة عمليات الحذف' : 'Sync Deletions'}</label>
                      <span className="text-xs text-muted-foreground">{lang === 'ar' ? `حذف المنتج من متجر زد تلقائياً عند أرشفته أو حذفه في نظام ${getErpName(erpType)}.` : `Delete product on Zid when it is archived/deleted in ${getErpNameEn(erpType)}.`}</span>
                    </div>
                  </div>

                  {/* Delete Behavior settings */}
                  {odooOperation === 'delete' && (
                    <div className="space-y-3 pt-3 border-t border-border/40 text-start">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        {lang === 'ar' ? '🗑️ سلوك حدث حذف السجل في ERP' : '🗑️ ERP Delete Event Behavior'}
                      </h4>
                      <div className="space-y-2">
                        <span className="text-xs text-muted-foreground block">
                          {lang === 'ar' 
                            ? 'اختر الإجراءات المطلوب تنفيذها في نظام ERP عند استلام حدث حذف من المتجر (اختيار متعدد):' 
                            : 'Choose the actions to perform in ERP when a delete event is received from the store (multiselect):'}
                        </span>
                        
                        <div className="space-y-3 pt-1">
                          <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={deleteBehavior.includes('delete')}
                              onChange={() => {
                                toggleDeleteBehavior('delete')
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-border text-foreground focus:ring-foreground animate-none"
                            />
                            <div>
                              <span className="font-semibold block text-muted-foreground">
                                {lang === 'ar' ? 'حذف السجل نهائياً (Delete)' : 'Delete Record Permanently'}
                              </span>
                              <span className="text-[11px] text-muted-foreground block">
                                {lang === 'ar' 
                                  ? 'محاولة مسح السجل تماماً من نظام ERP.' 
                                  : 'Attempt to permanently delete the record from ERP.'}
                              </span>
                            </div>
                          </label>

                          <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={deleteBehavior.includes('archive')}
                              onChange={() => {
                                toggleDeleteBehavior('archive')
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-border text-foreground focus:ring-foreground animate-none"
                            />
                            <div>
                              <span className="font-semibold block text-muted-foreground">
                                {lang === 'ar' ? 'أرشفة السجل (Archive)' : 'Archive Record'}
                              </span>
                              <span className="text-[11px] text-muted-foreground block">
                                {lang === 'ar' 
                                  ? `تعديل حالة السجل للأرشفة (مثل ضبط الحقل active إلى false في أودو، أو disabled في ERPNext) كإجراء بديل أو إضافي.` 
                                  : `Update record status to archived (e.g. active=false in Odoo, or disabled=1 in ERPNext) as a fallback or additional action.`}
                              </span>
                            </div>
                          </label>

                          <label className="flex items-start gap-2.5 text-xs text-muted-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={deleteBehavior.includes('run_map')}
                              onChange={() => {
                                toggleDeleteBehavior('run_map')
                              }}
                              className="mt-0.5 h-4 w-4 rounded border-border text-foreground focus:ring-foreground animate-none"
                            />
                            <div>
                              <span className="font-semibold block text-muted-foreground">
                                {lang === 'ar' ? 'تنفيذ المطابقة / الماب (Run Map)' : 'Run Field Mapping'}
                              </span>
                              <span className="text-[11px] text-muted-foreground block">
                                {lang === 'ar' 
                                  ? 'تحديث قيم الحقول في السجل طبقاً لجدول المطابقة المكتوب (مثل تعيين قيم ثابتة أو حقول مخصصة).' 
                                  : 'Update fields in the record according to the mapped lines in the mapping table.'}
                              </span>
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Variant Sync Mode settings */}
                  {odooModel === 'product.template' && 
                    (zidEvent.toLowerCase().includes('product') || 
                     zidEvent.toLowerCase().includes('item') || 
                     zidEvent.toLowerCase().includes('stock')) && 
                    (odooOperation === 'create' || odooOperation === 'update') && (
                    <div className="space-y-3 pt-3 border-t border-border/40 text-start animate-in fade-in slide-in-from-top-1 duration-200">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        {lang === 'ar' ? '📦 خيارات مزامنة المتغيرات (Product Variants)' : '📦 Product Variant Sync Mode'}
                      </h4>
                      <div className="space-y-3">
                        <span className="text-[11px] text-muted-foreground block">
                          {lang === 'ar' 
                            ? 'حدد كيفية مزامنة المنتجات التي تحتوي على خيارات متعددة (مثل المقاس أو اللون):' 
                            : 'Choose how products with multiple variants (e.g. size or color) should be synced:'}
                        </span>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                          <label className={cn(
                            "flex items-start gap-3 p-3.5 rounded-none border cursor-pointer transition-all duration-200 shadow-sm hover:shadow",
                            variantSyncMode === 'AS_VARIANTS' 
                              ? "bg-foreground/5 border-foreground text-foreground ring-1 ring-foreground/20" 
                              : "bg-background border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground"
                          )}>
                            <input
                              type="radio"
                              name="variantSyncMode"
                              value="AS_VARIANTS"
                              checked={variantSyncMode === 'AS_VARIANTS'}
                              onChange={() => {
                                setVariantSyncMode('AS_VARIANTS')
                                setIsSaved(false)
                              }}
                              className="mt-1 h-4 w-4 text-foreground border-border focus:ring-foreground focus:ring-offset-0 focus:ring-0"
                            />
                            <div className="space-y-1">
                              <span className="font-semibold block text-xs text-muted-foreground">
                                {lang === 'ar' ? 'مزامنة كمنتج بمتغيرات (AS_VARIANTS)' : 'Sync as Product with Variants'}
                              </span>
                              <span className="text-[11px] leading-relaxed block text-muted-foreground">
                                {lang === 'ar' 
                                  ? 'يتم إنشاء منتج رئيسي واحد في Odoo وربط الخيارات به كمتغيرات (مثل اللون والمقاس).' 
                                  : 'Creates a single main product template in Odoo and groups all option variants under it.'}
                              </span>
                            </div>
                          </label>

                          <label className={cn(
                            "flex items-start gap-3 p-3.5 rounded-none border cursor-pointer transition-all duration-200 shadow-sm hover:shadow",
                            variantSyncMode === 'AS_SEPARATE_PRODUCTS' 
                              ? "bg-foreground/5 border-foreground text-foreground ring-1 ring-foreground/20" 
                              : "bg-background border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground"
                          )}>
                            <input
                              type="radio"
                              name="variantSyncMode"
                              value="AS_SEPARATE_PRODUCTS"
                              checked={variantSyncMode === 'AS_SEPARATE_PRODUCTS'}
                              onChange={() => {
                                setVariantSyncMode('AS_SEPARATE_PRODUCTS')
                                setIsSaved(false)
                              }}
                              className="mt-1 h-4 w-4 text-foreground border-border focus:ring-foreground focus:ring-offset-0 focus:ring-0"
                            />
                            <div className="space-y-1">
                              <span className="font-semibold block text-xs text-muted-foreground">
                                {lang === 'ar' ? 'مزامنة كمنتجات منفصلة (AS_SEPARATE_PRODUCTS)' : 'Sync as Separate Products'}
                              </span>
                              <span className="text-[11px] leading-relaxed block text-muted-foreground">
                                {lang === 'ar' 
                                  ? 'يتم إنشاء كل متغير كمنتج مستقل تماماً في Odoo، ودمج اسم المتغير في اسم المنتج.' 
                                  : 'Creates a completely standalone product in Odoo for each variant option.'}
                              </span>
                            </div>
                          </label>
                        </div>

                        {variantSyncMode === 'AS_VARIANTS' && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3.5 border-t border-border/40 animate-in fade-in slide-in-from-top-1 duration-200">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                                {lang === 'ar' ? '🔍 حقل مطابقة المتغير في Odoo:' : '🔍 Odoo Variant Match Field:'}
                              </label>
                              <div className="rounded-none border border-border bg-card p-0.5">
                                <SearchableSelect
                                  value={variantOdooMatchField}
                                  onChange={(val) => {
                                    setVariantOdooMatchField(val)
                                    setIsSaved(false)
                                  }}
                                  options={[
                                    { value: '', label: lang === 'ar' ? 'مطابقة تلقائية بالخصائص (الافتراضي)' : 'Auto-match by Attributes (Default)' },
                                    ...(modelFields['product.product'] || ODOO_FIELDS['product.product'] || []).map(f => ({
                                      value: f.value,
                                      label: `${f.label.split(' (')[0]} (${f.value})`
                                    }))
                                  ]}
                                  placeholder={lang === 'ar' ? 'اختر حقل المطابقة...' : 'Select match field...'}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground block leading-tight">
                                {lang === 'ar' 
                                  ? 'الحقل المراد مقارنته داخل سجل Odoo (product.product).' 
                                  : 'The field to match against in the Odoo Variant record (product.product).'}
                              </span>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
                                {lang === 'ar' ? '🔍 حقل المطابقة في المتجر:' : '🔍 Store Variant Match Field:'}
                              </label>
                              <div className="rounded-none border border-border bg-card p-0.5">
                                <SearchableSelect
                                  value={variantZidMatchField}
                                  onChange={(val) => {
                                    setVariantZidMatchField(val)
                                    setIsSaved(false)
                                  }}
                                  options={[
                                    { value: '', label: lang === 'ar' ? 'مطابقة تلقائية بالخصائص (الافتراضي)' : 'Auto-match by Attributes (Default)' },
                                    ...(STORE_VARIANT_FIELDS[platform] || []).map(f => ({
                                      value: f.value,
                                      label: lang === 'ar' ? `${f.labelAr} (${f.value})` : `${f.label} (${f.value})`
                                    }))
                                  ]}
                                  placeholder={lang === 'ar' ? 'اختر حقل المطابقة...' : 'Select match field...'}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground block leading-tight">
                                {lang === 'ar' 
                                  ? 'الحقل المراد مقارنته من بيانات المتغير الواردة بالحدث.' 
                                  : 'The field in the incoming variant payload to compare.'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Shipping cost as Order Line configuration */}
                  {odooModel === 'sale.order' && (
                    <div className="space-y-3 pt-3 border-t border-border/40 text-start">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        {lang === 'ar' ? '🚚 إضافة تكلفة الشحن كبند في الطلب' : '🚚 Add Shipping as Order Line'}
                      </h4>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id="add-shipping-line"
                          checked={addShippingAsLine}
                          onChange={(e) => {
                            setAddShippingAsLine(e.target.checked)
                            setIsSaved(false)
                          }}
                          className="mt-1 h-4 w-4 rounded border-border text-foreground focus:ring-foreground"
                        />
                        <div className="flex-1 space-y-2">
                          <label htmlFor="add-shipping-line" className="font-semibold block text-muted-foreground">
                            {lang === 'ar' ? 'إدراج الشحن كبند منتج (Sales Order Line) تلقائياً' : 'Automatically insert shipping as a product line'}
                          </label>
                          <span className="text-xs text-muted-foreground block">
                            {lang === 'ar' ? 'عند تفعيله، سيتم إضافة سطر إضافي في الطلب بقيمة الشحن.' : 'When enabled, an additional line item will be added to the sales order with the shipping cost.'}
                          </span>
                          
                          {addShippingAsLine && (
                            <div className="grid grid-cols-2 gap-3 pt-2">
                              <div className="space-y-1">
                                <label className="text-[11px] text-muted-foreground font-semibold block">
                                  {lang === 'ar' ? 'رقم المنتج في أودو (Product ID):' : 'Odoo Product ID:'}
                                </label>
                                <input
                                  type="text"
                                  value={shippingProductId}
                                  onChange={(e) => {
                                    setShippingProductId(e.target.value)
                                    setIsSaved(false)
                                  }}
                                  placeholder="e.g. 99"
                                  className="h-8 w-full rounded-none border border-input bg-inputBg px-3 text-xs outline-none focus:border-foreground transition-all"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[11px] text-muted-foreground font-semibold block">
                                  {lang === 'ar' ? 'أو كود المنتج (Product SKU):' : 'Or Product SKU:'}
                                </label>
                                <input
                                  type="text"
                                  value={shippingProductSku}
                                  onChange={(e) => {
                                    setShippingProductSku(e.target.value)
                                    setIsSaved(false)
                                  }}
                                  placeholder="e.g. SHIPPING"
                                  className="h-8 w-full rounded-none border border-input bg-inputBg px-3 text-xs outline-none focus:border-foreground transition-all"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Discount as Order Line configuration */}
                  {odooModel === 'sale.order' && (
                    <div className="space-y-3 pt-3 border-t border-border/40 text-start">
                      <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        {lang === 'ar' ? '🏷️ إضافة الخصم كبند في الطلب (Order-Level)' : '🏷️ Add Discount as Order Line (Order-Level)'}
                      </h4>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id="add-discount-line"
                          checked={addDiscountAsLine}
                          onChange={(e) => {
                            setAddDiscountAsLine(e.target.checked)
                            setIsSaved(false)
                          }}
                          className="mt-1 h-4 w-4 rounded border-border text-foreground focus:ring-foreground"
                        />
                        <div className="flex-1 space-y-2">
                          <label htmlFor="add-discount-line" className="font-semibold block text-muted-foreground">
                            {lang === 'ar' ? 'إدراج الخصم كبند منتج (Sales Order Line) تلقائياً' : 'Automatically insert discount as a product line'}
                          </label>
                          <span className="text-xs text-muted-foreground block">
                            {lang === 'ar' ? 'عند تفعيله، سيتم إضافة سطر إضافي في الطلب بقيمة الخصم (في حال وجوده في البيانات المرسلة من زد).' : 'When enabled, an additional line item will be added to the sales order with the discount amount (only if discount exists in the Zid payload).'}
                          </span>

                          {addDiscountAsLine && (
                            <div className="grid grid-cols-2 gap-3 pt-2">
                              <div className="space-y-1">
                                <label className="text-[11px] text-muted-foreground font-semibold block">
                                  {lang === 'ar' ? 'رقم منتج الخصم في أودو (Product ID):' : 'Odoo Discount Product ID:'}
                                </label>
                                <input
                                  type="text"
                                  value={discountProductId}
                                  onChange={(e) => {
                                    setDiscountProductId(e.target.value)
                                    setIsSaved(false)
                                  }}
                                  placeholder="e.g. 999"
                                  className="h-8 w-full rounded-none border border-input bg-inputBg px-3 text-xs outline-none focus:border-foreground transition-all"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[11px] text-muted-foreground font-semibold block">
                                  {lang === 'ar' ? 'أو كود المنتج (Product SKU):' : 'Or Product SKU:'}
                                </label>
                                <input
                                  type="text"
                                  value={discountProductSku}
                                  onChange={(e) => {
                                    setDiscountProductSku(e.target.value)
                                    setIsSaved(false)
                                  }}
                                  placeholder="e.g. DISCOUNT"
                                  className="h-8 w-full rounded-none border border-input bg-inputBg px-3 text-xs outline-none focus:border-foreground transition-all"
                                />
                              </div>
                              <div className="col-span-2 space-y-1">
                                <label className="text-[11px] text-muted-foreground font-semibold block">
                                  {lang === 'ar' ? 'صيغة الخصم (Discount Mode):' : 'Discount Mode:'}
                                </label>
                                <div className="flex items-center gap-4 pt-1">
                                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <input
                                      type="radio"
                                      name="discount-mode"
                                      checked={discountMode === 'fixed'}
                                      onChange={() => {
                                        setDiscountMode('fixed')
                                        setIsSaved(false)
                                      }}
                                      className="h-3 w-3"
                                    />
                                    <span>{lang === 'ar' ? 'مبلغ ثابت' : 'Fixed Amount'}</span>
                                  </label>
                                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <input
                                      type="radio"
                                      name="discount-mode"
                                      checked={discountMode === 'percent'}
                                      onChange={() => {
                                        setDiscountMode('percent')
                                        setIsSaved(false)
                                      }}
                                      className="h-3 w-3"
                                    />
                                    <span>{lang === 'ar' ? 'نسبة مئوية' : 'Percent'}</span>
                                  </label>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
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
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-card text-foreground border border-border px-4 py-3.5 rounded-none text-sm max-w-sm font-medium shadow-card"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background text-foreground">
              <Check className="h-3 w-3 stroke-[3]" />
            </div>
            <div className="flex-1">{toastMessage}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Smart Match Config Modal - Match Designer */}
      <AnimatePresence>
        {activeFuzzyLine && (() => {
          const meta = getFieldMeta(currentModelKey, activeFuzzyLine.erpField)
          const relation = meta?.relation || ''
          const relationFields = modelFields[relation] || ODOO_FIELDS[relation] || []
          
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="w-full max-w-2xl bg-card border border-border rounded-none overflow-hidden flex flex-col max-h-[85vh] text-start"
              >
                {/* Header */}
                <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30">
                  <div>
                    <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                      <span>🎯</span>
                      {lang === 'ar' ? 'مصمم المطابقة' : 'Match Designer'}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {lang === 'ar' 
                        ? `حدد حقول المطابقة للبحث في "${relation}"` 
                        : `Set match fields to search records in "${relation}"`}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveFuzzyLine(null)}
                    className="rounded-none p-1.5 hover:bg-muted text-muted-foreground transition-all"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-4 flex-1">
                  <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-none border border-border/60">
                    💡 {lang === 'ar' 
                      ? 'سيبحث النظام بالمطابقة المختارة أولاً، ثم بحقل زد الرئيسي. إذا لم يُعثر على تطابق، سيلجأ للسياسة الاحتياطية المُحدّدة في الجدول.'
                      : 'The system searches using the match map below first, then the main Zid field. If no match is found, the fallback policy in the table applies.'}
                  </div>

                  {/* OR/AND Toggle + Match Fields Header */}
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        {lang === 'ar' ? 'حقول المطابقة' : 'Match Fields'}
                      </span>
                      {(activeFuzzyLine.fuzzyMatchMappings?.length ?? fuzzyModalMappings.length) > 0 && (() => {
                        const currentOperator = activeFuzzyLine.matchOperator || 'OR'
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              const newOp = currentOperator === 'OR' ? 'AND' : 'OR'
                              setMappings(prev => ({
                                ...prev,
                                [currentModelKey]: (prev[currentModelKey] || []).map(line => {
                                  if (line.id === activeFuzzyLine.id) {
                                    return { ...line, matchOperator: newOp }
                                  }
                                  return line
                                })
                              }))
                              setIsSaved(false)
                            }}
                            className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-none border transition-all",
                              currentOperator === 'OR'
                                ? "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"
                                : "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                            )}
                          >
                            {currentOperator === 'OR' ? 'OR' : 'AND'}
                          </button>
                        )
                      })()}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {lang === 'ar'
                        ? (activeFuzzyLine.matchOperator === 'AND' ? 'كل التطابقات مطلوبة' : 'يكفي أي تطابق')
                        : (activeFuzzyLine.matchOperator === 'AND' ? 'All conditions required' : 'Any condition matches')}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-12 gap-3 text-xs font-bold text-muted-foreground uppercase tracking-wider px-2">
                      <div className="col-span-5">{lang === 'ar' ? 'حقل أودو (Odoo Field)' : 'Odoo Field'}</div>
                      <div className="col-span-6">{lang === 'ar' ? 'حقل المتجر (Store Field)' : 'Store Field'}</div>
                      <div className="col-span-1"></div>
                    </div>

                    <div className="space-y-2">
                      {fuzzyModalMappings.map((m, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-3 items-center bg-muted/20 p-2.5 rounded-none border border-border/40">
                          {/* Odoo Field Selection */}
                          <div className="col-span-5">
                            <SearchableSelect
                              value={m.erpField}
                              onChange={(val) => {
                                setFuzzyModalMappings(prev => prev.map((item, i) => i === idx ? { ...item, erpField: val } : item))
                              }}
                              options={relationFields.map(opt => ({
                                value: opt.value,
                                label: formatFieldLabel(opt.label, lang)
                              }))}
                              placeholder={lang === 'ar' ? 'اختر حقل أودو...' : 'Select Odoo field...'}
                              variant="cell"
                            />
                          </div>

                          {/* Platform Field Selection */}
                          <div className="col-span-6">
                            <SearchableSelect
                              value={m.platformField}
                              onChange={(val) => {
                                setFuzzyModalMappings(prev => prev.map((item, i) => i === idx ? { ...item, platformField: val } : item))
                              }}
                              options={currentZidFields.map(opt => ({
                                value: opt.value,
                                label: formatFieldLabel(opt.label, lang)
                              }))}
                              placeholder={lang === 'ar' ? 'اختر حقل المتجر...' : 'Select store field...'}
                              variant="cell"
                            />
                          </div>

                          {/* Delete Button */}
                          <div className="col-span-1 flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setFuzzyModalMappings(prev => prev.filter((_, i) => i !== idx))
                              }}
                              className="text-muted-foreground/60 hover:text-destructive p-1 rounded-none hover:bg-destructive/10 transition-all"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {fuzzyModalMappings.length === 0 && (
                        <div className="text-center py-6 text-xs text-muted-foreground italic border border-dashed border-border/80 rounded-none">
                          {lang === 'ar' ? 'لا توجد حقول مطابقة مخصصة مضافة حالياً. أضف حقولاً للبحث أو أغلق النافذة للاكتفاء بحقل زد الرئيسي.' : 'No custom match fields configured. Add fields to search, or close to use the main Zid field only.'}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setFuzzyModalMappings(prev => [...prev, { erpField: '', platformField: '' }])
                      }}
                      className="text-foreground hover:text-foreground/80 font-semibold flex items-center gap-1.5 transition-all text-xs mt-2 px-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {lang === 'ar' ? 'إضافة حقل مطابقة آخر' : 'Add match field'}
                    </button>
                  </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border flex items-center justify-between gap-3 bg-muted/10">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowDryRunModal(true)
                        setDryRunResult(null)
                        setDryRunSampleData('')
                      }}
                      className="text-xs gap-1.5"
                    >
                      <span>🧪</span>
                      {lang === 'ar' ? 'تجربة المطابقة' : 'Test Match'}
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setActiveFuzzyLine(null)}
                      className="text-xs"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => {
                        const filtered = fuzzyModalMappings.filter(m => m.erpField && m.platformField)
                        
                        setMappings(prev => ({
                          ...prev,
                          [currentModelKey]: (prev[currentModelKey] || []).map(line => {
                            if (line.id === activeFuzzyLine.id) {
                              return { ...line, fuzzyMatchMappings: filtered }
                            }
                            return line
                          })
                        }))
                        
                        setIsSaved(false)
                        setActiveFuzzyLine(null)
                      }}
                      className="text-xs"
                    >
                      {lang === 'ar' ? 'تطبيق وإغلاق' : 'Apply & Save'}
                    </Button>
                  </div>
                </div>
              </motion.div>
            </div>
          )
        })()}
      </AnimatePresence>

      {/* Dry-Run Preview Modal */}
      <AnimatePresence>
        {showDryRunModal && activeFuzzyLine && (() => {
          const meta = getFieldMeta(currentModelKey, activeFuzzyLine.erpField)
          const relation = meta?.relation || ''
          return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-foreground/60 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="w-full max-w-xl bg-card border border-border rounded-none overflow-hidden flex flex-col max-h-[85vh] text-start"
              >
                {/* Header */}
                <div className="p-4 border-b border-border flex items-center justify-between bg-muted/30">
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <span>🧪</span>
                      {lang === 'ar' ? 'تجربة المطابقة' : 'Test Match'}
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {lang === 'ar'
                        ? `اختبر المطابقة على ${relation} قبل الحفظ`
                        : `Test matching against ${relation} before saving`}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDryRunModal(false)}
                    className="rounded-none p-1 hover:bg-muted text-muted-foreground transition-all"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto space-y-3 flex-1">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-muted-foreground">
                      {lang === 'ar' ? 'بيانات زد النموذجية (JSON):' : 'Sample Zid data (JSON):'}
                    </label>
                    <textarea
                      value={dryRunSampleData}
                      onChange={(e) => setDryRunSampleData(e.target.value)}
                      placeholder={lang === 'ar'
                        ? 'ألصق هنا عينة من بيانات webhook زد...\nمثال: {\n  "sku": "PROD-123",\n  "barcode": "123456",\n  "name": "منتج تجريبي"\n}'
                        : 'Paste a Zid webhook data sample...\nExample: {\n  "sku": "PROD-123",\n  "barcode": "123456",\n  "name": "Test Product"\n}'}
                      rows={6}
                      className="w-full rounded-none border border-input bg-inputBg p-3 text-xs outline-none focus:border-foreground focus:ring-1 focus:ring-foreground resize-none font-mono transition-all"
                    />
                  </div>

                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={isRunningDryRun || !dryRunSampleData.trim()}
                    onClick={async () => {
                      setIsRunningDryRun(true)
                      setDryRunResult(null)
                      try {
                        let parsed: Record<string, unknown>
                        try {
                          parsed = JSON.parse(dryRunSampleData)
                        } catch {
                          setDryRunResult({ phase: 'error', error: lang === 'ar' ? 'JSON غير صالح' : 'Invalid JSON' })
                          setIsRunningDryRun(false)
                          return
                        }

                        const { dryRunMatch } = await import('@/app/actions/odoo')
                        const res = await dryRunMatch({
                          relation,
                          item: {
                            fuzzyMatchMappings: activeFuzzyLine.fuzzyMatchMappings || [],
                            matchOperator: activeFuzzyLine.matchOperator || 'OR',
                            staticValue: activeFuzzyLine.staticValue || '',
                            policy: activeFuzzyLine.policy || 'create',
                            createMappingId: activeFuzzyLine.createMappingId || '',
                            inlineSubMapping: activeFuzzyLine.inlineSubMapping
                          },
                          sampleData: parsed
                        })
                        if (res.success) {
                          setDryRunResult(res)
                        } else {
                          setDryRunResult({ phase: 'error', error: res.error })
                        }
                      } catch (err: any) {
                        setDryRunResult({ phase: 'error', error: err.message || 'Failed' })
                      }
                      setIsRunningDryRun(false)
                    }}
                    className="text-xs w-full"
                  >
                    {isRunningDryRun ? (
                      <><Loader2 className="h-3 w-3 animate-spin mr-1" /> {lang === 'ar' ? 'جاري الاختبار...' : 'Testing...'}</>
                    ) : (
                      <>{lang === 'ar' ? '🔍 تشغيل الاختبار' : '🔍 Run Test'}</>
                    )}
                  </Button>

                  {/* Result display */}
                  {dryRunResult && (
                    <div className={cn(
                      "rounded-none border p-3 text-xs space-y-1",
                      dryRunResult.phase === 'error' ? "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300" :
                      dryRunResult.phase === 'custom_map' || dryRunResult.phase === 'default_fallback' ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300" :
                      dryRunResult.phase === 'create' ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300" :
                      "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-300"
                    )}>
                      {dryRunResult.phase === 'custom_map' && (
                        <><span className="font-bold">🟢 </span>{lang === 'ar' ? `تم العثور على المنتج #${dryRunResult.matchedId} عبر خريطة المطابقة` : `Match found via Custom Map → ID #${dryRunResult.matchedId}`}</>
                      )}
                      {dryRunResult.phase === 'default_fallback' && (
                        <><span className="font-bold">🟡 </span>{lang === 'ar' ? `سيستخدم المنتج الافتراضي #${dryRunResult.matchedId}` : `Will use default product ID #${dryRunResult.matchedId}`}</>
                      )}
                      {dryRunResult.phase === 'create' && (
                        <><span className="font-bold">🔵 </span>{lang === 'ar' ? 'سينشئ سجل جديد في أودو' : 'Will create a new record in Odoo'}</>
                      )}
                      {dryRunResult.phase === 'block' && (
                        <><span className="font-bold">🔴 </span>{lang === 'ar' ? 'سيتم إيقاف المزامنة' : 'Sync will be blocked'}</>
                      )}
                      {dryRunResult.phase === 'not_found' && (
                        <><span className="font-bold">🟠 </span>{lang === 'ar' ? 'لم يُعثر على مطابقة و لا توجد سياسة احتياطية' : 'No match found and no fallback policy'}</>
                      )}
                      {dryRunResult.phase === 'error' && (
                        <><span className="font-bold">❌ </span>{dryRunResult.error || (lang === 'ar' ? 'خطأ غير معروف' : 'Unknown error')}</>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-border flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowDryRunModal(false)}
                    className="text-xs"
                  >
                    {lang === 'ar' ? 'إغلاق' : 'Close'}
                  </Button>
                </div>
              </motion.div>
            </div>
          )
        })()}
      </AnimatePresence>

    </div>
  )
}
