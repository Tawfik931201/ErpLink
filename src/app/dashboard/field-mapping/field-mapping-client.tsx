'use client'

import React, { useState, useEffect } from 'react'
import { 
  Plus, 
  Edit, 
  Trash2, 
  SlidersHorizontal, 
  ArrowRight, 
  Database, 
  Layers, 
  Calendar,
  AlertTriangle,
  Loader2,
  History,
  Puzzle,
  ArrowRightLeft
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ZID_EVENTS, SALLA_EVENTS } from './field-mapping-form'
import FieldMappingForm from './field-mapping-form'
import SearchableSelect from './searchable-select'
import { getFieldMappings, deleteFieldMapping } from '@/app/actions/field-mappings'
import { useLanguage } from '@/components/language-provider'
import { formatFieldLabel } from '@/lib/translations'
import SyncLogModal from './sync-log-modal'
import { motion, AnimatePresence } from 'framer-motion'
import AddCustomFieldForm from './add-custom-field-form'
import FixedMappingsTab from './fixed-mappings-tab'

interface FieldMappingClientProps {
  initialModels: Array<{ model: string; name: string }>
  hasOdooConnection: boolean
  erpType?: string
  preloadedModel: string
  preloadedFields: any[]
  isZidConnected: boolean
  isSallaConnected: boolean
  zidStoreName?: string | null
  sallaStoreName?: string | null
  initialFixedMappings?: any[]
}

export default function FieldMappingClient({
  initialModels,
  hasOdooConnection,
  erpType = 'odoo',
  preloadedModel,
  preloadedFields,
  isZidConnected,
  isSallaConnected,
  zidStoreName,
  sallaStoreName,
  initialFixedMappings = []
}: FieldMappingClientProps) {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [mappings, setMappings] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedMapping, setSelectedMapping] = useState<any>(null)
  const { t, lang, dir } = useLanguage()

  // Page-level tab: 'mapping' | 'addfield' | 'fixedmapping'
  const [pageTab, setPageTab] = useState<'mapping' | 'addfield' | 'fixedmapping'>('mapping')
  const [fixedMappings, setFixedMappings] = useState<any[]>(initialFixedMappings)
  
  // Filter tab state: 'all' | 'zid' | 'salla'
  const [platformFilter, setPlatformFilter] = useState<string[]>([])

  // Advanced Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [directionFilter, setDirectionFilter] = useState<string[]>([])
  const [operationFilter, setOperationFilter] = useState<string[]>([])

  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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

  const getEventBadgeStyles = (eventId: string) => {
    if (eventId.startsWith('product')) {
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    }
    if (eventId.startsWith('order')) {
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
    }
    if (eventId.startsWith('customer')) {
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
    }
    if (eventId.startsWith('category')) {
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    }
    return 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20'
  }

  const getEventName = (eventId: string) => {
    const found = ZID_EVENTS.find(e => e.id === eventId) || SALLA_EVENTS.find(e => e.id === eventId)
    return found ? formatFieldLabel(found.name, lang) : eventId
  }

  // Detect if action belongs to Zid or Salla
  const getPlatformSource = (action: string): 'zid' | 'salla' => {
    if (SALLA_EVENTS.find(e => e.id === action)) return 'salla'
    return 'zid'
  }

  const getActionGroup = (action: string) => {
    const act = action.toLowerCase()
    if (act.includes('product') || act.includes('item') || act.includes('stock')) return 'products'
    if (act.includes('order') || act.includes('cart') || act.includes('shipment') || act.includes('abandoned')) return 'orders'
    if (act.includes('customer') || act.includes('branch') || act.includes('brand') || act.includes('partner')) return 'customers'
    if (act.includes('category')) return 'categories'
    return 'other'
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
          fixedMappings={fixedMappings}
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
    const allModelKeys = Object.keys(selectedMapping.mappings || {})
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
          editingId={selectedMapping.id}
          initialName={selectedMapping.name}
          initialAction={selectedMapping.action}
          initialOdooModel={selectedMapping.odoo_model}
          initialOdooOperation={selectedMapping.odoo_operation || 'create'}
          initialOdooMatchField={selectedMapping.odoo_match_field || ''}
          initialZidMatchField={selectedMapping.zid_match_field || ''}
          initialMappings={selectedMapping.mappings}
          initialRelatedModels={initialRelated}
          fixedMappings={fixedMappings}
          initialSyncDirection={selectedMapping.sync_direction || 'store_to_erp'}
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
    ...(isSallaConnected ? [{ value: 'salla', label: sallaStoreName || (lang === 'ar' ? 'متجر سلة (Salla)' : 'Salla Store') }] : [])
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
    <div className="max-w-4xl mx-auto space-y-4 font-sans" dir={dir}>

      {/* ── Page-Level Animated Tabs ───────────────────────────────────── */}
      <div className="flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/50 rounded-2xl p-1 w-fit shadow-inner">
        {[
          {
            key: 'mapping',
            labelAr: 'ربط الحقول',
            labelEn: 'Field Mapping',
            icon: <SlidersHorizontal className="h-3.5 w-3.5" />
          },
          ...(erpType === 'odoo' || erpType === 'erpnext' ? [{
            key: 'addfield',
            labelAr: 'إضافة حقل',
            labelEn: 'Add Field',
            icon: <Puzzle className="h-3.5 w-3.5" />
          }] : []),
          {
            key: 'fixedmapping',
            labelAr: 'الربط الثابت',
            labelEn: 'Fixed Mapping',
            icon: <ArrowRightLeft className="h-3.5 w-3.5" />
          },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPageTab(tab.key as 'mapping' | 'addfield' | 'fixedmapping')}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors duration-200 z-10',
              pageTab === tab.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {pageTab === tab.key && (
              <motion.span
                layoutId="page-tab-pill"
                className={cn(
                  'absolute inset-0 rounded-xl shadow-sm',
                  tab.key === 'addfield'
                    ? 'bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-400/25'
                    : tab.key === 'fixedmapping'
                    ? 'bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border border-indigo-400/25'
                    : 'bg-white dark:bg-slate-700 border border-slate-200/80 dark:border-slate-600'
                )}
                transition={{ type: 'spring', stiffness: 450, damping: 38 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {tab.icon}
              {lang === 'ar' ? tab.labelAr : tab.labelEn}
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
      {pageTab === 'fixedmapping' ? (
        <motion.div
          key="fixedmapping-tab"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <FixedMappingsTab
            initialModels={initialModels}
            hasOdooConnection={hasOdooConnection}
            isZidConnected={isZidConnected}
            isSallaConnected={isSallaConnected}
            fixedMappings={fixedMappings}
            onFixedMappingsChange={setFixedMappings}
            erpType={erpType}
          />
        </motion.div>
      ) : pageTab === 'addfield' ? (
        <motion.div
          key="addfield-tab"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          <AddCustomFieldForm
            initialModels={initialModels}
            hasOdooConnection={hasOdooConnection}
            erpType={erpType}
          />
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
          <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
            {t('nav.fieldMapping')}
          </h1>
          <p className="mt-1 text-muted-foreground text-[11px]">
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
            className="border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 gap-1.5 font-medium rounded-lg h-9 text-xs shadow-sm"
          >
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            {lang === 'ar' ? 'سجل المزامنة العام' : 'Global Sync Log'}
          </Button>
          <Button 
            onClick={() => setView('create')}
            className="gradient-brand text-white gap-1.5 font-medium rounded-lg h-9 text-xs shadow-sm hover:scale-[1.01] transition-transform duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'إضافة ربط جديد' : 'Add New Mapping'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] bg-white border border-slate-200/80 rounded-xl p-8">
          <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
          <p className="text-xs text-muted-foreground font-medium">{lang === 'ar' ? 'جاري تحميل إعدادات الربط...' : 'Loading field mappings...'}</p>
        </div>
      ) : mappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center min-h-[250px] bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/10 to-purple-500/10 flex items-center justify-center mb-4">
            <SlidersHorizontal className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-sm font-bold text-foreground mb-1">{lang === 'ar' ? 'لا يوجد ربط حقول حالياً' : 'No Field Mappings Found'}</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4 leading-relaxed">
            {lang === 'ar' 
              ? `قم بربط وتخصيص كيفية انتقال الحقول بين متجرك ونظام ${getErpFromLabel(erpType)} لإيقاف المزامنة اليدوية وبدء المزامنة التلقائية.` 
              : `Map and customize how fields flow between your store and ${getErpFromLabel(erpType)} to automate data synchronization.`}
          </p>
          <Button 
            onClick={() => setView('create')}
            className="gradient-brand text-white gap-1.5 font-semibold rounded-lg h-9 text-xs shadow-sm hover:scale-[1.01] transition-transform duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'ابدأ ربط الحقول الآن' : 'Start Mapping Fields'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Advanced Filter Bar */}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 p-4 bg-slate-50/50 dark:bg-slate-900/40 rounded-xl border border-slate-200/60 dark:border-slate-800">
            {/* Search Input */}
            <div className="sm:col-span-2 md:col-span-1">
              <input
                type="text"
                placeholder={lang === 'ar' ? 'بحث باسم الربط، النموذج...' : 'Search mapping, model...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs h-9 px-3 rounded-lg border border-slate-200 focus:border-primary focus:ring-1 focus:ring-primary outline-none dark:border-slate-800 dark:bg-slate-900 text-foreground placeholder:text-muted-foreground/60 shadow-sm"
              />
            </div>

            {/* Store Filter */}
            <div className="bg-white dark:bg-slate-900 rounded-lg">
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
            <div className="bg-white dark:bg-slate-900 rounded-lg">
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
            <div className="bg-white dark:bg-slate-900 rounded-lg">
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

          {/* Mappings List */}
          <AnimatePresence mode="popLayout">
          <div className="bg-white border border-slate-200/80 shadow-sm rounded-xl overflow-hidden divide-y divide-border/60">
          {filteredMappings.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center min-h-[120px] p-6">
              <p className="text-xs text-muted-foreground font-medium">
                {lang === 'ar' ? 'لا توجد روابط لهذه المنصة' : 'No mappings for this platform'}
              </p>
            </div>
          ) : filteredMappings.map((item) => {
            const totalFields = countTotalMappedFields(item.mappings)
            const formattedDate = item.created_at 
              ? new Date(item.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : '-'

            const platform = getPlatformSource(item.action)
            return (
              <motion.div 
                key={item.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                className="p-4 hover:bg-muted/5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* Details */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary mt-0.5">
                    <SlidersHorizontal className="h-4.5 w-4.5" />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-xs text-foreground break-all">
                        {item.name || (lang === 'ar' ? 'ربط حقول غير مسمى' : 'Unnamed field mapping')}
                      </span>
                      {/* Platform Source Badge */}
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border',
                        platform === 'salla'
                          ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-400/30'
                          : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-400/30'
                      )}>
                        <span className={cn(
                          'inline-block w-1.5 h-1.5 rounded-full',
                          platform === 'salla' ? 'bg-teal-500' : 'bg-violet-500'
                        )} />
                        {platform === 'salla' ? (lang === 'ar' ? 'سله' : 'Salla') : (lang === 'ar' ? 'زد' : 'Zid')}
                      </span>
                      <span className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                        getEventBadgeStyles(item.action)
                      )}>
                        {getEventName(item.action)}
                      </span>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20">
                        {item.odoo_operation === 'delete'
                          ? t('map.operationDelete')
                          : item.odoo_operation === 'update'
                            ? t('map.operationUpdate')
                            : t('map.operationCreate')}
                      </span>
                      {/* Sync Direction Badge */}
                      {(item.sync_direction || 'store_to_erp').split(',').map((dir: string) => (
                        <span key={dir} className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border",
                          dir === 'erp_to_store'
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
                            : "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20"
                        )}>
                          {dir === 'erp_to_store'
                            ? (lang === 'ar' ? `من ${getErpFromLabel(erpType)} للمتجر` : `${getErpFromLabel(erpType)} to Store`)
                            : (lang === 'ar' ? `من المتجر ${getErpLabel(erpType)}` : `Store to ${getErpFromLabel(erpType)}`)}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Database className="h-3 w-3 text-muted-foreground" />
                        <span>{lang === 'ar' ? `نموذج ${getErpFromLabel(erpType)}: ` : `${getErpFromLabel(erpType)} Model: `}<span className="font-mono text-foreground font-semibold">{item.odoo_model}</span></span>
                      </span>
                      {(item.odoo_operation === 'update' || item.odoo_operation === 'delete' || (item.sync_direction || '').split(',').includes('erp_to_store')) && (item.odoo_match_field || item.zid_match_field) && (
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3 text-muted-foreground" />
                          <span>{lang === 'ar' ? 'مطابقة: ' : 'Matching: '}<span className="font-mono text-foreground font-semibold">{item.odoo_match_field || '-'} ⇄ {item.zid_match_field || '-'}</span></span>
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                        <span>{lang === 'ar' ? 'الحقول المربوطة: ' : 'Mapped fields: '}<span className="font-semibold text-foreground">{totalFields}</span></span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Operations */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {deleteConfirmId === item.id ? (
                    <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-lg p-1 animate-in fade-in zoom-in duration-200">
                      <span className="text-[10px] font-semibold text-destructive px-1.5">{lang === 'ar' ? 'تأكيد؟' : 'Confirm?'}</span>
                      <Button 
                        size="sm" 
                        variant="destructive" 
                        disabled={isDeleting}
                        onClick={() => handleDelete(item.id)}
                        className="h-6 px-2 text-xs font-semibold rounded-md"
                      >
                        {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : t('ws.deleteBtn')}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => setDeleteConfirmId(null)}
                        className="h-6 px-2 text-xs font-semibold text-muted-foreground rounded-md hover:bg-muted"
                      >
                        {t('ws.cancelBtn')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setLogMappingId(item.id)
                          setLogMappingName(item.name)
                          setIsLogOpen(true)
                        }}
                        className="h-8 w-8 text-muted-foreground hover:text-primary rounded-lg hover:bg-primary/5"
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
                        className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                        title={t('ws.editBtn')}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteConfirmId(item.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10"
                        title={t('ws.deleteBtn')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            )
          })}
          </div>
          </AnimatePresence>
        </div>
      )}
      
      <SyncLogModal 
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        mappingId={logMappingId}
        mappingName={logMappingName}
        mappingsList={mappings.map(m => ({ id: m.id, name: m.name }))}
      />
      </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}
