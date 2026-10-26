'use client'

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Hash,
  Mail,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Store,
  Trash2,
  User,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { getZidWebhookHealth, recoverZidBrokenWebhooks } from '@/app/actions/workspaces'
import { Button, buttonVariants } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
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
    <path d="M30,40 L30,20 Q50,5 70,20 L70,40" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.9" />
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

const storeSlugFor = (platform: string, key: string): string =>
  platform === 'shopify' ? key.replace(/\./g, '-') : key

const storeSlugMatches = (platform: string, tk: any, slug: string): boolean =>
  storeSlugFor(platform, storeKeyFor(platform, tk)) === slug

const storeDetailHref = (platform: string, key: string): string =>
  `/app/connect-store/${platform}/${encodeURIComponent(storeSlugFor(platform, key))}`

function InfoField({
  label,
  children,
  mono = false,
  wide = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
  wide?: boolean
}) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className={cn('mt-1 break-all text-xs text-foreground', mono && 'font-mono')}>
        {children}
      </div>
    </div>
  )
}

function RowActions({
  row,
  isAr,
  onOpen,
  onReconnect,
}: {
  row: ConnectedRow
  isAr: boolean
  onOpen: () => void
  onReconnect: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onDocumentClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onDocumentClick)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onDocumentClick)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  return (
    <div className="relative flex justify-end" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={isAr ? 'إجراءات' : 'Actions'}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          onClick={(event) => event.stopPropagation()}
          className="absolute end-0 top-full z-50 mt-1 w-44 border border-border bg-card py-1 shadow-card"
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onOpen()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-start text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Store className="h-3.5 w-3.5" />
            <span className="truncate">{isAr ? 'عرض التفاصيل' : 'View Details'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onReconnect()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-start text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="truncate">{isAr ? 'إعادة الاتصال' : 'Reconnect'}</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default function StoreSelector({
  zidTokens = [],
  sallaTokens = [],
  shopifyTokens = [],
  installUrl,
  sallaInstallUrl,
  lang,
  dir,
  initialPlatform,
  initialSlug,
}: StoreSelectorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const ar = lang === 'ar'

  const error = searchParams.get('error')
  const errorDescription = searchParams.get('description')
  const success = searchParams.get('success')

  const isDetailRoute = Boolean(initialPlatform && initialSlug)
  const [view, setView] = useState<'list' | 'connect' | 'details'>(isDetailRoute ? 'details' : 'list')
  const detail = isDetailRoute ? { platform: initialPlatform as string, slug: initialSlug as string } : null
  const [connectPlatform, setConnectPlatform] = useState<string>('zid')
  const [copiedId, setCopiedId] = useState(false)

  const getSuccessMessage = (s: string) => {
    const platformName =
      s === 'salla_connected'
        ? ar
          ? 'سلة'
          : 'Salla'
        : s === 'shopify_connected'
          ? ar
            ? 'شوبيفاي'
            : 'Shopify'
          : ar
            ? 'زد'
            : 'Zid'
    return ar ? `تم ربط متجر ${platformName} بنجاح!` : `${platformName} store connected successfully!`
  }

  const getErrorMessage = (err: string) => {
    switch (err) {
      case 'access_denied':
      case 'salla_denied':
        return ar
          ? 'تم رفض الصلاحيات من قبل المستخدم أو متجر سلة. يرجى الموافقة على الصلاحيات لتتمكن من الربط.'
          : 'Authorization was denied by the user or Salla store. Please approve the permissions to connect.'
      case 'invalid_client':
        return ar
          ? 'بيانات اعتماد التطبيق غير صالحة (Client ID/Secret).'
          : 'Invalid client credentials (Client ID/Secret).'
      case 'redirect_uri_mismatch':
        return ar
          ? 'رابط إعادة التوجيه المسجل في سلة لا يطابق هذا الرابط.'
          : 'Redirect URI mismatch on Salla Developer Portal.'
      case 'invalid_scope':
        return ar
          ? 'الصلاحيات المطلوبة غير صالحة أو غير مصرح بها لهذا التطبيق.'
          : 'Requested scopes are invalid or unauthorized for this app.'
      default:
        return (
          errorDescription ||
          (ar ? `حدث خطأ أثناء الربط: ${err}` : `An error occurred during connection: ${err}`)
        )
    }
  }

  const t = (key: string) => {
    return (translations[lang] as any)[key] || (translations['ar'] as any)[key] || key
  }

  const formatDate = (dateStr: string | Date) => {
    if (!dateStr) return '—'
    try {
      const date = new Date(dateStr)
      if (Number.isNaN(date.getTime())) return '—'
      return date.toLocaleString(ar ? 'ar-EG' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return String(dateStr)
    }
  }

  const stores = [
    { id: 'zid', name: ar ? 'زد (Zid)' : 'Zid', logo: ZidLogo },
    { id: 'salla', name: ar ? 'سلة (Salla)' : 'Salla', logo: SallaLogo },
    { id: 'shopify', name: ar ? 'شوبيفاي (Shopify)' : 'Shopify', logo: ShopifyLogo },
  ]

  const selectedPlatform = stores.find((s) => s.id === connectPlatform)

  const tokensFor = (platform: string): any[] =>
    platform === 'zid' ? zidTokens : platform === 'salla' ? sallaTokens : shopifyTokens

  const displayFor = (platform: string, tk: any): { name: string; code: string } => {
    if (platform === 'zid')
      return {
        name: tk?.name || (ar ? 'متجر زد' : 'Zid Store'),
        code: tk?.merchant_id ? String(tk.merchant_id) : '',
      }
    if (platform === 'salla')
      return {
        name: tk?.store_name || tk?.name || (ar ? 'متجر سلة' : 'Salla Store'),
        code: tk?.merchant_id ? String(tk.merchant_id) : '',
      }
    return {
      name: tk?.name || (ar ? 'متجر شوبيفاي' : 'Shopify Store'),
      code: tk?.shop_domain || '',
    }
  }

  const connectedRows: ConnectedRow[] = stores.flatMap((store) =>
    tokensFor(store.id).map((tk) => {
      const { name, code } = displayFor(store.id, tk)
      return { platform: store.id, key: storeKeyFor(store.id, tk), token: tk, name, code }
    })
  )

  const openDetails = (platform: string, key: string) => {
    router.push(storeDetailHref(platform, key))
  }

  const detailToken =
    detail?.platform && stores.some((s) => s.id === detail.platform)
      ? tokensFor(detail.platform).find((tk) => storeSlugMatches(detail.platform, tk, detail.slug)) ??
        null
      : null

  useEffect(() => {
    if (!success) return
    const id = success === 'salla_connected' ? 'salla' : success === 'shopify_connected' ? 'shopify' : 'zid'
    const rows = tokensFor(id)
    if (rows.length > 0) {
      router.replace(storeDetailHref(id, storeKeyFor(id, rows[0])))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success])

  const copyStoreId = async (idText: string) => {
    try {
      await navigator.clipboard.writeText(idText)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    } catch {
      toast({
        title: ar ? 'تعذر النسخ' : 'Copy failed',
        description: ar ? 'المتصفح منع الوصول إلى الحافظة.' : 'The browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  const handleReconnect = (platform: string) => {
    const url =
      platform === 'salla'
        ? '/api/salla/connect'
        : platform === 'shopify'
          ? '/app/connect-store'
          : '/api/zid/connect'
    router.push(url)
  }

  const BackIcon = dir === 'rtl' ? ChevronRight : ChevronLeft

  return (
    <div className="space-y-5" dir={dir}>
      {error && (
        <div className="flex items-start gap-3 border border-destructive/25 bg-destructive/[0.05] p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold text-foreground">
              {ar ? 'فشل الاتصال بالمنصة' : 'Connection Failed'}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{getErrorMessage(error)}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-3 border border-primary/25 bg-primary/[0.06] p-3 text-xs text-primary">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold text-primary">{ar ? 'تم ربط المتجر بنجاح' : 'Store Connected'}</p>
            <p className="text-[11px] text-primary/80 mt-0.5">{getSuccessMessage(success)}</p>
          </div>
        </div>
      )}

      {/* ── List View: Odoo-style list with header row + clean records ── */}
      {view === 'list' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">
                {ar ? 'المتاجر المتصلة' : 'Connected Stores'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ar
                  ? `إجمالي المتاجر المرتبطة بمساحة العمل الحالية: ${connectedRows.length}`
                  : `Total connected stores in current workspace: ${connectedRows.length}`}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setView('connect')}
              className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{ar ? 'إضافة متجر' : 'Add Store'}</span>
            </Button>
          </div>

          <div className="overflow-x-auto border border-border bg-card">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-y border-border bg-muted/60 text-[10px] uppercase tracking-wide text-foreground/70">
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                    {ar ? 'الحالة' : 'Status'}
                  </th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                    {ar ? 'المتجر' : 'Store'}
                  </th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                    {ar ? 'المنصة' : 'Platform'}
                  </th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                    {ar ? 'معرف التاجر / النطاق' : 'Merchant ID / Domain'}
                  </th>
                  <th className="px-2 py-2.5 text-start font-bold whitespace-nowrap">
                    {ar ? 'آخر تحديث' : 'Last Updated'}
                  </th>
                  <th className="px-2 py-2.5 text-end font-bold whitespace-nowrap w-12" />
                </tr>
              </thead>
              <tbody>
                {connectedRows.length > 0 ? (
                  connectedRows.map((row) => {
                    const storeMeta = stores.find((s) => s.id === row.platform)
                    const StoreIcon = storeMeta?.logo ?? Store
                    const platformName = storeMeta?.name || row.platform

                    return (
                      <tr
                        key={`${row.platform}:${row.key}`}
                        tabIndex={0}
                        role="button"
                        onClick={() => openDetails(row.platform, row.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openDetails(row.platform, row.key)
                          }
                        }}
                        className="cursor-pointer transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none border-b border-border/40 last:border-b-0"
                      >
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 border border-primary/20 bg-primary/[0.06] px-2 py-0.5 text-[10px] font-bold text-primary">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                            {ar ? 'متصل' : 'Connected'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-2 font-bold text-foreground">
                            <StoreIcon />
                            <span dir="auto">{row.name}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground font-medium">
                          {platformName}
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap font-mono text-foreground">
                          {row.code || '—'}
                        </td>
                        <td className="px-2 py-2.5 whitespace-nowrap text-muted-foreground">
                          {formatDate(row.token?.updated_at)}
                        </td>
                        <td className="px-2 py-2.5 text-end">
                          <RowActions
                            row={row}
                            isAr={ar}
                            onOpen={() => openDetails(row.platform, row.key)}
                            onReconnect={() => handleReconnect(row.platform)}
                          />
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <div className="flex flex-col items-center justify-center">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mb-3">
                          <Store className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <p className="text-xs font-bold text-muted-foreground">
                          {ar ? 'لا يوجد أي متجر متصل حالياً' : 'No stores connected currently'}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 max-w-xs leading-relaxed">
                          {ar
                            ? 'قم بإضافة متجرك الإلكتروني (زد، سلة، أو شوبيفاي) لبدء مزامنة المنتجات والطلبات والمخزون مع نظام أودو.'
                            : 'Add your online store (Zid, Salla, or Shopify) to begin syncing products, orders, and stock with Odoo.'}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setView('connect')}
                          className="mt-4 h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>{ar ? 'إضافة متجر جديد' : 'Add New Store'}</span>
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Connect View: Pick a platform + Connect ────────────────── */}
      {view === 'connect' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => setView('list')}
              className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <BackIcon className="h-3.5 w-3.5" />
              {ar ? 'العودة للمتاجر' : 'Back to Stores'}
            </button>
            <span className="text-muted-foreground/30">/</span>
            <span className="font-mono text-foreground/70">{ar ? 'إضافة متجر' : 'Add Store'}</span>
          </div>

          <div className="border border-border bg-card p-4 space-y-4 max-w-xl">
            <div className="border-b border-border pb-3">
              <h1 className="text-base font-bold text-foreground">
                {ar ? 'ربط متجر جديد' : 'Connect New Store'}
              </h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {ar ? 'اختر المنصة لبدء عملية الربط التلقائي' : 'Select platform to start automatic connection'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {ar ? 'منصة المتجر' : 'Store Platform'}
              </label>
              <select
                value={connectPlatform}
                onChange={(e) => setConnectPlatform(e.target.value)}
                className="w-full h-8 px-3 rounded-none border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {tokensFor(s.id).length > 0
                      ? ar
                        ? ` (متصل: ${tokensFor(s.id).length})`
                        : ` (connected: ${tokensFor(s.id).length})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            {connectPlatform === 'shopify' ? (
              <div className="space-y-3 pt-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {ar
                    ? 'أدخل نطاق متجرك على شوبيفاي ثم اضغط اتصال للموافقة على الصلاحيات.'
                    : 'Enter your Shopify shop domain, then click Connect to approve permissions.'}
                </p>
                <form action="/api/shopify/connect" method="GET" className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    name="shop"
                    placeholder="store-name.myshopify.com"
                    required
                    className="flex h-8 w-full border border-border bg-background px-3 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold shrink-0"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>{ar ? 'اتصال' : 'Connect'}</span>
                  </Button>
                </form>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  {selectedPlatform && <selectedPlatform.logo />}
                  <span className="text-sm font-bold text-foreground">{selectedPlatform?.name}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {ar
                    ? `اربط متجرك على ${selectedPlatform?.name} لتتمكن من مزامنة المنتجات، المخزون، والطلبات تلقائياً مع نظام ERP. بعد الضغط على الاتصال يتم تسجيل التنبيهات وتفعيل المزامنة تلقائياً.`
                    : `Connect your store on ${selectedPlatform?.name} to automatically sync products, stock, and orders with your ERP system. After connecting, webhooks and sync run automatically.`}
                </p>
                <div className="p-2.5 border border-border bg-muted/40 font-mono text-[10px]">
                  <div className="text-muted-foreground mb-1 font-sans">{t('zid.redirectUrl')}</div>
                  <div className="text-foreground/80 break-all">
                    {connectPlatform === 'salla' ? sallaInstallUrl : installUrl}
                  </div>
                </div>
                <a
                  href={connectPlatform === 'salla' ? '/api/salla/connect' : '/api/zid/connect'}
                  className={cn(
                    buttonVariants({ variant: 'outline' }),
                    'h-8 gap-1.5 rounded-none px-3 text-[10px] font-bold inline-flex'
                  )}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>{ar ? 'اتصال الحساب' : 'Connect Account'}</span>
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Detail View: Odoo Record Style ──────────────────────────── */}
      {view === 'details' && detail && !detailToken && (
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Link
              href="/app/connect-store"
              className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <BackIcon className="h-3.5 w-3.5" />
              {ar ? 'العودة للمتاجر' : 'Back to Stores'}
            </Link>
            <span className="text-muted-foreground/30">/</span>
            <span className="font-mono text-foreground/70">{detail.slug}</span>
          </div>

          <div className="border border-border bg-card p-4">
            <div className="flex items-start gap-3 text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <h2 className="text-sm font-bold">{ar ? 'المتجر غير متصل' : 'Store Not Connected'}</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {ar
                    ? 'هذا المتجر غير مرتبط بمساحة العمل الحالية أو تم فصله.'
                    : 'This store is not linked to the current workspace or was disconnected.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'details' && detail && detailToken && (
        <div className="space-y-5">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-[11px]">
            <Link
              href="/app/connect-store"
              className="inline-flex items-center gap-1 font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <BackIcon className="h-3.5 w-3.5" />
              {ar ? 'العودة للمتاجر' : 'Back to Stores'}
            </Link>
            <span className="text-muted-foreground/30">/</span>
            <span className="font-mono text-foreground/70">
              {displayFor(detail.platform, detailToken).name}
            </span>
          </div>

          {/* Record Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-bold text-foreground">
                  {displayFor(detail.platform, detailToken).name}
                </h1>
                <span className="inline-flex items-center border border-primary/20 bg-primary/[0.06] px-2 py-0.5 text-[10px] font-bold text-primary">
                  <span className="me-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  {ar ? 'متصل' : 'Connected'}
                </span>
              </div>

              <div className="mt-1 flex items-center gap-1.5">
                <span className="break-all font-mono text-[11px] text-muted-foreground">
                  {displayFor(detail.platform, detailToken).code || detailToken.merchant_id || detailToken.shop_domain}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyStoreId(
                      String(
                        displayFor(detail.platform, detailToken).code ||
                          detailToken.merchant_id ||
                          detailToken.shop_domain
                      )
                    )
                  }
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={ar ? 'نسخ المعرّف' : 'Copy ID'}
                >
                  {copiedId ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <WebhookStatusPill
                platform={detail.platform}
                merchantId={detail.platform === 'zid' ? String(detailToken.merchant_id ?? '') : ''}
                reconnectHref={detail.platform === 'salla' ? '/api/salla/connect' : '/api/zid/connect'}
                lang={lang}
              />

              {(detail.platform === 'zid' || detail.platform === 'salla') && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    router.push(detail.platform === 'salla' ? '/api/salla/connect' : '/api/zid/connect')
                  }
                  className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{ar ? 'إعادة الاتصال' : 'Reconnect'}</span>
                </Button>
              )}

              {detail.platform === 'zid' && (
                <DisconnectButton
                  merchantId={String(detailToken.merchant_id)}
                  confirmText={t('zid.disconnectConfirm')}
                  buttonText={t('zid.disconnect')}
                  onDone={() => router.push('/app/connect-store')}
                />
              )}
              {detail.platform === 'salla' && (
                <DisconnectButton
                  merchantId={String(detailToken.merchant_id)}
                  confirmText={
                    ar
                      ? 'هل أنت متأكد من رغبتك في إلغاء ربط متجر سلة؟'
                      : 'Are you sure you want to disconnect Salla store?'
                  }
                  buttonText={t('zid.disconnect')}
                  platform="salla"
                  onDone={() => router.push('/app/connect-store')}
                />
              )}
              {detail.platform === 'shopify' && (
                <DisconnectButton
                  merchantId={detailToken.shop_domain}
                  confirmText={
                    ar
                      ? 'هل أنت متأكد من رغبتك في إلغاء ربط متجر شوبيفاي؟'
                      : 'Are you sure you want to disconnect Shopify store?'
                  }
                  buttonText={t('zid.disconnect')}
                  platform="shopify"
                  onDone={() => router.push('/app/connect-store')}
                />
              )}
            </div>
          </div>

          {/* Odoo-style Information Grid Card */}
          <div className="border border-border bg-card p-4">
            <h2 className="text-[11px] font-bold text-foreground uppercase tracking-wide border-b border-border pb-2 mb-4">
              {ar ? 'معلومات المتجر الأساسية' : 'Basic Store Information'}
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {detail.platform === 'zid' && (
                <>
                  <InfoField label={ar ? 'معرف التاجر' : 'Merchant ID'} mono>
                    {detailToken.merchant_id || '—'}
                  </InfoField>
                  <InfoField label={ar ? 'معرف المتجر' : 'Store ID'} mono>
                    {detailToken.store_id || '—'}
                  </InfoField>
                  <InfoField label={ar ? 'بريد التاجر' : 'Merchant Email'}>
                    {detailToken.email || '—'}
                  </InfoField>
                  <InfoField label={ar ? 'اسم المستخدم' : 'Username'}>
                    {detailToken.username || '—'}
                  </InfoField>
                </>
              )}

              {detail.platform === 'salla' && (
                <>
                  <InfoField label={ar ? 'معرف التاجر' : 'Merchant ID'} mono>
                    {detailToken.merchant_id || '—'}
                  </InfoField>
                  <InfoField label={ar ? 'اسم المتجر' : 'Store Username'}>
                    {detailToken.username || '—'}
                  </InfoField>
                  <InfoField label={ar ? 'اسم التاجر' : 'Merchant Name'}>
                    {detailToken.name || '—'}
                  </InfoField>
                  <InfoField label={ar ? 'البريد الإلكتروني' : 'Email'}>
                    {detailToken.email || '—'}
                  </InfoField>
                </>
              )}

              {detail.platform === 'shopify' && (
                <>
                  <InfoField label={ar ? 'نطاق المتجر' : 'Shop Domain'} mono wide>
                    {detailToken.shop_domain || '—'}
                  </InfoField>
                  <InfoField label={ar ? 'البريد الإلكتروني' : 'Email'}>
                    {detailToken.email || '—'}
                  </InfoField>
                </>
              )}

              <InfoField label={ar ? 'آخر تحديث' : 'Last Updated'}>
                {formatDate(detailToken.updated_at)}
              </InfoField>
              <InfoField label={ar ? 'حالة المزامنة' : 'Sync Status'}>
                <span className="inline-flex items-center gap-1 font-bold text-primary text-xs">
                  <Check className="h-3.5 w-3.5" />
                  {ar ? 'نشطة تلقائياً' : 'Active Automatically'}
                </span>
              </InfoField>
            </div>
          </div>

          {/* Sync Settings Section */}
          <div className="border border-border bg-card p-4 space-y-3">
            <div>
              <h2 className="text-[11px] font-bold text-foreground uppercase tracking-wide">
                {ar ? 'إعدادات المزامنة المتقدمة' : 'Advanced Sync Settings'}
              </h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {t('sync.coreOn')}
              </p>
            </div>
            <div className="pt-2 border-t border-border/50">
              {detail.platform === 'zid' && (
                <SyncSettingsTable
                  merchantId={detailToken.merchant_id}
                  initialSettings={detailToken.sync_settings}
                />
              )}
              {detail.platform === 'salla' && (
                <SallaSyncSettingsTable
                  merchantId={detailToken.merchant_id}
                  initialSettings={detailToken.sync_settings}
                />
              )}
              {detail.platform === 'shopify' && (
                <ShopifySyncSettingsTable
                  shopDomain={detailToken.shop_domain}
                  initialSettings={detailToken.sync_settings}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

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
  const [counts, setCounts] = useState<{ healthy: number | null; broken: number; degraded: number }>({
    healthy: null,
    broken: 0,
    degraded: 0,
  })
  const [reason, setReason] = useState<string | null>(null)
  const [repairing, setRepairing] = useState(false)
  const ar = lang === 'ar'

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

  if (!isZid) {
    return (
      <span className="inline-flex items-center gap-1.5 border border-primary/20 bg-primary/[0.06] px-2 h-8 text-[10px] font-bold text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {ar ? 'المتجر متصل' : 'Connected'}
      </span>
    )
  }

  if (!merchantId) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center gap-1.5 border border-amber-500/30 bg-amber-500/[0.06] px-2 h-8 text-[10px] font-bold text-amber-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{ar ? 'بيانات غير مكتملة' : 'Incomplete Data'}</span>
        </span>
        <a
          href={reconnectHref}
          className="inline-flex items-center gap-1 border border-amber-500/30 bg-background px-2 h-8 text-[10px] font-bold text-amber-600 hover:bg-amber-500/[0.06] transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{ar ? 'إعادة الاتصال' : 'Reconnect'}</span>
        </a>
      </span>
    )
  }

  const pillClass =
    'inline-flex items-center gap-1.5 border px-2.5 h-8 text-[10px] font-bold max-w-[210px]'

  if (state === 'loading') {
    return (
      <span className={cn(pillClass, 'border-border bg-muted/40 text-muted-foreground')}>
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="truncate">{ar ? 'فحص التنبيهات…' : 'Checking…'}</span>
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
            ? ar
              ? `${counts.healthy} تنبيهات مفعّلة — اضغط لإعادة الفحص`
              : `${counts.healthy} active webhooks — click to re-check`
            : ar
              ? 'اضغط لإعادة الفحص'
              : 'Click to re-check'
        }
        className={cn(
          pillClass,
          'border-primary/20 bg-primary/[0.06] text-primary hover:bg-primary/10 transition-colors'
        )}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
        <span className="truncate">{ar ? 'التنبيهات تعمل' : 'Webhooks healthy'}</span>
      </button>
    )
  }

  if (state === 'broken') {
    const label =
      counts.broken > 0
        ? ar
          ? `${counts.broken} تنبيهات معطّلة`
          : `${counts.broken} broken webhooks`
        : ar
          ? `${counts.degraded} تنبيهات متأخرة`
          : `${counts.degraded} degraded webhooks`
    return (
      <span className="inline-flex items-center gap-1">
        <span
          className={cn(pillClass, 'border-destructive/25 bg-destructive/[0.05] text-destructive')}
          title={label}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRecover}
          disabled={repairing}
          className="h-8 gap-1 rounded-none px-2.5 text-[10px] font-bold text-destructive"
        >
          <Wrench className={cn('h-3.5 w-3.5', repairing && 'animate-pulse')} />
          <span>
            {repairing ? (ar ? 'جارٍ الإصلاح…' : 'Repairing…') : ar ? 'إصلاح التنبيهات' : 'Repair Webhooks'}
          </span>
        </Button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(pillClass, 'border-amber-500/30 bg-amber-500/[0.06] text-amber-600')}
        title={reason || undefined}
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{ar ? 'تعذّر فحص التنبيهات' : 'Webhook check failed'}</span>
      </span>
      <a
        href={reconnectHref}
        className="inline-flex items-center gap-1 border border-amber-500/30 bg-background px-2.5 h-8 text-[10px] font-bold text-amber-600 hover:bg-amber-500/[0.06] transition-colors"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        <span>{ar ? 'إعادة الاتصال' : 'Reconnect'}</span>
      </a>
    </span>
  )
}
