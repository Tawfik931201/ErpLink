'use client'

import { useState } from 'react'
import { 
  Store, 
  ExternalLink, 
  CheckCircle2, 
  Mail, 
  Calendar, 
  Hash, 
  RefreshCw, 
  User, 
  ArrowRightLeft, 
  Bell, 
  Layers, 
  CheckSquare, 
  Sparkles,
  Inbox,
  AlertCircle,
  Globe,
  Award,
  Phone
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Language, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'
import SyncSettingsTable from './sync-settings'
import SallaSyncSettingsTable from './salla-sync-settings'
import DisconnectButton from './disconnect-button'

// ─── Inline Custom SVGs for Store Logos ───────────────────────────────────────

const ZidLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="currentColor">
    <path d="M20,35 L80,35 L70,85 L30,85 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M35,35 Q50,10 65,35" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    <circle cx="50" cy="55" r="8" fill="currentColor" />
  </svg>
)

const SallaLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="currentColor">
    <path d="M15,40 L85,40 Q90,65 80,85 L20,85 Q10,65 15,40 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M30,40 L30,20 Q50,5 70,20 L70,40" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="50" y1="40" x2="50" y2="85" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
  </svg>
)

const ShopifyLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="currentColor">
    <path d="M25,30 L75,30 L85,90 L15,90 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M40,30 C40,15 60,15 60,30" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
    <path d="M40,50 C40,45 60,45 60,55 C60,65 40,65 40,60" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
  </svg>
)

const WooCommerceLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="currentColor">
    <path d="M15,30 L35,80 L50,50 L65,80 L85,30" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="50" cy="25" r="6" fill="currentColor" />
  </svg>
)

const AmazonLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none" stroke="currentColor">
    <path d="M15,45 Q50,75 85,45" strokeWidth="10" strokeLinecap="round" />
    <path d="M70,48 L85,45 L80,30" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    <text x="50" y="32" fontSize="24" fontWeight="black" textAnchor="middle" fill="currentColor" stroke="none">a</text>
  </svg>
)

const NoonLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none" stroke="currentColor">
    <circle cx="50" cy="50" r="40" strokeWidth="8" />
    <path d="M35,60 L35,40 C35,35 45,30 50,35 L50,60" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M50,60 L50,40 C50,35 60,30 65,35 L65,60" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const JumiaLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="currentColor">
    <path d="M30,20 L30,65 A20,20 0 0,0 70,65 L70,55" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="70" cy="20" r="10" fill="currentColor" />
  </svg>
)

interface StoreSelectorProps {
  token: any
  sallaToken?: any
  installUrl: string
  sallaInstallUrl?: string
  appUrl: string
  lang: Language
  dir: 'rtl' | 'ltr'
}

export default function StoreSelector({ token, sallaToken, installUrl, sallaInstallUrl, appUrl, lang, dir }: StoreSelectorProps) {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('description')
  const [selectedStore, setSelectedStore] = useState<string>('zid')
  const [email, setEmail] = useState('')
  const [isPriority, setIsPriority] = useState(false)
  const [loading, setLoading] = useState(false)

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
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return String(dateStr)
    }
  }

  const stores = [
    {
      id: 'zid',
      name: lang === 'ar' ? 'زد' : 'Zid',
      logo: ZidLogo,
      isActive: true,
      brandGradient: 'from-[#6b4580]/20 to-[#5a3570]/20 text-[#8d5da7] dark:text-[#a07bbf] hover:border-[#8d5da7]/40',
      activeRing: 'ring-[#8d5da7] border-[#8d5da7] bg-[#8d5da7]/5 dark:ring-[#6b4580] dark:border-[#6b4580] dark:bg-[#6b4580]/10',
      badgeClass: 'bg-emerald-500/10 text-emerald-500',
    },
    {
      id: 'salla',
      name: lang === 'ar' ? 'سلة' : 'Salla',
      logo: SallaLogo,
      isActive: true,
      brandGradient: 'from-[#2e8f84]/20 to-[#247d74]/20 text-[#4cc3b4] dark:text-[#6bd0c4] hover:border-[#4cc3b4]/40',
      activeRing: 'ring-[#4cc3b4] border-[#4cc3b4] bg-[#4cc3b4]/5 dark:ring-[#2e8f84] dark:border-[#2e8f84] dark:bg-[#2e8f84]/10',
      badgeClass: 'bg-emerald-500/10 text-emerald-500',
    },
    {
      id: 'shopify',
      name: lang === 'ar' ? 'شوبيفاي' : 'Shopify',
      logo: ShopifyLogo,
      isActive: false,
      brandGradient: 'from-[#96bf48]/10 to-[#7fa33a]/10 text-[#96bf48] hover:border-[#96bf48]/40',
      activeRing: 'ring-[#96bf48] border-[#96bf48] bg-[#96bf48]/5',
      badgeClass: 'bg-muted-foreground/10 text-muted-foreground',
    },
    {
      id: 'woocommerce',
      name: lang === 'ar' ? 'ووكومرس' : 'WooCommerce',
      logo: WooCommerceLogo,
      isActive: false,
      brandGradient: 'from-[#96588a]/10 to-[#7a426f]/10 text-[#96588a] hover:border-[#96588a]/40',
      activeRing: 'ring-[#96588a] border-[#96588a] bg-[#96588a]/5',
      badgeClass: 'bg-muted-foreground/10 text-muted-foreground',
    },
    {
      id: 'amazon',
      name: lang === 'ar' ? 'أمازون' : 'Amazon',
      logo: AmazonLogo,
      isActive: false,
      brandGradient: 'from-[#ff9900]/10 to-[#e47911]/10 text-[#e47911] hover:border-[#ff9900]/40',
      activeRing: 'ring-[#ff9900] border-[#ff9900] bg-[#ff9900]/5',
      badgeClass: 'bg-muted-foreground/10 text-muted-foreground',
    },
    {
      id: 'noon',
      name: lang === 'ar' ? 'نون' : 'Noon',
      logo: NoonLogo,
      isActive: false,
      brandGradient: 'from-[#feee00]/10 to-[#ffd200]/10 text-[#b5a700] dark:text-[#feee00] hover:border-[#feee00]/40',
      activeRing: 'ring-[#b5a700] border-[#b5a700] bg-[#b5a700]/5 dark:ring-[#feee00] dark:border-[#feee00] dark:bg-[#feee00]/5',
      badgeClass: 'bg-muted-foreground/10 text-muted-foreground',
    },
    {
      id: 'jumia',
      name: lang === 'ar' ? 'جوميا' : 'Jumia',
      logo: JumiaLogo,
      isActive: false,
      brandGradient: 'from-[#f68b1e]/10 to-[#d8720e]/10 text-[#f68b1e] hover:border-[#f68b1e]/40',
      activeRing: 'ring-[#f68b1e] border-[#f68b1e] bg-[#f68b1e]/5',
      badgeClass: 'bg-muted-foreground/10 text-muted-foreground',
    },
  ]

  const handleNotifySubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setLoading(true)
    
    // Simulate API request to register interest
    setTimeout(() => {
      setLoading(false)
      const currentStore = stores.find(s => s.id === selectedStore)?.name || selectedStore
      
      const successMsg = isPriority 
        ? t('connect.prioritySuccess').replace('{store}', currentStore)
        : t('connect.notifyMeSuccess').replace('{store}', currentStore)

      toast({
        title: lang === 'ar' ? 'تم بنجاح!' : 'Success!',
        description: successMsg,
        variant: 'default',
      })
      
      setEmail('')
      setIsPriority(false)
    }, 800)
  }

  const selectedPlatform = stores.find(s => s.id === selectedStore)

  return (
    <div className="space-y-6" dir={dir}>
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-red-600 dark:text-red-400 animate-in fade-in duration-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold text-xs">
              {lang === 'ar' ? 'فشل الاتصال بالمنصة' : 'Connection Failed'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {getErrorMessage(error)}
            </p>
          </div>
        </div>
      )}

      {/* ─── Platform Grid Selector ────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-primary" />
            {t('connect.selectStore')}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {t('connect.selectStoreDesc')}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {stores.map((store) => {
            const StoreIcon = store.logo
            const isSelected = selectedStore === store.id
            const isZidAndConnected = store.id === 'zid' && !!token
            const isSallaAndConnected = store.id === 'salla' && !!sallaToken
            
            return (
              <button
                key={store.id}
                onClick={() => setSelectedStore(store.id)}
                className={cn(
                  "flex flex-col items-center justify-between p-3 rounded-xl border bg-background transition-all duration-300 relative text-center select-none overflow-hidden h-28 group",
                  isSelected 
                    ? cn("ring-2 shadow-md scale-[1.02] border-transparent z-10", store.activeRing)
                    : "hover:shadow-sm hover:scale-[1.01] border-border/80"
                )}
              >
                {/* Brand Indicator Light */}
                <div className={cn(
                  "absolute top-0 right-0 left-0 h-[3px] transition-all duration-300",
                  isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-50"
                )} style={{
                  background: store.id === 'zid' ? '#8d5da7' :
                              store.id === 'salla' ? '#4cc3b4' :
                              store.id === 'shopify' ? '#96bf48' :
                              store.id === 'woocommerce' ? '#96588a' :
                              store.id === 'amazon' ? '#ff9900' :
                              store.id === 'noon' ? '#feee00' : '#f68b1e'
                }} />

                {/* Store Icon */}
                <div className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300 mt-1.5",
                  store.brandGradient
                )}>
                  <StoreIcon />
                </div>

                {/* Store Name & Badge */}
                <div className="space-y-1 w-full">
                  <div className="text-[11px] font-black text-foreground truncate">
                    {store.name}
                  </div>
                  <div className="flex justify-center">
                    <span className={cn(
                      "inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-bold select-none",
                      store.id === 'zid' 
                        ? (isZidAndConnected ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400' : 'bg-purple-500/10 text-purple-500')
                        : store.id === 'salla'
                          ? (isSallaAndConnected ? 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400' : 'bg-teal-500/10 text-teal-500')
                          : 'bg-muted/80 text-muted-foreground'
                    )}>
                      {store.id === 'zid'
                        ? (isZidAndConnected ? t('connect.connected') : t('connect.active'))
                        : store.id === 'salla'
                          ? (isSallaAndConnected ? t('connect.connected') : t('connect.active'))
                          : t('connect.comingSoon')}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ─── Selected Platform Content Panel ─────────────────────────────── */}
      <div className="transition-all duration-300">
        {selectedStore === 'zid' ? (
          /* ZID INTEGRATION PANEL */
          token ? (
            // Connected State UI
            <div className="space-y-4 animate-in fade-in-50 slide-in-from-top-4 duration-300">
              {/* Status Banner */}
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <div className="flex-1 text-[11px] font-medium">
                  {t('zid.connectedBanner')}
                </div>
              </div>

              {/* Details Card */}
              <div className="rounded-xl border bg-card p-4 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-emerald-500 to-teal-500" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/60">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                      <Store className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                        {token.name || t('db.storeZid')}
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-500">
                          {t('zid.activeStatus')}
                        </span>
                      </h2>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {lang === 'ar' ? 'تطبيق زد مدمج ومفعل بالكامل' : 'Zid app is fully integrated and enabled'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    <a
                      href="/api/zid/connect"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-border/80 bg-background text-foreground/80 hover:bg-muted gap-1.5 h-8 px-3 text-xs font-semibold select-none transition-all duration-200"
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                      <span>{t('zid.reconnect')}</span>
                    </a>

                    <DisconnectButton
                      merchantId={token.merchant_id}
                      confirmText={t('zid.disconnectConfirm')}
                      buttonText={t('zid.disconnect')}
                    />
                  </div>
                </div>

                <div className="divide-y divide-border/50 pt-4">
                  {/* Store/Merchant ID */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 first:pt-0 last:pb-0 gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400">
                        <Hash className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{t('zid.merchantId')}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('zid.merchantIdDesc')}</p>
                      </div>
                    </div>
                    <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                      {token.merchant_id}
                    </div>
                  </div>

                  {/* Store ID */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                        <Hash className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{t('zid.storeId')}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('zid.storeIdDesc')}</p>
                      </div>
                    </div>
                    <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                      {token.store_id || '—'}
                    </div>
                  </div>

                  {/* Email */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-400">
                        <Mail className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{t('zid.merchantEmail')}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('zid.merchantEmailDesc')}</p>
                      </div>
                    </div>
                    <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                      {token.email || '—'}
                    </div>
                  </div>

                  {/* Username */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 dark:text-purple-400">
                        <User className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{t('zid.merchantUsername')}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('zid.merchantUsernameDesc')}</p>
                      </div>
                    </div>
                    <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                      {token.username || '—'}
                    </div>
                  </div>

                  {/* Updated At */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 last:pb-0 gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 dark:text-amber-400">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{t('zid.lastUpdated')}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('zid.lastUpdatedDesc')}</p>
                      </div>
                    </div>
                    <div className="sm:text-left text-xs font-semibold text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all">
                      {formatDate(token.updated_at)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Sync Settings Card */}
              <div className="rounded-xl border bg-card p-4 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-primary to-purple-600" />
                <SyncSettingsTable merchantId={token.merchant_id} initialSettings={token.sync_settings} />
              </div>
            </div>
          ) : (
            // Disconnected State UI
            <div className="rounded-xl border bg-card p-5 shadow-md relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
              <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-[#8d5da7] to-[#75448f]" />
              
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#8d5da7]/10 text-[#8d5da7] shrink-0">
                  <Store className="h-5.5 w-5.5 animate-pulse" />
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{t('zid.installApp')}</h2>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {t('zid.installAppDesc')}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-muted/40 border border-border/50 text-[10px] font-mono break-all text-muted-foreground">
                    <span className="font-semibold text-foreground">{t('zid.redirectUrl')}</span>
                    <p className="mt-1">{installUrl}</p>
                  </div>

                  <a
                    href="/api/zid/connect"
                    className="bg-gradient-to-r from-[#6b4580] to-[#5a3570] dark:from-[#5a3570] dark:to-[#4a2b5f] text-white inline-flex items-center justify-center rounded-lg shadow-sm hover:shadow-md transition-all duration-300 gap-1.5 px-4 h-9 text-xs hover:scale-[1.01] font-semibold"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {t('zid.installBtn')}
                  </a>
                </div>
              </div>
            </div>
          )
        ) : selectedStore === 'salla' ? (
          /* SALLA INTEGRATION PANEL */
          sallaToken ? (
            // Connected State UI
            <div className="space-y-4 animate-in fade-in-50 slide-in-from-top-4 duration-300">
              {/* Status Banner */}
              <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <div className="flex-1 text-[11px] font-medium">
                  {lang === 'ar' 
                    ? 'متجر سلة مرتبط بنجاح حالياً بمساحة العمل النشطة. يمكنك الآن مزامنة المنتجات والطلبات والعملاء.'
                    : 'Salla store is currently successfully connected to the active workspace. You can now sync products, orders, and customers.'}
                </div>
              </div>

              {/* Details Card */}
              <div className="rounded-xl border bg-card p-4 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-emerald-500 to-teal-500" />
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/60">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                      <Store className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                        {sallaToken.store_name || sallaToken.name || (lang === 'ar' ? 'متجر سلة' : 'Salla Store')}
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-500">
                          {t('zid.activeStatus')}
                        </span>
                      </h2>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {lang === 'ar' ? 'تطبيق سلة مدمج ومفعل بالكامل' : 'Salla app is fully integrated and enabled'}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    <a
                      href="/api/salla/connect"
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-border/80 bg-background text-foreground/80 hover:bg-muted gap-1.5 h-8 px-3 text-xs font-semibold select-none transition-all duration-200"
                    >
                      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                      <span>{t('zid.reconnect')}</span>
                    </a>

                    <DisconnectButton
                      merchantId={sallaToken.merchant_id}
                      confirmText={lang === 'ar' ? 'هل أنت متأكد من رغبتك في إلغاء ربط متجر سلة؟' : 'Are you sure you want to disconnect Salla store?'}
                      buttonText={t('zid.disconnect')}
                      platform="salla"
                    />
                  </div>
                </div>

                <div className="divide-y divide-border/50 pt-4">
                  {/* Merchant ID */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 first:pt-0 last:pb-0 gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400">
                        <Hash className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{lang === 'ar' ? 'معرف التاجر (Merchant ID)' : 'Merchant ID'}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'المعرف الفريد لمتجر سلة الخاص بك' : 'The unique identifier for your Salla store'}</p>
                      </div>
                    </div>
                    <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                      {sallaToken.merchant_id}
                    </div>
                  </div>

                  {/* Username */}
                  {sallaToken.username && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-400">
                          <Globe className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-foreground">{lang === 'ar' ? 'اسم المستخدم للمتجر' : 'Store Username'}</h3>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'معرف المتجر التعريفي' : 'The unique username of the store'}</p>
                        </div>
                      </div>
                      <div className="sm:text-left font-semibold text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40" dir="ltr">
                        {sallaToken.username}
                      </div>
                    </div>
                  )}

                  {/* Merchant Name */}
                  {sallaToken.name && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 dark:text-purple-400">
                          <User className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-foreground">{lang === 'ar' ? 'اسم التاجر' : 'Merchant Name'}</h3>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'الاسم الشخصي لصاحب الحساب' : 'The name of the merchant account holder'}</p>
                        </div>
                      </div>
                      <div className="sm:text-left text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 font-semibold">
                        {sallaToken.name}
                      </div>
                    </div>
                  )}

                  {/* Email */}
                  {sallaToken.email && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-400">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-foreground">{t('zid.merchantEmail')}</h3>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{t('zid.merchantEmailDesc')}</p>
                        </div>
                      </div>
                      <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                        {sallaToken.email}
                      </div>
                    </div>
                  )}



                  {/* Updated At */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 last:pb-0 gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 dark:text-amber-400">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{t('zid.lastUpdated')}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t('zid.lastUpdatedDesc')}</p>
                      </div>
                    </div>
                    <div className="sm:text-left text-xs font-semibold text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all">
                      {formatDate(sallaToken.updated_at)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Sync Settings Card */}
              <div className="rounded-xl border bg-card p-4 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-emerald-500 to-teal-500" />
                <SallaSyncSettingsTable merchantId={sallaToken.merchant_id} initialSettings={sallaToken.sync_settings} />
              </div>
            </div>
          ) : (
            // Salla Disconnected State UI
            <div className="rounded-xl border bg-card p-5 shadow-md relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
              <div className="absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-[#4cc3b4] to-[#3aa89a]" />
              
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#4cc3b4]/10 text-[#4cc3b4] shrink-0">
                  <Store className="h-5.5 w-5.5 animate-pulse" />
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <h2 className="text-base font-bold text-foreground">{lang === 'ar' ? 'ربط متجر سلة' : 'Connect Salla Store'}</h2>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      {lang === 'ar' 
                        ? 'اربط متجرك على سلة لتتمكن من مزامنة المنتجات، المخزون، والطلبات تلقائياً مع نظام ERP.'
                        : 'Connect your store on Salla to automatically sync products, stock, and orders with your ERP system.'}
                    </p>
                  </div>

                  <a
                    href={sallaInstallUrl}
                    className="bg-gradient-to-r from-[#2e8f84] to-[#247d74] dark:from-[#247d74] dark:to-[#1d6b62] text-white inline-flex items-center justify-center rounded-lg shadow-sm hover:shadow-md transition-all duration-300 gap-1.5 px-4 h-9 text-xs hover:scale-[1.01] font-semibold"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {lang === 'ar' ? 'ربط متجر سلة (Connect Salla)' : 'Connect Salla Store'}
                  </a>
                </div>
              </div>
            </div>
          )
        ) : (
          /* COMING SOON PLATFORMS */
          selectedPlatform && (
            <div className="rounded-xl border bg-card p-6 shadow-md relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
              {/* Brand Top border decoration */}
              <div className="absolute top-0 right-0 left-0 h-1" style={{
                background: selectedStore === 'salla' ? '#4cc3b4' :
                            selectedStore === 'shopify' ? '#96bf48' :
                            selectedStore === 'woocommerce' ? '#96588a' :
                            selectedStore === 'amazon' ? '#ff9900' :
                            selectedStore === 'noon' ? '#feee00' : '#f68b1e'
              }} />

              <div className="flex flex-col md:flex-row gap-6 items-start">
                {/* Left side: Platform visual */}
                <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-muted/30 border border-border/50 w-full md:w-48 shrink-0 text-center space-y-3">
                  <div className={cn(
                    "flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm",
                    selectedPlatform.brandGradient
                  )}>
                    {/* Render icon */}
                    <selectedPlatform.logo />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-foreground text-sm">{selectedPlatform.name}</h3>
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold text-primary mt-1">
                      {t('connect.comingSoon')}
                    </span>
                  </div>
                </div>

                {/* Right side: Subscription Form & Details */}
                <div className="flex-1 space-y-5 w-full">
                  <div>
                    <h2 className="text-base font-extrabold text-foreground flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-amber-500 animate-spin" style={{ animationDuration: '3s' }} />
                      {t('connect.comingSoonTitle').replace('{store}', selectedPlatform.name)}
                    </h2>
                    <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                      {t('connect.comingSoonDesc').replace('{store}', selectedPlatform.name)}
                    </p>
                  </div>

                  {/* Sync features list */}
                  <div className="p-4 rounded-xl bg-muted/30 border border-border/40 space-y-2">
                    <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                      {t('connect.featuresSync')}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <CheckSquare className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>{lang === 'ar' ? 'مزامنة الطلبات المباشرة إلى أودو' : 'Live Sync of Orders to Odoo'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckSquare className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>{lang === 'ar' ? 'تحديث وتزامن مخزون السلع' : 'Real-time Stock Updates'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckSquare className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>{lang === 'ar' ? 'استيراد وتحديث كتالوج المنتجات' : 'Product Catalog Import & Sync'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckSquare className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>{lang === 'ar' ? 'مطابقة ومزامنة بيانات العملاء' : 'Customer Account & Address Matching'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Notify Me / Register Interest Form */}
                  <form onSubmit={handleNotifySubmit} className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2 max-w-md">
                      <div className="relative flex-1">
                        <Mail className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder={t('connect.emailPlaceholder')}
                          className="w-full h-9 rounded-lg border border-input bg-background pl-3 pr-9 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={loading}
                        className="h-9 px-4 text-xs font-semibold rounded-lg gap-1.5 select-none shrink-0"
                      >
                        {loading ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Bell className="h-3.5 w-3.5" />
                        )}
                        <span>{t('connect.notifyMe')}</span>
                      </Button>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-muted-foreground max-w-md">
                      <input
                        type="checkbox"
                        checked={isPriority}
                        onChange={(e) => setIsPriority(e.target.checked)}
                        className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
                      />
                      <span>{t('connect.priorityCheck')}</span>
                    </label>
                  </form>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
