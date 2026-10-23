'use client'

import {
  Store, ExternalLink, Mail, Calendar, Hash, RefreshCw,
  User, AlertCircle, Globe, CheckCircle2, Wrench,
  Plus, ChevronLeft, ChevronRight
} from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'

import { getZidWebhookHealth, recoverZidBrokenWebhooks } from '@/app/actions/workspaces'
import { Button, buttonVariants } from '@/components/ui/button'
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
  zidTokens?: any[]
  sallaTokens?: any[]
  shopifyTokens?: any[]
  installUrl: string
  sallaInstallUrl?: string
  lang: Language
  dir: 'rtl' | 'ltr'
  // Detail route (/app/connect-store/<platform>/<slug>): the store is opened
  // as its own page instead of a view toggled inside the list.
  initialPlatform?: string
  initialSlug?: string
}

interface ConnectedRow {
  platform: string
  key: string
  token: any
  name: string
  code: string
}

const storeKeyFor = (platform: string, tk: any): string =>
  platform === 'shopify' ? String(tk?.shop_domain ?? '') : String(tk?.merchant_id ?? '')

// URL slug for a store key. Zid/Salla merchant ids are already URL-safe; a
// Shopify shop domain contains dots, and a path segment ending in ".com" would
// be skipped by the middleware matcher (it excludes static-file paths), so
// dots become dashes. "a.b.myshopify.com" is never a real shop domain, so the
// mapping stays collision-free in practice.
const storeSlugFor = (platform: string, key: string): string =>
  platform === 'shopify' ? key.replace(/\./g, '-') : key

const storeSlugMatches = (platform: string, tk: any, slug: string): boolean =>
  storeSlugFor(platform, storeKeyFor(platform, tk)) === slug

const storeDetailHref = (platform: string, key: string): string =>
  `/app/connect-store/${platform}/${encodeURIComponent(storeSlugFor(platform, key))}`

export default function StoreSelector({ zidTokens = [], sallaTokens = [], shopifyTokens = [], installUrl, sallaInstallUrl, lang, dir, initialPlatform, initialSlug }: StoreSelectorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('description')
  const success = searchParams.get('success')
  // Odoo-style single screen: only one of list / connect-form / details is
  // visible at a time — never stacked together.
  const isDetailRoute = Boolean(initialPlatform && initialSlug)
  const [view, setView] = useState<'list' | 'connect' | 'details'>(isDetailRoute ? 'details' : 'list')
  // On a detail route the opened store comes from the URL, so it survives a
  // refresh, a shared link and the browser's own history.
  const detail = isDetailRoute ? { platform: initialPlatform as string, slug: initialSlug as string } : null
  const [connectPlatform, setConnectPlatform] = useState<string>('zid')

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

  const selectedPlatform = stores.find(s => s.id === connectPlatform)

  const tokensFor = (platform: string): any[] =>
    platform === 'zid' ? zidTokens : platform === 'salla' ? sallaTokens : shopifyTokens

  // Basic row data: store name + merchant code, e.g. Demo(403476178).
  const displayFor = (platform: string, tk: any): { name: string; code: string } => {
    if (platform === 'zid') return { name: tk?.name || (lang === 'ar' ? 'زد' : 'Zid'), code: tk?.merchant_id ? String(tk.merchant_id) : '' }
    if (platform === 'salla') return { name: tk?.store_name || tk?.name || (lang === 'ar' ? 'سلة' : 'Salla'), code: tk?.merchant_id ? String(tk.merchant_id) : '' }
    return { name: tk?.name || (lang === 'ar' ? 'شوبيفاي' : 'Shopify'), code: tk?.shop_domain || '' }
  }

  // Multi-store: one row per connected STORE (a platform may appear several
  // times). Lists arrive newest-first from the server.
  const connectedRows: ConnectedRow[] = stores.flatMap(store =>
    tokensFor(store.id).map(tk => {
      const { name, code } = displayFor(store.id, tk)
      return { platform: store.id, key: storeKeyFor(store.id, tk), token: tk, name, code }
    })
  )

  const openDetails = (platform: string, key: string) => {
    router.push(storeDetailHref(platform, key))
  }

  const detailToken = detail?.platform && stores.some(s => s.id === detail.platform)
    ? tokensFor(detail.platform).find(tk => storeSlugMatches(detail.platform, tk, detail.slug)) ?? null
    : null

  // After an OAuth redirect (?success=salla_connected …) jump straight to
  // that platform's newest store instead of leaving the user on the list.
  useEffect(() => {
    if (!success) return
    const id = success === 'salla_connected' ? 'salla' : success === 'shopify_connected' ? 'shopify' : 'zid'
    const rows = tokensFor(id)
    if (rows.length > 0) {
      router.replace(storeDetailHref(id, storeKeyFor(id, rows[0])))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success])

  const BackButton = (
    <button
      type="button"
      onClick={() => (isDetailRoute ? router.push('/app/connect-store') : setView('list'))}
      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
    >
      {dir === 'rtl' ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      <span>{lang === 'ar' ? 'رجوع' : 'Back'}</span>
    </button>
  )

  return (
    <div className="space-y-5" dir={dir}>
      {error && (
        <div className="flex items-start gap-3 border border-destructive/25 bg-destructive/[0.05] p-3">
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
        <div className="flex items-start gap-3 border border-primary/25 bg-primary/[0.06] p-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-xs text-primary">
              {lang === 'ar' ? 'تم ربط المتجر بنجاح' : 'Store Connected'}
            </p>
            <p className="text-[11px] text-primary/80 mt-0.5">
              {getSuccessMessage(success)}
            </p>
          </div>
        </div>
      )}

      {/* ── List View: connected stores ─────────────────────────── */}
      {view === 'list' && (
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-foreground">{t('connect.selectStore')}</span>
            <span className="text-[11px] text-muted-foreground">
              {lang === 'ar' ? `${connectedRows.length} متاجر متصلة` : `${connectedRows.length} connected stores`}
            </span>
          </div>
          <Button
            type="button"
            variant="brand"
            size="sm"
            onClick={() => setView('connect')}
            className="h-7 text-[11px] gap-1"
          >
            <Plus className="h-3 w-3" />
            <span>{lang === 'ar' ? 'إضافة متجر' : 'Add store'}</span>
          </Button>
        </div>

        {connectedRows.length > 0 ? (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'المتجر' : 'Store'}</th>
              <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'معرف التاجر' : 'Merchant ID'}</th>
              <th className="px-3 py-2 text-start font-medium">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
              <th className="px-3 py-2 text-end font-medium w-10" />
            </tr>
          </thead>
          <tbody>
            {connectedRows.map((row) => {
              const StoreIcon = stores.find(s => s.id === row.platform)?.logo ?? Store

              return (
                <tr
                  key={`${row.platform}:${row.key}`}
                  onClick={() => openDetails(row.platform, row.key)}
                  className="border-b border-border/50 last:border-b-0 cursor-pointer transition-colors hover:bg-muted/30"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <StoreIcon />
                      <span className="text-foreground" dir="auto">{row.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-muted-foreground" dir="ltr">{row.code || '—'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      <span className="text-foreground">{t('connect.connected')}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <span className="inline-flex text-muted-foreground">
                      {dir === 'rtl' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        ) : (
        <div className="p-5 flex flex-col sm:flex-row items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-primary/25 bg-primary/5 text-primary">
            <Store className="h-5 w-5" />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{lang === 'ar' ? 'لا يوجد متجر متصل' : 'No store connected'}</h2>
              <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                {lang === 'ar'
                  ? 'اضغط على إضافة متجر واختر منصتك لإتمام الربط — المزامنة تعمل تلقائياً بعد الموافقة.'
                  : 'Click Add store, pick your platform and approve — sync runs automatically afterwards.'}
              </p>
            </div>
            <Button type="button" variant="brand" size="sm" onClick={() => setView('connect')} className="h-8 text-[11px] gap-1.5">
              <Plus className="h-3 w-3" />
              <span>{lang === 'ar' ? 'إضافة متجر' : 'Add store'}</span>
            </Button>
          </div>
        </div>
        )}
      </div>
      )}

      {/* ── Connect View: pick a platform + connect ─────────────── */}
      {view === 'connect' && (
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-muted/30">
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
            <Store className="h-3.5 w-3.5 text-muted-foreground" />
            {lang === 'ar' ? 'إضافة متجر' : 'Add store'}
          </div>
          {BackButton}
        </div>

        <div className="p-4 space-y-4 max-w-xl">
          <div className="space-y-1.5">
            <label className="block text-[11px] font-bold text-muted-foreground">
              {lang === 'ar' ? 'اختر المتجر' : 'Choose store'}
            </label>
            <select
              value={connectPlatform}
              onChange={e => setConnectPlatform(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/25 outline-none transition-all"
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{tokensFor(s.id).length > 0 ? (lang === 'ar' ? ` (متصل: ${tokensFor(s.id).length})` : ` (connected: ${tokensFor(s.id).length})`) : ''}
                </option>
              ))}
            </select>
          </div>

          {connectPlatform === 'shopify' ? (
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {lang === 'ar'
                  ? 'أدخل نطاق متجرك على شوبيفاي ثم اضغط ربط للموافقة على الصلاحيات.'
                  : 'Enter your Shopify shop domain, then click Connect to approve permissions.'}
              </p>
              <form action="/api/shopify/connect" method="GET" className="flex flex-col sm:flex-row gap-2">
                <input type="text" name="shop" placeholder="store-name.myshopify.com" required
                  className="flex h-9 w-full rounded-lg border border-border bg-background px-3 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
                <Button type="submit" variant="outline" size="sm" className="h-9 text-[11px] gap-1.5 shrink-0">
                  <ExternalLink className="h-3 w-3" />
                  <span>{lang === 'ar' ? 'اتصال' : 'Connect'}</span>
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {selectedPlatform && <selectedPlatform.logo />}
                <span className="text-sm font-semibold text-foreground">{selectedPlatform?.name}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {lang === 'ar'
                  ? `اربط متجرك على ${selectedPlatform?.name} لتتمكن من مزامنة المنتجات، المخزون، والطلبات تلقائياً مع نظام ERP. بعد الضغط على الاتصال يتم تلقائياً: تسجيل التنبيهات الأساسية + تفعيل المزامنة — بلا أي إعداد يدوي.`
                  : `Connect your store on ${selectedPlatform?.name} to automatically sync products, stock, and orders with your ERP system. After clicking connect, everything is automatic: core webhooks + sync turn on with zero manual setup.`}
              </p>
              <div className="p-2.5 border border-border bg-muted/30">
                <div className="text-[10px] text-muted-foreground mb-1">{t('zid.redirectUrl')}</div>
                <code className="font-mono text-[10px] text-foreground/80 break-all">
                  {connectPlatform === 'salla' ? sallaInstallUrl : installUrl}
                </code>
              </div>
              <a href={connectPlatform === 'salla' ? '/api/salla/connect' : '/api/zid/connect'}
                 className={cn(buttonVariants({ variant: 'brand' }), 'h-9 gap-1.5 px-3 text-[11px]')}>
                <ExternalLink className="h-3 w-3" />
                {lang === 'ar' ? 'اتصال' : 'Connect'}
              </a>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Details View: one connected store, standalone ──────────── */}
      {view === 'details' && detail && !detailToken && (
      <div className="border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1 space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">
              {lang === 'ar' ? 'المتجر غير متصل' : 'Store not connected'}
            </h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {lang === 'ar'
                ? 'هذا المتجر غير مرتبط بمساحة العمل الحالية أو تم فصله. أعد ربطه للمتابعة.'
                : 'This store is not linked to the current workspace or was disconnected. Reconnect it to continue.'}
            </p>
            <div className="pt-1">{BackButton}</div>
          </div>
        </div>
      </div>
      )}

      {view === 'details' && detail && detailToken && (
      <div className="border border-border bg-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 bg-muted/30">
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground min-w-0">
            {(() => {
              const meta = stores.find(s => s.id === detail.platform)
              const StoreIcon = meta?.logo ?? Store
              const display = displayFor(detail.platform, detailToken)
              return (
                <>
                  <StoreIcon />
                  <span className="truncate" dir="auto">{display.name}</span>
                  {display.code && <span className="font-mono text-[10px] text-muted-foreground" dir="ltr">({display.code})</span>}
                  <span className="inline-flex items-center gap-1 text-[10px] text-foreground/70 shrink-0">
                    <span className="h-1 w-1 rounded-full bg-primary" />
                    {t('connect.connected')}
                  </span>
                </>
              )
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-1 shrink-0">
            <WebhookStatusPill
              platform={detail.platform}
              merchantId={detail.platform === 'zid' ? String(detailToken.merchant_id ?? '') : ''}
              reconnectHref={detail.platform === 'salla' ? '/api/salla/connect' : '/api/zid/connect'}
              lang={lang}
            />
            {BackButton}
            {detail.platform === 'zid' && (
              <>
                <a href="/api/zid/connect"
                   className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors">
                  <RefreshCw className="h-3 w-3" />
                  {t('zid.reconnect')}
                </a>
                <DisconnectButton
                  merchantId={String(detailToken.merchant_id)}
                  confirmText={t('zid.disconnectConfirm')}
                  buttonText={t('zid.disconnect')}
                  onDone={() => router.push('/app/connect-store')}
                />
              </>
            )}
            {detail.platform === 'salla' && (
              <>
                <a href="/api/salla/connect"
                   className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 h-7 text-[11px] text-foreground/70 hover:text-foreground hover:bg-muted transition-colors">
                  <RefreshCw className="h-3 w-3" />
                  {t('zid.reconnect')}
                </a>
                <DisconnectButton
                  merchantId={String(detailToken.merchant_id)}
                  confirmText={lang === 'ar' ? 'هل أنت متأكد من رغبتك في إلغاء ربط متجر سلة؟' : 'Are you sure you want to disconnect Salla store?'}
                  buttonText={t('zid.disconnect')}
                  platform="salla"
                  onDone={() => router.push('/app/connect-store')}
                />
              </>
            )}
            {detail.platform === 'shopify' && (
              <DisconnectButton
                merchantId={detailToken.shop_domain}
                confirmText={lang === 'ar' ? 'هل أنت متأكد من رغبتك في إلغاء ربط متجر شوبيفاي؟' : 'Are you sure you want to disconnect Shopify store?'}
                buttonText={t('zid.disconnect')}
                platform="shopify"
                onDone={() => router.push('/app/connect-store')}
              />
            )}
          </div>
        </div>

        {detail.platform === 'zid' && <ConnectedContent token={detailToken} lang={lang} t={t} formatDate={formatDate} />}
        {detail.platform === 'salla' && <ConnectedSallaContent token={detailToken} lang={lang} t={t} formatDate={formatDate} />}
        {detail.platform === 'shopify' && <ConnectedShopifyContent token={detailToken} lang={lang} t={t} formatDate={formatDate} />}
      </div>
      )}
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
 * Inline webhook-health pill shown in the store-detail header, next to Back.
 * Quiet by design: a dot plus one short line. It only grows a control when
 * something is actually wrong — repair when webhooks are broken, reconnect
 * when the check itself fails (expired credential, API unreachable).
 * Non-blocking: a failed check never breaks the page.
 */
function WebhookStatusPill({
  platform,
  merchantId,
  reconnectHref,
  lang,
}: {
  platform: string
  merchantId: string
  reconnectHref: string
  lang: string
}) {
  const isZid = platform === 'zid'
  const canCheck = isZid && Boolean(merchantId)
  const [state, setState] = useState<'loading' | 'ok' | 'broken' | 'error'>('loading')
  const [counts, setCounts] = useState<{ healthy: number | null; broken: number; degraded: number }>({ healthy: null, broken: 0, degraded: 0 })
  const [reason, setReason] = useState<string | null>(null)
  const [repairing, setRepairing] = useState(false)

  const check = useCallback(() => {
    if (!canCheck) return
    setState('loading')
    getZidWebhookHealth(merchantId)
      .then((res: any) => {
        if (!res?.success) {
          setReason(res?.error || null)
          setState('error')
          return
        }
        const stats = res.health?.data ?? res.health
        const broken = typeof stats?.broken === 'number' ? stats.broken : 0
        const degraded = typeof stats?.degraded === 'number' ? stats.degraded : 0
        const healthy = typeof stats?.healthy === 'number' ? stats.healthy : null
        setCounts({ healthy, broken, degraded })
        setReason(null)
        setState(broken === 0 && degraded === 0 ? 'ok' : 'broken')
      })
      .catch((err: any) => {
        setReason(err?.message || null)
        setState('error')
      })
  }, [canCheck, merchantId])

  useEffect(() => {
    check()
  }, [check])

  const handleRecover = async () => {
    setRepairing(true)
    const res = await recoverZidBrokenWebhooks(merchantId)
    setRepairing(false)
    if (res.success) check()
    else setReason((res as any).error || null)
  }

  // Salla/Shopify expose no health endpoint — state only what is actually known.
  if (!isZid) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.06] px-2 h-7 text-[10px] font-medium text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {lang === 'ar' ? 'المتجر متصل' : 'Connected'}
      </span>
    )
  }

  if (!merchantId) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/[0.06] px-2 h-7 text-[10px] font-medium text-amber-600">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{lang === 'ar' ? 'بيانات المتجر غير مكتملة' : 'Store data incomplete'}</span>
        </span>
        <a
          href={reconnectHref}
          className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-background px-2 h-7 text-[10px] font-medium text-amber-600 hover:bg-amber-500/[0.06] transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          <span>{lang === 'ar' ? 'إعادة الاتصال' : 'Reconnect'}</span>
        </a>
      </span>
    )
  }

  const pillClass =
    'inline-flex items-center gap-1.5 rounded-full border px-2 h-7 text-[10px] font-medium max-w-[210px]'

  if (state === 'loading') {
    return (
      <span className={cn(pillClass, 'border-border bg-muted/40 text-muted-foreground')}>
        <RefreshCw className="h-3 w-3 shrink-0 animate-spin" />
        <span className="truncate">{lang === 'ar' ? 'جارٍ فحص التنبيهات…' : 'Checking webhooks…'}</span>
      </span>
    )
  }

  if (state === 'ok') {
    return (
      <button
        type="button"
        onClick={check}
        title={
          counts.healthy !== null
            ? lang === 'ar'
              ? `${counts.healthy} تنبيهات مفعّلة — اضغط لإعادة الفحص`
              : `${counts.healthy} active webhooks — click to re-check`
            : lang === 'ar' ? 'اضغط لإعادة الفحص' : 'Click to re-check'
        }
        className={cn(pillClass, 'border-primary/20 bg-primary/[0.06] text-primary hover:bg-primary/10 transition-colors')}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        <span className="truncate">{lang === 'ar' ? 'التنبيهات تعمل' : 'Webhooks healthy'}</span>
      </button>
    )
  }

  if (state === 'broken') {
    const label = counts.broken > 0
      ? lang === 'ar' ? `${counts.broken} تنبيهات معطّلة` : `${counts.broken} broken webhooks`
      : lang === 'ar' ? `${counts.degraded} تنبيهات متأخرة` : `${counts.degraded} degraded webhooks`
    return (
      <span className="inline-flex items-center gap-1">
        <span className={cn(pillClass, 'border-destructive/25 bg-destructive/[0.05] text-destructive')} title={label}>
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <button
          type="button"
          onClick={handleRecover}
          disabled={repairing}
          className="inline-flex items-center gap-1 rounded-full border border-destructive/25 bg-background px-2 h-7 text-[10px] font-medium text-destructive hover:bg-destructive/[0.06] transition-colors disabled:opacity-50"
        >
          <Wrench className={cn('h-3 w-3', repairing && 'animate-pulse')} />
          <span>{repairing ? (lang === 'ar' ? 'جارٍ الإصلاح…' : 'Repairing…') : (lang === 'ar' ? 'إصلاح' : 'Repair')}</span>
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(pillClass, 'border-amber-500/30 bg-amber-500/[0.06] text-amber-600')}
        title={reason || undefined}
      >
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {lang === 'ar' ? 'تعذّر التحقق من التنبيهات' : 'Webhook check failed'}
        </span>
      </span>
      <a
        href={reconnectHref}
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-background px-2 h-7 text-[10px] font-medium text-amber-600 hover:bg-amber-500/[0.06] transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        <span>{lang === 'ar' ? 'إعادة الاتصال' : 'Reconnect'}</span>
      </a>
    </span>
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


