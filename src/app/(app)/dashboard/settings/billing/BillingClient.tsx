'use client'

import { useState } from 'react'
import {
  CreditCard,
  Copy,
  Check,
  FileText,
  Calendar,
  AlertCircle,
  Download,
  Clock,
  DollarSign
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Subscription {
  id: string
  start_date: string
  months_paid: number
  end_date: string
  amount_paid: number | string
  currency: string
  status: string
  notes: string | null
  created_at: string
  isExpired: boolean
  daysRemaining: number
}

interface Props {
  lang: 'ar' | 'en'
  initialWorkspace: {
    id: string
    name: string
    subscription_number: string | null
  } | null
  initialSubscriptions: Subscription[]
  error: string | null
}

export default function BillingClient({ lang, initialWorkspace, initialSubscriptions, error }: Props) {
  const isAr = lang === 'ar'
  const [copied, setCopied] = useState(false)

  if (error || !initialWorkspace) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          {error || (isAr ? 'عذراً، فشل تحميل بيانات الفوترة.' : 'Failed to load billing details.')}
        </span>
      </div>
    )
  }

  const activeSub = initialSubscriptions.find((sub) => sub.status === 'active' && !sub.isExpired)
  const subNum = initialWorkspace.subscription_number || '—'

  const handleCopy = () => {
    navigator.clipboard.writeText(subNum)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const formatDate = (dateStr: string) => {
    try {
      if (!dateStr) return '—'
      const date = new Date(`${dateStr}T00:00:00Z`)
      if (Number.isNaN(date.getTime())) return dateStr
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
      
      const day = date.getUTCDate()
      const month = date.getUTCMonth()
      const year = date.getUTCFullYear()
      
      if (isAr) {
        return `${day} ${monthsAr[month]} ${year}`
      }
      return `${months[month]} ${day}, ${year}`
    } catch {
      return dateStr
    }
  }

  const formatAmount = (amount: number | string) => {
    const num = Number(amount) || 0
    return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }

  const statusBadge = (sub: Subscription) => {
    if (sub.status === 'cancelled') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-gray-50 border-gray-200 text-gray-500">
          {isAr ? 'ملغى' : 'Cancelled'}
        </span>
      )
    }
    if (sub.isExpired) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-red-50 border-red-200 text-red-600">
          {isAr ? 'منتهٍ' : 'Expired'}
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-50 border-emerald-200 text-emerald-600">
        {isAr ? 'نشط' : 'Active'}
      </span>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in text-foreground">
      {/* Top Banner / Hero Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Active Subscription Status */}
        <div className="md:col-span-2 rounded-2xl border border-border/80 bg-gradient-to-br from-card to-secondary/10 p-6 flex flex-col justify-between space-y-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="h-4 w-4" />
                <span>{isAr ? 'الاشتراك الحالي' : 'Current Subscription'}</span>
              </h3>
              <p className="text-2xl font-black tracking-tight">
                {activeSub 
                  ? (isAr ? `باقة نشطة (${activeSub.months_paid} شهر)` : `Active Plan (${activeSub.months_paid} Mo)`)
                  : (isAr ? 'لا يوجد اشتراك نشط' : 'No Active Subscription')
                }
              </p>
            </div>
            {activeSub && statusBadge(activeSub)}
          </div>

          {activeSub ? (
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/40 text-xs">
              <div className="space-y-1">
                <p className="text-muted-foreground">{isAr ? 'تاريخ الدفع' : 'Payment Date'}</p>
                <p className="font-bold flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatDate(activeSub.start_date)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground">{isAr ? 'تاريخ الانتهاء' : 'Expiry Date'}</p>
                <p className="font-bold flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatDate(activeSub.end_date)}
                </p>
              </div>
            </div>
          ) : (
            <div className="pt-2 border-t border-border/40 text-xs text-muted-foreground">
              {isAr
                ? 'لم يتم العثور على اشتراك نشط لمساحة العمل هذه. يرجى تزويد المسؤول برقم اشتراكك لتفعيل الخدمة.'
                : 'No active subscription found for this workspace. Please provide your subscription number to the admin to activate.'}
            </div>
          )}
        </div>

        {/* Subscription Number Box */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 flex flex-col justify-between space-y-4 shadow-sm relative overflow-hidden group">
          <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-5 pointer-events-none">
            <FileText className="w-32 h-32" />
          </div>
          <div className="space-y-1">
            <h3 className="text-xs font-bold text-primary flex items-center gap-1.5 uppercase tracking-wider">
              {isAr ? 'رقم الاشتراك الخاص بك' : 'Your Subscription Number'}
            </h3>
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              {isAr 
                ? 'أرسل هذا الرقم للمسؤول لتفعيل الاشتراك يدوياً بعد التحويل.' 
                : 'Send this code to support or admin to manually activate your subscription.'}
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <div className="flex-1 bg-background border border-border rounded-xl px-4 py-3 font-mono text-center text-sm font-black text-foreground shadow-inner select-all">
              {subNum}
            </div>
            <Button
              onClick={handleCopy}
              variant="outline"
              size="icon"
              className="rounded-xl h-11 w-11 hover:bg-secondary/60 hover:text-foreground transition-all duration-300"
              title={isAr ? 'نسخ رقم الاشتراك' : 'Copy subscription number'}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>

      </div>

      {/* Invoice History Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-black text-foreground flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <span>{isAr ? 'سجل المدفوعات والفواتير' : 'Invoices & Payment History'}</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAr 
              ? 'عرض وتحميل الفواتير الخاصة بالاشتراكات التي تم دفعها سابقاً.' 
              : 'View and download invoices for your previously paid subscriptions.'}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          {initialSubscriptions.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground space-y-2">
              <Clock className="h-8 w-8 mx-auto opacity-35" />
              <p>{isAr ? 'لا يوجد فواتير سابقة مسجلة بعد' : 'No previous invoices registered yet'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground bg-secondary/30">
                  <tr className="border-b border-border/40">
                    <th className="px-6 py-3.5 text-start">{isAr ? 'تاريخ الفاتورة' : 'Invoice Date'}</th>
                    <th className="px-6 py-3.5 text-start">{isAr ? 'المدة' : 'Period'}</th>
                    <th className="px-6 py-3.5 text-start">{isAr ? 'الشهور' : 'Duration'}</th>
                    <th className="px-6 py-3.5 text-start">{isAr ? 'المبلغ المدفوع' : 'Amount'}</th>
                    <th className="px-6 py-3.5 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="px-6 py-3.5 text-end">{isAr ? 'تحميل الفاتورة' : 'Invoice'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {initialSubscriptions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-secondary/10 transition-colors">
                      <td className="px-6 py-4 font-medium text-xs">
                        {formatDate(sub.start_date)}
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">
                        {formatDate(sub.start_date)} - {formatDate(sub.end_date)}
                      </td>
                      <td className="px-6 py-4 text-xs">
                        {sub.months_paid} {isAr ? 'شهر' : 'Mo'}
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold">
                        {formatAmount(sub.amount_paid)} {sub.currency}
                      </td>
                      <td className="px-6 py-4">
                        {statusBadge(sub)}
                      </td>
                      <td className="px-6 py-4 text-end">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="rounded-lg h-8 px-3 text-[11px] font-bold text-primary hover:bg-primary/5 hover:text-primary transition"
                        >
                          <a href={`/invoice/${sub.id}`} target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5 mr-1" />
                            {isAr ? 'تحميل PDF' : 'Download PDF'}
                          </a>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
