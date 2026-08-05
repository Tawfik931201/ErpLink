import { CheckCircle, XCircle, AlertCircle, RefreshCw, Zap, Database } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getActiveWorkspaceZidToken } from '@/app/actions/workspaces'
import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'

export const metadata: Metadata = { title: 'Integrations — ErpLink' }

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

  const [zidRes, odooRes] = await Promise.all([
    getActiveWorkspaceZidToken(),
    getActiveWorkspaceErpConnection()
  ])
  const isZidConnected = zidRes.success && !!zidRes.token
  const storeName = zidRes.success && zidRes.token?.name ? zidRes.token.name : null
  const isOdooConnected = odooRes.success && !!odooRes.connection
  const odooConnectionName = odooRes.success && odooRes.connection?.connection_name ? odooRes.connection.connection_name : null
  const erpType = odooRes.success && odooRes.connection?.erp_type ? odooRes.connection.erp_type : null

  const getErpLabel = (type: string | null) => {
    if (type === 'odoo') return 'أودو (Odoo)'
    if (type === 'zoho') return 'زوهو (Zoho)'
    if (type === 'erpnext') return 'ERPNext'
    return 'أودو (Odoo)'
  }

  return (
    <div className="space-y-8" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          التكامل والربط (Integrations)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          قم بربط متجرك الإلكتروني على زد ونظام ERP للبدء في مزامنة البيانات والعمليات تلقائياً.
        </p>
      </div>

      {success === 'zid_connected' && (
        <div className="flex items-start gap-3 rounded-xl border bg-muted p-4 animate-in fade-in duration-300">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
          <div>
            <p className="font-semibold text-foreground">
              تم ربط متجر زد بنجاح!
            </p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {storeName
                ? `المتجر "${storeName}" مرتبط الآن بـ ErpLink.`
                : 'متجر زد الخاص بك مرتبط الآن بـ ErpLink.'}
              {' '}يمكنك الآن تهيئة إعدادات المزامنة وتفعيل التحديثات التلقائية.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 p-4 animate-in fade-in duration-300">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">فشل الاتصال بالمنصة</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {ERROR_MESSAGES[error] ?? `حدث خطأ غير معروف: ${error}`}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border bg-card">
          <CardHeader className="pb-3 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground">
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
                  <CheckCircle className="h-4 w-4 text-foreground" />
                  تم تخزين رموز الوصول (Tokens) بأمان.
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-foreground" />
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
                  href="/dashboard/connect-store"
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  إدارة الربط (Manage)
                </Link>
              ) : (
                <a
                  href="/api/zid/connect"
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-foreground text-background px-4 text-sm font-medium hover:opacity-90 transition-colors"
                >
                  ربط متجر زد (Connect Zid)
                </a>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-card">
          <CardHeader className="pb-3 pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-foreground">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    {isOdooConnected ? `نظام الـ ERP (${getErpLabel(erpType)})` : 'نظام الـ ERP (ERP System)'}
                  </CardTitle>
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
                  <CheckCircle className="h-4 w-4 text-foreground" />
                  تم التحقق من بيانات الاتصال وحفظها بنجاح.
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-foreground" />
                  البرنامج النشط: <strong className="text-foreground">{getErpLabel(erpType)}</strong>
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-foreground" />
                  اسم الاتصال: <strong className="text-foreground">{odooConnectionName || 'الرئيسي'}</strong>
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground leading-relaxed">
                اربط نظام الـ ERP الخاص بك (Odoo، Zoho، أو ERPNext) لإتمام عمليات مزامنة المنتجات والطلبات وتحديثات المخازن بدقة وسهولة.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Link
                href="/dashboard/connect-odoo"
                className={
                  isOdooConnected
                    ? 'inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted transition-colors'
                    : 'inline-flex h-9 items-center justify-center rounded-lg bg-foreground text-background px-4 text-sm font-medium hover:opacity-90 transition-colors'
                }
              >
                {isOdooConnected ? 'إدارة الربط (Manage)' : 'ربط نظام الـ ERP (Connect ERP)'}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
