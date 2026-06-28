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

interface OdooConnectionFormProps {
  initialConnection: any // DB structure for OdooConnection
}

export default function OdooConnectionForm({ initialConnection }: OdooConnectionFormProps) {
  const { toast } = useToast()
  
  // Connection state
  const [connection, setConnection] = useState(initialConnection)
  const [isEditing, setIsEditing] = useState(!initialConnection)
  
  // Form fields state
  const [connectionName, setConnectionName] = useState(connection?.connection_name || 'أودو الرئيسي')
  const [url, setUrl] = useState(connection?.url || '')
  const [dbName, setDbName] = useState(connection?.db_name || '')
  const [username, setUsername] = useState(connection?.username || '')
  const [apiKey, setApiKey] = useState(connection?.password || '') // password maps to API key
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
        setTestStatus({ success: true, message: 'تم الاتصال بنجاح! بيانات الاعتماد صحيحة.' })
        setIsTestedSuccessfully(true)
        toast({
          title: 'نجاح الاتصال',
          description: 'تم الاتصال بنظام أودو بنجاح (Connection successful)',
          variant: 'default',
        })
      } else {
        setTestStatus({ success: false, message: res.error || 'فشل الاتصال بنظام أودو.' })
        setIsTestedSuccessfully(false)
        toast({
          title: 'فشل الاتصال',
          description: res.error || 'يرجى التحقق من صحة البيانات والاتصال بالخادم',
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
        title: 'يجب اختبار الاتصال أولاً',
        description: 'يرجى الضغط على زر اختبار الاتصال والتأكد من نجاحه قبل الحفظ.',
        variant: 'warning',
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
        setConnection(res.connection)
        setIsEditing(false)
        setIsTestedSuccessfully(false)
        toast({
          title: 'تم الحفظ بنجاح',
          description: 'تم ربط وحفظ إعدادات أودو بنجاح.',
        })
      } else {
        toast({
          title: 'خطأ في الحفظ',
          description: res.error || 'حدث خطأ أثناء محاولة حفظ الإعدادات.',
          variant: 'destructive',
        })
      }
    })
  }

  // Handle disconnect
  const handleDisconnect = () => {
    if (!connection?.id) return
    
    if (!confirm('هل أنت متأكد من رغبتك في قطع الاتصال وحذف بيانات الربط مع أودو؟')) {
      return
    }

    startDisconnecting(async () => {
      const res = await disconnectOdooConnection(connection.id)
      if (res.success) {
        setConnection(null)
        setConnectionName('أودو الرئيسي')
        setUrl('')
        setDbName('')
        setUsername('')
        setApiKey('')
        setIsEditing(true)
        setIsTestedSuccessfully(false)
        setTestStatus(null)
        toast({
          title: 'تم قطع الاتصال',
          description: 'تم حذف بيانات الاتصال بنظام أودو بنجاح.',
        })
      } else {
        toast({
          title: 'خطأ في قطع الاتصال',
          description: res.error || 'حدث خطأ أثناء محاولة قطع الاتصال.',
          variant: 'destructive',
        })
      }
    })
  }

  return (
    <div className="space-y-6" dir="rtl">
      {connection && !isEditing ? (
        // Connected View
        <div className="space-y-6 animate-in fade-in-50 slide-in-from-top-4 duration-300">
          
          {/* Status banner */}
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div className="flex-1 text-sm font-medium">
              تم ربط نظام أودو ERP بنجاح ببيئة العمل النشطة. يمكنك الآن مطابقة الحقول ومزامنة البيانات.
            </div>
          </div>

          {/* Details Card */}
          <div className="rounded-2xl border bg-card p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-emerald-500 to-teal-500" />
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border/60">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
                  <Database className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
                    {connection.connection_name || 'أودو ERP'}
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-500">
                      متصل (Connected)
                    </span>
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    إعدادات الربط وحالة الاتصال نشطة ومستقرة
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button 
                  onClick={() => {
                    setIsEditing(true)
                    setIsTestedSuccessfully(false)
                    setTestStatus(null)
                  }} 
                  variant="outline" 
                  size="sm" 
                  className="rounded-xl border-border/80 hover:bg-muted gap-2"
                >
                  <Edit3 className="h-4 w-4" />
                  تعديل الإعدادات (Edit)
                </Button>

                <Button 
                  onClick={handleTestConnection}
                  variant="secondary"
                  size="sm"
                  disabled={isTesting}
                  className="rounded-xl gap-2"
                >
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  اختبار الاتصال (Test)
                </Button>

                <Button 
                  onClick={handleDisconnect}
                  variant="destructive" 
                  size="sm" 
                  disabled={isDisconnecting}
                  className="rounded-xl gap-2 hover:bg-destructive/90"
                >
                  {isDisconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  قطع الاتصال (Disconnect)
                </Button>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 pt-6 text-sm">
              {/* Name */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                <Tag className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">اسم الاتصال</p>
                  <p className="mt-1 text-foreground font-semibold break-all">{connection.connection_name}</p>
                </div>
              </div>

              {/* URL */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                <Globe className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">رابط الخادم (Odoo URL)</p>
                  <p className="mt-1 text-foreground font-semibold break-all">{connection.url}</p>
                </div>
              </div>

              {/* DB Name */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                <Hash className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">اسم قاعدة البيانات (DB Name)</p>
                  <p className="mt-1 text-foreground font-semibold break-all">{connection.db_name || 'غير متوفر'}</p>
                </div>
              </div>

              {/* Username */}
              <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/40">
                <User className="h-5 w-5 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-muted-foreground">اسم المستخدم / البريد الإلكتروني</p>
                  <p className="mt-1 text-foreground font-semibold break-all">{connection.username}</p>
                </div>
              </div>
            </div>
            
            {/* Live Connection Test Results */}
            {testStatus && (
              <div className={`mt-6 p-4 rounded-xl border text-sm flex items-start gap-3 ${
                testStatus.success 
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400' 
                  : 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400'
              }`}>
                {testStatus.success ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">{testStatus.success ? 'نجح فحص الاتصال' : 'فشل فحص الاتصال'}</p>
                  <p className="mt-1 text-xs opacity-90">{testStatus.message}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Disconnected State UI (Form)
        <div className="rounded-2xl border bg-card p-6 shadow-xl relative overflow-hidden animate-in fade-in-50 slide-in-from-top-4 duration-300">
          <div className="absolute top-0 right-0 h-1.5 w-full bg-gradient-to-l from-primary to-purple-600" />
          
          <div className="flex items-center justify-between pb-4 border-b border-border/60 mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Database className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground">تهيئة وربط نظام أودو (Odoo ERP Connection)</h2>
                <p className="text-sm text-muted-foreground mt-0.5">أدخل بيانات الربط الخاصة بنظام Odoo XML-RPC للبدء.</p>
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
                className="rounded-full"
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>

          <form onSubmit={handleSaveConnection} className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              
              {/* Connection Name */}
              <div className="space-y-2">
                <Label htmlFor="connectionName" className="font-semibold">اسم الاتصال</Label>
                <div className="relative">
                  <Tag className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="connectionName"
                    value={connectionName}
                    onChange={(e) => setConnectionName(e.target.value)}
                    placeholder="مثال: أودو الرئيسي"
                    className="pr-10 rounded-xl"
                    required
                  />
                </div>
              </div>

              {/* Odoo URL */}
              <div className="space-y-2">
                <Label htmlFor="url" className="font-semibold">رابط أودو (Odoo URL)</Label>
                <div className="relative">
                  <Globe className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="url"
                    value={url}
                    onChange={(e) => handleUrlChange(e.target.value)}
                    placeholder="https://mycompany.odoo.com"
                    type="url"
                    className="pr-10 rounded-xl font-mono text-left"
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              {/* Database Name */}
              <div className="space-y-2">
                <Label htmlFor="dbName" className="font-semibold">اسم قاعدة البيانات (Database Name)</Label>
                <div className="relative">
                  <Hash className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="dbName"
                    value={dbName}
                    onChange={(e) => handleDbNameChange(e.target.value)}
                    placeholder="مثال: companydb"
                    className="pr-10 rounded-xl font-mono text-left"
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              {/* Username */}
              <div className="space-y-2">
                <Label htmlFor="username" className="font-semibold">اسم المستخدم / البريد الإلكتروني</Label>
                <div className="relative">
                  <User className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder="admin@mycompany.com"
                    className="pr-10 rounded-xl font-mono text-left"
                    dir="ltr"
                    required
                  />
                </div>
              </div>

              {/* Password / API Key */}
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="apiKey" className="font-semibold">كلمة المرور أو مفتاح API (API Key)</Label>
                <div className="relative">
                  <Key className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="apiKey"
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder="كلمة المرور الخاصة بك أو مفتاح API"
                    type="password"
                    className="pr-10 rounded-xl font-mono text-left"
                    dir="ltr"
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                  💡 <strong>نصيحة أمنية:</strong> يُنصح بشدة بإنشاء واستخدام <strong>مفتاح API (API Key)</strong> مخصص من إعدادات مستخدم أودو (Odoo 14+) بدلاً من استخدام كلمة المرور الرئيسية للحفاظ على أمان حسابك.
                </p>
              </div>

            </div>

            {/* Live Connection Test Results */}
            {testStatus && (
              <div className={`p-4 rounded-xl border text-sm flex items-start gap-3 ${
                testStatus.success 
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400' 
                  : 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400'
              }`}>
                {testStatus.success ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-semibold">{testStatus.success ? 'نجح فحص الاتصال' : 'فشل فحص الاتصال'}</p>
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
                        جاري الحفظ...
                      </>
                    ) : (
                      'حفظ وإتصال (Save)'
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
                        جاري إعادة الفحص...
                      </>
                    ) : (
                      'إعادة اختبار الاتصال (Re-test)'
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
                      جاري فحص الاتصال...
                    </>
                  ) : (
                    'اختبار الاتصال أولاً (Test Connection)'
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
