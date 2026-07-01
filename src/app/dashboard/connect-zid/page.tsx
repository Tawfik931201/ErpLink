import type { Metadata } from 'next'
import { ExternalLink, Store, CheckCircle2, User, Mail, Calendar, Hash, RefreshCw, Trash2 } from 'lucide-react'
import { cookies } from 'next/headers'

import { Button } from '@/components/ui/button'
import { getActiveWorkspaceZidToken, disconnectZidStore } from '@/app/actions/workspaces'
import SyncSettingsTable from './sync-settings'
import { Language, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'

import DisconnectButton from './disconnect-button'

export const metadata: Metadata = {
  title: 'ربط المتجر — ZidLink',
  description: 'إدارة وتوصيل متجرك الإلكتروني وقنوات البيع',
}

export default async function ConnectZidPage() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const installUrl = `${appUrl}/api/zid/connect`

  const tokenRes = await getActiveWorkspaceZidToken()
  const token = tokenRes.success ? tokenRes.token : null

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

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

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <div>
        <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          {t('zid.title')}
        </h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('zid.desc')}
        </p>
      </div>

      {token ? (
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
            <div className={`absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-emerald-500 to-teal-500`} />
            
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
            <div className={`absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-primary to-purple-600`} />
            <SyncSettingsTable merchantId={token.merchant_id} initialSettings={token.sync_settings} />
          </div>
        </div>
      ) : (
        // Disconnected State UI
        <div className="rounded-xl border bg-card p-5 shadow-md relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <div className={`absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-zid-500 to-zid-600`} />
          
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-zid-500/10 text-zid-500 shrink-0">
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
                className="gradient-brand text-white inline-flex items-center justify-center rounded-lg shadow-sm hover:shadow-md transition-all duration-300 gap-1.5 px-4 h-9 text-xs hover:scale-[1.01] font-semibold"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('zid.installBtn')}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
