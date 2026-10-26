'use client'

import {
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  Key,
  Globe,
  User,
  Hash,
  Tag,
  Edit3,
  X,
  Server,
  ArrowLeft,
  ArrowRight
} from 'lucide-react'
import React, { useEffect, useState, useTransition } from 'react'

import { saveErpConnection, disconnectErpConnection, detectOdooVersion } from '@/app/actions/odoo'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface OdooConnectionFormProps {
  initialConnection: any // DB structure for OdooConnection
}

const erpOptions = [
  {
    id: 'odoo',
    nameAr: 'أودو (Odoo)',
    nameEn: 'Odoo ERP',
    descAr: 'ربط كامل وسلس مع نظام Odoo ERP الخاص بك.',
    descEn: 'Full and seamless integration with Odoo ERP.',
    icon: Database,
  },
  {
    id: 'erpnext',
    nameAr: 'ERPNext',
    nameEn: 'ERPNext',
    descAr: 'الاتصال بنظام ERPNext لإدارة المخزون والمحاسبة.',
    descEn: 'Connect with ERPNext for inventory and accounting.',
    icon: Server,
  }
]

function InfoField({
  label,
  children,
  mono = false,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={cn('mt-1 break-all text-xs text-foreground', mono && 'font-mono')}>{children}</div>
    </div>
  )
}

export default function OdooConnectionForm({ initialConnection }: OdooConnectionFormProps) {
  const { toast } = useToast()
  const { t, lang, dir } = useLanguage()

  // Connection state
  const [connection, setConnection] = useState(initialConnection)
  const [isEditing, setIsEditing] = useState(!initialConnection)

  // Odoo server version, detected automatically after a successful connect.
  // Older connections (saved before the version was stored) get one lazy
  // detection pass instead of a live XML-RPC call on every page load.
  const [odooVersion, setOdooVersion] = useState<string | null>(
    initialConnection?.erp_type === 'odoo' ? (initialConnection?.odoo_version ?? null) : null
  )
  const [isDetectingVersion, setIsDetectingVersion] = useState(false)

  useEffect(() => {
    if (!connection || connection.erp_type !== 'odoo' || connection.odoo_version) return
    let cancelled = false
    setIsDetectingVersion(true)
    detectOdooVersion()
      .then((res) => { if (!cancelled) setOdooVersion(res.success ? (res.version ?? null) : null) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsDetectingVersion(false) })
    return () => { cancelled = true }
  }, [connection])

  // Selected ERP for flow control (null means show selector, non-null means show form)
  const [selectedErp, setSelectedErp] = useState<string | null>(connection?.erp_type || null)

  // Form fields state
  const [erpType, setErpType] = useState<string>(connection?.erp_type || 'odoo')
  const [connectionName, setConnectionName] = useState(
    connection?.connection_name || (lang === 'ar' ? 'أودو الرئيسي' : 'Main Odoo')
  )
  const [url, setUrl] = useState(connection?.url || '')
  const [dbName, setDbName] = useState(connection?.db_name || '')
  const [username, setUsername] = useState(connection?.username || '')
  const [apiKey, setApiKey] = useState('') // API key starts empty for security when modifying
  const [nameTouched, setNameTouched] = useState(false)

  const handleErpSelect = (type: string | null) => {
    setSelectedErp(type)
    if (type) {
      handleErpTypeChange(type)
    }
  }

  const handleErpTypeChange = (type: string) => {
    setErpType(type)
    setTestStatus(null)
  }

  const handleUrlChange = (value: string) => {
    setUrl(value)
    setTestStatus(null)
  }
  const handleDbNameChange = (value: string) => {
    setDbName(value)
    setTestStatus(null)
  }
  const handleUsernameChange = (value: string) => {
    setUsername(value)
    setTestStatus(null)
  }
  const handleApiKeyChange = (value: string) => {
    setApiKey(value)
    setTestStatus(null)
  }

  // P0: connection name is auto-generated from the DB name or server hostname.
  // A manual override lives under Advanced details; untouched by default.
  const autoConnectionName = (() => {
    let host = ''
    try {
      const withProto = url.includes('://') ? url : `https://${url}`
      host = new URL(withProto).hostname
    } catch { host = '' }
    if (erpType === 'odoo') {
      return dbName.trim() || host || (lang === 'ar' ? 'أودو الرئيسي' : 'Main Odoo')
    }
    return host || (lang === 'ar' ? 'ERPNext الرئيسي' : 'Main ERPNext')
  })()
  const finalConnectionName = nameTouched && connectionName.trim() ? connectionName.trim() : autoConnectionName

  // Dynamic labels and values based on selected ERP Type (odoo | erpnext)
  const formTitle = erpType === 'odoo'
    ? (lang === 'ar' ? 'بيانات اتصال نظام أودو (Odoo)' : 'Odoo ERP Connection Details')
    : (lang === 'ar' ? 'بيانات اتصال نظام ERPNext' : 'ERPNext Connection Details')

  const formDesc = erpType === 'odoo'
    ? (lang === 'ar' ? 'يرجى إدخال تفاصيل خادم أودو بشكل صحيح والتأكد من إمكانية الوصول إليه عبر الإنترنت.' : 'Please enter your Odoo server details correctly and ensure it is accessible online.')
    : (lang === 'ar' ? 'يرجى إدخال تفاصيل خادم ERPNext ومفاتيح API للاتصال.' : 'Please enter your ERPNext server details and API credentials to connect.')

  const urlLabel = erpType === 'odoo'
    ? (lang === 'ar' ? 'رابط خادم أودو (URL)' : 'Odoo Server URL')
    : (lang === 'ar' ? 'رابط خادم ERPNext (URL)' : 'ERPNext Instance URL')

  const urlPlaceholder = erpType === 'odoo'
    ? 'https://your-odoo-instance.com'
    : 'https://your-erpnext-instance.com'

  const usernameLabel = erpType === 'odoo'
    ? (lang === 'ar' ? 'اسم المستخدم / البريد الإلكتروني' : 'Username / Email')
    : (lang === 'ar' ? 'مفتاح واجهة البرمجة (API Key)' : 'API Key')

  const usernamePlaceholder = erpType === 'odoo'
    ? 'admin@example.com'
    : 'api_key_xxxxxxxx'

  const passwordLabel = erpType === 'odoo'
    ? (lang === 'ar' ? 'كلمة المرور / مفتاح الوصول (API Key)' : 'Password / API Key')
    : (lang === 'ar' ? 'الرمز السري (API Secret)' : 'API Secret')

  const passwordPlaceholder = '••••••••••••••••'

  const securityTip = erpType === 'odoo'
    ? (lang === 'ar'
      ? 'يُنصح بشدة بإنشاء واستخدام مفتاح API (API Key) مخصص من إعدادات مستخدم أودو (Odoo 14+) بدلاً من استخدام كلمة المرور الرئيسية للحفاظ على أمان حسابك.'
      : 'It is highly recommended to create and use a dedicated API Key from Odoo user settings (Odoo 14+) instead of your master password to keep your account secure.')
    : (lang === 'ar'
      ? 'يجب إنشاء مفتاح وسر API (API Key & API Secret) من إعدادات المستخدم داخل لوحة تحكم ERPNext.'
      : 'You need to generate an API Key and API Secret from the User settings within your ERPNext dashboard.')

  const getErpTypeName = (type: string) => {
    if (type === 'odoo') return lang === 'ar' ? 'أودو (Odoo)' : 'Odoo'
    if (type === 'erpnext') return lang === 'ar' ? 'ERPNext' : 'ERPNext'
    return type
  }

  const getConnectedUsernameLabel = (type: string) => {
    if (type === 'odoo') return lang === 'ar' ? 'اسم المستخدم / البريد الإلكتروني' : 'Username / Email'
    return lang === 'ar' ? 'مفتاح واجهة البرمجة (API Key)' : 'API Key'
  }

  // Transitions/Loading states
  const [isSaving, startSaving] = useTransition()
  const [isDisconnecting, startDisconnecting] = useTransition()

  // Real-time connection test results status
  const [testStatus, setTestStatus] = useState<{
    success?: boolean
    message?: string
  } | null>(null)

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)

  // P0: single "Test & Save" action. saveErpConnection already tests the
  // credentials server-side before persisting, so one click covers both.
  const handleTestAndSave = (e: React.FormEvent) => {
    e.preventDefault()
    setTestStatus(null)
    startSaving(async () => {
      const res = await saveErpConnection({
        connectionName: finalConnectionName,
        erpType,
        url,
        dbName: erpType === 'odoo' ? dbName : '',
        username,
        apiKey,
      })

      if (res.success) {
        // Strip password key from result before updating frontend state
        if (res.connection) {
          delete res.connection.password;
        }
        setConnection(res.connection)
        setOdooVersion(res.connection?.odoo_version ?? null)
        setIsEditing(false)
        setNameTouched(false)
        setApiKey('') // Force clear key state completely after save
        setTestStatus({
          success: true,
          message: lang === 'ar' ? 'تم الاتصال بنظام أودو بنجاح.' : 'Connected to Odoo successfully.',
        })
        toast({
          title: t('odoo.successSave'),
          description: lang === 'ar' ? 'تم ربط وحفظ إعدادات أودو بنجاح.' : 'Odoo connection details saved successfully.',
        })
      } else {
        setTestStatus({
          success: false,
          message: res.error || (lang === 'ar' ? 'فشل الاتصال بنظام أودو.' : 'Connection to Odoo failed.'),
        })
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
    setShowDisconnectConfirm(true)
  }

  const handleDisconnectConfirm = async () => {
    if (!connection?.id) return
    setShowDisconnectConfirm(false)

    await startDisconnecting(async () => {
      const res = await disconnectErpConnection(connection.id)
      if (res.success) {
        setConnection(null)
        setOdooVersion(null)
        setConnectionName(lang === 'ar' ? 'أودو الرئيسي' : 'Main Odoo')
        setUrl('')
        setDbName('')
        setUsername('')
        setApiKey('')
        setErpType('odoo')
        setSelectedErp(null)
        setIsEditing(true)
        setNameTouched(false)
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

  const iconClass = cn("absolute top-3 h-4 w-4 text-muted-foreground", dir === 'rtl' ? "right-3" : "left-3")
  const inputClass = cn("rounded-xl", dir === 'rtl' ? "pr-10" : "pl-10")

  return (
    <><div className="space-y-4" dir={dir}>
      {connection && !isEditing ? (
        // Connected View - Odoo Record Style
        <div className="space-y-5 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base font-bold text-foreground">
                  {connection.connection_name || t('db.storeOdoo')}
                </h1>
                <span className="inline-flex items-center gap-1 border border-success/25 bg-success/10 px-2 py-0.5 text-[10px] font-bold text-success">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('db.connected')}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {lang === 'ar' ? 'إعدادات الربط وحالة الاتصال نشطة ومستقرة' : 'Integration settings and connection status are active and stable'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => {
                  setIsEditing(true)
                  setTestStatus(null)
                }}
                variant="outline"
                size="sm"
                className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold"
              >
                <Edit3 className="h-3.5 w-3.5" />
                {t('ws.editBtn')}
              </Button>

              <Button
                onClick={handleDisconnect}
                variant="outline"
                size="sm"
                disabled={isDisconnecting}
                className="h-8 gap-1 rounded-none px-3 text-[10px] font-bold text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/20"
              >
                {isDisconnecting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t('zid.disconnect')}
              </Button>
            </div>
          </div>

          {/* Basic record data */}
          <div className="border border-border bg-card p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <InfoField label={lang === 'ar' ? 'نوع النظام' : 'System Type'}>
                {getErpTypeName(connection.erp_type)}
              </InfoField>
              {connection.erp_type === 'odoo' && (
                <InfoField label={lang === 'ar' ? 'إصدار أودو' : 'Odoo Version'} mono>
                  {odooVersion
                    ? `Odoo ${odooVersion}`
                    : isDetectingVersion
                      ? (lang === 'ar' ? 'جارٍ الكشف…' : 'Detecting…')
                      : '—'}
                </InfoField>
              )}
              <InfoField label={t('odoo.connectionNameLabel')}>
                {connection.connection_name || '—'}
              </InfoField>
              <InfoField label={t('odoo.urlLabel')} mono>
                {connection.url || '—'}
              </InfoField>
              {connection.erp_type === 'odoo' && (
                <InfoField label={t('odoo.dbLabel')} mono>
                  {connection.db_name || '—'}
                </InfoField>
              )}
              <InfoField label={getConnectedUsernameLabel(connection.erp_type)} mono>
                {connection.username || '—'}
              </InfoField>
              <InfoField label={lang === 'ar' ? 'معرف المزامنة' : 'Sync ID'} mono>
                {connection.id || '—'}
              </InfoField>
              <InfoField label={lang === 'ar' ? 'حالة الربط' : 'Status'}>
                <span className="text-emerald-600 font-semibold">{t('db.connected')}</span>
              </InfoField>
            </div>
          </div>

          {/* Status Details Card */}
          <div className="overflow-hidden border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5">
              <span className="text-[10px] font-bold text-muted-foreground">
                {lang === 'ar' ? 'تفاصيل المزامنة والربط' : 'Sync & Integration Details'}
              </span>
              <span className="text-[9px] font-mono text-muted-foreground">
                {connection.erp_type === 'odoo' ? 'Odoo ERP' : 'ERPNext'}
              </span>
            </div>
            <div className="p-4 space-y-3 text-xs leading-relaxed">
              <div className="flex items-center gap-2 text-primary font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                <span>
                  {lang === 'ar'
                    ? 'تم ربط نظام أودو ERP بنجاح ببيئة العمل النشطة. يمكنك الآن مطابقة الحقول ومزامنة البيانات.'
                    : 'Odoo ERP connection completed successfully. You can now configure field mappings and sync data.'}
                </span>
              </div>
            </div>
          </div>

          {/* Live Connection Test Results */}
          {testStatus && (
            <div
              className={cn(
                'flex items-start gap-2 border p-3 text-xs',
                testStatus.success
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-destructive/15 bg-destructive/5 text-destructive'
              )}
            >
              {testStatus.success ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="space-y-0.5">
                <div className="font-bold">
                  {testStatus.success
                    ? (lang === 'ar' ? 'نجح فحص الاتصال' : 'Connection Test Succeeded')
                    : (lang === 'ar' ? 'فشل فحص الاتصال' : 'Connection Test Failed')}
                </div>
                <div className="break-all font-mono text-[11px] leading-relaxed opacity-90">
                  {testStatus.message}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : selectedErp === null ? (
        // ERP Selection View
        <div className="rounded-xl border bg-card p-5 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3 pb-3.5 border-b border-border mb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Database className="h-5.5 w-5.5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                {lang === 'ar' ? 'ربط نظام الـ ERP' : 'Connect ERP System'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lang === 'ar' ? 'اختر برنامج الـ ERP الذي تستخدمه لربطه ببيئة عملك.' : 'Select the ERP program you use to connect it with your workspace.'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Label className="block text-[11px] font-bold text-muted-foreground">
              {lang === 'ar' ? 'اختر النظام للبدء' : 'Select System to Begin'}
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {erpOptions.map((opt) => {
                const Icon = opt.icon
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleErpSelect(opt.id)}
                    className="flex items-center gap-3.5 p-3.5 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-primary/[0.04] transition-colors cursor-pointer text-right w-full"
                  >
                    <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex flex-col text-right">
                      <span className="text-xs font-bold text-foreground">
                        {lang === 'ar' ? opt.nameAr : opt.nameEn}
                      </span>
                      <span className="text-[9px] text-muted-foreground mt-0.5 leading-snug">
                        {lang === 'ar' ? opt.descAr : opt.descEn}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        // Disconnected State UI (Form) with Help Guide Sidebar
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          {/* Form Box */}
          <div className="lg:col-span-2 rounded-xl border bg-card p-5 flex flex-col justify-between">

            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 pb-5 border-b border-border mb-5">
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleErpSelect(null)}
                    className="rounded-lg h-8 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    {dir === 'rtl' ? <ArrowRight className="h-3.5 w-3.5" /> : <ArrowLeft className="h-3.5 w-3.5" />}
                    {lang === 'ar' ? 'رجوع' : 'Back'}
                  </Button>
                  <div className="h-4 w-px bg-border mx-1" />
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Database className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">{formTitle}</h2>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{formDesc}</p>
                  </div>
                </div>
                {connection && (
                  <Button
                    onClick={() => {
                      setIsEditing(false)
                      setTestStatus(null)
                      setErpType(connection.erp_type || 'odoo')
                      setSelectedErp(connection.erp_type || 'odoo')
                    }}
                    variant="ghost"
                    size="icon"
                    className="rounded-full h-8 w-8"
                  >
                    <X className="h-4.5 w-4.5" />
                  </Button>
                )}
              </div>

              <form onSubmit={handleTestAndSave} className="space-y-6">
                {/* Auto connection name (P0): derived from DB/hostname, override under Advanced */}
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">{finalConnectionName}</span>
                  {' · '}{t('odoo.autoNameHelp')}
                </div>
                <div className="grid gap-5 sm:grid-cols-2">

                  {/* Connection Name override (Advanced, optional) */}
                  <details className="sm:col-span-2 border border-border rounded-xl">
                    <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-foreground/80 hover:bg-muted/50">
                      {t('odoo.advancedDetails')}
                    </summary>
                    <div className="border-t border-border p-3 space-y-1.5">
                      <Label htmlFor="connectionName" className="block text-[11px] font-bold text-muted-foreground">
                        {t('odoo.connectionNameLabel')}
                      </Label>
                      <div className="relative rounded-xl border border-border bg-card p-0.5">
                        <Tag className={iconClass} />
                        <Input
                          id="connectionName"
                          value={connectionName}
                          onChange={(e) => { setConnectionName(e.target.value); setNameTouched(true) }}
                          placeholder={t('odoo.connectionNamePlaceholder')}
                          className={cn(inputClass, "border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0")}
                        />
                      </div>
                    </div>
                  </details>

                  {/* ERP URL */}
                  <div className="space-y-1.5">
                    <Label htmlFor="url" className="block text-[11px] font-bold text-muted-foreground">
                      {urlLabel}
                    </Label>
                    <div className="relative rounded-xl border border-border bg-card p-0.5">
                      <Globe className={iconClass} />
                      <Input
                        id="url"
                        value={url}
                        onChange={(e) => handleUrlChange(e.target.value)}
                        placeholder={urlPlaceholder}
                        type="url"
                        className={cn(inputClass, "border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-left")}
                        dir="ltr"
                        required
                      />
                    </div>
                  </div>

                  {/* Database Name (Only Odoo) */}
                  {erpType === 'odoo' && (
                    <div className="space-y-1.5">
                      <Label htmlFor="dbName" className="block text-[11px] font-bold text-muted-foreground">
                        {t('odoo.dbLabel')}
                      </Label>
                      <div className="relative rounded-xl border border-border bg-card p-0.5">
                        <Hash className={iconClass} />
                        <Input
                          id="dbName"
                          value={dbName}
                          onChange={(e) => handleDbNameChange(e.target.value)}
                          placeholder={t('odoo.dbPlaceholder')}
                          className={cn(inputClass, "border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-left")}
                          dir="ltr"
                          required
                        />
                      </div>
                    </div>
                  )}

                  {/* Username */}
                  <div className={cn("space-y-1.5", erpType !== 'odoo' ? "sm:col-span-1" : "")}>
                    <Label htmlFor="username" className="block text-[11px] font-bold text-muted-foreground">
                      {usernameLabel}
                    </Label>
                    <div className="relative rounded-xl border border-border bg-card p-0.5">
                      <User className={iconClass} />
                      <Input
                        id="username"
                        value={username}
                        onChange={(e) => handleUsernameChange(e.target.value)}
                        placeholder={usernamePlaceholder}
                        className={cn(inputClass, "border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-left")}
                        dir="ltr"
                        required
                      />
                    </div>
                  </div>

                  {/* Password / API Key */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="apiKey" className="block text-[11px] font-bold text-muted-foreground">
                      {passwordLabel}
                    </Label>
                    <div className="relative rounded-xl border border-border bg-card p-0.5">
                      <Key className={iconClass} />
                      <Input
                        id="apiKey"
                        value={apiKey}
                        onChange={(e) => handleApiKeyChange(e.target.value)}
                        placeholder={passwordPlaceholder}
                        type="password"
                        className={cn(inputClass, "border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-left")}
                        dir="ltr"
                        required
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  {/* Security Tip Box */}
                  <div className="sm:col-span-2 rounded-xl border border-border bg-muted p-4 flex flex-col justify-center text-[11px] leading-relaxed text-muted-foreground space-y-1">
                    <span className="font-bold text-foreground flex items-center gap-1.5">
                      {lang === 'ar' ? 'نصيحة أمنية' : 'Security Tip'}
                    </span>
                    <span>
                      {securityTip}
                    </span>
                  </div>

                </div>

                {/* Live Connection Test Results */}
                {testStatus && (
                  <div className={`p-4 rounded-xl border text-sm flex items-start gap-3 ${testStatus.success
                      ? 'bg-primary/[0.06] border-primary/25 text-primary'
                      : 'bg-destructive/10 border-destructive/20 text-destructive'
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

                {/* Single Test & Save button (P0) */}
                <div className="flex flex-wrap gap-4 pt-4 border-t border-border">
                  <Button
                    type="submit"
                    variant="brand"
                    disabled={isSaving}
                    className="rounded-xl px-6 py-5 gap-2"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('odoo.testingAndSaving')}
                      </>
                    ) : (
                      t('odoo.testAndSave')
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>

          {/* Help Guide Box */}
          <div className="rounded-xl border bg-card p-5 space-y-4 self-start">
            <div className="flex items-center gap-2 pb-3 border-b border-border">
              <h3 className="text-xs font-bold text-foreground">
                {lang === 'ar' ? 'كيفية الحصول على بيانات الاتصال؟' : 'How to get connection details?'}
              </h3>
            </div>

            {erpType === 'odoo' && (
              <div className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                <div>
                  <h4 className="font-bold text-foreground mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    {lang === 'ar' ? 'رابط خادم أودو (Server URL)' : 'Odoo Server URL'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'هو الرابط المباشر لموقع مثيل أودو الخاص بك (مثال: https://mycompany.odoo.com).' 
                      : 'The direct URL to your Odoo instance (e.g., https://mycompany.odoo.com).'}
                  </p>
                </div>
                
                <div>
                  <h4 className="font-bold text-foreground mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    {lang === 'ar' ? 'اسم قاعدة البيانات (Database Name)' : 'Database Name'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'يمكنك معرفته من شاشة تسجيل الدخول في أودو، أو زيارة الرابط الخاص بك متبوعاً بـ /web/database/selector.' 
                      : 'Found on the Odoo login screen, or by visiting your URL followed by /web/database/selector.'}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-foreground mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    {lang === 'ar' ? 'اسم المستخدم (Username)' : 'Username'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'البريد الإلكتروني الذي تستخدمه لتسجيل الدخول إلى حسابك في أودو.' 
                      : 'The email address you use to sign in to your Odoo instance.'}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-foreground mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    {lang === 'ar' ? 'مفتاح واجهة البرمجة (API Key)' : 'API Key'}
                  </h4>
                  <div className="space-y-1">
                    <span>{lang === 'ar' ? 'للحصول على مفتاح الوصول الآمن:' : 'To get your secure API access key:'}</span>
                    <ol className="list-decimal list-inside pr-1 space-y-1 text-[11px] text-muted-foreground">
                      <li>{lang === 'ar' ? 'سجل الدخول إلى حسابك في أودو.' : 'Sign in to Odoo.'}</li>
                      <li>{lang === 'ar' ? 'اذهب للملف الشخصي (My Profile).' : 'Go to My Profile.'}</li>
                      <li>{lang === 'ar' ? 'اختر تبويب أمان الحساب (Account Security).' : 'Choose Account Security tab.'}</li>
                      <li>{lang === 'ar' ? 'اضغط على Developer API Keys وقم بإنشاء مفتاح جديد.' : 'Click Developer API Keys and generate a new key.'}</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {erpType === 'erpnext' && (
              <div className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                <div>
                  <h4 className="font-bold text-foreground mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    {lang === 'ar' ? 'رابط الخادم (Instance URL)' : 'Instance URL'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'الرابط المباشر الذي تستخدمه لفتح لوحة تحكم ERPNext.' 
                      : 'The direct URL of your ERPNext dashboard.'}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-foreground mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                    {lang === 'ar' ? 'مفاتيح API (API Key & Secret)' : 'API Key & Secret'}
                  </h4>
                  <div className="space-y-1">
                    <span>{lang === 'ar' ? 'للحصول على مفتاح وسر API:' : 'To generate API Key & Secret:'}</span>
                    <ol className="list-decimal list-inside pr-1 space-y-1 text-[11px] text-muted-foreground">
                      <li>{lang === 'ar' ? 'اذهب لصفحة المستخدمين (Users).' : 'Go to Users directory.'}</li>
                      <li>{lang === 'ar' ? 'اختر حساب المستخدم المخصص للربط.' : 'Select the user account.'}</li>
                      <li>{lang === 'ar' ? 'في قسم API Access، اضغط على Generate Keys.' : 'Under API Access section, click Generate Keys.'}</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      <ConfirmDialog
        open={showDisconnectConfirm}
        onOpenChange={setShowDisconnectConfirm}
        title={lang === 'ar' ? 'قطع الاتصال' : 'Disconnect'}
        description={lang === 'ar' ? 'هل أنت متأكد من رغبتك في قطع الاتصال وحذف بيانات الربط؟' : 'Are you sure you want to disconnect and delete integration details?'}
        confirmText={lang === 'ar' ? 'قطع الاتصال' : 'Disconnect'}
        onConfirm={handleDisconnectConfirm}
      />
    </>
  )
}
