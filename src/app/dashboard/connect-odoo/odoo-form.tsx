'use client'

import React, { useState, useTransition } from 'react'
import {
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Trash2,
  Key,
  Globe,
  User,
  Hash,
  Tag,
  Edit3,
  X
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { testOdooConnection, saveOdooConnection, disconnectOdooConnection } from '@/app/actions/odoo'
import { useLanguage } from '@/components/language-provider'
import { cn } from '@/lib/utils'

interface OdooConnectionFormProps {
  initialConnection: any // DB structure for OdooConnection
}

export default function OdooConnectionForm({ initialConnection }: OdooConnectionFormProps) {
  const { toast } = useToast()
  const { t, lang, dir } = useLanguage()

  // Connection state
  const [connection, setConnection] = useState(initialConnection)
  const [isEditing, setIsEditing] = useState(!initialConnection)

  // Form fields state
  const [connectionName, setConnectionName] = useState(
    connection?.connection_name || (lang === 'ar' ? 'أودو الرئيسي' : 'Main Odoo')
  )
  const [url, setUrl] = useState(connection?.url || '')
  const [dbName, setDbName] = useState(connection?.db_name || '')
  const [username, setUsername] = useState(connection?.username || '')
  const [apiKey, setApiKey] = useState('') // API key starts empty for security when modifying
  const [isTestedSuccessfully, setIsTestedSuccessfully] = useState(false)

  const handleUrlChange = (value: string) => {
    setUrl(value)
    setIsTestedSuccessfully(false)
    setTestStatus(null)
  }
  const handleDbNameChange = (value: string) => {
    setDbName(value)
    setIsTestedSuccessfully(false)
    setTestStatus(null)
  }
  const handleUsernameChange = (value: string) => {
    setUsername(value)
    setIsTestedSuccessfully(false)
    setTestStatus(null)
  }
  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setIsTestedSuccessfully(false)
    setTestStatus(null)
  }

  // Transitions/Loading states
  const [isTesting, startTesting] = useTransition()
  const [isSaving, startSaving] = useTransition()
  const [isDisconnecting, startDisconnecting] = useTransition()

  // Real-time connection test results status
  const [testStatus, setTestStatus] = useState<{
    success?: boolean
    message?: string
  } | null>(null)

  // Handle test connection
  const handleTestConnection = () => {
    setTestStatus(null)
    startTesting(async () => {
      const res = await testOdooConnection(url, dbName, username, apiKey)
      if (res.success) {
        setTestStatus({ 
          success: true, 
          message: lang === 'ar' ? 'تم الاتصال بنجاح! بيانات الاعتماد صحيحة.' : 'Connected successfully! Credentials are correct.' 
        })
        setIsTestedSuccessfully(true)
        toast({
          title: t('odoo.successTest'),
          description: lang === 'ar' ? 'تم الاتصال بنظام أودو بنجاح.' : 'Connected to Odoo successfully.',
          variant: 'default',
        })
      } else {
        setTestStatus({ 
          success: false, 
          message: res.error || (lang === 'ar' ? 'فشل الاتصال بنظام أودو.' : 'Connection to Odoo failed.') 
        })
        setIsTestedSuccessfully(false)
        toast({
          title: lang === 'ar' ? 'فشل الاتصال' : 'Connection Failed',
          description: res.error || t('odoo.failTest'),
          variant: 'destructive',
        })
      }
    })
  }

  // Handle save connection
  const handleSaveConnection = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isTestedSuccessfully) {
      toast({
        title: lang === 'ar' ? 'يجب اختبار الاتصال أولاً' : 'Must Test Connection First',
        description: lang === 'ar' ? 'يرجى الضغط على زر اختبار الاتصال والتأكد من نجاحه قبل الحفظ.' : 'Please click Test Connection and ensure it succeeds before saving.',
        variant: 'destructive',
      })
      return
    }
    setTestStatus(null)
    startSaving(async () => {
      const res = await saveOdooConnection({
        connectionName,
        url,
        dbName,
        username,
        apiKey,
      })

      if (res.success) {
        // Strip password key from result before updating frontend state
        if (res.connection) {
          delete res.connection.password;
        }
        setConnection(res.connection)
        setIsEditing(false)
        setIsTestedSuccessfully(false)
        setApiKey('') // Force clear key state completely after save
        toast({
          title: t('odoo.successSave'),
          description: lang === 'ar' ? 'تم ربط وحفظ إعدادات أودو بنجاح.' : 'Odoo connection details saved successfully.',
        })
      } else {
        toast({
          title: lang === 'ar' ? 'خطأ في الحفظ' : 'Save Error',
          description: res.error || t('odoo.failSave'),
          variant: 'destructive',
        })
      }
    })
  }

  // Handle disconnect
  const handleDisconnect = () => {
    if (!connection?.id) return

    if (!confirm(lang === 'ar' ? 'هل أنت متأكد من رغبتك في قطع الاتصال وحذف بيانات الربط مع أودو؟' : 'Are you sure you want to disconnect and delete Odoo integration details?')) {
      return
    }

    startDisconnecting(async () => {
      const res = await disconnectOdooConnection(connection.id)
      if (res.success) {
        setConnection(null)
        setConnectionName(lang === 'ar' ? 'أودو الرئيسي' : 'Main Odoo')
        setUrl('')
        setDbName('')
        setUsername('')
        setApiKey('')
        setIsEditing(true)
        setIsTestedSuccessfully(false)
        setTestStatus(null)
        toast({
          title: lang === 'ar' ? 'تم قطع الاتصال' : 'Disconnected',
          description: lang === 'ar' ? 'تم حذف بيانات الاتصال بنظام أودو بنجاح.' : 'Odoo connection details deleted successfully.',
        })
      } else {
        toast({
          title: lang === 'ar' ? 'خطأ في قطع الاتصال' : 'Disconnect Error',
          description: res.error || (lang === 'ar' ? 'حدث خطأ أثناء محاولة قطع الاتصال.' : 'An error occurred while disconnecting.'),
          variant: 'destructive',
        })
      }
    })
  }

  const iconClass = cn("absolute top-3 h-4 w-4 text-muted-foreground", dir === 'ar' ? "right-3" : "left-3")
  const inputClass = cn("rounded-xl", dir === 'ar' ? "pr-10" : "pl-10")

  return (
    <div className="space-y-4" dir={dir}>
      {connection && !isEditing ? (
        // Connected View
        <div className="space-y-4 animate-in fade-in-50 slide-in-from-top-4 duration-300">

          {/* Status banner */}
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <div className="flex-1 text-[11px] font-medium">
              {lang === 'ar' ? 'تم ربط نظام أودو ERP بنجاح ببيئة العمل النشطة. يمكنك الآن مطابقة الحقول ومزامنة البيانات.' : 'Odoo ERP connection completed successfully. You can now configure field mappings and sync data.'}
            </div>
          </div>

          {/* Details Card */}
          <div className="rounded-xl border bg-card p-4 shadow-md relative overflow-hidden">
            <div className={`absolute top-0 right-0 h-1 w-full bg-gradient-to-l from-emerald-500 to-teal-500`} />

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/60">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                    {connection.connection_name || t('db.storeOdoo')}
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-500">
                      {t('db.connected')}
                    </span>
                  </h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {lang === 'ar' ? 'إعدادات الربط وحالة الاتصال نشطة ومستقرة' : 'Integration settings and connection status are active and stable'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    setIsEditing(true)
                    setIsTestedSuccessfully(false)
                    setTestStatus(null)
                  }}
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-border/80 hover:bg-muted gap-1.5 h-8 text-xs"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  {t('ws.editBtn')}
                </Button>

                <Button
                  onClick={handleDisconnect}
                  variant="destructive"
                  size="sm"
                  disabled={isDisconnecting}
                  className="rounded-lg gap-1.5 h-8 text-xs hover:bg-destructive/90"
                >
                  {isDisconnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  {t('zid.disconnect')}
                </Button>
              </div>
            </div>

            <div className="divide-y divide-border/50 pt-4">
              {/* Name */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 first:pt-0 last:pb-0 gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500 dark:text-emerald-400">
                    <Tag className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">{t('odoo.connectionNameLabel')}</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'الاسم المعرّف لقاعدة بيانات أودو المربوطة ببيئة العمل' : 'Display name for the connected Odoo database'}</p>
                  </div>
                </div>
                <div className="sm:text-left text-xs font-semibold text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all">
                  {connection.connection_name}
                </div>
              </div>

              {/* URL */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 dark:text-blue-400">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">{t('odoo.urlLabel')}</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'العنوان أو النطاق المخصص للوصول إلى نظام أودو XML-RPC' : 'The specific server endpoint or domain for Odoo XML-RPC'}</p>
                  </div>
                </div>
                <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                  {connection.url}
                </div>
              </div>

              {/* DB Name */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500 dark:text-purple-400">
                    <Hash className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">{t('odoo.dbLabel')}</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'قاعدة البيانات النشطة والمحددة للاتصال بنظام الـ ERP' : 'The specific active database on your Odoo server'}</p>
                  </div>
                </div>
                <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                  {connection.db_name || '—'}
                </div>
              </div>

              {/* Username */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 last:pb-0 gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 dark:text-amber-400">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">{t('odoo.usernameLabel')}</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'حساب المسؤول أو المستخدم المخصص لإجراء عمليات الربط' : 'The admin or user email address used to authenticate'}</p>
                  </div>
                </div>
                <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                  {connection.username}
                </div>
              </div>
            </div>

            {/* Live Connection Test Results */}
            {testStatus && (
              <div className={`mt-6 p-4 rounded-xl border text-sm flex items-start gap-3 ${testStatus.success
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                  : 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400'
                }`}>
                {testStatus.success ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">{testStatus.success ? (lang === 'ar' ? 'نجح فحص الاتصال' : 'Connection Test Succeeded') : (lang === 'ar' ? 'فشل فحص الاتصال' : 'Connection Test Failed')}</p>
                  <p className="mt-1 text-xs opacity-90">{testStatus.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
         // Disconnected State UI (Form)
        <div className="rounded-2xl border bg-card p-5 shadow-lg relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-primary to-purple-600" />

          <div className="flex items-center justify-between pb-3.5 border-b border-border/60 mb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Database className="h-5.5 w-5.5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">{t('odoo.formTitle')}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">{t('odoo.formDesc')}</p>
              </div>
            </div>
            {connection && (
              <Button
                onClick={() => {
                  setIsEditing(false)
                  setTestStatus(null)
                }}
                variant="ghost"
                size="icon"
                className="rounded-full h-8 w-8"
              >
                <X className="h-4.5 w-4.5" />
              </Button>
            )}
          </div>

          <form onSubmit={handleSaveConnection} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">

              {/* Connection Name */}
              <div className="space-y-2">
                <Label htmlFor="connectionName" className="font-semibold">{t('odoo.connectionNameLabel')}</Label>
                <div className="relative">
                  <Tag className={iconClass} />
                  <Input
                    id="connectionName"
                    value={connectionName}
                    onChange={(e) => setConnectionName(e.target.value)}
                    placeholder={t('odoo.connectionNamePlaceholder')}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              {/* Odoo URL */}
              <div className="space-y-2">
                <Label htmlFor="url" className="font-semibold">{t('odoo.urlLabel')}</Label>
                <div className="relative">
                  <Globe className={iconClass} />
                  <Input
                    id="url"
                    value={url}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder={t('odoo.urlPlaceholder')}
                    type="url"
                    className={cn(inputClass, "font-mono text-left")}
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              {/* Database Name */}
              <div className="space-y-2">
                <Label htmlFor="dbName" className="font-semibold">{t('odoo.dbLabel')}</Label>
                <div className="relative">
                  <Hash className={iconClass} />
                  <Input
                    id="dbName"
                    value={dbName}
                    onChange={(e) => handleDbNameChange(e.target.value)}
                    placeholder={t('odoo.dbPlaceholder')}
                    className={cn(inputClass, "font-mono text-left")}
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              {/* Username */}
              <div className="space-y-2">
                <Label htmlFor="username" className="font-semibold">{t('odoo.usernameLabel')}</Label>
                <div className="relative">
                  <User className={iconClass} />
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder={t('odoo.usernamePlaceholder')}
                    className={cn(inputClass, "font-mono text-left")}
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              {/* Password / API Key */}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="apiKey" className="font-semibold">{t('odoo.passwordLabel')}</Label>
                <div className="relative">
                  <Key className={iconClass} />
                  <Input
                    id="apiKey"
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder={t('odoo.passwordPlaceholder')}
                    type="password"
                    className={cn(inputClass, "font-mono text-left")}
                    dir="ltr"
                    required
                    autoComplete="new-password"
                  />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                  {lang === 'ar' ? (
                    <>💡 <strong>نصيحة أمنية:</strong> يُنصح بشدة بإنشاء واستخدام <strong>مفتاح API (API Key)</strong> مخصص من إعدادات مستخدم أودو (Odoo 14+) بدلاً من استخدام كلمة المرور الرئيسية للحفاظ على أمان حسابك.</>
                  ) : (
                    <>💡 <strong>Security Tip:</strong> It is highly recommended to create and use a dedicated <strong>API Key</strong> from Odoo user settings (Odoo 14+) instead of your master password to keep your account secure.</>
                  )}
                </p>
              </div>

            </div>

            {/* Live Connection Test Results */}
            {testStatus && (
              <div className={`p-4 rounded-xl border text-sm flex items-start gap-3 ${testStatus.success
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
                  : 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400'
                }`}>
                {testStatus.success ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">{testStatus.success ? (lang === 'ar' ? 'نجح فحص الاتصال' : 'Connection Test Succeeded') : (lang === 'ar' ? 'فشل فحص الاتصال' : 'Connection Test Failed')}</p>
                  <p className="mt-1 text-xs opacity-90">{testStatus.message}</p>
                </div>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-wrap gap-4 pt-4 border-t border-border/60">
              {isTestedSuccessfully ? (
                <>
                  <Button
                    type="submit"
                    disabled={isSaving}
                    className="gradient-brand text-white rounded-xl shadow-md px-6 py-5 gap-2 hover:scale-[1.01] transition-transform animate-in zoom-in-95 duration-200"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('odoo.saving')}
                      </>
                    ) : (
                      t('ws.saveBtn')
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={isSaving || isTesting}
                    className="rounded-xl px-6 py-5 gap-2 border-border/80 hover:bg-muted"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {lang === 'ar' ? 'جاري إعادة الفحص...' : 'Re-testing...'}
                      </>
                    ) : (
                      lang === 'ar' ? 'إعادة اختبار الاتصال' : 'Re-test Connection'
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="gradient-brand text-white rounded-xl shadow-md px-6 py-5 gap-2 hover:scale-[1.01] transition-transform"
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === 'ar' ? 'جاري فحص الاتصال...' : 'Testing connection...'}
                    </>
                  ) : (
                    t('odoo.testBtn')
                  )}
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
