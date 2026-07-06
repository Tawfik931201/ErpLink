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
  X,
  Briefcase,
  Server,
  ArrowLeft,
  ArrowRight
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { testErpConnection, saveErpConnection, disconnectErpConnection } from '@/app/actions/odoo'
import { useLanguage } from '@/components/language-provider'
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
    color: 'from-purple-500/10 to-indigo-500/10 text-indigo-500 border-indigo-500/30',
    activeBg: 'border-indigo-500 bg-indigo-500/5 ring-2 ring-indigo-500/20'
  },
  {
    id: 'zoho',
    nameAr: 'زوهو (Zoho)',
    nameEn: 'Zoho ERP',
    descAr: 'مزامنة الفواتير والعملاء مع Zoho Books.',
    descEn: 'Sync invoices and customers with Zoho Books.',
    icon: Briefcase,
    color: 'from-amber-500/10 to-orange-500/10 text-orange-500 border-orange-500/30',
    activeBg: 'border-orange-500 bg-orange-500/5 ring-2 ring-orange-500/20'
  },
  {
    id: 'erpnext',
    nameAr: 'ERPNext',
    nameEn: 'ERPNext',
    descAr: 'الاتصال بنظام ERPNext لإدارة المخزون والمحاسبة.',
    descEn: 'Connect with ERPNext for inventory and accounting.',
    icon: Server,
    color: 'from-sky-500/10 to-blue-500/10 text-blue-500 border-blue-500/30',
    activeBg: 'border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/20'
  }
]

export default function OdooConnectionForm({ initialConnection }: OdooConnectionFormProps) {
  const { toast } = useToast()
  const { t, lang, dir } = useLanguage()

  // Connection state
  const [connection, setConnection] = useState(initialConnection)
  const [isEditing, setIsEditing] = useState(!initialConnection)

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
  const [isTestedSuccessfully, setIsTestedSuccessfully] = useState(false)

  const handleErpSelect = (type: string | null) => {
    setSelectedErp(type)
    if (type) {
      handleErpTypeChange(type)
    }
  }

  const handleErpTypeChange = (type: string) => {
    setErpType(type)
    setIsTestedSuccessfully(false)
    setTestStatus(null)
    if (
      connectionName === 'أودو الرئيسي' ||
      connectionName === 'Main Odoo' ||
      connectionName === 'زوهو الرئيسي' ||
      connectionName === 'Main Zoho' ||
      connectionName === 'ERPNext الرئيسي' ||
      connectionName === 'Main ERPNext'
    ) {
      if (type === 'odoo') {
        setConnectionName(lang === 'ar' ? 'أودو الرئيسي' : 'Main Odoo')
      } else if (type === 'zoho') {
        setConnectionName(lang === 'ar' ? 'زوهو الرئيسي' : 'Main Zoho')
      } else {
        setConnectionName(lang === 'ar' ? 'ERPNext الرئيسي' : 'Main ERPNext')
      }
    }
  }

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

  // Dynamic labels and values based on selected ERP Type
  const formTitle = erpType === 'odoo'
    ? (lang === 'ar' ? 'بيانات اتصال نظام أودو (Odoo)' : 'Odoo ERP Connection Details')
    : erpType === 'zoho'
    ? (lang === 'ar' ? 'بيانات اتصال نظام زوهو (Zoho)' : 'Zoho ERP Connection Details')
    : (lang === 'ar' ? 'بيانات اتصال نظام ERPNext' : 'ERPNext Connection Details')

  const formDesc = erpType === 'odoo'
    ? (lang === 'ar' ? 'يرجى إدخال تفاصيل خادم أودو بشكل صحيح والتأكد من إمكانية الوصول إليه عبر الإنترنت.' : 'Please enter your Odoo server details correctly and ensure it is accessible online.')
    : erpType === 'zoho'
    ? (lang === 'ar' ? 'يرجى إدخال تفاصيل حساب زوهو وبيانات اعتماد API للاتصال.' : 'Please enter your Zoho account details and API credentials to connect.')
    : (lang === 'ar' ? 'يرجى إدخال تفاصيل خادم ERPNext ومفاتيح API للاتصال.' : 'Please enter your ERPNext server details and API credentials to connect.')

  const urlLabel = erpType === 'odoo'
    ? (lang === 'ar' ? 'رابط خادم أودو (URL)' : 'Odoo Server URL')
    : erpType === 'zoho'
    ? (lang === 'ar' ? 'رابط خادم زوهو (API URL)' : 'Zoho API URL')
    : (lang === 'ar' ? 'رابط خادم ERPNext (URL)' : 'ERPNext Instance URL')

  const urlPlaceholder = erpType === 'odoo'
    ? 'https://your-odoo-instance.com'
    : erpType === 'zoho'
    ? 'https://accounts.zoho.com'
    : 'https://your-erpnext-instance.com'

  const usernameLabel = erpType === 'odoo'
    ? (lang === 'ar' ? 'اسم المستخدم / البريد الإلكتروني' : 'Username / Email')
    : erpType === 'zoho'
    ? (lang === 'ar' ? 'معرف العميل (Client ID)' : 'Client ID')
    : (lang === 'ar' ? 'مفتاح واجهة البرمجة (API Key)' : 'API Key')

  const usernamePlaceholder = erpType === 'odoo'
    ? 'admin@example.com'
    : erpType === 'zoho'
    ? '1000.XXXXXXXXXXXXXXXXXXXXXXXX'
    : 'api_key_xxxxxxxx'

  const passwordLabel = erpType === 'odoo'
    ? (lang === 'ar' ? 'كلمة المرور / مفتاح الوصول (API Key)' : 'Password / API Key')
    : erpType === 'zoho'
    ? (lang === 'ar' ? 'الرمز السري (Client Secret)' : 'Client Secret')
    : (lang === 'ar' ? 'الرمز السري (API Secret)' : 'API Secret')

  const passwordPlaceholder = erpType === 'odoo'
    ? '••••••••••••••••'
    : erpType === 'zoho'
    ? '••••••••••••••••'
    : '••••••••••••••••'

  const securityTip = erpType === 'odoo'
    ? (lang === 'ar'
      ? 'يُنصح بشدة بإنشاء واستخدام مفتاح API (API Key) مخصص من إعدادات مستخدم أودو (Odoo 14+) بدلاً من استخدام كلمة المرور الرئيسية للحفاظ على أمان حسابك.'
      : 'It is highly recommended to create and use a dedicated API Key from Odoo user settings (Odoo 14+) instead of your master password to keep your account secure.')
    : erpType === 'zoho'
    ? (lang === 'ar'
      ? 'يجب إنشاء تطبيق عميل (Client Application) في بوابة Zoho Developer للحصول على معرف العميل (Client ID) والسر الخاص بالعميل (Client Secret).'
      : 'You need to register a client application in the Zoho Developer Console to obtain a Client ID and Client Secret.')
    : (lang === 'ar'
      ? 'يجب إنشاء مفتاح وسر API (API Key & API Secret) من إعدادات المستخدم داخل لوحة تحكم ERPNext.'
      : 'You need to generate an API Key and API Secret from the User settings within your ERPNext dashboard.')

  const getErpTypeName = (type: string) => {
    if (type === 'odoo') return lang === 'ar' ? 'أودو (Odoo)' : 'Odoo'
    if (type === 'zoho') return lang === 'ar' ? 'زوهو (Zoho)' : 'Zoho'
    if (type === 'erpnext') return lang === 'ar' ? 'ERPNext' : 'ERPNext'
    return type
  }

  const getConnectedUsernameLabel = (type: string) => {
    if (type === 'odoo') return lang === 'ar' ? 'اسم المستخدم / البريد الإلكتروني' : 'Username / Email'
    if (type === 'zoho') return lang === 'ar' ? 'معرف العميل (Client ID)' : 'Client ID'
    return lang === 'ar' ? 'مفتاح واجهة البرمجة (API Key)' : 'API Key'
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
      const res = await testErpConnection(url, erpType === 'odoo' ? dbName : '', username, apiKey, erpType)
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
      const res = await saveErpConnection({
        connectionName,
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
      const res = await disconnectErpConnection(connection.id)
      if (res.success) {
        setConnection(null)
        setConnectionName(lang === 'ar' ? 'أودو الرئيسي' : 'Main Odoo')
        setUrl('')
        setDbName('')
        setUsername('')
        setApiKey('')
        setErpType('odoo')
        setSelectedErp(null)
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

  const iconClass = cn("absolute top-3 h-4 w-4 text-muted-foreground", dir === 'rtl' ? "right-3" : "left-3")
  const inputClass = cn("rounded-xl", dir === 'rtl' ? "pr-10" : "pl-10")

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
              {/* ERP Program Type */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 first:pt-0 gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500 dark:text-indigo-400">
                    <Database className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">{lang === 'ar' ? 'نوع نظام الـ ERP' : 'ERP System Type'}</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'نظام إدارة موارد المؤسسة المختار للربط' : 'Selected ERP system type connected to the workspace'}</p>
                  </div>
                </div>
                <div className="sm:text-left text-xs font-semibold text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 capitalize">
                  {getErpTypeName(connection.erp_type)}
                </div>
              </div>

              {/* Name */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2">
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
                    <p className="text-[10px] text-muted-foreground mt-0.5">{lang === 'ar' ? 'العنوان أو النطاق المخصص للوصول إلى نظام الـ ERP' : 'The specific server endpoint or domain for the ERP'}</p>
                  </div>
                </div>
                <div className="sm:text-left font-mono text-xs text-foreground bg-muted/30 px-3 py-1.5 rounded-lg border border-border/40 break-all" dir="ltr">
                  {connection.url}
                </div>
              </div>

              {/* DB Name */}
              {connection.erp_type === 'odoo' && (
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
              )}

              {/* Username */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 last:pb-0 gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 dark:text-amber-400">
                    <User className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">{getConnectedUsernameLabel(connection.erp_type)}</h3>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {connection.erp_type === 'odoo'
                        ? (lang === 'ar' ? 'حساب المسؤول أو المستخدم المخصص لإجراء عمليات الربط' : 'The admin or user email address used to authenticate')
                        : connection.erp_type === 'zoho'
                        ? (lang === 'ar' ? 'معرف العميل (Client ID) المستخدم للمصادقة عبر API' : 'The Client ID used to authenticate with Zoho APIs')
                        : (lang === 'ar' ? 'مفتاح واجهة البرمجة (API Key) المستخدم للمصادقة' : 'The API Key used to authenticate with ERPNext')}
                    </p>
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
      ) : selectedErp === null ? (
        // ERP Selection View
        <div className="rounded-2xl border bg-card p-5 shadow-lg relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-primary to-purple-600" />
          <div className="flex items-center gap-3 pb-3.5 border-b border-border/60 mb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Database className="h-5.5 w-5.5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {lang === 'ar' ? 'ربط نظام الـ ERP' : 'Connect ERP System'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lang === 'ar' ? 'اختر برنامج الـ ERP الذي تستخدمه لربطه ببيئة عملك.' : 'Select the ERP program you use to connect it with your workspace.'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
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
                    className="flex items-center gap-3.5 p-3.5 rounded-xl border border-border hover:border-slate-300 dark:hover:border-slate-700 bg-slate-500/5 hover:bg-slate-500/10 transition-all duration-200 cursor-pointer text-right w-full hover:scale-[1.02] active:scale-[0.98] shadow-sm"
                  >
                    <div className={cn("p-2 rounded-lg bg-gradient-to-br shrink-0", opt.color)}>
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
          <div className="lg:col-span-2 rounded-2xl border bg-card p-5 shadow-lg relative overflow-hidden flex flex-col justify-between">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-primary to-purple-600" />

            <div>
              <div className="flex items-center justify-between pb-3.5 border-b border-border/60 mb-5">
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
                  <div className="h-4 w-px bg-border/60 mx-1" />
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

              <form onSubmit={handleSaveConnection} className="space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">

                  {/* Connection Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="connectionName" className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
                      {t('odoo.connectionNameLabel')}
                    </Label>
                    <div className="relative rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
                      <Tag className={iconClass} />
                      <Input
                        id="connectionName"
                        value={connectionName}
                        onChange={(e) => setConnectionName(e.target.value)}
                        placeholder={t('odoo.connectionNamePlaceholder')}
                        className={cn(inputClass, "border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0")}
                        required
                      />
                    </div>
                  </div>

                  {/* ERP URL */}
                  <div className="space-y-1.5">
                    <Label htmlFor="url" className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
                      {urlLabel}
                    </Label>
                    <div className="relative rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
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
                      <Label htmlFor="dbName" className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
                        {t('odoo.dbLabel')}
                      </Label>
                      <div className="relative rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
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
                    <Label htmlFor="username" className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
                      {usernameLabel}
                    </Label>
                    <div className="relative rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
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
                    <Label htmlFor="apiKey" className="block text-[11px] font-bold text-slate-400 dark:text-slate-300">
                      {passwordLabel}
                    </Label>
                    <div className="relative rounded-xl border border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-0.5">
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
                  <div className="sm:col-span-2 rounded-xl border border-slate-200/20 dark:border-slate-800 bg-slate-500/5 dark:bg-slate-950/40 p-4 flex flex-col justify-center text-[11px] leading-relaxed text-slate-400 space-y-1">
                    <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      💡 {lang === 'ar' ? 'نصيحة أمنية' : 'Security Tip'}
                    </span>
                    <span>
                      {securityTip}
                    </span>
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
          </div>

          {/* Help Guide Box */}
          <div className="rounded-2xl border bg-slate-50/50 dark:bg-slate-900/30 p-5 space-y-4 relative overflow-hidden self-start">
            <div className="flex items-center gap-2 pb-3 border-b border-border/60">
              <span className="text-base">📋</span>
              <h3 className="text-xs font-bold text-foreground">
                {lang === 'ar' ? 'كيفية الحصول على بيانات الاتصال؟' : 'How to get connection details?'}
              </h3>
            </div>

            {erpType === 'odoo' && (
              <div className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                    {lang === 'ar' ? 'رابط خادم أودو (Server URL)' : 'Odoo Server URL'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'هو الرابط المباشر لموقع مثيل أودو الخاص بك (مثال: https://mycompany.odoo.com).' 
                      : 'The direct URL to your Odoo instance (e.g., https://mycompany.odoo.com).'}
                  </p>
                </div>
                
                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                    {lang === 'ar' ? 'اسم قاعدة البيانات (Database Name)' : 'Database Name'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'يمكنك معرفته من شاشة تسجيل الدخول في أودو، أو زيارة الرابط الخاص بك متبوعاً بـ /web/database/selector.' 
                      : 'Found on the Odoo login screen, or by visiting your URL followed by /web/database/selector.'}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                    {lang === 'ar' ? 'اسم المستخدم (Username)' : 'Username'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'البريد الإلكتروني الذي تستخدمه لتسجيل الدخول إلى حسابك في أودو.' 
                      : 'The email address you use to sign in to your Odoo instance.'}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                    {lang === 'ar' ? 'مفتاح واجهة البرمجة (API Key)' : 'API Key'}
                  </h4>
                  <div className="space-y-1">
                    <span>{lang === 'ar' ? 'للحصول على مفتاح الوصول الآمن:' : 'To get your secure API access key:'}</span>
                    <ol className="list-decimal list-inside pr-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <li>{lang === 'ar' ? 'سجل الدخول إلى حسابك في أودو.' : 'Sign in to Odoo.'}</li>
                      <li>{lang === 'ar' ? 'اذهب للملف الشخصي (My Profile).' : 'Go to My Profile.'}</li>
                      <li>{lang === 'ar' ? 'اختر تبويب أمان الحساب (Account Security).' : 'Choose Account Security tab.'}</li>
                      <li>{lang === 'ar' ? 'اضغط على Developer API Keys وقم بإنشاء مفتاح جديد.' : 'Click Developer API Keys and generate a new key.'}</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {erpType === 'zoho' && (
              <div className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {lang === 'ar' ? 'رابط خادم زوهو (API URL)' : 'Zoho API URL'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'الرابط الخاص بحساب زوهو الخاص بك (مثال: https://accounts.zoho.com).' 
                      : 'The Zoho accounts service endpoint (e.g., https://accounts.zoho.com).'}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    {lang === 'ar' ? 'معرف العميل وسر العميل (Credentials)' : 'Client Credentials'}
                  </h4>
                  <div className="space-y-1">
                    <span>{lang === 'ar' ? 'للحصول على معرف وسر العميل:' : 'To get Client ID & Secret:'}</span>
                    <ol className="list-decimal list-inside pr-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <li>{lang === 'ar' ? 'اذهب إلى Zoho Developer Console.' : 'Go to Zoho Developer Console.'}</li>
                      <li>{lang === 'ar' ? 'أنشئ تطبيقاً من نوع Server-Based.' : 'Create a Server-Based Application.'}</li>
                      <li>{lang === 'ar' ? 'املأ الحقول وانسخ معرف وسر العميل.' : 'Fill the fields and copy Client ID and Secret.'}</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {erpType === 'erpnext' && (
              <div className="space-y-4 text-xs text-muted-foreground leading-relaxed">
                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                    {lang === 'ar' ? 'رابط الخادم (Instance URL)' : 'Instance URL'}
                  </h4>
                  <p>
                    {lang === 'ar' 
                      ? 'الرابط المباشر الذي تستخدمه لفتح لوحة تحكم ERPNext.' 
                      : 'The direct URL of your ERPNext dashboard.'}
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                    {lang === 'ar' ? 'مفاتيح API (API Key & Secret)' : 'API Key & Secret'}
                  </h4>
                  <div className="space-y-1">
                    <span>{lang === 'ar' ? 'للحصول على مفتاح وسر API:' : 'To generate API Key & Secret:'}</span>
                    <ol className="list-decimal list-inside pr-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
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
  )
}
