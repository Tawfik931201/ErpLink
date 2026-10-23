'use client'

import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'

import { getFieldMappings } from '@/app/actions/field-mappings'
import {
  getSyncLogStats,
  getSyncLogs,
  type SyncLogRow,
} from '@/app/actions/sync-logs'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import {
  eventEntity,
  SyncStatusBadge,
  SyncTriggerBadge,
} from './log-ui'

const LIMIT = 20
const ALL_STATUSES = ['success', 'manual', 'failed', 'skipped']
const ALL_PLATFORMS = ['zid', 'salla', 'shopify']
const ENTITY_KEYS = ['product', 'order', 'customer', 'category'] as const

interface MappingOption {
  id: string
  name: string
}

function CheckRow({
  checked,
  onChange,
  danger = false,
  children,
}: {
  checked: boolean
  onChange: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-xs font-medium cursor-pointer text-muted-foreground select-none transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={cn(
          'rounded border-border/70 h-3.5 w-3.5',
          danger ? 'text-destructive focus:ring-destructive/30' : 'text-primary focus:ring-primary/30'
        )}
      />
      <span className="flex items-center gap-1.5 truncate">{children}</span>
    </label>
  )
}

function FilterSelect({
  label,
  icon,
  buttonRef,
  isOpen,
  onToggle,
  triggerText,
  minWidth = 'min-w-[120px]',
  children,
}: {
  label: string
  icon?: React.ReactNode
  buttonRef: React.RefObject<HTMLDivElement | null>
  isOpen: boolean
  onToggle: () => void
  triggerText: string
  minWidth?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 relative select-none" ref={buttonRef}>
      {icon}
      <span className="text-[11px] font-bold text-muted-foreground me-1 shrink-0">{label}</span>
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'text-xs bg-muted/60 hover:bg-muted border border-border/70 px-3 py-1.5',
            'focus:outline-none focus:ring-1 focus:ring-primary/30 font-semibold flex items-center gap-2',
            'select-none justify-between text-start transition-colors',
            minWidth
          )}
        >
          <span className="truncate max-w-[150px]">{triggerText}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
        {isOpen && (
          <div className="absolute z-50 mt-1.5 w-56 bg-card border border-border/70 py-1.5 shadow-card animate-in fade-in scale-in duration-150 max-h-60 overflow-y-auto">
            {children}
          </div>
        )}
      </div>
    </div>
  )
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
  const [entityIdInput, setEntityIdInput] = useState('')
  const [appliedEntityId, setAppliedEntityId] = useState('')

  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [isPlatformOpen, setIsPlatformOpen] = useState(false)
  const [isMappingOpen, setIsMappingOpen] = useState(false)
  const [isEntityOpen, setIsEntityOpen] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const platformRef = useRef<HTMLDivElement>(null)
  const mappingRef = useRef<HTMLDivElement>(null)
  const entityRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(event.target as Node)) setIsStatusOpen(false)
      if (platformRef.current && !platformRef.current.contains(event.target as Node)) setIsPlatformOpen(false)
      if (mappingRef.current && !mappingRef.current.contains(event.target as Node)) setIsMappingOpen(false)
      if (entityRef.current && !entityRef.current.contains(event.target as Node)) setIsEntityOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
      entityId: appliedEntityId,
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
    appliedEntityId,
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

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    )
  }

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

  const applyEntityIdSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setAppliedEntityId(entityIdInput.trim())
  }

  const clearEntityIdSearch = () => {
    setEntityIdInput('')
    setAppliedEntityId('')
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">{t('log.title')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('log.subtitle')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => fetchAt(offset)} disabled={isLoading}>
          <RefreshCw className={cn('h-3.5 w-3.5 me-1', isLoading && 'animate-spin')} />
          {t('log.refresh')}
        </Button>
      </div>

      {notice && (
        <div className="border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {notice}
        </div>
      )}

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
      </div>

      <div className="border border-border bg-card px-3 py-2.5 flex flex-wrap items-center gap-3">
        <FilterSelect
          label={t('log.status')}
          buttonRef={statusRef}
          isOpen={isStatusOpen}
          onToggle={() => setIsStatusOpen(!isStatusOpen)}
          triggerText={
            selectedStatuses.length === ALL_STATUSES.length
              ? t('log.all')
              : selectedStatuses.length === 0
                ? (ar ? 'لا شيء' : 'None')
                : selectedStatuses.map(s => {
                    if (s === 'success') return t('log.success')
                    if (s === 'manual') return (ar ? 'حل يدوي' : 'Manual')
                    if (s === 'failed') return t('log.failed')
                    if (s === 'skipped') return t('log.skipped')
                    return s
                  }).join(', ')
          }
        >
          <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-xs font-bold cursor-pointer text-muted-foreground select-none transition-colors">
            <input
              type="checkbox"
              checked={selectedStatuses.length === ALL_STATUSES.length}
              onChange={() => setSelectedStatuses(
                selectedStatuses.length === ALL_STATUSES.length ? [] : [...ALL_STATUSES]
              )}
              className="rounded border-border/70 text-primary focus:ring-primary/30 h-3.5 w-3.5"
            />
            <span>{t('log.all')}</span>
          </label>
          <div className="border-t border-border/50 mx-2 my-1" />
          <CheckRow checked={selectedStatuses.includes('success')} onChange={() => toggleStatus('success')}>
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {t('log.success')}
          </CheckRow>
          <CheckRow checked={selectedStatuses.includes('manual')} onChange={() => toggleStatus('manual')}>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {ar ? 'حل يدوي' : 'Manual Resolve'}
          </CheckRow>
          <CheckRow checked={selectedStatuses.includes('failed')} onChange={() => toggleStatus('failed')} danger>
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            {t('log.failed')}
          </CheckRow>
          <CheckRow checked={selectedStatuses.includes('skipped')} onChange={() => toggleStatus('skipped')}>
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            {t('log.skipped')}
          </CheckRow>
        </FilterSelect>

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

        <form onSubmit={applyEntityIdSearch} className="flex items-center gap-1.5 ms-auto">
          <Input
            value={entityIdInput}
            onChange={e => setEntityIdInput(e.target.value)}
            placeholder={t('log.searchEntityId')}
            className="h-7 w-44 text-xs border-border/70 bg-muted/60"
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-none text-muted-foreground hover:text-foreground"
            title={t('log.search')}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          {appliedEntityId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearEntityIdSearch}
              className="h-7 text-[10px] px-2 text-muted-foreground hover:text-foreground"
            >
              ✕
            </Button>
          )}
        </form>

      </div>

      {/* Odoo-style list: a header row and clean records, no cell borders. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-border bg-muted/60 text-[10px] uppercase tracking-wide text-foreground/70">
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{t('log.status')}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{ar ? 'الحدث' : 'Event'}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{t('log.entity')}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{t('log.model')}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{t('log.triggerType')}</th>
              <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">{t('log.time')}</th>
              <th className="px-2 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {isLoading && logs.length === 0
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <td key={j} className="px-2 py-3">
                        <div className="h-3 bg-muted/60 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              : logs.map(log => {
                  const logEntity = eventEntity(log.event)
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
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <SyncStatusBadge status={log.status} resolvedManually={log.resolved_manually} />
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <div
                          className="font-mono font-semibold text-foreground max-w-[220px] truncate"
                          title={log.field_mappings?.name ? `${log.event} · ${log.field_mappings.name}` : (log.event || '')}
                        >
                          {log.event || '—'}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        {entityLabels[logEntity] || '—'}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap font-mono text-foreground">
                        {log.odoo_model || '—'}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <SyncTriggerBadge triggerType={log.trigger_type} />
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatDate(log.created_at)}
                      </td>
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
            <p className="text-xs font-bold text-muted-foreground">{t('log.noLogs')}</p>
            <p className="text-[10px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
              {ar
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
