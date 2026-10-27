'use client'

import {
  X,
  RefreshCw,
  Eye,
  EyeOff,
  Filter,
  Calendar,
  Database,
  AlertCircle,
  HelpCircle,
  Loader2,
  Tag,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock
} from 'lucide-react'
import React, { useState, useEffect, useRef } from 'react'

import { getSyncLogs, retrySyncLog, resolveLogManually } from '@/app/actions/sync-logs'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { CheckRow, FilterSelect } from '@/components/ui/filter-select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import {
  getDeletionCountdown as formatDeletionCountdown,
  SyncStatusBadge,
  SyncTriggerBadge,
} from '../logs/log-ui'

interface SyncLogModalProps {
  isOpen: boolean
  onClose: () => void
  mappingId?: string
  mappingName?: string
  mappingsList: Array<{ id: string; name: string }>
  eventFilter?: string
}

export default function SyncLogModal({
  isOpen,
  onClose,
  mappingId,
  mappingName,
  mappingsList,
  eventFilter
}: SyncLogModalProps) {
  const { t, lang, dir } = useLanguage()
  const { toast } = useToast()
  const [logs, setLogs] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRetryingId, setIsRetryingId] = useState<string | null>(null)
  const [isResolvingId, setIsResolvingId] = useState<string | null>(null)
  
  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['success', 'manual', 'failed', 'skipped'])
  const [selectedMappingIds, setSelectedMappingIds] = useState<string[]>(
    mappingId ? [mappingId] : mappingsList.map(m => m.id)
  )
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['zid', 'salla', 'shopify'])
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false)
  const statusDropdownRef = useRef<HTMLDivElement>(null)
  const [isMappingDropdownOpen, setIsMappingDropdownOpen] = useState(false)
  const mappingDropdownRef = useRef<HTMLDivElement>(null)
  const [isPlatformDropdownOpen, setIsPlatformDropdownOpen] = useState(false)
  const platformDropdownRef = useRef<HTMLDivElement>(null)

  const togglePlatform = (plat: string) => {
    setSelectedPlatforms(prev => {
      let next: string[]
      if (prev.includes(plat)) {
        next = prev.filter(p => p !== plat)
      } else {
        next = [...prev, plat]
      }
      return next
    })
  }

  const toggleAllPlatforms = () => {
    if (selectedPlatforms.length === 3) {
      setSelectedPlatforms([])
    } else {
      setSelectedPlatforms(['zid', 'salla', 'shopify'])
    }
  }

  // Sync selectedMappingIds when mappingsList or mappingId changes
  // Only updates state when the actual content differs (no re-fetch loops on re-renders)
  useEffect(() => {
    const target = mappingId
      ? [mappingId]
      : mappingsList.map(m => m.id)
    setSelectedMappingIds(prev => {
      const same = prev.length === target.length && prev.every((id, i) => target[i] === id)
      return same ? prev : target
    })
  }, [mappingsList, mappingId])
  
  // Pagination
  const [offset, setOffset] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  
  // Expanded payload states
  const [expandedPayloadIds, setExpandedPayloadIds] = useState<Set<string>>(new Set())

  // Maximize state
  const [isMaximized, setIsMaximized] = useState(false)

  const LIMIT = 15

  // Fetch logs function (resets to page 1)
  const fetchLogs = async () => {
    setIsLoading(true)
    setOffset(0)

    try {
      const activeMappingId = eventFilter
        ? 'all'
        : (mappingId || (
            selectedMappingIds.length === 0 
              ? 'none' 
              : selectedMappingIds.length === mappingsList.length 
                ? 'all' 
                : selectedMappingIds.join(',')
          ))
      
      const activePlatform = selectedPlatforms.length === 3 
        ? 'all' 
        : selectedPlatforms.length === 0 
          ? 'none' 
          : selectedPlatforms.join(',')

      const res = await getSyncLogs({
        mappingId: activeMappingId,
        status: selectedStatuses.length === 4 ? 'all' : selectedStatuses.join(','),
        limit: LIMIT,
        offset: 0,
        platform: activePlatform,
        eventFilter
      })

      if (res.success) {
        setLogs(res.logs || [])
        setTotalCount(res.totalCount || 0)
      } else {
        console.error('Failed to load logs:', res.error)
      }
    } catch (err) {
      console.error('Error fetching sync logs:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Navigate to specific offset
  const goToOffset = async (newOffset: number) => {
    setIsLoading(true)
    try {
      const activeMappingId = eventFilter
        ? 'all'
        : (mappingId || (
            selectedMappingIds.length === 0 
              ? 'none' 
              : selectedMappingIds.length === mappingsList.length 
                ? 'all' 
                : selectedMappingIds.join(',')
          ))
      
      const activePlatform = selectedPlatforms.length === 3 
        ? 'all' 
        : selectedPlatforms.length === 0 
          ? 'none' 
          : selectedPlatforms.join(',')

      const res = await getSyncLogs({
        mappingId: activeMappingId,
        status: selectedStatuses.length === 4 ? 'all' : selectedStatuses.join(','),
        limit: LIMIT,
        offset: newOffset,
        platform: activePlatform,
        eventFilter
      })

      if (res.success) {
        setLogs(res.logs || [])
        setOffset(newOffset)
        setTotalCount(res.totalCount || 0)
      } else {
        console.error('Failed to load logs:', res.error)
      }
    } catch (err) {
      console.error('Error fetching sync logs:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Deletion countdown — the exact same rule the /app/logs list and record
  // page use (72h for success, 7 days otherwise), so the numbers can't drift.
  const getDeletionCountdown = (createdAtStr: string, status: string) =>
    formatDeletionCountdown(createdAtStr, status, lang === 'ar')

  // Page handlers
  const handlePrevPage = () => {
    const newOffset = Math.max(0, offset - LIMIT)
    goToOffset(newOffset)
  }

  const handleNextPage = () => {
    const newOffset = offset + LIMIT
    goToOffset(newOffset)
  }

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev => {
      let next: string[]
      if (prev.includes(status)) {
        next = prev.filter(s => s !== status)
      } else {
        next = [...prev, status]
      }
      return next
    })
  }

  const toggleAllStatuses = () => {
    if (selectedStatuses.length === 4) {
      setSelectedStatuses([])
    } else {
      setSelectedStatuses(['success', 'manual', 'failed', 'skipped'])
    }
  }

  const toggleMapping = (mId: string) => {
    setSelectedMappingIds(prev => {
      let next: string[]
      if (prev.includes(mId)) {
        next = prev.filter(id => id !== mId)
      } else {
        next = [...prev, mId]
      }
      return next
    })
  }

  const toggleAllMappings = () => {
    if (selectedMappingIds.length === mappingsList.length) {
      setSelectedMappingIds([])
    } else {
      setSelectedMappingIds(mappingsList.map(m => m.id))
    }
  }

  // Close status, mapping and platform dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setIsStatusDropdownOpen(false)
      }
      if (mappingDropdownRef.current && !mappingDropdownRef.current.contains(event.target as Node)) {
        setIsMappingDropdownOpen(false)
      }
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(event.target as Node)) {
        setIsPlatformDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reload logs only when the modal opens or the user changes a filter.
  // filtersKey is a stable primitive so background re-renders never re-trigger a fetch.
  const filtersKey = [...selectedStatuses].sort().join(',') + '|' + [...selectedPlatforms].sort().join(',') + '|' + [...selectedMappingIds].sort().join(',')
  useEffect(() => {
    if (isOpen) {
      fetchLogs()
      setExpandedPayloadIds(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, filtersKey])

  if (!isOpen) return null

  const handleResend = async (logId: string) => {
    setIsRetryingId(logId)
    try {
      const res = await retrySyncLog(logId)
      if (res.success) {
        toast({
          title: lang === 'ar' ? 'إعادة الإرسال' : 'Sync Resend',
          description: lang === 'ar' ? 'تمت إعادة الإرسال بنجاح والمزامنة قيد التشغيل!' : 'Retry sync started successfully!',
        })
        
        // Refresh logs list at the same page
        goToOffset(offset)
      } else {
        toast({
          title: lang === 'ar' ? 'فشلت إعادة الإرسال' : 'Resend Failed',
          description: res.error || (lang === 'ar' ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: err.message || (lang === 'ar' ? 'حدث خطأ ما' : 'Something went wrong'),
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
          title: lang === 'ar' ? 'تم الحل يدويًا' : 'Resolved Manually',
          description: lang === 'ar' ? 'تم تعيين السجل كـ "محلول يدوياً في أودو" بنجاح!' : 'Log marked as resolved manually in Odoo!',
        })
        // Refresh logs list at the same page
        goToOffset(offset)
      } else {
        toast({
          title: lang === 'ar' ? 'فشل الإجراء' : 'Action Failed',
          description: res.error || (lang === 'ar' ? 'حدث خطأ ما' : 'Something went wrong'),
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: err.message || (lang === 'ar' ? 'حدث خطأ ما' : 'Something went wrong'),
        variant: 'destructive',
      })
    } finally {
      setIsResolvingId(null)
    }
  }

  const togglePayload = (id: string) => {
    setExpandedPayloadIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Platform labels shared by the filter trigger and the row.
  const platformLabel = (p: string) =>
    p === 'zid' ? (lang === 'ar' ? 'زد (Zid)' : 'Zid')
      : p === 'salla' ? (lang === 'ar' ? 'سلة (Salla)' : 'Salla')
      : p === 'shopify' ? (lang === 'ar' ? 'شوبيفاي (Shopify)' : 'Shopify')
      : p

  const isFirstPage = offset === 0
  const isLastPage = offset + logs.length >= totalCount
  const PrevIcon = dir === 'rtl' ? ChevronRight : ChevronLeft
  const NextIcon = dir === 'rtl' ? ChevronLeft : ChevronRight

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        className={cn(
          "bg-card border border-border w-full flex flex-col overflow-hidden transition-all duration-300",
          isMaximized
            ? "max-w-[96vw] h-[92vh] max-h-[92vh]"
            : "max-w-4xl h-auto max-h-[85vh]",
          "animate-in zoom-in-95 duration-200"
        )}
        dir={dir}
      >
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-muted/60">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">
                {mappingName
                  ? t('log.mappingTitle').replace('{name}', mappingName)
                  : t('log.globalTitle')}
              </span>
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {lang === 'ar'
                ? 'استعرض تفاصيل عمليات المزامنة الحية، وشخّص الأخطاء، وأعد إرسال الطلبات يدوياً.'
                : 'Review live synchronization runs, diagnose errors, and resend payloads manually.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Pagination Controls */}
            {totalCount > 0 && (
              <div className="flex items-center gap-2 border border-border bg-card p-1 text-xs font-medium">
                <span className="px-2 text-muted-foreground select-none font-mono">
                  {offset + 1}-{Math.min(offset + logs.length, totalCount)} / {totalCount}
                </span>
                <div className="flex items-center gap-0.5 border-e border-border pe-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handlePrevPage}
                    disabled={isFirstPage || isLoading}
                    className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                    title={lang === 'ar' ? 'الصفحة السابقة' : 'Previous page'}
                  >
                    <PrevIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleNextPage}
                    disabled={isLastPage || isLoading}
                    className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground disabled:opacity-40"
                    title={lang === 'ar' ? 'الصفحة التالية' : 'Next page'}
                  >
                    <NextIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsMaximized(!isMaximized)}
              className="h-7 w-7 rounded-none hover:bg-muted text-muted-foreground hover:text-foreground"
              title={isMaximized ? (lang === 'ar' ? 'تصغير الشاشة' : 'Minimize') : (lang === 'ar' ? 'توسيع الشاشة' : 'Maximize')}
            >
              {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="h-7 w-7 rounded-none hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Modal Filters — the same compact FilterSelect the list pages use. */}
        <div className="px-6 py-2.5 border-b border-border bg-card flex flex-wrap items-center gap-3">
          <FilterSelect
            label={t('log.status')}
            icon={<Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            buttonRef={statusDropdownRef}
            isOpen={isStatusDropdownOpen}
            onToggle={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
            triggerText={
              selectedStatuses.length === 4
                ? t('log.all')
                : selectedStatuses.length === 0
                  ? (lang === 'ar' ? 'لا شيء' : 'None')
                  : selectedStatuses.map(s => {
                      if (s === 'success') return t('log.success')
                      if (s === 'manual') return (lang === 'ar' ? 'حل يدوي' : 'Manual')
                      if (s === 'failed') return t('log.failed')
                      if (s === 'skipped') return t('log.skipped')
                      return s
                    }).join(', ')
            }
          >
            <CheckRow checked={selectedStatuses.length === 4} onChange={toggleAllStatuses}>
              <span className="font-bold">{t('log.all')}</span>
            </CheckRow>
            <div className="border-t border-border/50 mx-2 my-1" />
            <CheckRow checked={selectedStatuses.includes('success')} onChange={() => toggleStatus('success')}>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {t('log.success')}
            </CheckRow>
            <CheckRow checked={selectedStatuses.includes('manual')} onChange={() => toggleStatus('manual')}>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {lang === 'ar' ? 'حل يدوي' : 'Manual resolve'}
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
            label={lang === 'ar' ? 'المنصة' : 'Platform'}
            buttonRef={platformDropdownRef}
            isOpen={isPlatformDropdownOpen}
            onToggle={() => setIsPlatformDropdownOpen(!isPlatformDropdownOpen)}
            triggerText={
              selectedPlatforms.length === 3
                ? (lang === 'ar' ? 'الكل' : 'All')
                : selectedPlatforms.length === 0
                  ? (lang === 'ar' ? 'لا شيء' : 'None')
                  : selectedPlatforms.map(p => platformLabel(p)).join(', ')
            }
          >
            <CheckRow checked={selectedPlatforms.length === 3} onChange={toggleAllPlatforms}>
              <span className="font-bold">{lang === 'ar' ? 'الكل' : 'All'}</span>
            </CheckRow>
            <div className="border-t border-border/50 mx-2 my-1" />
            <CheckRow checked={selectedPlatforms.includes('zid')} onChange={() => togglePlatform('zid')}>
              <span className="h-1.5 w-1.5 rounded-full bg-zid-500" />
              {platformLabel('zid')}
            </CheckRow>
            <CheckRow checked={selectedPlatforms.includes('salla')} onChange={() => togglePlatform('salla')}>
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              {platformLabel('salla')}
            </CheckRow>
            <CheckRow checked={selectedPlatforms.includes('shopify')} onChange={() => togglePlatform('shopify')}>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {platformLabel('shopify')}
            </CheckRow>
          </FilterSelect>

          {/* Global mode only: which mapping the log belongs to. */}
          {!mappingId && (
            <FilterSelect
              label={lang === 'ar' ? 'الربط' : 'Mapping'}
              icon={<Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              buttonRef={mappingDropdownRef}
              isOpen={isMappingDropdownOpen}
              onToggle={() => setIsMappingDropdownOpen(!isMappingDropdownOpen)}
              triggerText={
                selectedMappingIds.length === mappingsList.length
                  ? (lang === 'ar' ? 'جميع عمليات الربط' : 'All mappings')
                  : selectedMappingIds.length === 0
                    ? (lang === 'ar' ? 'لا شيء' : 'None')
                    : selectedMappingIds.map(id => mappingsList.find(m => m.id === id)?.name || id).join(', ')
              }
            >
              <CheckRow checked={selectedMappingIds.length === mappingsList.length} onChange={toggleAllMappings}>
                <span className="font-bold">{lang === 'ar' ? 'جميع عمليات الربط' : 'All mappings'}</span>
              </CheckRow>
              <div className="border-t border-border/50 mx-2 my-1" />
              {mappingsList.map(m => (
                <CheckRow
                  key={m.id}
                  checked={selectedMappingIds.includes(m.id)}
                  onChange={() => toggleMapping(m.id)}
                >
                  <span className="truncate" title={m.name}>{m.name}</span>
                </CheckRow>
              ))}
            </FilterSelect>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchLogs()}
            disabled={isLoading}
            className="ms-auto h-7 rounded-none px-2.5 text-[10px] font-bold"
          >
            <RefreshCw className={cn("h-3 w-3 me-1", isLoading && "animate-spin")} />
            {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </Button>
        </div>

        {/* Logs List Area — same Odoo-style row list as /app/logs. */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-6 w-6 text-muted-foreground animate-spin mb-2" />
              <p className="text-xs text-muted-foreground font-medium">
                {lang === 'ar' ? 'جاري تحميل السجلات...' : 'Loading logs...'}
              </p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-xs font-bold text-muted-foreground">
                {t('log.noLogs')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
                {lang === 'ar'
                  ? 'لم يتم تسجيل أي عمليات مزامنة مطابقة للشروط المحددة حتى الآن.'
                  : 'No sync operations match the selected filters.'}
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3 border-y border-border bg-muted/60 px-3 py-2 text-[10px] uppercase tracking-wide text-foreground/70">
                <span className="w-[130px] shrink-0 font-bold">{t('log.status')}</span>
                <span className="min-w-0 flex-1 font-bold">{lang === 'ar' ? 'الحدث' : 'Event'}</span>
                <span className="hidden w-[130px] shrink-0 font-bold md:block">{lang === 'ar' ? 'التاريخ' : 'Date'}</span>
                <span className="w-[110px] shrink-0 text-end font-bold">{lang === 'ar' ? 'إجراءات' : 'Actions'}</span>
              </div>

              {logs.map(log => {
                const isExpanded = expandedPayloadIds.has(log.id)
                const dateFormatted = log.created_at
                  ? new Date(log.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })
                  : '-'
                const isResolvedManually = log.status === 'success' && log.error_message?.includes('Resolved manually')
                const canAct = log.status === 'failed' || log.status === 'skipped'

                return (
                  <div key={log.id} className="border-b border-border/60">
                    <div className="flex flex-wrap items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30">
                      <div className="flex w-[130px] shrink-0 flex-wrap items-center gap-1">
                        <SyncStatusBadge status={log.status} resolvedManually={isResolvedManually} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-foreground break-all">
                            {log.event}
                          </span>
                          <SyncTriggerBadge triggerType={log.trigger_type} />
                          {!mappingId && log.field_mappings?.name && (
                            <span
                              className="max-w-[160px] truncate border-s border-border/60 ps-2 text-[10px] font-semibold text-muted-foreground"
                              title={log.field_mappings.name}
                            >
                              {log.field_mappings.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1 md:hidden">
                            <Calendar className="h-3 w-3 opacity-60" />
                            {dateFormatted}
                          </span>
                          <span className="flex items-center gap-1">
                            {t('log.model')}: <span className="font-mono text-foreground">{log.odoo_model}</span>
                          </span>
                          {log.zid_entity_id && (
                            <span className="flex items-center gap-1">
                              {t('log.entityId')}: <span className="font-mono text-foreground">{log.zid_entity_id}</span>
                            </span>
                          )}
                          {log.odoo_record_id && (
                            <span className="flex items-center gap-1">
                              {t('log.recordId')}: <span className="font-mono text-foreground">#{log.odoo_record_id}</span>
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3 opacity-60" />
                            {getDeletionCountdown(log.created_at, log.status)}
                          </span>
                        </div>
                      </div>

                      <span className="hidden w-[130px] shrink-0 text-[10px] text-muted-foreground md:block">
                        {dateFormatted}
                      </span>

                      <div className="flex w-[110px] shrink-0 items-center justify-end gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => togglePayload(log.id)}
                          className="h-7 w-7 rounded-none text-muted-foreground hover:text-foreground"
                          title={t('log.viewPayload')}
                        >
                          {isExpanded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>

                        {canAct && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleResolveManually(log.id)}
                            disabled={isResolvingId === log.id}
                            className="h-7 w-7 rounded-none text-muted-foreground hover:text-foreground"
                            title={lang === 'ar' ? 'حل يدوي' : 'Resolve manually'}
                          >
                            {isResolvingId === log.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}

                        {canAct && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleResend(log.id)}
                            disabled={isRetryingId === log.id}
                            className="h-7 w-7 rounded-none text-muted-foreground hover:text-foreground"
                            title={t('log.resend')}
                          >
                            {isRetryingId === log.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Diagnostics: error / skip details */}
                    {canAct && log.error_message && (
                      <div className={cn(
                        "mx-3 mb-2 flex items-start gap-2 border p-2 text-[11px]",
                        log.status === 'failed'
                          ? "border-destructive/20 bg-destructive/5 text-destructive"
                          : "border-border bg-muted text-muted-foreground"
                      )}>
                        {log.status === 'failed' ? (
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                        ) : (
                          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="space-y-0.5">
                          <div className="font-bold">
                            {log.status === 'failed' ? t('log.errorMessage') : (lang === 'ar' ? 'سبب التخطي / التفاصيل' : 'Skip reason / details')}
                          </div>
                          <div className="font-mono break-all leading-relaxed opacity-90">{log.error_message}</div>
                        </div>
                      </div>
                    )}

                    {/* Expandable payload — on demand only, never in the list row */}
                    {isExpanded && (
                      <div className="mx-3 mb-2 overflow-hidden border border-border animate-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
                          <span className="text-[10px] font-bold text-muted-foreground">{t('log.payloadTitle')}</span>
                          <span className="text-[9px] font-mono text-muted-foreground">JSON</span>
                        </div>
                        <pre className="max-h-[250px] overflow-x-auto bg-card p-3 text-[10px] font-mono leading-relaxed text-foreground">
                          {JSON.stringify(log.payload || {}, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border bg-muted/60 px-4 py-2">
          <div className="text-[10px] font-semibold text-muted-foreground">
            {lang === 'ar'
              ? `إجمالي السجلات: ${totalCount}`
              : `Total logs: ${totalCount}`}
          </div>
          <Button
            onClick={onClose}
            className="h-7 rounded-none px-3 text-[10px] font-bold"
          >
            {t('log.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
