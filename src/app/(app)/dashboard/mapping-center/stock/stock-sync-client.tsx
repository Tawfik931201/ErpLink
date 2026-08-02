'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Store } from 'lucide-react'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { triggerStockSync, getStockSyncHistory } from '@/app/actions/stock-sync'

interface StockSyncClientProps {
  hasErp: boolean
  erpType: string
  isZidConnected: boolean
  isSallaConnected: boolean
  isShopifyConnected: boolean
  zidStoreName?: string | null
  sallaStoreName?: string | null
  shopifyStoreName?: string | null
}

type Platform = 'zid' | 'salla' | 'shopify'

const PLATFORM_INFO: Record<Platform, { label: string; color: string }> = {
  zid: { label: 'Zid', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  salla: { label: 'Salla', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  shopify: { label: 'Shopify', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
}

export default function StockSyncClient({
  hasErp, erpType,
  isZidConnected, isSallaConnected, isShopifyConnected,
  zidStoreName, sallaStoreName, shopifyStoreName,
}: StockSyncClientProps) {
  const { lang } = useLanguage()
  const { toast } = useToast()
  const [syncing, setSyncing] = useState<Platform | null>(null)
  const [lastResult, setLastResult] = useState<Record<Platform, any | null>>({ zid: null, salla: null, shopify: null })
  const [history, setHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    const res = await getStockSyncHistory()
    if (res.success) setHistory(res.history || [])
    setLoadingHistory(false)
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const handleSync = async (platform: Platform) => {
    setSyncing(platform)
    setLastResult(prev => ({ ...prev, [platform]: null }))
    try {
      const res = await triggerStockSync(platform)
      if (res.success && res.result) {
        setLastResult(prev => ({ ...prev, [platform]: res.result }))
        toast({
          title: lang === 'ar' ? 'تمت المزامنة' : 'Sync Complete',
          description: lang === 'ar'
            ? `تم تحديث ${res.result.updated} منتج، ${res.result.failed} فشل، ${res.result.skipped} تخطي`
            : `Updated ${res.result.updated} products, ${res.result.failed} failed, ${res.result.skipped} skipped`,
        })
        loadHistory()
      } else {
        toast({
          title: lang === 'ar' ? 'فشلت المزامنة' : 'Sync Failed',
          description: res.error || '',
          variant: 'destructive',
        })
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
    setSyncing(null)
  }

  const isConnected: Record<Platform, boolean> = {
    zid: isZidConnected, salla: isSallaConnected, shopify: isShopifyConnected,
  }
  const storeNames: Record<Platform, string | null | undefined> = {
    zid: zidStoreName, salla: sallaStoreName, shopify: shopifyStoreName,
  }

  if (!hasErp) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertTriangle className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h3 className="font-bold text-sm">
          {lang === 'ar' ? `نظام ${erpType === 'odoo' ? 'أودو' : erpType} غير متصل` : `${erpType} is not connected`}
        </h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-md">
          {lang === 'ar' ? 'يرجى ربط نظام ERP أولاً لمزامنة المخزون' : 'Connect your ERP system first to sync stock'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Platform Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Object.entries(PLATFORM_INFO) as [Platform, { label: string; color: string }][]).map(([platform, info]) => {
          const connected = isConnected[platform]
          const syncingNow = syncing === platform
          const result = lastResult[platform]
          const name = storeNames[platform]

          return (
            <div key={platform} className={cn(
              'rounded-xl border p-5 transition-all',
              connected ? 'border-border bg-card' : 'border-dashed border-border/50 bg-muted/30 opacity-60',
            )}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <Store className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-md', info.color)}>
                      {info.label}
                    </span>
                    {name && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{name}</p>
                    )}
                  </div>
                </div>
                {!connected && (
                  <span className="text-[10px] text-muted-foreground">
                    {lang === 'ar' ? 'غير متصل' : 'Disconnected'}
                  </span>
                )}
              </div>

              {connected && (
                <>
                  <Button
                    onClick={() => handleSync(platform)}
                    disabled={!!syncing}
                    size="sm"
                    className="w-full gap-2 rounded-lg text-xs h-9"
                  >
                    {syncingNow ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {syncingNow
                      ? (lang === 'ar' ? 'جاري المزامنة...' : 'Syncing...')
                      : (lang === 'ar' ? 'مزامنة المخزون' : 'Sync Stock')}
                  </Button>

                  {result && (
                    <div className="mt-3 space-y-1 text-[11px]">
                      <div className="flex items-center gap-1.5 text-green-600">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>{lang === 'ar' ? 'تم التحديث:' : 'Updated:'} {result.updated}</span>
                      </div>
                      {result.failed > 0 && (
                        <div className="flex items-center gap-1.5 text-red-600">
                          <XCircle className="h-3 w-3" />
                          <span>{lang === 'ar' ? 'فشل:' : 'Failed:'} {result.failed}</span>
                        </div>
                      )}
                      {result.skipped > 0 && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <AlertTriangle className="h-3 w-3" />
                          <span>{lang === 'ar' ? 'تخطي:' : 'Skipped:'} {result.skipped}</span>
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {lang === 'ar' ? 'إجمالي:' : 'Total:'} {result.total}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* History */}
      <div>
        <h3 className="text-sm font-bold text-muted-foreground mb-3">
          {lang === 'ar' ? 'سجل المزامنة' : 'Sync History'}
        </h3>
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground italic">
            {lang === 'ar' ? 'لا يوجد سجل مزامنة بعد' : 'No sync history yet'}
          </div>
        ) : (
          <div className="space-y-2">
            {history.map((h: any) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border p-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className={cn(
                    'px-2 py-0.5 rounded text-[10px] font-bold',
                    PLATFORM_INFO[h.direction?.split('_')[0] as Platform]?.color || 'bg-muted text-muted-foreground'
                  )}>
                    {h.direction?.split('_')[0]?.toUpperCase() || '—'}
                  </span>
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                    h.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' :
                    h.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30',
                  )}>
                    {h.status === 'completed' ? (lang === 'ar' ? 'مكتمل' : 'Completed') :
                     h.status === 'failed' ? (lang === 'ar' ? 'فشل' : 'Failed') :
                     h.status === 'running' ? (lang === 'ar' ? 'قيد التشغيل' : 'Running') :
                     (lang === 'ar' ? 'معلق' : 'Pending')}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {new Date(h.created_at).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
