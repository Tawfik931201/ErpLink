'use client'

import React, { useState, useEffect, useRef } from 'react'
import { 
  X, 
  RefreshCw, 
  Eye, 
  EyeOff, 
  Filter, 
  Calendar, 
  Database, 
  AlertCircle, 
  CheckCircle2, 
  HelpCircle,
  Loader2,
  Tag,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Clock
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/components/language-provider'
import { getSyncLogs, retrySyncLog, resolveLogManually } from '@/app/actions/sync-logs'
import { useToast } from '@/hooks/use-toast'

interface SyncLogModalProps {
  isOpen: boolean
  onClose: () => void
  mappingId?: string
  mappingName?: string
  mappingsList: Array<{ id: string; name: string }>
}

export default function SyncLogModal({
  isOpen,
  onClose,
  mappingId,
  mappingName,
  mappingsList
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
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false)
  const statusDropdownRef = useRef<HTMLDivElement>(null)
  const [isMappingDropdownOpen, setIsMappingDropdownOpen] = useState(false)
  const mappingDropdownRef = useRef<HTMLDivElement>(null)

  // Sync selectedMappingIds when mappingsList or mappingId changes
  useEffect(() => {
    if (mappingId) {
      setSelectedMappingIds([mappingId])
    } else {
      setSelectedMappingIds(mappingsList.map(m => m.id))
    }
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
      const activeMappingId = mappingId || (
        selectedMappingIds.length === 0 
          ? 'none' 
          : selectedMappingIds.length === mappingsList.length 
            ? 'all' 
            : selectedMappingIds.join(',')
      )
      
      const res = await getSyncLogs({
        mappingId: activeMappingId,
        status: selectedStatuses.length === 4 ? 'all' : selectedStatuses.join(','),
        limit: LIMIT,
        offset: 0
      })

      if (res.success) {
        setLogs(res.logs || [])
        setTotalCount(res.totalCount)
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
      const activeMappingId = mappingId || (
        selectedMappingIds.length === 0 
          ? 'none' 
          : selectedMappingIds.length === mappingsList.length 
            ? 'all' 
            : selectedMappingIds.join(',')
      )
      
      const res = await getSyncLogs({
        mappingId: activeMappingId,
        status: selectedStatuses.length === 4 ? 'all' : selectedStatuses.join(','),
        limit: LIMIT,
        offset: newOffset
      })

      if (res.success) {
        setLogs(res.logs || [])
        setOffset(newOffset)
        setTotalCount(res.totalCount)
      } else {
        console.error('Failed to load logs:', res.error)
      }
    } catch (err) {
      console.error('Error fetching sync logs:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Deletion countdown helper
  const getDeletionCountdown = (createdAtStr: string, status: string) => {
    const createdAt = new Date(createdAtStr).getTime()
    const now = Date.now()
    
    // Success logs (or manually resolved ones) expire in 72 hours, other logs in 7 days
    const duration = status === 'success' 
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

  // Close status and mapping dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(event.target as Node)) {
        setIsStatusDropdownOpen(false)
      }
      if (mappingDropdownRef.current && !mappingDropdownRef.current.contains(event.target as Node)) {
        setIsMappingDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reload logs when filters or mappingId changes
  useEffect(() => {
    if (isOpen) {
      fetchLogs()
      setExpandedPayloadIds(new Set())
    }
  }, [isOpen, selectedStatuses, selectedMappingIds, mappingId])

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

  const getStatusBadge = (status: string, errorMessage?: string) => {
    if (status === 'success' && errorMessage?.includes('Resolved manually')) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          <CheckCircle2 className="h-3 w-3 text-amber-500" />
          {lang === 'ar' ? 'تم الحل يدويًا' : 'Resolved Manually'}
        </span>
      )
    }

    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="h-3 w-3" />
            {t('log.success')}
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/20">
            <AlertCircle className="h-3 w-3" />
            {t('log.failed')}
          </span>
        )
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            <HelpCircle className="h-3 w-3" />
            {t('log.skipped')}
          </span>
        )
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
            {lang === 'ar' ? 'جاري المزامنة...' : 'Syncing...'}
          </span>
        )
      default:
        return null
    }
  }

  const getTriggerBadge = (triggerType: string) => {
    const isManual = triggerType === 'manual'
    return (
      <span className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border",
        isManual 
          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" 
          : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
      )}>
        {isManual ? t('log.manual') : t('log.automatic')}
      </span>
    )
  }

  const isFirstPage = offset === 0
  const isLastPage = offset + logs.length >= totalCount
  const PrevIcon = dir === 'rtl' ? ChevronRight : ChevronLeft
  const NextIcon = dir === 'rtl' ? ChevronLeft : ChevronRight

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className={cn(
          "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full flex flex-col shadow-2xl overflow-hidden transition-all duration-300",
          isMaximized 
            ? "max-w-[96vw] h-[92vh] max-h-[92vh]" 
            : "max-w-4xl h-auto max-h-[85vh]",
          "animate-in zoom-in-95 duration-200"
        )}
        dir={dir}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Database className="h-4.5 w-4.5 text-primary" />
              {mappingName 
                ? t('log.mappingTitle').replace('{name}', mappingName) 
                : t('log.globalTitle')}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {lang === 'ar' 
                ? 'استعرض تفاصيل عمليات المزامنة الحية، وشخّص الأخطاء، وأعد إرسال الطلبات يدوياً.' 
                : 'Review live synchronization runs, diagnose errors, and resend payloads manually.'}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {/* Pagination Controls */}
            {totalCount > 0 && (
              <div className="flex items-center gap-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg p-1 text-xs font-medium shadow-sm">
                <span className="px-2 text-muted-foreground select-none font-mono">
                  {offset + 1}-{Math.min(offset + logs.length, totalCount)} / {totalCount}
                </span>
                <div className="flex items-center gap-0.5 border-l border-slate-200 dark:border-slate-800 pl-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handlePrevPage}
                    disabled={isFirstPage || isLoading}
                    className="h-7 w-7 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-muted-foreground disabled:opacity-40"
                    title={lang === 'ar' ? 'الصفحة السابقة' : 'Previous page'}
                  >
                    <PrevIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleNextPage}
                    disabled={isLastPage || isLoading}
                    className="h-7 w-7 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-muted-foreground disabled:opacity-40"
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
              className="h-8 w-8 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-muted-foreground hover:text-foreground"
              title={isMaximized ? (lang === 'ar' ? 'تصغير الشاشة' : 'Minimize') : (lang === 'ar' ? 'توسيع الشاشة' : 'Maximize')}
            >
              {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Modal Filters */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            
            {/* Status Filter Multi-Select Dropdown */}
            <div className="flex items-center gap-1.5 relative select-none" ref={statusDropdownRef}>
              <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-semibold text-muted-foreground mr-1 shrink-0">{t('log.status')}:</span>
              
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary font-medium flex items-center gap-2 select-none min-w-[120px] justify-between text-start"
                >
                  <span className="truncate max-w-[150px]">
                    {selectedStatuses.length === 4
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
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>

                {isStatusDropdownOpen && (
                  <div className="absolute z-50 mt-1 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg py-1 animate-in fade-in duration-100">
                    {/* All option */}
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.length === 4}
                        onChange={toggleAllStatuses}
                        className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <span>{t('log.all')}</span>
                    </label>
                    <hr className="border-slate-100 dark:border-slate-800 my-1" />

                    {/* Success option */}
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes('success')}
                        onChange={() => toggleStatus('success')}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-3.5 w-3.5"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {t('log.success')}
                      </span>
                    </label>

                    {/* Manual option */}
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes('manual')}
                        onChange={() => toggleStatus('manual')}
                        className="rounded border-slate-300 text-amber-600 focus:ring-amber-500 h-3.5 w-3.5"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {lang === 'ar' ? 'حل يدوي' : 'Manual Resolve'}
                      </span>
                    </label>

                    {/* Failed option */}
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes('failed')}
                        onChange={() => toggleStatus('failed')}
                        className="rounded border-slate-300 text-destructive focus:ring-destructive h-3.5 w-3.5"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                        {t('log.failed')}
                      </span>
                    </label>

                    {/* Skipped option */}
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes('skipped')}
                        onChange={() => toggleStatus('skipped')}
                        className="rounded border-slate-300 text-slate-500 focus:ring-slate-500 h-3.5 w-3.5"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                        {t('log.skipped')}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Global Mode: Mapping selector Multi-Select Dropdown */}
            {!mappingId && (
              <div className="flex items-center gap-1.5 relative select-none" ref={mappingDropdownRef}>
                <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-[11px] font-semibold text-muted-foreground mr-1 shrink-0">{lang === 'ar' ? 'الربط:' : 'Mapping:'}</span>
                
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsMappingDropdownOpen(!isMappingDropdownOpen)}
                    className="text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-primary font-medium flex items-center gap-2 select-none min-w-[140px] justify-between text-start"
                  >
                    <span className="truncate max-w-[150px]">
                      {selectedMappingIds.length === mappingsList.length
                        ? (lang === 'ar' ? 'جميع عمليات الربط' : 'All Mappings')
                        : selectedMappingIds.length === 0
                          ? (lang === 'ar' ? 'لا شيء' : 'None')
                          : selectedMappingIds.map(id => mappingsList.find(m => m.id === id)?.name || id).join(', ')
                      }
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </button>

                  {isMappingDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg py-1 animate-in fade-in duration-100 max-h-60 overflow-y-auto">
                      {/* All option */}
                      <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer text-foreground select-none">
                        <input
                          type="checkbox"
                          checked={selectedMappingIds.length === mappingsList.length}
                          onChange={toggleAllMappings}
                          className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                        />
                        <span>{lang === 'ar' ? 'جميع عمليات الربط' : 'All Mappings'}</span>
                      </label>
                      <hr className="border-slate-100 dark:border-slate-800 my-1" />

                      {/* Mapping options */}
                      {mappingsList.map(m => (
                        <label key={m.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer text-foreground select-none">
                          <input
                            type="checkbox"
                            checked={selectedMappingIds.includes(m.id)}
                            onChange={() => toggleMapping(m.id)}
                            className="rounded border-slate-300 text-primary focus:ring-primary h-3.5 w-3.5"
                          />
                          <span className="truncate" title={m.name}>{m.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchLogs(false)}
            disabled={isLoading}
            className="h-7 text-[10px] font-semibold rounded-lg shrink-0"
          >
            <RefreshCw className={cn("h-3 w-3 mr-1", isLoading && "animate-spin")} />
            {lang === 'ar' ? 'تحديث' : 'Refresh'}
          </Button>
        </div>

        {/* Logs List Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-900/20">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
              <p className="text-xs text-muted-foreground font-medium">
                {lang === 'ar' ? 'جاري تحميل السجلات...' : 'Loading logs...'}
              </p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                <AlertCircle className="h-5 w-5 text-slate-400" />
              </div>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                {t('log.noLogs')}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
                {lang === 'ar' 
                  ? 'لم يتم تسجيل أي عمليات مزامنة مطابقة للشروط المحددة حتى الآن.' 
                  : 'No sync operations match the selected filters.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {logs.map((log) => {
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

                return (
                  <div 
                    key={log.id} 
                    className={cn(
                      "bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-4 shadow-sm transition-all duration-200 hover:border-slate-300 dark:hover:border-slate-700",
                      log.status === 'failed' && "border-l-4 border-l-destructive",
                      log.status === 'success' && (
                        isResolvedManually
                          ? "border-l-4 border-l-amber-500" 
                          : "border-l-4 border-l-emerald-500"
                      ),
                      log.status === 'processing' && "border-l-4 border-l-blue-500 animate-pulse"
                    )}
                  >
                    {/* Log Row Info */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {getStatusBadge(log.status, log.error_message)}
                          {getTriggerBadge(log.trigger_type)}
                          <span className="text-xs font-bold font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-foreground">
                            {log.event}
                          </span>
                          {!mappingId && log.field_mappings?.name && (
                            <span className="text-[10px] font-bold text-primary max-w-[150px] truncate" title={log.field_mappings.name}>
                              [{log.field_mappings.name}]
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-muted-foreground font-medium pt-1 items-center">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>{dateFormatted}</span>
                          </span>
                          <span className="flex items-center gap-1 bg-amber-500/5 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold px-2 py-0.5 rounded border border-amber-500/10 dark:border-amber-500/20">
                            <Clock className="h-3 w-3 animate-pulse text-amber-500" />
                            <span>{getDeletionCountdown(log.created_at, log.status)}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <Database className="h-3 w-3" />
                            <span>{t('log.model')}: <span className="font-mono text-foreground font-semibold">{log.odoo_model}</span></span>
                          </span>
                          {log.zid_entity_id && (
                            <span>{t('log.entityId')}: <span className="font-mono text-foreground font-semibold">{log.zid_entity_id}</span></span>
                          )}
                          {log.odoo_record_id && (
                            <span>{t('log.recordId')}: <span className="font-mono text-foreground font-semibold">#{log.odoo_record_id}</span></span>
                          )}
                        </div>
                      </div>

                      {/* Log Action Buttons */}
                      <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                        {/* Payload Toggle Button */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => togglePayload(log.id)}
                          className="h-8 text-[10px] font-semibold gap-1 rounded-lg px-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          {t('log.viewPayload')}
                        </Button>

                        {/* Resolve Manually Button */}
                        {(log.status === 'failed' || log.status === 'skipped') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResolveManually(log.id)}
                            disabled={isResolvingId === log.id}
                            className="h-8 text-[10px] font-bold border-emerald-500/20 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 rounded-lg px-3 shadow-sm hover:scale-[1.01] transition-transform duration-200 gap-1"
                          >
                            {isResolvingId === log.id ? (
                              <Loader2 className="h-3 w-3 animate-spin text-emerald-500" />
                            ) : (
                              <Check className="h-3.5 w-3.5 text-emerald-500" />
                            )}
                            {lang === 'ar' ? 'حل يدوي' : 'Resolve Manually'}
                          </Button>
                        )}

                        {/* Retry Button */}
                        {(log.status === 'failed' || log.status === 'skipped') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleResend(log.id)}
                            disabled={isRetryingId === log.id}
                            className="h-8 text-[10px] font-bold border-primary/20 text-primary hover:bg-primary/5 rounded-lg px-3 shadow-sm hover:scale-[1.01] transition-transform duration-200 gap-1"
                          >
                            {isRetryingId === log.id ? (
                              <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            ) : (
                              <RefreshCw className="h-3 w-3" />
                            )}
                            {t('log.resend')}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Diagnostics: Display Error details if status is Failed or Skipped */}
                    {((log.status === 'failed' || log.status === 'skipped') && log.error_message) && (
                      <div className={cn(
                        "mt-3 border rounded-lg p-3 flex items-start gap-2 text-xs",
                        log.status === 'failed' 
                          ? "bg-destructive/5 border-destructive/15 text-destructive" 
                          : "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      )}>
                        {log.status === 'failed' ? (
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                        ) : (
                          <HelpCircle className="h-4 w-4 shrink-0 mt-0.5 text-slate-500 dark:text-slate-400" />
                        )}
                        <div className="space-y-0.5">
                          <div className="font-bold">
                            {log.status === 'failed' ? t('log.errorMessage') : (lang === 'ar' ? 'سبب التخطي / التفاصيل' : 'Skip Reason / Details')}
                          </div>
                          <div className="font-mono break-all leading-relaxed text-[11px] opacity-90">{log.error_message}</div>
                        </div>
                      </div>
                    )}

                    {/* Expandable Zid Payload display */}
                    {isExpanded && (
                      <div className="mt-3 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden animate-in slide-in-from-top-2 duration-200">
                        <div className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 py-1.5 flex items-center justify-between">
                          <span className="text-[10px] font-bold text-muted-foreground">{t('log.payloadTitle')}</span>
                          <span className="text-[9px] font-mono text-slate-400">JSON Format</span>
                        </div>
                        <pre className="p-3 bg-slate-950 text-slate-200 text-[10px] font-mono overflow-x-auto max-h-[250px] leading-relaxed">
                          {JSON.stringify(log.payload || {}, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* End of logs list indicator if empty */}
              {logs.length === 0 && !isLoading && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {lang === 'ar' ? 'لا توجد سجلات مطابقة للفلاتر المحددة.' : 'No logs matching the selected filters.'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex justify-between items-center">
          <div className="text-[10px] text-muted-foreground font-semibold">
            {lang === 'ar' 
              ? `إجمالي السجلات: ${totalCount}` 
              : `Total logs: ${totalCount}`}
          </div>
          <Button 
            onClick={onClose} 
            className="h-8.5 rounded-lg text-xs font-semibold px-4"
          >
            {t('log.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
