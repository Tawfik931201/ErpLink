'use client'

import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Eye,
  EyeOff,
  HelpCircle,
  Loader2,
  RefreshCw,
  Search,
  Tag,
} from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import { getFieldMappings } from '@/app/actions/field-mappings'
import {
  getSyncLogById,
  getSyncLogStats,
  getSyncLogs,
  resolveLogManually,
  retrySyncLog,
  type SyncLogRow,
} from '@/app/actions/sync-logs'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

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
            'text-xs bg-muted/60 hover:bg-muted border border-border/70 rounded-xl px-3 py-1.5',
            'focus:outline-none focus:ring-1 focus:ring-primary/30 font-semibold flex items-center gap-2',
            'select-none justify-between text-start transition-colors',
            minWidth
          )}
        >
          <span className="truncate max-w-[150px]">{triggerText}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
        {isOpen && (
          <div className="absolute z-50 mt-1.5 w-56 bg-card border border-border/70 rounded-xl py-1.5 shadow-card animate-in fade-in scale-in duration-150 max-h-60 overflow-y-auto">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

export default function LogsClient() {
  const { t, lang, dir } = useLanguage()
  const { toast } = useToast()
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

  const [isRetryingId, setIsRetryingId] = useState<string | null>(null)
  const [isResolvingId, setIsResolvingId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [payloadLoadingId, setPayloadLoadingId] = useState<string | null>(null)
  const payloadCache = useRef<Map<string, unknown>>(new Map())

  const [isStatusOpen, setIsStatusOpen] = useState(false)
  const [isPlatformOpen, setIsPlatformOpen] = useState(false)
  const [isMappingOpen, setIsMappingOpen] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const platformRef = useRef<HTMLDivElement>(null)
  const mappingRef = useRef<HTMLDivElement>(null)

  const entityLabels: Record<string, string> = {
    product: t('log.entityProduct'),
    order: t('log.entityOrder'),
    customer: t('log.entityCustomer'),
    category: t('log.entityCategory'),
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
    payloadCache.current.clear()
    setExpandedIds(new Set())
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

  const getDeletionCountdown = (createdAtStr: string, status: string) => {
    if (!createdAtStr) return ''
    const createdAt = new Date(createdAtStr).getTime()
    const duration = status === 'success' ? 72 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    const remainingMs = createdAt + duration - Date.now()
    if (remainingMs <= 0) return ar ? 'جاري الحذف...' : 'Deleting soon...'
    const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000))
    if (remainingHours >= 24) {
      const days = Math.floor(remainingHours / 24)
      const hours = remainingHours % 24
      return ar ? `الحذف بعد: ${days} يوم و ${hours} ساعة` : `Deletes in: ${days}d ${hours}h`
    }
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000))
    return ar
      ? `الحذف بعد: ${remainingHours} ساعة و ${minutes} دقيقة`
      : `Deletes in: ${remainingHours}h ${minutes}m`
  }

  const handleResend = async (logId: string) => {
    setIsRetryingId(logId)
    try {
      const res = await retrySyncLog(logId)
      if (res.success) {
        toast({
          title: ar ? 'إعادة الإرسال' : 'Sync Resend',
          description: ar ? 'تمت إعادة الإرسال بنجاح والمزامنة قيد التشغيل!' : 'Retry sync started successfully!',
        })
        await Promise.all([fetchAt(offset), loadStats()])
      } else {
        toast({
          title: ar ? 'فشلت إعادة الإرسال' : 'Resend Failed',
          description: res.error || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: ar ? 'خطأ' : 'Error',
        description: err?.message || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
        variant: 'destructive',
      })
    } finally {
      setIsRetryingId(null)
    }
  }

  const handleResolveManually = async (logId: string) => {
    setIsResolvingId(logId)
    try {
      const res = await resolveLogManually(logId)
      if (res.success) {
        toast({
          title: ar ? 'تم الحل يدويًا' : 'Resolved Manually',
          description: ar ? 'تم تعيين السجل كـ "محلول يدوياً في أودو" بنجاح!' : 'Log marked as resolved manually in Odoo!',
        })
        await Promise.all([fetchAt(offset), loadStats()])
      } else {
        toast({
          title: ar ? 'فشل الإجراء' : 'Action Failed',
          description: res.error || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: ar ? 'خطأ' : 'Error',
        description: err?.message || (ar ? 'حدث خطأ ما' : 'Something went wrong'),
        variant: 'destructive',
      })
    } finally {
      setIsResolvingId(null)
    }
  }

  const togglePayload = async (log: SyncLogRow) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(log.id)) {
        next.delete(log.id)
      } else {
        next.add(log.id)
      }
      return next
    })
    if (!payloadCache.current.has(log.id)) {
      setPayloadLoadingId(log.id)
      try {
        const res = await getSyncLogById(log.id)
        if (res.success) {
          payloadCache.current.set(log.id, (res.log as any).payload ?? {})
        }
      } catch {
        payloadCache.current.set(log.id, {})
      } finally {
        setPayloadLoadingId(null)
      }
    }
  }

  const getStatusBadge = (status: string | null, errorMessage?: string | null) => {
    if (status === 'success' && errorMessage?.includes('Resolved manually')) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <CheckCircle2 className="h-3 w-3" />
          {t('log.resolvedManually')}
        </span>
      )
    }
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3" />
            {t('log.success')}
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/20">
            <AlertCircle className="h-3 w-3" />
            {t('log.failed')}
          </span>
        )
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground border border-border/60">
            <HelpCircle className="h-3 w-3" />
            {t('log.skipped')}
          </span>
        )
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
            <Loader2 className="h-3 w-3 animate-spin" />
            {ar ? 'جاري المزامنة...' : 'Syncing...'}
          </span>
        )
      default:
        return null
    }
  }

  const getTriggerBadge = (triggerType: string | null) => {
    const isManual = triggerType === 'manual'
    return (
      <span className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border',
        isManual
          ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20'
          : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
      )}>
        {isManual ? t('log.manual') : t('log.automatic')}
      </span>
    )
  }

  const isFirstPage = offset === 0
  const isLastPage = offset + logs.length >= totalCount
  const PrevIcon = dir === 'rtl' ? ChevronRight : ChevronLeft
  const NextIcon = dir === 'rtl' ? ChevronLeft : ChevronRight

  const statCards = [
    { key: 'total', label: ar ? 'الإجمالي' : 'Total', value: stats.total, statuses: [...ALL_STATUSES] },
    { key: 'success', label: t('log.success'), value: stats.success, statuses: ['success'], dot: 'bg-emerald-500' },
    { key: 'failed', label: t('log.failed'), value: stats.failed, statuses: ['failed'], dot: 'bg-destructive' },
    { key: 'manual', label: ar ? 'حل يدوي' : 'Manual', value: stats.manual, statuses: ['manual'], dot: 'bg-amber-500' },
    { key: 'skipped', label: t('log.skipped'), value: stats.skipped, statuses: ['skipped'], dot: 'bg-muted-foreground' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Database className="h-4.5 w-4.5 text-primary" />
            {t('log.title')}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t('log.subtitle')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => fetchAt(offset)} disabled={isLoading}>
          <RefreshCw className={cn('h-3.5 w-3.5 me-1', isLoading && 'animate-spin')} />
          {t('log.refresh')}
        </Button>
      </div>

      {notice && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
                'rounded-lg border p-3 text-start transition-colors',
                isActive ? 'border-foreground/30 bg-muted/50' : 'border-border'
              )}
            >
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                {c.dot && <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />}
                {c.label}
              </p>
              <p className="text-2xl font-bold text-foreground">{c.value}</p>
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border border-border bg-card px-3 py-2.5 flex flex-wrap items-center gap-3">
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
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
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

        <form onSubmit={applyEntityIdSearch} className="flex items-center gap-1.5">
          <Input
            value={entityIdInput}
            onChange={e => setEntityIdInput(e.target.value)}
            placeholder={t('log.searchEntityId')}
            className="h-7 w-44 text-xs rounded-xl border-border/70 bg-muted/60"
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
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

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted-foreground me-1">{t('log.entity')}:</span>
          {[{ key: 'all', label: t('log.all') }, ...ENTITY_KEYS.map(k => ({ key: k, label: entityLabels[k] }))].map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setEntity(opt.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                entity === opt.key
                  ? 'border-foreground/40 bg-muted font-bold text-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {totalCount > 0 && (
          <div className="flex items-center gap-2 border border-border bg-card rounded-xl p-1 text-xs font-medium shadow-sm">
            <span className="px-2 text-muted-foreground select-none font-mono">
              {offset + 1}-{Math.min(offset + logs.length, totalCount)} / {totalCount}
            </span>
            <div className="flex items-center gap-0.5 border-e border-border pe-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchAt(Math.max(0, offset - LIMIT))}
                disabled={isFirstPage || isLoading}
                className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-40"
                title={ar ? 'الصفحة السابقة' : 'Previous page'}
              >
                <PrevIcon className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => fetchAt(offset + LIMIT)}
                disabled={isLastPage || isLoading}
                className="h-7 w-7 rounded-lg hover:bg-muted text-muted-foreground disabled:opacity-40"
                title={ar ? 'الصفحة التالية' : 'Next page'}
              >
                <NextIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-foreground animate-spin mb-2" />
          <p className="text-xs text-muted-foreground font-medium">
            {ar ? 'جاري تحميل السجلات...' : 'Loading logs...'}
          </p>
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
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
      ) : (
        <div className="space-y-4">
          {logs.map(log => {
            const isExpanded = expandedIds.has(log.id)
            const dateFormatted = log.created_at
              ? new Date(log.created_at).toLocaleString(ar ? 'ar-EG' : 'en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '-'
            const isResolvedManually = log.status === 'success' && log.error_message?.includes('Resolved manually')
            const cachedPayload = payloadCache.current.get(log.id)

            return (
              <div
                key={log.id}
                className={cn(
                  'bg-card border border-border/80 rounded-xl p-4 transition-all duration-200 hover:border-border hover:shadow-sm',
                  log.status === 'failed' && 'border-s-[3px] border-s-destructive',
                  log.status === 'success' && (
                    isResolvedManually
                      ? 'border-s-[3px] border-s-amber-500/60'
                      : 'border-s-[3px] border-s-emerald-500/60'
                  ),
                  log.status === 'processing' && 'border-s-[3px] border-s-primary/50'
                )}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {getStatusBadge(log.status, log.error_message)}
                      {getTriggerBadge(log.trigger_type)}
                      <span className="text-xs font-bold font-mono bg-muted/60 px-2.5 py-1 rounded-lg text-foreground border border-border/50">
                        {log.event}
                      </span>
                      {log.field_mappings?.name && (
                        <span
                          className="text-[10px] font-bold text-foreground/70 max-w-[150px] truncate border-s border-border/50 ps-2"
                          title={log.field_mappings.name}
                        >
                          {log.field_mappings.name}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground font-medium items-center">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3 text-muted-foreground/60" />
                        <span>{dateFormatted}</span>
                      </span>
                      <span className="flex items-center gap-1.5 bg-muted/40 text-muted-foreground font-semibold px-2 py-0.5 rounded-lg border border-border/50">
                        <Clock className="h-3 w-3 text-muted-foreground/60" />
                        <span>{getDeletionCountdown(log.created_at || '', log.status || '')}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Database className="h-3 w-3 text-muted-foreground/60" />
                        <span>
                          {t('log.model')}: <span className="font-mono text-foreground font-semibold">{log.odoo_model}</span>
                        </span>
                      </span>
                      {log.zid_entity_id && (
                        <span>
                          {t('log.entityId')}: <span className="font-mono text-foreground font-semibold">{log.zid_entity_id}</span>
                        </span>
                      )}
                      {log.odoo_record_id && (
                        <span>
                          {t('log.recordId')}: <span className="font-mono text-foreground font-semibold">#{log.odoo_record_id}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => togglePayload(log)}
                      className="h-8 text-[10px] font-semibold gap-1 rounded-lg px-2.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {t('log.viewPayload')}
                    </Button>

                    {(log.status === 'failed' || log.status === 'skipped') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResolveManually(log.id)}
                        disabled={isResolvingId === log.id}
                        className="h-8 text-[10px] font-bold border-border text-foreground hover:bg-muted rounded-lg px-3 transition-transform duration-200 gap-1"
                      >
                        {isResolvingId === log.id ? (
                          <Loader2 className="h-3 w-3 animate-spin text-foreground" />
                        ) : (
                          <Check className="h-3.5 w-3.5 text-foreground" />
                        )}
                        {ar ? 'حل يدوي' : 'Resolve Manually'}
                      </Button>
                    )}

                    {(log.status === 'failed' || log.status === 'skipped') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResend(log.id)}
                        disabled={isRetryingId === log.id}
                        className="h-8 text-[10px] font-bold border-border text-foreground hover:bg-muted rounded-lg px-3 transition-transform duration-200 gap-1"
                      >
                        {isRetryingId === log.id ? (
                          <Loader2 className="h-3 w-3 animate-spin text-foreground" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        {t('log.resend')}
                      </Button>
                    )}
                  </div>
                </div>

                {(log.status === 'failed' || log.status === 'skipped') && log.error_message && (
                  <div className={cn(
                    'mt-3 border rounded-lg p-3 flex items-start gap-2 text-xs',
                    log.status === 'failed'
                      ? 'bg-destructive/5 border-destructive/15 text-destructive'
                      : 'bg-muted border-border text-muted-foreground'
                  )}>
                    {log.status === 'failed' ? (
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                    ) : (
                      <HelpCircle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                    )}
                    <div className="space-y-0.5">
                      <div className="font-bold">
                        {log.status === 'failed'
                          ? t('log.errorMessage')
                          : (ar ? 'سبب التخطي / التفاصيل' : 'Skip Reason / Details')}
                      </div>
                      <div className="font-mono break-all leading-relaxed text-[11px] opacity-90">{log.error_message}</div>
                    </div>
                  </div>
                )}

                {isExpanded && (
                  <div className="mt-3 border border-border rounded-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
                    <div className="bg-muted border-b border-border px-3 py-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground">{t('log.payloadTitle')}</span>
                      <span className="text-[9px] font-mono text-muted-foreground">JSON Format</span>
                    </div>
                    {payloadLoadingId === log.id && cachedPayload === undefined ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <pre className="p-3 bg-card text-foreground text-[10px] font-mono overflow-x-auto max-h-[250px] leading-relaxed">
                        {JSON.stringify(cachedPayload ?? {}, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground font-semibold">
        {ar ? `إجمالي السجلات: ${totalCount}` : `Total logs: ${totalCount}`}
      </div>
    </div>
  )
}
