'use client'

import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle, ArrowLeft, Clock, Play, Square, History, CopyPlus, Search, FileDown, AlertTriangle, Settings, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useState, useEffect, useCallback } from 'react'

import { bulkRetryOrders } from '@/app/actions/order-bulk-actions'
import { getOrderSyncStats, getOrderSyncLogs, retryOrderSync } from '@/app/actions/order-dashboard'
import { getOrderTimeline, getWebhookHealth } from '@/app/actions/order-timeline'
import type { TimelineEntry, WebhookHealth } from '@/app/actions/order-timeline'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

import DuplicateOrdersModal from './duplicate-orders-modal'
import ErrorSummaryModal from './error-summary-modal'
import OrderDetailModal from './order-detail-modal'
import OrderTimelineModal from './order-timeline-modal'

type SyncStats = { total: number; success: number; failed: number; skipped: number; total_events?: number; last_activity?: string | null }
type SyncLog = {
  id: string
  event: string
  status: string
  error_message?: string
  created_at: string
  zid_entity_id?: string
  odoo_record_id?: number
  odoo_model?: string
  store_id?: string
}

function ExpandableError({ message, lang }: { message: string; lang: 'ar' | 'en' }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = message.length > 80
  return (
    <div className="relative">
      <span className={expanded ? '' : 'line-clamp-1'}>{message}</span>
      {truncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] font-semibold text-primary hover:text-primary/80 mt-0.5 block"
        >
          {expanded
            ? (lang === 'ar' ? 'عرض أقل' : 'Show less')
            : (lang === 'ar' ? 'عرض المزيد' : 'Show more')}
        </button>
      )}
    </div>
  )
}

export default function OrderDashboardClient() {
  const { lang, dir } = useLanguage()
  const { toast } = useToast()
  const router = useRouter()

  const [stats, setStats] = useState<SyncStats | null>(null)
  const [health, setHealth] = useState<WebhookHealth[]>([])
  const [odooUrl, setOdooUrl] = useState<string | undefined>(undefined)
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isRetrying, setIsRetrying] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [page, setPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkRetrying, setIsBulkRetrying] = useState(false)
  const [timelineOrderId, setTimelineOrderId] = useState<string | null>(null)
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([])
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(false)
  const [isDupModalOpen, setIsDupModalOpen] = useState(false)
  const [isErrorSummaryOpen, setIsErrorSummaryOpen] = useState(false)
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null)
  const [detailStoreId, setDetailStoreId] = useState<string | undefined>(undefined)
  const pageSize = 20

  const load = useCallback(async () => {
    setIsLoading(true)
    const [statsRes, logsRes, healthRes] = await Promise.all([
      getOrderSyncStats(),
      getOrderSyncLogs({
        status: statusFilter === 'all' ? undefined : statusFilter,
        platform: platformFilter === 'all' ? undefined : platformFilter,
        searchQuery: searchQuery || undefined,
        limit: pageSize,
        offset: page * pageSize
      }),
      getWebhookHealth(),
    ])
    if (statsRes.success && statsRes.stats) setStats(statsRes.stats)
    if (logsRes.success) {
      setLogs(logsRes.logs || [])
      setTotalCount(logsRes.totalCount || 0)
      setOdooUrl((logsRes as { odooUrl?: string }).odooUrl)
    }
    if (healthRes.success) setHealth(healthRes.health || [])
    setSelectedIds(new Set())
    setIsLoading(false)
  }, [statusFilter, platformFilter, searchQuery, page])

  useEffect(() => { load() }, [load])

  const retryAllFailed = async () => {
    const failedIds = logs.filter(l => l.status === 'failed').map(l => l.id)
    if (failedIds.length === 0) {
      toast({ title: lang === 'ar' ? 'لا يوجد فاشل' : 'No failed items', description: lang === 'ar' ? 'لا توجد سجلات فاشلة لإعادة المحاولة' : 'No failed records to retry' })
      return
    }
    setIsBulkRetrying(true)
    const res = await bulkRetryOrders(failedIds)
    if (res.success) {
      const successCount = res.results?.filter(r => r.success).length || 0
      toast({
        title: lang === 'ar' ? 'تمت إعادة المحاولة' : 'Retry completed',
        description: lang === 'ar'
          ? `تمت إعادة محاولة ${successCount} من ${failedIds.length}`
          : `Retried ${successCount} of ${failedIds.length}`
      })
      load()
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
    setIsBulkRetrying(false)
  }

  const exportCsv = () => {
    const headers = ['Event', 'Status', 'Order ID', 'Odoo ID', 'Date', 'Error']
    const rows = logs.map(l => [
      l.event, l.status, l.zid_entity_id || '', String(l.odoo_record_id || ''), l.created_at, l.error_message || ''
    ])
    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n')
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `order-sync-logs-${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const handleRetry = async (logId: string) => {
    setIsRetrying(logId)
    const res = await retryOrderSync(logId)
    if (res.success) {
      toast({ title: lang === 'ar' ? 'تمت إعادة المحاولة' : 'Retry completed', description: lang === 'ar' ? 'تمت إعادة معالجة المزامنة' : 'Sync reprocessed' })
      load()
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
    setIsRetrying(null)
  }

  const handleBulkRetry = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setIsBulkRetrying(true)
    const res = await bulkRetryOrders(ids)
    if (res.success) {
      const failedCount = res.results?.filter(r => !r.success).length || 0
      const successCount = res.results?.filter(r => r.success).length || 0
      toast({
        title: lang === 'ar' ? 'تمت المعالجة الجماعية' : 'Bulk retry completed',
        description: lang === 'ar'
          ? `${successCount} نجح، ${failedCount} فشل`
          : `${successCount} succeeded, ${failedCount} failed`
      })
      load()
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
    setIsBulkRetrying(false)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleShowTimeline = async (zidEntityId: string, storeId?: string) => {
    setTimelineOrderId(zidEntityId)
    setIsLoadingTimeline(true)
    const res = await getOrderTimeline(zidEntityId, storeId)
    if (res.success) {
      setTimelineEntries(res.entries || [])
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
    setIsLoadingTimeline(false)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(logs.map(l => l.id)))
    }
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const getPlatformFromEvent = (ev: string): 'Zid' | 'Salla' | 'Shopify' => {
    if (ev.includes('/')) return 'Shopify'
    if (/\.(create|update|delete|publish)$/.test(ev)) return 'Zid'
    return 'Salla'
  }

  const getEventLabel = (ev: string) => {
    const map: Record<string, string> = {
      'order.created': lang === 'ar' ? 'طلب جديد' : 'Order Created',
      'order.updated': lang === 'ar' ? 'تحديث طلب' : 'Order Updated',
      'order.status.update': lang === 'ar' ? 'تحديث حالة' : 'Status Update',
      'order.cancelled': lang === 'ar' ? 'إلغاء طلب' : 'Order Cancelled',
      'order.delivered': lang === 'ar' ? 'توصيل طلب' : 'Order Delivered',
      'order.payment_status.update': lang === 'ar' ? 'تحديث الدفع' : 'Payment Update',
      'order.refunded': lang === 'ar' ? 'مسترجع' : 'Refunded',
      'order.reversed': lang === 'ar' ? 'مرتجع' : 'Reversed',
      'orders/create': lang === 'ar' ? 'طلب جديد' : 'Order Created',
      'orders/updated': lang === 'ar' ? 'تحديث طلب' : 'Order Updated',
      'orders/cancelled': lang === 'ar' ? 'إلغاء طلب' : 'Order Cancelled',
      'orders/fulfilled': lang === 'ar' ? 'طلب مكتمل' : 'Order Fulfilled',
      'orders/paid': lang === 'ar' ? 'تم الدفع' : 'Order Paid',
      'orders/partially_fulfilled': lang === 'ar' ? 'توصيل جزئي' : 'Partial Fulfillment',
      'orders/edited': lang === 'ar' ? 'تعديل طلب' : 'Order Edited',
      'orders/delete': lang === 'ar' ? 'حذف طلب' : 'Order Deleted',
    }
    return map[ev] || ev
  }

  const getStatusIcon = (status: string) => {
    if (status === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-500" />
    return <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />
  }

  const totalPages = Math.ceil(totalCount / pageSize)
  const hasSelectedFailed = Array.from(selectedIds).some(id => logs.find(l => l.id === id)?.status === 'failed')

  return (
    <div className="space-y-6 p-6" dir={dir}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => router.push('/app/mapping-center')} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground">
            {lang === 'ar' ? 'لوحة تحكم الطلبات' : 'Order Sync Dashboard'}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {lang === 'ar' ? 'مراقبة ومتابعة مزامنة الطلبات' : 'Monitor and manage order synchronization'}
          </p>
        </div>
        <div className="mr-auto flex items-center gap-2">
          {/* Retry All Failed */}
          {stats && stats.failed > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={retryAllFailed}
              disabled={isBulkRetrying}
              className="gap-1.5 h-8 text-xs border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20"
            >
              {isBulkRetrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
              {lang === 'ar' ? `إعادة ${stats.failed} فاشل` : `Retry ${stats.failed} Failed`}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setIsErrorSummaryOpen(true)} className="gap-1.5 h-8 text-xs">
            <AlertCircle className="h-3 w-3" />
            {lang === 'ar' ? 'الأخطاء' : 'Errors'}
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={logs.length === 0} className="gap-1.5 h-8 text-xs">
          <FileDown className="h-3 w-3" />
          CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => setIsDupModalOpen(true)} className="gap-1.5 h-8 text-xs">
          <CopyPlus className="h-3 w-3" />
          {lang === 'ar' ? 'المكررات' : 'Duplicates'}
        </Button>
        <Button variant="outline" size="sm" onClick={load} disabled={isLoading} className="gap-1.5 h-8 text-xs">
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          {lang === 'ar' ? 'تحديث' : 'Refresh'}
        </Button>
      </div>

      {/* Last Activity Indicator */}
      {stats?.last_activity && (
        <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-muted/20 border border-border/50">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">
            {lang === 'ar' ? 'آخر نشاط:' : 'Last activity:'}
          </span>
          <span className="text-[10px] font-semibold text-foreground">
            {formatTime(stats.last_activity)}
          </span>
        </div>
      )}

      {/* Stats Cards — counting unique orders, showing total events */}
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground font-semibold">{lang === 'ar' ? 'اجمالي الطلبات' : 'Total Orders'}</div>
            <div className="text-2xl font-extrabold text-foreground mt-1">{stats.total}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground font-semibold">{lang === 'ar' ? 'ناجح' : 'Success'}</div>
            <div className="text-2xl font-extrabold text-green-600 mt-1">{stats.success}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground font-semibold">{lang === 'ar' ? 'فاشل' : 'Failed'}</div>
            <div className="text-2xl font-extrabold text-red-600 mt-1">{stats.failed}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground font-semibold">{lang === 'ar' ? 'متخطى' : 'Skipped'}</div>
            <div className="text-2xl font-extrabold text-yellow-600 mt-1">{stats.skipped}</div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-[11px] text-muted-foreground font-semibold">{lang === 'ar' ? 'اجمالي الأحداث' : 'Total Events'}</div>
            <div className="text-2xl font-extrabold text-muted-foreground mt-1">{stats.total_events ?? '—'}</div>
          </div>
        </div>
      )}

      {/* Webhook Health Check */}
      {health.length > 0 && (
        <div className="flex items-center gap-3">
          {health.map(h => (
            <div key={h.platform} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold ${
              h.is_healthy
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800'
                : h.last_event
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800'
                  : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                h.is_healthy ? 'bg-emerald-500' : h.last_event ? 'bg-amber-500' : 'bg-red-500'
              }`} />
              {h.platform}
              {h.last_event && (
                <span className="text-[9px] opacity-70">
                  {formatTime(h.last_event)}
                </span>
              )}
              {!h.last_event && <span className="text-[9px] opacity-70">{lang === 'ar' ? 'لا توجد أحداث' : 'No events'}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Quick link to Order Settings */}
      <div className="flex justify-end">
        <Button
          variant="link"
          size="sm"
          onClick={() => router.push('/app/mapping-center?tab=standard&subtab=orders')}
          className="gap-1 h-7 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-3 w-3" />
          {lang === 'ar' ? 'إعدادات ربط الطلبات' : 'Order Mapping Settings'}
        </Button>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search by Order ID */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px] max-w-xs">
          <div className="relative w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { setSearchQuery(searchInput); setPage(0) } }}
              onBlur={() => { if (searchInput !== searchQuery) { setSearchQuery(searchInput); setPage(0) } }}
              placeholder={lang === 'ar' ? 'بحث برقم الطلب...' : 'Search by Order ID...'}
              className="w-full h-9 pl-8 pr-3 rounded-lg border border-input bg-inputBg text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
            />
          </div>
          {searchQuery && (
            <button
              onClick={() => { setSearchInput(''); setSearchQuery(''); setPage(0) }}
              className="text-[10px] font-semibold text-muted-foreground hover:text-foreground whitespace-nowrap"
            >
              {lang === 'ar' ? 'مسح' : 'Clear'}
            </button>
          )}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground">{lang === 'ar' ? 'الحالة:' : 'Status:'}</span>
          {['all', 'success', 'failed', 'skipped'].map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(0) }}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
                statusFilter === s ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {s === 'all' ? (lang === 'ar' ? 'الكل' : 'All') :
               s === 'success' ? (lang === 'ar' ? 'ناجح' : 'Success') :
               s === 'failed' ? (lang === 'ar' ? 'فاشل' : 'Failed') :
               (lang === 'ar' ? 'متخطى' : 'Skipped')}
            </button>
          ))}
        </div>

        {/* Platform Filter */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground">{lang === 'ar' ? 'المنصة:' : 'Platform:'}</span>
          {['all', 'zid', 'salla', 'shopify'].map((p) => (
            <button
              key={p}
              onClick={() => { setPlatformFilter(p); setPage(0) }}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold transition-colors ${
                platformFilter === p ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p === 'all' ? (lang === 'ar' ? 'الكل' : 'All') :
               p === 'zid' ? 'Zid' :
               p === 'salla' ? 'Salla' : 'Shopify'}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-muted/20">
          <span className="text-xs font-semibold text-muted-foreground">
            {lang === 'ar' ? `محدد: ${selectedIds.size}` : `Selected: ${selectedIds.size}`}
          </span>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkRetry}
            disabled={isBulkRetrying || !hasSelectedFailed}
            className="h-7 text-[10px] gap-1"
          >
            {isBulkRetrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {lang === 'ar' ? 'إعادة محاولة المحدد' : 'Retry Selected'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
            className="h-7 text-[10px] gap-1 text-muted-foreground"
          >
            <Square className="h-3 w-3" />
            {lang === 'ar' ? 'إلغاء التحديد' : 'Clear'}
          </Button>
        </div>
      )}

      {/* Logs Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          {lang === 'ar' ? 'لا توجد سجلات مزامنة للطلبات' : 'No order sync logs found'}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-muted/40 text-muted-foreground border-b border-border/60">
                <th className="px-2 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={logs.length > 0 && selectedIds.size === logs.length}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 cursor-pointer accent-foreground"
                  />
                </th>
                <th className="px-4 py-2.5 font-bold">{lang === 'ar' ? 'الحدث' : 'Event'}</th>
                <th className="px-4 py-2.5 font-bold">{lang === 'ar' ? 'المنصة' : 'Platform'}</th>
                <th className="px-4 py-2.5 font-bold">{lang === 'ar' ? 'حالة المزامنة' : 'Status'}</th>
                <th className="px-4 py-2.5 font-bold">{lang === 'ar' ? 'معرف الطلب' : 'Order ID'}</th>
                <th className="px-4 py-2.5 font-bold">Odoo ID</th>
                <th className="px-4 py-2.5 font-bold">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                <th className="px-4 py-2.5 font-bold">{lang === 'ar' ? 'ملاحظات' : 'Notes'}</th>
                <th className="px-4 py-2.5 font-bold">{lang === 'ar' ? 'إجراء' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {logs.map((log) => (
                <tr key={log.id} className={`hover:bg-muted/10 ${selectedIds.has(log.id) ? 'bg-muted/20' : ''}`}>
                  <td className="px-2 py-2.5">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(log.id)}
                      onChange={() => toggleSelect(log.id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-foreground"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-foreground">
                    <div className="flex items-center gap-1.5">
                      {getEventLabel(log.event)}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        getPlatformFromEvent(log.event) === 'Shopify' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        getPlatformFromEvent(log.event) === 'Salla' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      }`}>
                        {getPlatformFromEvent(log.event)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {getStatusIcon(log.status)}
                      <span className={
                        log.status === 'success' ? 'text-green-600' :
                        log.status === 'failed' ? 'text-red-600' : 'text-yellow-600'
                      }>
                        {log.status === 'success' ? (lang === 'ar' ? 'ناجح' : 'Success') :
                         log.status === 'failed' ? (lang === 'ar' ? 'فاشل' : 'Failed') :
                         (lang === 'ar' ? 'متخطى' : 'Skipped')}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{log.zid_entity_id || '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {log.odoo_record_id ? (
                      odooUrl ? (
                        <a
                          href={`${odooUrl}/web#id=${log.odoo_record_id}&model=${log.odoo_model || 'sale.order'}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:text-primary/80 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {log.odoo_record_id}
                        </a>
                      ) : (
                        log.odoo_record_id
                      )
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatTime(log.created_at)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground max-w-[240px]">
                    {log.error_message ? (
                      <ExpandableError message={log.error_message} lang={lang} />
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      {log.status === 'failed' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetry(log.id)}
                          disabled={isRetrying === log.id}
                          className="h-7 text-[10px] gap-1"
                        >
                          {isRetrying === log.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          {lang === 'ar' ? 'إعادة' : 'Retry'}
                        </Button>
                      )}
                      {log.zid_entity_id && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setDetailOrderId(log.zid_entity_id!); setDetailStoreId(log.store_id) }}
                            className="h-7 text-[10px] gap-1"
                          >
                            <Search className="h-3 w-3" />
                            {lang === 'ar' ? 'عرض' : 'View'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleShowTimeline(log.zid_entity_id!, log.store_id)}
                            disabled={isLoadingTimeline && timelineOrderId === log.zid_entity_id}
                            className="h-7 text-[10px] gap-1"
                          >
                            <History className="h-3 w-3" />
                            {lang === 'ar' ? 'السجل' : 'Timeline'}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <span className="text-[10px] text-muted-foreground">
            {lang === 'ar'
              ? `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, totalCount)} من ${totalCount}`
              : `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, totalCount)} of ${totalCount}`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} className="h-8 text-xs">
              {lang === 'ar' ? 'السابق' : 'Previous'}
            </Button>
            <span className="text-xs text-muted-foreground min-w-[40px] text-center">{page + 1} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="h-8 text-xs">
              {lang === 'ar' ? 'التالي' : 'Next'}
            </Button>
          </div>
        </div>
      )}

      {/* Timeline Modal */}
      <OrderTimelineModal
        open={timelineOrderId !== null}
        onClose={() => setTimelineOrderId(null)}
        zidEntityId={timelineOrderId}
        entries={timelineEntries}
        isLoading={isLoadingTimeline}
        lang={lang}
      />

      {/* Duplicates Modal */}
      <DuplicateOrdersModal
        open={isDupModalOpen}
        onClose={() => setIsDupModalOpen(false)}
        lang={lang}
        onDedupDone={load}
      />

      {/* Order Detail Modal */}
      <OrderDetailModal
        open={detailOrderId !== null}
        onClose={() => setDetailOrderId(null)}
        zidEntityId={detailOrderId}
        storeId={detailStoreId}
        lang={lang}
      />

      {/* Error Summary Modal */}
      <ErrorSummaryModal
        open={isErrorSummaryOpen}
        onClose={() => setIsErrorSummaryOpen(false)}
        platformFilter={platformFilter}
        lang={lang}
      />
    </div>
  )
}
