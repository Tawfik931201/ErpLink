'use client'

import { motion } from 'framer-motion'
import {
  Plus,
  SlidersHorizontal,
  ArrowRight,
  History,
  X,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useState, useEffect, useRef } from 'react'

import { getFieldMappings } from '@/app/actions/field-mappings'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { CheckRow, FilterSelect } from '@/components/ui/filter-select'
import { Input } from '@/components/ui/input'
import { SALLA_EVENTS } from '@/lib/platforms/salla/fields'
import { SHOPIFY_EVENTS } from '@/lib/platforms/shopify/fields'
import { ZID_EVENTS } from '@/lib/platforms/zid/fields'
import { formatFieldLabel } from '@/lib/translations'
import { cn } from '@/lib/utils'

import FieldMappingForm from './field-mapping-form'
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
  // Only creation happens inline; editing lives on the record page at
  // /app/mapping-center/custom/<id> so a mapping has a real, linkable URL.
  const [view, setView] = useState<'list' | 'create'>('list')
  const [mappings, setMappings] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { lang, dir } = useLanguage()
  const router = useRouter()

  // Filter state
  const [platformFilter, setPlatformFilter] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [directionFilter, setDirectionFilter] = useState<string[]>([])
  const [operationFilter, setOperationFilter] = useState<string[]>([])

  // Compact dropdown open state (same plumbing as /app/logs)
  const [isPlatformOpen, setIsPlatformOpen] = useState(false)
  const [isDirectionOpen, setIsDirectionOpen] = useState(false)
  const [isOperationOpen, setIsOperationOpen] = useState(false)
  const platformRef = useRef<HTMLDivElement>(null)
  const directionRef = useRef<HTMLDivElement>(null)
  const operationRef = useRef<HTMLDivElement>(null)

  // Pagination
  const PAGE_SIZE = 20
  const [page, setPage] = useState(1)

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

  // Close the compact filter panels on an outside click (same as /app/logs).
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (platformRef.current && !platformRef.current.contains(event.target as Node)) setIsPlatformOpen(false)
      if (directionRef.current && !directionRef.current.contains(event.target as Node)) setIsDirectionOpen(false)
      if (operationRef.current && !operationRef.current.contains(event.target as Node)) setIsOperationOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Any filter change sends the user back to the first page.
  useEffect(() => {
    setPage(1)
  }, [searchQuery, platformFilter, directionFilter, operationFilter])

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
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-none mb-2"
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

  // Compact-list helpers — labels resolved from the option arrays above so the
  // table, the filter triggers and the pills can never disagree.
  const platformLabel = (p: string) =>
    p === 'shopify' ? (lang === 'ar' ? 'شوبيفاي' : 'Shopify')
      : p === 'salla' ? (lang === 'ar' ? 'سلة' : 'Salla')
      : (lang === 'ar' ? 'زد' : 'Zid')

  const operationLabel = (v: string) => operationOptions.find(o => o.value === v)?.label ?? v
  const directionLabel = (v: string) => directionOptions.find(o => o.value === v)?.label ?? v

  const togglePlatform = (value: string) =>
    setPlatformFilter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]))
  const toggleDirection = (value: string) =>
    setDirectionFilter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]))
  const toggleOperation = (value: string) =>
    setOperationFilter(prev => (prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]))

  const hasActiveFilters =
    searchQuery !== '' ||
    platformFilter.length > 0 ||
    directionFilter.length > 0 ||
    operationFilter.length > 0

  const clearFilters = () => {
    setSearchQuery('')
    setPlatformFilter([])
    setDirectionFilter([])
    setOperationFilter([])
  }

  const pagedMappings = filteredMappings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const PrevIcon = dir === 'rtl' ? ChevronRight : ChevronLeft
  const NextIcon = dir === 'rtl' ? ChevronLeft : ChevronRight
  const OpenIcon = dir === 'rtl' ? ChevronLeft : ChevronRight

  return (
    <div className="max-w-7xl mx-auto space-y-4" dir={dir}>
      <motion.div
        key="mapping-tab"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-4"
      >
      {/* Page title lives in `custom/page.tsx` (MappingCenterHeader); the client
          keeps only its actions so the two never render the same heading twice. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">
          {lang === 'ar'
            ? `عرض ${filteredMappings.length} من ${mappings.length} ربط`
            : `Showing ${filteredMappings.length} of ${mappings.length} mappings`}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="ms-2 font-semibold text-primary transition-colors hover:text-primary/80"
            >
              {lang === 'ar' ? 'مسح الكل' : 'Clear all'}
            </button>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            onClick={() => {
              setLogMappingId(undefined)
              setLogMappingName(undefined)
              setIsLogOpen(true)
            }}
            className="h-8 gap-1.5 rounded-none px-3 text-[10px] font-bold"
          >
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            {lang === 'ar' ? 'سجل المزامنة العام' : 'Global Sync Log'}
          </Button>
          <Button
            onClick={() => setView('create')}
            className="h-8 gap-1.5 rounded-none px-3 text-[10px] font-bold"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'إضافة ربط جديد' : 'Add New Mapping'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center border border-border bg-card py-16">
          <Loader2 className="mb-2 h-5 w-5 animate-spin text-muted-foreground" />
          <p className="text-[11px] font-medium text-muted-foreground">
            {lang === 'ar' ? 'جارٍ تحميل الروابط…' : 'Loading mappings…'}
          </p>
        </div>
      ) : mappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center border border-border bg-card py-16 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-bold text-muted-foreground">
            {lang === 'ar' ? 'لا يوجد تخصيص ربط حالياً' : 'No custom mappings yet'}
          </p>
          <p className="mt-1 mb-4 max-w-md px-6 text-[10px] leading-relaxed text-muted-foreground">
            {lang === 'ar'
              ? `قم بربط وتخصيص كيفية انتقال الحقول بين متجرك ونظام ${getErpFromLabel(erpType)} لإيقاف المزامنة اليدوية وبدء المزامنة التلقائية.`
              : `Map and customize how fields flow between your store and ${getErpFromLabel(erpType)} to automate data synchronization.`}
          </p>
          <Button
            onClick={() => setView('create')}
            className="h-8 gap-1.5 rounded-none px-3 text-[10px] font-bold"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'ابدأ تخصيص الربط الآن' : 'Start custom mapping'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Compact filter bar — mirrors /app/logs so the two pages read as one system. */}
          <div className="border border-border bg-card px-3 py-2.5 flex flex-wrap items-center gap-3">
            <FilterSelect
              label={lang === 'ar' ? 'المتجر' : 'Store'}
              buttonRef={platformRef}
              isOpen={isPlatformOpen}
              onToggle={() => setIsPlatformOpen(!isPlatformOpen)}
              triggerText={
                platformFilter.length === 0
                  ? (lang === 'ar' ? 'كل المتاجر' : 'All stores')
                  : storeOptions.filter(o => platformFilter.includes(o.value)).map(o => o.label).join(', ')
              }
            >
              <CheckRow checked={platformFilter.length === 0} onChange={() => setPlatformFilter([])}>
                {lang === 'ar' ? 'كل المتاجر' : 'All stores'}
              </CheckRow>
              <div className="border-t border-border/50 mx-2 my-1" />
              {storeOptions.map(opt => (
                <CheckRow
                  key={opt.value}
                  checked={platformFilter.includes(opt.value)}
                  onChange={() => togglePlatform(opt.value)}
                >
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    opt.value === 'zid' && 'bg-zid-500',
                    opt.value === 'salla' && 'bg-orange-500',
                    opt.value === 'shopify' && 'bg-emerald-500'
                  )} />
                  <span className="truncate">{opt.label}</span>
                </CheckRow>
              ))}
            </FilterSelect>

            <FilterSelect
              label={lang === 'ar' ? 'الاتجاه' : 'Direction'}
              buttonRef={directionRef}
              isOpen={isDirectionOpen}
              onToggle={() => setIsDirectionOpen(!isDirectionOpen)}
              triggerText={
                directionFilter.length === 0
                  ? (lang === 'ar' ? 'كل الاتجاهات' : 'All directions')
                  : directionOptions.filter(o => directionFilter.includes(o.value)).map(o => o.label).join(', ')
              }
            >
              <CheckRow checked={directionFilter.length === 0} onChange={() => setDirectionFilter([])}>
                {lang === 'ar' ? 'كل الاتجاهات' : 'All directions'}
              </CheckRow>
              <div className="border-t border-border/50 mx-2 my-1" />
              {directionOptions.map(opt => (
                <CheckRow
                  key={opt.value}
                  checked={directionFilter.includes(opt.value)}
                  onChange={() => toggleDirection(opt.value)}
                >
                  {opt.label}
                </CheckRow>
              ))}
            </FilterSelect>

            <FilterSelect
              label={lang === 'ar' ? 'العملية' : 'Operation'}
              buttonRef={operationRef}
              isOpen={isOperationOpen}
              onToggle={() => setIsOperationOpen(!isOperationOpen)}
              triggerText={
                operationFilter.length === 0
                  ? (lang === 'ar' ? 'جميع العمليات' : 'All operations')
                  : operationOptions.filter(o => operationFilter.includes(o.value)).map(o => o.label).join(', ')
              }
              minWidth="min-w-[110px]"
            >
              <CheckRow checked={operationFilter.length === 0} onChange={() => setOperationFilter([])}>
                {lang === 'ar' ? 'جميع العمليات' : 'All operations'}
              </CheckRow>
              <div className="border-t border-border/50 mx-2 my-1" />
              {operationOptions.map(opt => (
                <CheckRow
                  key={opt.value}
                  checked={operationFilter.includes(opt.value)}
                  onChange={() => toggleOperation(opt.value)}
                >
                  {opt.label}
                </CheckRow>
              ))}
            </FilterSelect>

            <form onSubmit={e => e.preventDefault()} className="flex items-center gap-1.5 w-full sm:w-auto sm:ms-auto">
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={lang === 'ar' ? 'بحث بالاسم أو النموذج…' : 'Search name or model…'}
                className="h-7 w-full sm:w-52 text-xs border-border/70 bg-muted/60"
              />
              {searchQuery && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setSearchQuery('')}
                  className="h-7 w-7 rounded-none text-muted-foreground hover:text-foreground"
                  title={lang === 'ar' ? 'مسح' : 'Clear'}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </form>
          </div>

          {/* Odoo-style list: a header row and clean, clickable records. */}
          <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
            <table className="w-full min-w-[650px] border-collapse text-[11px]">
              <thead>
                <tr className="border-y border-border bg-muted/60 text-[10px] uppercase tracking-wide text-foreground/70">
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{lang === 'ar' ? 'الاسم' : 'Name'}</th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{lang === 'ar' ? 'المتجر' : 'Store'}</th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{lang === 'ar' ? 'النموذج' : 'Model'}</th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{lang === 'ar' ? 'العملية' : 'Operation'}</th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{lang === 'ar' ? 'الاتجاه' : 'Direction'}</th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{lang === 'ar' ? 'الحقول' : 'Fields'}</th>
                  <th className="px-2 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {pagedMappings.map(item => {
                  const platform = getPlatformSource(item.action)
                  const operation = item.odoo_operation || 'create'
                  const directions = (item.sync_direction || 'store_to_erp')
                    .split(',')
                    .map((s: string) => s.trim())
                    .filter(Boolean)
                  return (
                    <tr
                      key={item.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => router.push(`/app/mapping-center/custom/${item.id}`)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          router.push(`/app/mapping-center/custom/${item.id}`)
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                    >
                      <td className="px-2 py-2.5">
                        <div className="font-semibold text-foreground max-w-[240px] truncate" title={item.name || ''}>
                          {item.name || (lang === 'ar' ? 'ربط غير مسمى' : 'Unnamed mapping')}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[240px]" title={item.action || ''}>
                          {item.action || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <span className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            platform === 'shopify' ? 'bg-emerald-500'
                              : platform === 'salla' ? 'bg-orange-500'
                              : 'bg-zid-500'
                          )} />
                          {platformLabel(platform)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap font-mono text-foreground">
                        {item.odoo_model || '—'}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <span className={cn(
                          'inline-flex items-center border px-2 py-0.5 text-[10px] font-bold',
                          operation === 'delete'
                            ? 'border-destructive/20 bg-destructive/10 text-destructive'
                            : operation === 'update'
                              ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        )}>
                          {operationLabel(operation)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {directions.map((d: string) => (
                            <span
                              key={d}
                              className="inline-flex items-center border border-border/60 bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                            >
                              {directionLabel(d)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {countTotalMappedFields(item.mappings)}
                      </td>
                      <td className="px-2 py-2.5 text-end text-muted-foreground">
                        <OpenIcon className="h-3.5 w-3.5 inline-block" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {filteredMappings.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Search className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-xs font-bold text-muted-foreground">
                  {lang === 'ar' ? 'لا توجد روابط تطابق التصفية' : 'No mappings match your filters'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
                  {lang === 'ar'
                    ? 'جرّب تعديل الفلاتر أو أضف ربطاً جديداً من الأعلى.'
                    : 'Try a different filter or create a new mapping above.'}
                </p>
              </div>
            )}
          </div>

          {filteredMappings.length > PAGE_SIZE && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-[10px] text-muted-foreground font-semibold">
                {lang === 'ar'
                  ? `إجمالي الروابط: ${filteredMappings.length}`
                  : `Total mappings: ${filteredMappings.length}`}
              </span>
              <div className="flex items-center gap-2 border border-border bg-card p-1 text-xs font-medium">
                <span className="px-2 text-muted-foreground select-none font-mono">
                  {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, filteredMappings.length)} / {filteredMappings.length}
                </span>
                <div className="flex items-center gap-0.5 border-e border-border pe-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || isLoading}
                    className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                    title={lang === 'ar' ? 'الصفحة السابقة' : 'Previous page'}
                  >
                    <PrevIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * PAGE_SIZE >= filteredMappings.length || isLoading}
                    className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                    title={lang === 'ar' ? 'الصفحة التالية' : 'Next page'}
                  >
                    <NextIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
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
