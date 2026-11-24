'use client'

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Tag,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { getFieldMappings } from '@/app/actions/field-mappings'
import {
  getSyncLogStats,
  getSyncLogs,
  type SyncLogRow,
} from '@/app/actions/sync-logs'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { CheckRow, FilterSelect } from '@/components/ui/filter-select'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  eventEntity,
  getDeletionCountdown,
  SyncStatusBadge,
  SyncTriggerBadge,
} from './log-ui'

const LIMIT = 20
const ALL_STATUSES = ['success', 'manual', 'failed', 'skipped']
const ALL_PLATFORMS = ['zid', 'salla', 'shopify']
const ENTITY_KEYS = ['product', 'order', 'customer', 'category'] as const

/** The search box waits this long after the last keystroke — long enough to
 *  coalesce typing, short enough to feel instant. */
const SEARCH_DEBOUNCE_MS = 300

/**
 * Column visibility is a browser preference, not server state: it is kept in
 * `localStorage` so the list opens exactly as the merchant left it, on this
 * device, without a write per toggle.
 */
const COLUMNS_STORAGE_KEY = 'erplink.logs.columns.v1'

type ColumnKey =
  | 'status'
  | 'event'
  | 'entity'
  | 'model'
  | 'trigger'
  | 'entityItemId'
  | 'odooRecordId'
  | 'mapping'
  | 'storeId'
  | 'logId'
  | 'time'
  | 'autoDelete'

interface ColumnDef {
  key: ColumnKey
  label: string
  /** Shown before the merchant opens the columns menu for the first time. */
  defaultVisible: boolean
}

interface MappingOption {
  id: string
  name: string
}

export default function LogsClient() {
  const { t, lang, dir } = useLanguage()
  const router = useRouter()
  const ar = lang === 'ar'

  const [logs, setLogs] = useState<SyncLogRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const [stats, setStats] = useState({ total: 0, success: 0, failed: 0, manual: 0, skipped: 0 })

  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([...ALL_STATUSES])
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([...ALL_PLATFORMS])
  const [entity, setEntity] = useState<string>('all')
  const [mappingsList, setMappingsList] = useState<MappingOption[]>([])
  const [selectedMappingIds, setSelectedMappingIds] = useState<string[]>([])
  const [mappingsLoaded, setMappingsLoaded] = useState(false)

  /** What the merchant is typing right now… */
  const [searchInput, setSearchInput] = useState('')
  /** …and what the last request actually used (debounced). */
  const [appliedSearch, setAppliedSearch] = useState('')

  const [isPlatformOpen, setIsPlatformOpen] = useState(false)
  const [isMappingOpen, setIsMappingOpen] = useState(false)
  const [isEntityOpen, setIsEntityOpen] = useState(false)
  const platformRef = useRef<HTMLDivElement>(null)
  const mappingRef = useRef<HTMLDivElement>(null)
  const entityRef = useRef<HTMLDivElement>(null)

  const columnsButtonRef = useRef<HTMLButtonElement>(null)
  const columnsMenuRef = useRef<HTMLDivElement>(null)
  const [isColumnsOpen, setIsColumnsOpen] = useState(false)
  const [columnsPos, setColumnsPos] = useState<{ top: number; left: number } | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>([])
  const [columnsLoaded, setColumnsLoaded] = useState(false)

  const entityLabels: Record<string, string> = {
    product: t('log.entityProduct'),
    order: t('log.entityOrder'),
    customer: t('log.entityCustomer'),
    category: t('log.entityCategory'),
    other: ar ? 'أخرى' : 'Other',
  }

  const platformLabel = (p: string) => {
    if (p === 'zid') return ar ? 'زد (Zid)' : 'Zid'
    if (p === 'salla') return ar ? 'سلة (Salla)' : 'Salla'
    if (p === 'shopify') return ar ? 'شوبيفاي (Shopify)' : 'Shopify'
    return p
  }

  /**
   * Every field the record page (`/app/logs/<id>`) shows can be shown here as a
   * column. `error_message` is deliberately absent: the lean list select omits
   * it because it can hold a multi-KB stack trace — see `getSyncLogs`.
   */
  const COLUMNS: ColumnDef[] = [
    { key: 'status', label: t('log.status'), defaultVisible: true },
    { key: 'event', label: ar ? 'الحدث' : 'Event', defaultVisible: true },
    { key: 'entity', label: t('log.entity'), defaultVisible: true },
    { key: 'model', label: t('log.model'), defaultVisible: true },
    { key: 'trigger', label: t('log.triggerType'), defaultVisible: true },
    { key: 'entityItemId', label: t('log.entityItemId'), defaultVisible: false },
    { key: 'odooRecordId', label: t('log.recordId'), defaultVisible: false },
    { key: 'mapping', label: t('log.mapping'), defaultVisible: false },
    { key: 'storeId', label: t('log.storeId'), defaultVisible: false },
    { key: 'logId', label: t('log.logNumber'), defaultVisible: false },
    { key: 'time', label: t('log.time'), defaultVisible: true },
    { key: 'autoDelete', label: t('log.autoDelete'), defaultVisible: false },
  ]
  const DEFAULT_VISIBLE = COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)
  const activeColumns = COLUMNS.filter((c) => visibleColumns.includes(c.key))

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (platformRef.current && !platformRef.current.contains(event.target as Node)) setIsPlatformOpen(false)
      if (mappingRef.current && !mappingRef.current.contains(event.target as Node)) setIsMappingOpen(false)
      if (entityRef.current && !entityRef.current.contains(event.target as Node)) setIsEntityOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // ── Column preference: read once on mount, then persist on every change ──
  useEffect(() => {
    let next: ColumnKey[] = DEFAULT_VISIBLE
    try {
      const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const known = COLUMNS.map((c) => c.key as string)
          const picked = parsed.filter(
            (k): k is ColumnKey => typeof k === 'string' && known.includes(k)
          )
          // An empty/invalid stored value must not hide the whole table.
          if (picked.length > 0) next = picked
        }
      }
    } catch {
      // A blocked/absent localStorage is not a failure — defaults still work.
    }
    setVisibleColumns(next)
    setColumnsLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!columnsLoaded) return
    // Never persist an empty table (happens mid-toggle if a write races a read).
    if (visibleColumns.length === 0) return
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns))
    } catch {
      // Storage full/blocked: the columns still work for this visit.
    }
  }, [visibleColumns, columnsLoaded])

  /** Fixed positioning keeps the menu out of the table's scroll clipping. */
  const openColumnsMenu = () => {
    const el = columnsButtonRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = 230
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8)
    )
    setColumnsPos({ top: rect.bottom + 4, left })
    setIsColumnsOpen(true)
  }

  // The menu is anchored to a button that scrolls with the page, so any page scroll
  // (or a resize) closes it rather than letting it float away from its anchor.
  // Scrolls originating INSIDE the menu itself are ignored so the merchant can scroll the list.
  useEffect(() => {
    if (!isColumnsOpen) return
    const handleScroll = (event: Event) => {
      if (columnsMenuRef.current && columnsMenuRef.current.contains(event.target as Node)) {
        return
      }
      setIsColumnsOpen(false)
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [isColumnsOpen])

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      if (prev.includes(key)) {
        // Keep at least one column: an empty table looks like a broken page.
        if (prev.length === 1) return prev
        return prev.filter((k) => k !== key)
      }
      return COLUMNS.filter((c) => c.key === key || prev.includes(c.key)).map((c) => c.key)
    })
  }

  const resetColumns = () => setVisibleColumns(DEFAULT_VISIBLE)

  const loadStats = async () => {
    const res = await getSyncLogStats()
    if (res.success && res.stats) setStats(res.stats)
  }

  const loadMappings = async () => {
    const res = await getFieldMappings()
    if (res.success) {
      const list: MappingOption[] = (res.mappings || []).map((m: any) => ({ id: m.id, name: m.name }))
      setMappingsList(list)
      setSelectedMappingIds(list.map(m => m.id))
    }
    setMappingsLoaded(true)
  }

  const buildParams = (offsetToUse: number) => {
    const statusParam = selectedStatuses.length === ALL_STATUSES.length ? 'all' : selectedStatuses.join(',')
    const platformParam = selectedPlatforms.length === ALL_PLATFORMS.length
      ? 'all'
      : selectedPlatforms.length === 0
        ? 'none'
        : selectedPlatforms.join(',')
    const mappingParam = mappingsList.length === 0
      ? 'all'
      : selectedMappingIds.length === 0
        ? 'none'
        : selectedMappingIds.length === mappingsList.length
          ? 'all'
          : selectedMappingIds.join(',')
    return {
      status: statusParam,
      platform: platformParam,
      mappingId: mappingParam,
      entity,
      search: appliedSearch,
      limit: LIMIT,
      offset: offsetToUse,
      lean: true,
    }
  }

  const fetchAt = async (offsetToUse: number) => {
    setIsLoading(true)
    setNotice('')
    try {
      const res = await getSyncLogs(buildParams(offsetToUse))
      if (res.success) {
        setLogs(res.logs || [])
        setOffset(offsetToUse)
        setTotalCount(res.totalCount || 0)
      } else {
        setNotice(res.error || (ar ? 'تعذر تحميل السجلات' : 'Failed to load logs'))
      }
    } catch (err: any) {
      setNotice(err?.message || (ar ? 'تعذر تحميل السجلات' : 'Failed to load logs'))
    } finally {
      setIsLoading(false)
    }
  }

  const filtersKey = [
    [...selectedStatuses].sort().join(','),
    [...selectedPlatforms].sort().join(','),
    [...selectedMappingIds].sort().join(','),
    entity,
    appliedSearch,
  ].join('|')

  useEffect(() => {
    loadStats()
    loadMappings()
  }, [])

  useEffect(() => {
    if (!mappingsLoaded) return
    fetchAt(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, mappingsLoaded])

  // Instant search: the value is applied as the merchant types, debounced.
  useEffect(() => {
    const next = searchInput.trim()
    if (next === appliedSearch) return
    const timer = setTimeout(() => setAppliedSearch(next), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput, appliedSearch])

  const togglePlatform = (plat: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(plat) ? prev.filter(p => p !== plat) : [...prev, plat]
    )
  }

  const toggleMapping = (mId: string) => {
    setSelectedMappingIds(prev =>
      prev.includes(mId) ? prev.filter(id => id !== mId) : [...prev, mId]
    )
  }

  const applyStatusPreset = (statuses: string[]) => {
    setSelectedStatuses(statuses)
  }

  const openLog = (id: string) => {
    router.push(`/app/logs/${id}`)
  }

  const isFirstPage = offset === 0
  const isLastPage = offset + logs.length >= totalCount
  const PrevIcon = dir === 'rtl' ? ChevronRight : ChevronLeft
  const NextIcon = dir === 'rtl' ? ChevronLeft : ChevronRight
  const OpenIcon = dir === 'rtl' ? ChevronLeft : ChevronRight

  const statCards = [
    { key: 'total', label: ar ? 'الإجمالي' : 'Total', value: stats.total, statuses: [...ALL_STATUSES] },
    { key: 'success', label: t('log.success'), value: stats.success, statuses: ['success'], dot: 'bg-success' },
    { key: 'failed', label: t('log.failed'), value: stats.failed, statuses: ['failed'], dot: 'bg-destructive' },
    { key: 'manual', label: ar ? 'حل يدوي' : 'Manual', value: stats.manual, statuses: ['manual'], dot: 'bg-amber-500' },
    { key: 'skipped', label: t('log.skipped'), value: stats.skipped, statuses: ['skipped'], dot: 'bg-muted-foreground' },
  ]

  const formatDate = (value: string | null) => {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString(ar ? 'ar-EG' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  /** One cell per visible column — the header and the row use the same order. */
  const renderCell = (key: ColumnKey, log: SyncLogRow) => {
    switch (key) {
      case 'status':
        return <SyncStatusBadge status={log.status} resolvedManually={log.resolved_manually} />
      case 'event':
        return (
          <div
            className="font-mono font-semibold text-foreground max-w-[220px] truncate"
            title={log.field_mappings?.name ? `${log.event} · ${log.field_mappings.name}` : (log.event || '')}
          >
            {log.event || '—'}
          </div>
        )
      case 'entity':
        return <span className="text-muted-foreground">{entityLabels[eventEntity(log.event)] || '—'}</span>
      case 'model':
        return <span className="font-mono text-foreground">{log.odoo_model || '—'}</span>
      case 'trigger':
        return <SyncTriggerBadge triggerType={log.trigger_type} />
      case 'entityItemId':
        return (
          <div className="max-w-[200px] truncate font-mono text-muted-foreground" dir="ltr" title={log.zid_entity_id || ''}>
            {log.zid_entity_id || '—'}
          </div>
        )
      case 'odooRecordId':
        return (
          <span className="font-mono text-muted-foreground">
            {log.odoo_record_id != null && log.odoo_record_id !== '' ? `#${log.odoo_record_id}` : '—'}
          </span>
        )
      case 'mapping':
        return (
          <div className="max-w-[180px] truncate text-muted-foreground" title={log.field_mappings?.name || ''}>
            {log.field_mappings?.name || '—'}
          </div>
        )
      case 'storeId':
        return (
          <div className="max-w-[160px] truncate font-mono text-muted-foreground" dir="ltr" title={log.store_id || ''}>
            {log.store_id || '—'}
          </div>
        )
      case 'logId':
        return (
          <div className="max-w-[140px] truncate font-mono text-muted-foreground" dir="ltr" title={log.id}>
            {log.id}
          </div>
        )
      case 'time':
        return <span className="text-muted-foreground">{formatDate(log.created_at)}</span>
      case 'autoDelete':
        return (
          <span className="text-[10px] text-muted-foreground">
            {getDeletionCountdown(log.created_at, log.status, ar) || '—'}
          </span>
        )
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-foreground">{t('log.title')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{t('log.subtitle')}</p>
      </div>

      {notice && (
        <div className="border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {notice}
        </div>
      )}

      {/* Status chips (= the status filter) + instant search + refresh, one row. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {statCards.map(c => {
          const isActive = c.key === 'total'
            ? selectedStatuses.length === ALL_STATUSES.length
            : selectedStatuses.length === 1 && selectedStatuses[0] === c.key
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => applyStatusPreset(c.statuses)}
              className={cn(
                'inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] transition-colors',
                isActive
                  ? 'border-foreground/30 bg-muted/60 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/40'
              )}
            >
              {c.dot && <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />}
              <span className="font-medium">{c.label}</span>
              <span className="font-bold tabular-nums text-foreground">{c.value}</span>
            </button>
          )
        })}

        <div className="ms-auto flex flex-wrap items-center gap-1.5 w-full sm:w-auto mt-1 sm:mt-0">
          <div className="relative flex-1 sm:flex-initial sm:w-56">
            <Search className="pointer-events-none absolute inset-y-0 start-2 my-auto h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('log.searchPlaceholder')}
              aria-label={t('log.search')}
              className="h-7 w-full sm:w-56 border-border/70 bg-muted/60 ps-7 pe-7 text-xs"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                title={ar ? 'مسح البحث' : 'Clear search'}
                aria-label={ar ? 'مسح البحث' : 'Clear search'}
                className="absolute inset-y-0 end-0 my-auto flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              loadStats()
              fetchAt(offset)
            }}
            disabled={isLoading}
            className="h-7 shrink-0 rounded-none px-3 text-[10px] font-bold"
          >
            {/* No spin: the table greys out while loading, the icon stays still. */}
            <RefreshCw className="h-3 w-3 me-1" />
            {t('log.refresh')}
          </Button>
        </div>
      </div>

      {/* Remaining filters (status lives in the chips above, so it is not here). */}
      <div className="border border-border bg-card px-3 py-2.5 flex flex-wrap items-center gap-3">
        <FilterSelect
          label={t('log.filterByPlatform')}
          buttonRef={platformRef}
          isOpen={isPlatformOpen}
          onToggle={() => setIsPlatformOpen(!isPlatformOpen)}
          triggerText={
            selectedPlatforms.length === ALL_PLATFORMS.length
              ? (ar ? 'الكل' : 'All')
              : selectedPlatforms.length === 0
                ? (ar ? 'لا شيء' : 'None')
                : selectedPlatforms.map(platformLabel).join(', ')
          }
        >
          <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-xs font-bold cursor-pointer text-muted-foreground select-none transition-colors">
            <input
              type="checkbox"
              checked={selectedPlatforms.length === ALL_PLATFORMS.length}
              onChange={() => setSelectedPlatforms(
                selectedPlatforms.length === ALL_PLATFORMS.length ? [] : [...ALL_PLATFORMS]
              )}
              className="rounded border-border/70 text-primary focus:ring-primary/30 h-3.5 w-3.5"
            />
            <span>{ar ? 'الكل' : 'All'}</span>
          </label>
          <div className="border-t border-border/50 mx-2 my-1" />
          {ALL_PLATFORMS.map(p => (
            <CheckRow key={p} checked={selectedPlatforms.includes(p)} onChange={() => togglePlatform(p)}>
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                p === 'zid' && 'bg-zid-500',
                p === 'salla' && 'bg-orange-500',
                p === 'shopify' && 'bg-emerald-500'
              )} />
              {platformLabel(p)}
            </CheckRow>
          ))}
        </FilterSelect>

        <FilterSelect
          label={ar ? 'الربط:' : 'Mapping:'}
          icon={<Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          buttonRef={mappingRef}
          isOpen={isMappingOpen}
          onToggle={() => setIsMappingOpen(!isMappingOpen)}
          triggerText={
            mappingsList.length === 0
              ? (ar ? 'لا توجد عمليات ربط' : 'No mappings')
              : selectedMappingIds.length === mappingsList.length
                ? (ar ? 'جميع عمليات الربط' : 'All Mappings')
                : selectedMappingIds.length === 0
                  ? (ar ? 'لا شيء' : 'None')
                  : selectedMappingIds.map(id => mappingsList.find(m => m.id === id)?.name || id).join(', ')
          }
          minWidth="min-w-[140px]"
        >
          {mappingsList.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              {ar ? 'لم يتم إنشاء أي عمليات ربط بعد.' : 'No field mappings created yet.'}
            </p>
          )}
          {mappingsList.length > 0 && (
            <>
              <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-xs font-bold cursor-pointer text-muted-foreground select-none transition-colors">
                <input
                  type="checkbox"
                  checked={selectedMappingIds.length === mappingsList.length}
                  onChange={() => setSelectedMappingIds(
                    selectedMappingIds.length === mappingsList.length
                      ? []
                      : mappingsList.map(m => m.id)
                  )}
                  className="rounded border-border/70 text-primary focus:ring-primary/30 h-3.5 w-3.5"
                />
                <span>{ar ? 'جميع عمليات الربط' : 'All Mappings'}</span>
              </label>
              <div className="border-t border-border/50 mx-2 my-1" />
              {mappingsList.map(m => (
                <CheckRow key={m.id} checked={selectedMappingIds.includes(m.id)} onChange={() => toggleMapping(m.id)}>
                  <span className="truncate font-medium" title={m.name}>{m.name}</span>
                </CheckRow>
              ))}
            </>
          )}
        </FilterSelect>

        <FilterSelect
          label={t('log.entity')}
          buttonRef={entityRef}
          isOpen={isEntityOpen}
          onToggle={() => setIsEntityOpen(!isEntityOpen)}
          triggerText={entity === 'all' ? t('log.all') : entityLabels[entity] || entity}
          minWidth="min-w-[110px]"
        >
          {[{ key: 'all', label: t('log.all') }, ...ENTITY_KEYS.map(k => ({ key: k, label: entityLabels[k] }))].map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => {
                setEntity(opt.key)
                setIsEntityOpen(false)
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-3 py-2 text-xs transition-colors',
                entity === opt.key
                  ? 'bg-muted/60 font-bold text-foreground'
                  : 'font-medium text-muted-foreground hover:bg-muted'
              )}
            >
              <span className="truncate">{opt.label}</span>
              {entity === opt.key && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          ))}
        </FilterSelect>
      </div>

      {/* Odoo-style list: a header row and clean records, no cell borders. */}
      <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
        <table className="w-full min-w-[640px] border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-border bg-muted/60 text-[10px] uppercase tracking-wide text-foreground/70">
              {activeColumns.map(col => (
                <th key={col.key} className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                  {col.label}
                </th>
              ))}
              <th className="px-2 py-2.5 w-10 text-end">
                <button
                  ref={columnsButtonRef}
                  type="button"
                  onClick={() => (isColumnsOpen ? setIsColumnsOpen(false) : openColumnsMenu())}
                  title={t('log.columns')}
                  aria-label={t('log.columns')}
                  aria-expanded={isColumnsOpen}
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center transition-colors',
                    isColumnsOpen
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && logs.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {Array.from({ length: activeColumns.length + 1 }).map((__, j) => (
                      <td key={j} className="px-2 py-3">
                        <div className="h-3 bg-muted/60 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : logs.map(log => {
                  return (
                    <tr
                      key={log.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openLog(log.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openLog(log.id)
                        }
                      }}
                      className="cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                    >
                      {activeColumns.map(col => (
                        <td
                          key={col.key}
                          className={cn(
                            'px-2 py-2.5',
                            (col.key === 'event' || col.key === 'mapping') ? '' : 'whitespace-nowrap'
                          )}
                        >
                          {renderCell(col.key, log)}
                        </td>
                      ))}
                      <td className="px-2 py-2.5 text-end text-muted-foreground">
                        <OpenIcon className="h-3.5 w-3.5 inline-block" />
                      </td>
                    </tr>
                  )
                })}
          </tbody>
        </table>

        {!isLoading && logs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs font-bold text-muted-foreground">
              {appliedSearch
                ? (ar ? `لا نتائج لـ «${appliedSearch}»` : `No results for "${appliedSearch}"`)
                : t('log.noLogs')}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
              {appliedSearch
                ? (ar
                    ? 'جرّب كلمة أقصر، أو امسح البحث لعرض كل السجلات.'
                    : 'Try a shorter term, or clear the search to see every log.')
                : ar
                  ? 'لم يتم تسجيل أي عمليات مزامنة مطابقة للشروط المحددة حتى الآن.'
                  : 'No sync operations match the selected filters.'}
            </p>
          </div>
        )}

        {isLoading && logs.length > 0 && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Column menu — fixed, so the table's horizontal scroll cannot clip it. */}
      {isColumnsOpen && columnsPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsColumnsOpen(false)} />
          <div
            ref={columnsMenuRef}
            className="fixed z-50 w-[230px] border border-border bg-card shadow-lg"
            style={{ top: columnsPos.top, left: columnsPos.left }}
            role="dialog"
            aria-label={t('log.columns')}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">
                {t('log.columns')}
              </span>
              <button
                type="button"
                onClick={resetColumns}
                className="text-[10px] font-bold text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('log.columnsReset')}
              </button>
            </div>
            <ul className="max-h-72 overflow-y-auto py-1">
              {COLUMNS.map(col => {
                const isOn = visibleColumns.includes(col.key)
                // The last visible column cannot be switched off.
                const isLastOne = isOn && visibleColumns.length === 1
                return (
                  <li key={col.key}>
                    <label
                      className={cn(
                        'flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors',
                        isLastOne
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer hover:bg-muted/60'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isOn}
                        disabled={isLastOne}
                        onChange={() => toggleColumn(col.key)}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-border/70 accent-foreground disabled:cursor-not-allowed"
                      />
                      <span className="font-medium text-foreground">{col.label}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="border-t border-border px-3 py-2 text-[10px] leading-relaxed text-muted-foreground">
              {t('log.columnsHint')}
            </p>
          </div>
        </>
      )}

      {totalCount > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-[10px] text-muted-foreground font-semibold">
            {ar ? `إجمالي السجلات: ${totalCount}` : `Total logs: ${totalCount}`}
          </span>
          <div className="flex items-center gap-2 border border-border bg-card p-1 text-xs font-medium">
            <span className="px-2 text-muted-foreground select-none font-mono">
              {offset + 1}-{Math.min(offset + logs.length, totalCount)} / {totalCount}
            </span>
            <div className="flex items-center gap-0.5 border-e border-border pe-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchAt(Math.max(0, offset - LIMIT))}
                disabled={isFirstPage || isLoading}
                className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                title={ar ? 'الصفحة السابقة' : 'Previous page'}
              >
                <PrevIcon className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchAt(offset + LIMIT)}
                disabled={isLastPage || isLoading}
                className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                title={ar ? 'الصفحة التالية' : 'Next page'}
              >
                <NextIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
