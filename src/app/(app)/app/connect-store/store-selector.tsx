'use client'

import {
  Store, ExternalLink, Mail, Calendar, Hash, RefreshCw,
  User, AlertCircle, Globe, Check, CheckCircle2, Activity, Wrench
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'

import { getZidWebhookHealth, recoverZidBrokenWebhooks } from '@/app/actions/workspaces'
import { Button } from '@/components/ui/button'
import type { Language } from '@/lib/translations'
import { translations } from '@/lib/translations'
import { cn } from '@/lib/utils'

import DisconnectButton from './disconnect-button'
import SallaSyncSettingsTable from './salla-sync-settings'
import ShopifySyncSettingsTable from './shopify-sync-settings'
import SyncSettingsTable from './sync-settings'

const ZidLogo = () => (
  <svg className="h-4 w-4" viewBox="0 0 100 100" fill="currentColor">
    <path d="M20,35 L80,35 L70,85 L30,85 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M35,35 Q50,10 65,35" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    <circle cx="50" cy="55" r="8" fill="currentColor" />
  </svg>
)

const SallaLogo = () => (
  <svg className="h-4 w-4" viewBox="0 0 100 100" fill="currentColor">
    <path d="M15,40 L85,40 Q90,65 80,85 L20,85 Q10,65 15,40 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M30,40 L30,20 Q50,5 70,20 L70,40" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="50" y1="40" x2="50" y2="85" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
  </svg>
)

const ShopifyLogo = () => (
  <svg className="h-4 w-4" viewBox="0 0 100 100" fill="currentColor">
    <path d="M25,30 L75,30 L85,90 L15,90 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M40,30 C40,15 60,15 60,30" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    <path d="M40,50 C40,45 60,45 60,55 C60,65 40,65 40,60" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
  </svg>
)

interface StoreSelectorProps {
  token: any
  sallaToken?: any
  shopifyToken?: any
  installUrl: string
  sallaInstallUrl?: string
  lang: Language
  dir: 'rtl' | 'ltr'
}

const isStoreConnected = (storeId: string, token: any, sallaToken: any, shopifyToken: any) => {
  if (storeId === 'zid') return !!token
  if (storeId === 'salla') return !!sallaToken
  if (storeId === 'shopify') return !!shopifyToken
  return null
}

export default function StoreSelector({ token, sallaToken, shopifyToken, installUrl, sallaInstallUrl, lang, dir }: StoreSelectorProps) {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('description')
  const success = searchParams.get('success')
  const [selectedStore, setSelectedStore] = useState<string>('zid')

  const getSuccessMessage = (s: string) => {
    const platformName = s === 'salla_connected' ? (lang === 'ar' ? 'سلة' : 'Salla')
      : s === 'shopify_connected' ? (lang === 'ar' ? 'شوبيفاي' : 'Shopify')
      : (lang === 'ar' ? 'زد' : 'Zid')
    return lang === 'ar'
      ? `تم ربط متجر ${platformName} بنجاح!`
      : `${platformName} store connected successfully!`
  }

  const getErrorMessage = (err: string) => {
    switch (err) {
      case 'access_denied':
      case 'salla_denied':
        return lang === 'ar'
          ? 'تم رفض الصلاحيات من قبل المستخدم أو متجر سلة. يرجى الموافقة على الصلاحيات لتتمكن من الربط.'
          : 'Authorization was denied by the user or Salla store. Please approve the permissions to connect.'
      case 'invalid_client':
        return lang === 'ar'
          ? 'بيانات اعتماد التطبيق غير صالحة (Client ID/Secret).'
          : 'Invalid client credentials (Client ID/Secret).'
      case 'redirect_uri_mismatch':
        return lang === 'ar'
          ? 'رابط إعادة التوجيه المسجل في سلة لا يطابق هذا الرابط.'
          : 'Redirect URI mismatch on Salla Developer Portal.'
      case 'invalid_scope':
        return lang === 'ar'
          ? 'الصلاحيات المطلوبة غير صالحة أو غير مصرح بها لهذا التطبيق.'
          : 'Requested scopes are invalid or unauthorized for this app.'
      default:
        return errorDescription || (lang === 'ar' ? `حدث خطأ أثناء الربط: ${err}` : `An error occurred during connection: ${err}`)
    }
  }

  const t = (key: string) => {
    return (translations[lang] as any)[key] || (translations['ar'] as any)[key] || key
  }

  const formatDate = (dateStr: string | Date) => {
    try {
      return new Date(dateStr).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    } catch { return String(dateStr) }
  }

  const stores = [
    { id: 'zid', name: lang === 'ar' ? 'زد' : 'Zid', logo: ZidLogo, isActive: true },
    { id: 'salla', name: lang === 'ar' ? 'سلة' : 'Salla', logo: SallaLogo, isActive: true },
    { id: 'shopify', name: lang === 'ar' ? 'شوبيفاي' : 'Shopify', logo: ShopifyLogo, isActive: true },
  ]

  const selectedPlatform = stores.find(s => s.id === selectedStore)

  return (
    <div className="space-y-5" dir={dir}>
      {error && (
        <div className="flex items-start gap-3 border border-border bg-card p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-xs text-foreground">
              {lang === 'ar' ? 'فشل الاتصال بالمنصة' : 'Connection Failed'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {getErrorMessage(error)}
            </p>
          </div>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-3 border border-emerald-200 bg-emerald-50 p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
          <div>
            <p className="font-medium text-xs text-emerald-800">
              {lang === 'ar' ? 'تم ربط المتجر بنجاح' : 'Store Connected'}
            </p>
            <p className="text-[11px] text-emerald-700 mt-0.5">
              {getSuccessMessage(success)}
            </p>
          </div>
        </div>
      )}

      {/* Platform ListView Table */}
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-foreground">{t('connect.selectStore')}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{stores.filter(s => isStoreConnected(s.id, token, sallaToken, shopifyToken)).length} / {stores.length} connected</span>
          </div>
        </div>

        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-3 py-2 text-start font-medium w-8">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'المنصة' : 'Platform'}</th>
              <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
              <th className="px-3 py-2 text-end font-medium w-10" />
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => {
              const StoreIcon = store.logo
              const connected = isStoreConnected(store.id, token, sallaToken, shopifyToken)
              const isSelected = selectedStore === store.id
              const statusTxt = connected ? t('connect.connected')
                : store.isActive ? t('connect.active')
                : t('connect.comingSoon')

              return (
                <tr
                  key={store.id}
                  onClick={() => setSelectedStore(store.id)}
                  className={cn(
                    "border-b border-border/50 cursor-pointer transition-colors",
                    isSelected ? "bg-muted/50" : "hover:bg-muted/30"
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center">
                      <div className={cn(
                        "h-3.5 w-3.5 rounded border transition-colors",
                        isSelected ? "border-foreground bg-foreground" : "border-border"
                      )}>
                        {isSelected && <Check className="h-3.5 w-3.5 text-background" strokeWidth={3} />}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <StoreIcon />
                      <span className="text-foreground">{store.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        connected === true ? "bg-foreground" : connected === false && store.isActive ? "bg-muted-foreground/50" : "bg-muted-foreground/30"
                      )} />
                      <span className={cn(
                        "text-muted-foreground",
                        connected === true && "text-foreground"
                      )}>{statusTxt}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <span className="text-[10px] text-muted-foreground">{isSelected ? '✓' : ''}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Detail Panel */}
      <div className="border border-border bg-card overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-muted/30">
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
            {selectedPlatform && <selectedPlatform.logo />}
            {selectedPlatform?.name}
            {isStoreConnected(selectedStore, token, sallaToken, shopifyToken) && (
              <span className="inline-flex items-center gap-1 text-[10px] text-foreground/70">
                <span className="h-1 w-1 rounded-full bg-foreground" />
                {t('zid.activeStatus')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {selectedStore === 'zid' && isStoreConnected('zid', token, sallaToken, shopifyToken) && (
              <>
                <a href="/api/zid/connect"
                   className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors">
                  <RefreshCw className="h-3 w-3" />
                  {t('zid.reconnect')}
                </a>
                <DisconnectButton
                  merchantId={token.merchant_id}
                  confirmText={t('zid.disconnectConfirm')}
                  buttonText={t('zid.disconnect')}
                />
              </>
            )}
            {selectedStore === 'salla' && isStoreConnected('salla', token, sallaToken, shopifyToken) && (
              <>
                <a href="/api/salla/connect"
                   className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors">
                  <RefreshCw className="h-3 w-3" />
                  {t('zid.reconnect')}
                </a>
                <DisconnectButton
                  merchantId={sallaToken.merchant_id}
                  confirmText={lang === 'ar' ? 'هل أنت متأكد من رغبتك في إلغاء ربط متجر سلة؟' : 'Are you sure you want to disconnect Salla store?'}
                  buttonText={t('zid.disconnect')}
                  platform="salla"
                />
              </>
            )}
            {selectedStore === 'shopify' && isStoreConnected('shopify', token, sallaToken, shopifyToken) && (
              <DisconnectButton
                merchantId={shopifyToken.shop_domain}
                confirmText={lang === 'ar' ? 'هل أنت متأكد من رغبتك في إلغاء ربط متجر شوبيفاي؟' : 'Are you sure you want to disconnect Shopify store?'}
                buttonText={t('zid.disconnect')}
                platform="shopify"
              />
            )}
          </div>
        </div>

        {/* Content */}
        {selectedStore === 'zid' ? (
          token ? <ConnectedContent token={token} lang={lang} t={t} formatDate={formatDate} /> : <DisconnectedContent connectHref="/api/zid/connect" installUrl={installUrl} t={t} lang={lang} platformName="Zid" />
        ) : selectedStore === 'salla' ? (
          sallaToken ? <ConnectedSallaContent token={sallaToken} lang={lang} t={t} formatDate={formatDate} /> : <DisconnectedContent connectHref={sallaInstallUrl!} installUrl={sallaInstallUrl!} t={t} lang={lang} platformName="Salla" />
        ) : selectedStore === 'shopify' ? (
          shopifyToken ? <ConnectedShopifyContent token={shopifyToken} lang={lang} t={t} formatDate={formatDate} /> : <DisconnectedShopifyContent lang={lang} />
        ) : (
          <div className="p-5 text-[11px] text-muted-foreground">
            {lang === 'ar' ? 'يرجى اختيار منصة للربط.' : 'Please select a platform to connect.'}
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────── */

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <span className="font-mono text-[11px] text-foreground text-start break-all" dir="ltr">{value}</span>
    </div>
  )
}

/**
 * Webhook health-summary panel (P2): يعرض حالة webhooks زد مع زر recoverBroken.
 * Non-blocking — يفشل بصمت لو تعذر جلب الصحة حتى لا يكسر صفحة الربط.
 */
function ZidWebhookHealthPanel({ merchantId, lang }: { merchantId: string; lang: string }) {
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const fetchHealth = useCallback(() => {
    setLoading(true)
    getZidWebhookHealth(merchantId)
      .then((res: any) => {
        if (res?.success) setHealth(res.health)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [merchantId])

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  const handleRecover = async () => {
    setRecovering(true)
    setMsg(null)
    const res = await recoverZidBrokenWebhooks(merchantId)
    setRecovering(false)
    if (res.success) {
      setMsg(lang === 'ar' ? 'تمت محاولة إصلاح الـ Webhooks وإعادة تفعيلها.' : 'Webhooks recovery attempted successfully.')
      fetchHealth()
    } else {
      setMsg((res as any).error || (lang === 'ar' ? 'فشل الإصلاح.' : 'Recovery failed.'))
    }
  }

  const stats = health?.data ?? health
  const healthyCount = typeof stats?.healthy === 'number' ? stats.healthy : null
  const brokenCount = typeof stats?.broken === 'number' ? stats.broken : 0
  const degradedCount = typeof stats?.degraded === 'number' ? stats.degraded : 0
  const hasLoaded = health !== null && !loading

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'صحة التنبيهات (Webhooks)' : 'Webhook Health'}</span>
        </div>
        <button
          type="button"
          onClick={fetchHealth}
          disabled={loading || recovering}
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title={lang === 'ar' ? 'تحديث الفحص' : 'Refresh'}
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          <span>{lang === 'ar' ? 'تحديث الفحص' : 'Refresh'}</span>
        </button>
      </div>

      <div className="mt-2.5">
        {loading && !health ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>{lang === 'ar' ? 'جارٍ فحص صحة التنبيهات مع زد…' : 'Checking webhook health with Zid…'}</span>
          </div>
        ) : hasLoaded && healthyCount !== null ? (
          brokenCount === 0 && degradedCount === 0 ? (
            <div className="flex items-center gap-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">
                  {lang === 'ar'
                    ? `جميع التنبيهات تعمل بنشاط وبشكل سليم (${healthyCount} تنبيهات مفعلة)`
                    : `All webhooks are active and healthy (${healthyCount} active)`}
                </p>
                <p className="text-[10px] opacity-80 mt-0.5">
                  {lang === 'ar'
                    ? 'الأحداث تصل للمنصة فورياً وتُعالج في الخلفية بدون أي تنبيهات معطلة.'
                    : 'Events are being received and processed with 0 broken webhooks.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-md bg-rose-500/10 border border-rose-500/20 p-2.5 text-rose-700 dark:text-rose-400">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="text-xs font-semibold">
                  {lang === 'ar'
                    ? `يوجد ${brokenCount} تنبيهات معطلة بحاجة لإصلاح`
                    : `${brokenCount} broken webhooks detected`}
                </span>
              </div>
              <button
                type="button"
                onClick={handleRecover}
                disabled={recovering}
                className="inline-flex items-center justify-center gap-1.5 rounded bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 transition-colors disabled:opacity-50 shrink-0"
              >
                <Wrench className="h-3 w-3" />
                <span>{recovering ? (lang === 'ar' ? 'جارٍ الإصلاح…' : 'Repairing…') : (lang === 'ar' ? 'إصلاح المعطلة' : 'Repair Now')}</span>
              </button>
            </div>
          )
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="text-xs font-semibold">
              {lang === 'ar' ? 'الربط نشط والتنبيهات تعمل بشكل طبيعي.' : 'Connection active and webhooks working normally.'}
            </span>
          </div>
        )}
      </div>

      {msg && <div className="mt-2 text-[11px] text-foreground/80 font-medium">{msg}</div>}
    </div>
  )
}

function ConnectedContent({ token, lang, t, formatDate }: any) {
  return (
    <div className="p-4">
      <div className="text-xs font-medium text-foreground mb-3">
        {lang === 'ar' ? 'معلومات المتجر' : 'Store Information'}
      </div>
      <DetailRow icon={Hash} label={t('zid.merchantId')} value={token.merchant_id} />
      <DetailRow icon={Hash} label={t('zid.storeId')} value={token.store_id || '—'} />
      <DetailRow icon={Mail} label={t('zid.merchantEmail')} value={token.email || '—'} />
      <DetailRow icon={User} label={t('zid.merchantUsername')} value={token.username || '—'} />
      <DetailRow icon={Calendar} label={t('zid.lastUpdated')} value={formatDate(token.updated_at)} />
      <ZidWebhookHealthPanel merchantId={token.merchant_id} lang={lang} />
      <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground leading-relaxed">
        {t('sync.coreOn')}
      </div>
      <details className="mt-2 border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-foreground/80 hover:bg-muted/50">
          {t('sync.advancedTitle')}
        </summary>
        <div className="border-t border-border p-3">
          <SyncSettingsTable merchantId={token.merchant_id} initialSettings={token.sync_settings} />
        </div>
      </details>
    </div>
  )
}

function ConnectedSallaContent({ token, lang, t, formatDate }: any) {
  return (
    <div className="p-4">
      <div className="text-xs font-medium text-foreground mb-3">
        {lang === 'ar' ? 'معلومات المتجر' : 'Store Information'}
      </div>
      <DetailRow icon={Hash} label={lang === 'ar' ? 'معرف التاجر' : 'Merchant ID'} value={token.merchant_id} />
      <DetailRow icon={Globe} label={lang === 'ar' ? 'اسم المستخدم للمتجر' : 'Store Username'} value={token.username || '—'} />
      <DetailRow icon={User} label={lang === 'ar' ? 'اسم التاجر' : 'Merchant Name'} value={token.name || '—'} />
      <DetailRow icon={Mail} label={t('zid.merchantEmail')} value={token.email || '—'} />
      <DetailRow icon={Calendar} label={t('zid.lastUpdated')} value={formatDate(token.updated_at)} />
      <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground leading-relaxed">
        {t('sync.coreOn')}
      </div>
      <details className="mt-2 border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-foreground/80 hover:bg-muted/50">
          {t('sync.advancedTitle')}
        </summary>
        <div className="border-t border-border p-3">
          <SallaSyncSettingsTable merchantId={token.merchant_id} initialSettings={token.sync_settings} />
        </div>
      </details>
    </div>
  )
}

function ConnectedShopifyContent({ token, lang, t, formatDate }: any) {
  return (
    <div className="p-4">
      <div className="text-xs font-medium text-foreground mb-3">
        {lang === 'ar' ? 'معلومات المتجر' : 'Store Information'}
      </div>
      <DetailRow icon={Hash} label={lang === 'ar' ? 'نطاق المتجر' : 'Shop Domain'} value={token.shop_domain} />
      <DetailRow icon={Mail} label={t('zid.merchantEmail')} value={token.email || '—'} />
      <DetailRow icon={Calendar} label={t('zid.lastUpdated')} value={formatDate(token.updated_at)} />
      <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground leading-relaxed">
        {t('sync.coreOn')}
      </div>
      <details className="mt-2 border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-foreground/80 hover:bg-muted/50">
          {t('sync.advancedTitle')}
        </summary>
        <div className="border-t border-border p-3">
          <ShopifySyncSettingsTable shopDomain={token.shop_domain} initialSettings={token.sync_settings} />
        </div>
      </details>
    </div>
  )
}

function DisconnectedContent({ connectHref, installUrl, t, lang, platformName }: { connectHref: string; installUrl: string; t: any; lang: string; platformName: string }) {
  return (
    <div className="p-5 flex flex-col sm:flex-row items-start gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded border border-border shrink-0">
        <Store className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{lang === 'ar' ? `ربط متجر ${platformName}` : `Connect ${platformName} Store`}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            {lang === 'ar'
              ? `اربط متجرك على ${platformName} لتتمكن من مزامنة المنتجات، المخزون، والطلبات تلقائياً مع نظام ERP.`
              : `Connect your store on ${platformName} to automatically sync products, stock, and orders with your ERP system.`}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
            {lang === 'ar'
              ? 'بعد الضغط على الربط يتم تلقائياً: تسجيل التنبيهات الأساسية + تفعيل المزامنة — بلا أي إعداد يدوي.'
              : 'After clicking connect, everything is automatic: core webhooks + sync turn on with zero manual setup.'}
          </p>
        </div>
        <div className="p-2.5 border border-border bg-muted/30">
          <div className="text-[10px] text-muted-foreground mb-1">{t('zid.redirectUrl')}</div>
          <code className="font-mono text-[10px] text-foreground/80 break-all">{installUrl}</code>
        </div>
        <a href={connectHref}
           className="inline-flex items-center gap-1.5 rounded border border-foreground/20 bg-background hover:bg-muted px-3 h-8 text-[11px] font-medium text-foreground transition-colors">
          <ExternalLink className="h-3 w-3" />
          {lang === 'ar' ? `ربط متجر ${platformName}` : `Connect ${platformName} Store`}
        </a>
      </div>
    </div>
  )
}

function DisconnectedShopifyContent({ lang }: { lang: string }) {
  return (
    <div className="p-5 flex flex-col sm:flex-row items-start gap-4">
      <div className="flex h-10 w-10 items-center justify-center rounded border border-border shrink-0">
        <Store className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="flex-1 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{lang === 'ar' ? 'ربط متجر شوبيفاي' : 'Connect Shopify Store'}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
            {lang === 'ar'
              ? 'اربط متجرك على شوبيفاي لتتمكن من مزامنة المنتجات، المخزون، والطلبات تلقائياً مع نظام ERP.'
              : 'Connect your store on Shopify to automatically sync products, stock, and orders with your ERP system.'}
          </p>
        </div>
        <form action="/api/shopify/connect" method="GET" className="flex flex-col sm:flex-row gap-2 max-w-md">
          <input type="text" name="shop" placeholder="store-name.myshopify.com" required
            className="flex h-8 w-full rounded border border-border bg-background px-3 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
          <Button type="submit" variant="outline" size="sm" className="h-8 text-[11px]">
            <ExternalLink className="h-3 w-3" />
            <span>{lang === 'ar' ? 'ربط' : 'Connect'}</span>
          </Button>
        </form>
      </div>
    </div>
  )
}


