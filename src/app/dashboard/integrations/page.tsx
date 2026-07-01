import { CheckCircle, XCircle, AlertCircle, RefreshCw, Zap, Database } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getActiveWorkspaceZidToken } from '@/app/actions/workspaces'
import { getActiveWorkspaceOdooConnection } from '@/app/actions/odoo'

export const metadata: Metadata = { title: 'Integrations — ZidLink' }

interface PageProps {
  searchParams: {
    success?: string
    error?: string
    store?: string
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  zid_denied:                'تم رفض الصلاحيات من قبل المستخدم. يرجى المحاولة والموافقة على الصلاحيات.',
  zid_no_code:               'منصة زد لم ترجع رمز المصادقة (Authorization Code).',
  zid_missing_code:          'منصة زد لم ترجع رمز المصادقة. يرجى إعادة المحاولة.',
  zid_token_exchange_failed: 'فشل استبدال الرموز من منصة زد. يرجى إعادة المحاولة.',
  zid_db_error:              'تم الاتصال بزد ولكن فشل حفظ البيانات في قاعدة البيانات.',
  zid_missing_params:        'بيانات الرد من زد غير صالحة.',
  missing_config:            'متغيرات البيئة الخاصة بزد غير متوفرة على الخادم.',
  invalid_token:             'الرمز المسترجع من زد غير صالح.',
  token_storage_failed:      'لم يتمكن الخادم من حفظ رموز زد.',
  unauthorized:              'تم رفض الرمز المخزن من قبل زد. يرجى إعادة الربط.',
  expired_token:             'انتهت صلاحية الرمز المسترجع من زد. يرجى إعادة الربط.',
  network_error:             'خطأ في الشبكة أثناء الاتصال بمنصة زد.',
  invalid_state:             'فشل التحقق من حالة الطلب الأمنية (OAuth State).',
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const { success, error } = searchParams

  // Dynamic token checks from database
  const zidRes = await getActiveWorkspaceZidToken()
  const isZidConnected = zidRes.success && !!zidRes.token
  const storeName = zidRes.success && zidRes.token?.name ? zidRes.token.name : null

  const odooRes = await getActiveWorkspaceOdooConnection()
  const isOdooConnected = odooRes.success && !!odooRes.connection
  const odooConnectionName = odooRes.success && odooRes.connection?.connection_name ? odooRes.connection.connection_name : null

  return (
    <div className="space-y-8" dir="rtl">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          التكامل والربط (Integrations)
        </h1>
        <p className="mt-2 text-muted-foreground">
          قم بربط متجرك الإلكتروني على زد ونظام أودو ERP للبدء في مزامنة البيانات والعمليات تلقائياً.
        </p>
      </div>

      {/* Status banners */}
      {success === 'zid_connected' && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-300">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div>
            <p className="font-semibold">
              تم ربط متجر زد بنجاح!
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {storeName
                ? `المتجر "${storeName}" مرتبط الآن بـ ZidLink.`
                : 'متجر زد الخاص بك مرتبط الآن بـ ZidLink.'}
              {' '}يمكنك الآن تهيئة إعدادات المزامنة وتفعيل التحديثات التلقائية.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-red-600 dark:text-red-400 animate-in fade-in duration-300">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div>
            <p className="font-semibold">فشل الاتصال بالمنصة</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {ERROR_MESSAGES[error] ?? `حدث خطأ غير معروف: ${error}`}
            </p>
          </div>
        </div>
      )}

      {/* Integration cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Zid Card */}
        <Card className="overflow-hidden rounded-2xl shadow-md border border-border hover:shadow-lg transition-shadow relative">
          <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-zid-500 to-zid-600" />
          <CardHeader className="pb-3 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zid-100 dark:bg-zid-900 text-zid-600 dark:text-zid-400">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">متجر زد (Zid Store)</CardTitle>
                  <CardDescription className="text-xs">منصة التجارة الإلكترونية</CardDescription>
                </div>
              </div>
              <Badge variant={isZidConnected ? 'success' : 'secondary'} className="rounded-full">
                {isZidConnected ? 'متصل (Connected)' : 'غير متصل'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {isZidConnected ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  تم تخزين رموز الوصول (Tokens) بأمان.
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  المتجر النشط: <strong className="text-foreground">{storeName || 'متجر زد'}</strong>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                اربط متجرك على زد لتتمكن من مزامنة المنتجات، المخزون، والطلبات تلقائياً مع نظام ERP.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              {isZidConnected ? (
                <Link
                  href="/dashboard/connect-zid"
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
                >
                  إدارة الربط (Manage)
                </Link>
              ) : (
                <a
                  href="/api/zid/connect"
                  className="gradient-brand inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-medium text-white shadow-md transition-colors hover:opacity-90 active:opacity-80"
                >
                  ربط متجر زد (Connect Zid)
                </a>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Odoo Card */}
        <Card className="overflow-hidden rounded-2xl shadow-md border border-border hover:shadow-lg transition-shadow relative">
          <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-primary to-purple-600" />
          <CardHeader className="pb-3 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">نظام أودو (Odoo ERP)</CardTitle>
                  <CardDescription className="text-xs">تخطيط موارد المؤسسات</CardDescription>
                </div>
              </div>
              <Badge variant={isOdooConnected ? 'success' : 'secondary'} className="rounded-full">
                {isOdooConnected ? 'متصل (Connected)' : 'غير متصل'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            {isOdooConnected ? (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  تم التحقق من بيانات XML-RPC وحفظها.
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  اسم الاتصال: <strong className="text-foreground">{odooConnectionName || 'أودو ERP'}</strong>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                اربط نظام أودو الخاص بك لإتمام عمليات مزامنة المنتجات والطلبات وتحديثات المخازن بدقة وسهولة.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Link
                href="/dashboard/connect-odoo"
                className={
                  isOdooConnected
                    ? 'inline-flex h-9 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors shadow-sm'
                    : 'gradient-brand inline-flex h-9 items-center justify-center rounded-xl px-4 text-sm font-medium text-white shadow-md transition-colors hover:opacity-90 active:opacity-80'
                }
              >
                {isOdooConnected ? 'إدارة الربط (Manage)' : 'ربط نظام أودو (Connect Odoo)'}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
