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
  History,
  X,
  Search,
} from 'lucide-react'
import React, { useState, useEffect } from 'react'

import { getFieldMappings, deleteFieldMapping } from '@/app/actions/field-mappings'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SALLA_EVENTS } from '@/lib/platforms/salla/fields'
import { SHOPIFY_EVENTS } from '@/lib/platforms/shopify/fields'
import { ZID_EVENTS } from '@/lib/platforms/zid/fields'
import { formatFieldLabel } from '@/lib/translations'
import { cn } from '@/lib/utils'

import FieldMappingForm from './field-mapping-form'
import SearchableSelect from './searchable-select'
import SyncLogModal from './sync-log-modal'

interface CustomMappingClientProps {
  initialModels: Array<{ model: string; name: string }>
  hasOdooConnection: boolean
  erpType?: string
  preloadedModel: string
  preloadedFields: any[]
  isZidConnected: boolean
  isSallaConnected: boolean
  isShopifyConnected: boolean
  /** Multi-store: every linked store per platform (id = merchant_id / shop_domain). */
  zidStores?: { id: string; name: string | null }[]
  sallaStores?: { id: string; name: string | null }[]
  shopifyStores?: { id: string; name: string | null }[]
  /** Store key passed to the create form (first connected store). */
  defaultStoreKey?: string
}

export default function CustomMappingClient({
  initialModels,
  hasOdooConnection,
  erpType = 'odoo',
  preloadedModel,
  preloadedFields,
  isZidConnected,
  isSallaConnected,
  isShopifyConnected,
  zidStores = [],
  sallaStores = [],
  shopifyStores = [],
  defaultStoreKey = '',
}: CustomMappingClientProps) {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [mappings, setMappings] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedMapping, setSelectedMapping] = useState<any>(null)
  const { t, lang, dir } = useLanguage()

  // Filter tab state: 'all' | 'zid' | 'salla'
  const [platformFilter, setPlatformFilter] = useState<string[]>([])

  // Advanced Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [directionFilter, setDirectionFilter] = useState<string[]>([])
  const [operationFilter, setOperationFilter] = useState<string[]>([])

  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [, setIsDeleting] = useState(false)

  // Logs state
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [logMappingId, setLogMappingId] = useState<string | undefined>(undefined)
  const [logMappingName, setLogMappingName] = useState<string | undefined>(undefined)

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
          initialStoreKey={defaultStoreKey}
          zidStores={zidStores}
          sallaStores={sallaStores}
          shopifyStores={shopifyStores}
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
          initialStoreKey={selectedMapping.merchant_id || ''}
          zidStores={zidStores}
          sallaStores={sallaStores}
          shopifyStores={shopifyStores}
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
    ...(isZidConnected ? [{ value: 'zid', label: (zidStores[0]?.name || (lang === 'ar' ? 'متجر زد (Zid)' : 'Zid Store')) + (zidStores.length > 1 ? ` (${zidStores.length})` : '') }] : []),
    ...(isSallaConnected ? [{ value: 'salla', label: (sallaStores[0]?.name || (lang === 'ar' ? 'متجر سلة (Salla)' : 'Salla Store')) + (sallaStores.length > 1 ? ` (${sallaStores.length})` : '') }] : []),
    ...(isShopifyConnected ? [{ value: 'shopify', label: (shopifyStores[0]?.name || (lang === 'ar' ? 'متجر شوبيفاي (Shopify)' : 'Shopify Store')) + (shopifyStores.length > 1 ? ` (${shopifyStores.length})` : '') }] : [])
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
    <div className="max-w-7xl mx-auto space-y-4 pt-[33px] md:pt-[25px]" dir={dir}>
      <motion.div
        key="mapping-tab"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
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

      <SyncLogModal
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        mappingId={logMappingId}
        mappingName={logMappingName}
        mappingsList={mappings.map(m => ({ id: m.id, name: m.name }))}
      />
    </div>
  )
}
