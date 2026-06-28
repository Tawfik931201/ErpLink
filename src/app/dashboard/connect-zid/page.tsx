import type { Metadata } from 'next'
import { ExternalLink, Store, CheckCircle2, User, Mail, Calendar, Hash, RefreshCw, Trash2 } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { getActiveWorkspaceZidToken, disconnectZidStore } from '@/app/actions/workspaces'
import SyncSettingsTable from './sync-settings'

export const metadata: Metadata = {
  title: 'Connect with Zid — ZidLink',
  description: 'إدارة وتوصيل متجرك الإلكتروني على منصة زد',
}

export default async function ConnectZidPage() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const installUrl = `${appUrl}/api/zid/connect`

  const tokenRes = await getActiveWorkspaceZidToken()
  const token = tokenRes.success ? tokenRes.token : null

  const formatDate = (dateStr: string | Date) => {
    try {
      return new Date(dateStr).toLocaleString('ar-EG', {
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
    <div className="space-y-6" dir="rtl">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          الاتصال بمنصة زد (Connect with Zid)
        </h1>
        <p className="mt-2 text-muted-foreground">
          إدارة ربط متجرك الإلكتروني على منصة زد وحفظ بيانات الاعتماد والمزامنة التلقائية.
        </p>
      </div>

      {token ? (
        // Connected State UI
        <div className="space-y-6 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          {/* Status Banner */}
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div className="flex-1 text-sm font-medium">
              متجر زد متصل حالياً بنجاح ببيئة العمل النشطة. يمكنك الآن مزامنة المنتجات والطلبات والعملاء.
            </div>
          </div>

          {/* Details Card */}
          <div className="rounded-2xl border bg-card p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-emerald-500 to-teal-500" />
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border/60">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
                  <Store className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                    {token.name || 'متجر زد'}
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-500">
                      نشط (Active)
                    </span>
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    تطبيق زد مدمج ومفعل بالكامل
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline" size="sm" className="rounded-xl border-border/80 hover:bg-muted gap-2">
                  <Link href="/api/zid/connect">
                    <RefreshCw className="h-4 w-4" />
                    إعادة الاتصال (Reconnect)
                  </Link>
                </Button>

                <form action={disconnectZidStore.bind(null, token.merchant_id)}>
                  <Button type="submit" variant="destructive" size="sm" className="rounded-xl gap-2 hover:bg-destructive/90">
                    <Trash2 className="h-4 w-4" />
                    قطع الاتصال (Disconnect)
                  </Button>
                </form>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 pt-6 text-sm">
              {/* Store/Merchant ID */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                <Hash className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">معرف المتجر / التاجر (Merchant ID)</p>
                  <p className="mt-1 font-mono text-foreground font-semibold break-all">{token.merchant_id}</p>
                </div>
              </div>

              {/* Email */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                <Mail className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">البريد الإلكتروني للتاجر (Email)</p>
                  <p className="mt-1 text-foreground font-semibold break-all">{token.email || 'غير متوفر'}</p>
                </div>
              </div>

              {/* Username */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">اسم المستخدم للتاجر (Username)</p>
                  <p className="mt-1 text-foreground font-semibold break-all">{token.username || 'غير متوفر'}</p>
                </div>
              </div>

              {/* Updated At */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40 sm:col-span-2 lg:col-span-3">
                <Calendar className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">تاريخ آخر اتصال / تحديث (Last Connected)</p>
                  <p className="mt-1 text-foreground font-semibold">{formatDate(token.updated_at)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sync Settings Card */}
          <div className="rounded-2xl border bg-card p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-primary to-purple-600" />
            <SyncSettingsTable merchantId={token.merchant_id} initialSettings={token.sync_settings} />
          </div>
        </div>
      ) : (
        // Disconnected State UI (Standard instructions)
        <div className="rounded-2xl border bg-card p-6 shadow-xl relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-zid-500 to-zid-600" />
          
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zid-500/10 text-zid-500 shrink-0">
              <Store className="h-7 w-7 animate-pulse" />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">تثبيت تطبيق زد (Zid App Installation)</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  يجب تثبيت تطبيق زد في متجرك لربطه بـ ZidLink. بعد التثبيت، ستتم مزامنة بيانات متجرك وحفظها بأمان في قاعدة البيانات.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-muted/40 border border-border/50 text-xs font-mono break-all text-muted-foreground">
                <span className="font-semibold text-foreground">رابط إعادة التوجيه / التثبيت:</span>
                <p className="mt-1.5">{installUrl}</p>
              </div>

              <Button asChild className="gradient-brand text-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 gap-2 px-5 py-5 hover:scale-[1.01]">
                <Link href="/api/zid/connect">
                  <ExternalLink className="h-4 w-4" />
                  تثبيت وربط متجر زد (Install Zid App)
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
