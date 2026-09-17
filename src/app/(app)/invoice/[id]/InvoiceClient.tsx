'use client'

import { Printer, ArrowLeft } from 'lucide-react'

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
  workspace_name: string | null
  workspace_sub_num: string | null
  client_name: string | null
  client_email: string | null
}

interface Props {
  subscription: Subscription
}

export default function InvoiceClient({ subscription }: Props) {
  // Always check language or fallback. We can read from cookie or default to Arabic.
  // We can also let the user print in their preferred language. Let's make it bilingual or elegant Arabic since they requested it in Arabic.
  const isAr = true

  const handlePrint = () => {
    window.print()
  }

  const formatDate = (dateStr: string) => {
    try {
      return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  const invoiceNum = `INV-${subscription.id.slice(0, 8).toUpperCase()}`

  return (
    <div className="min-h-screen bg-slate-50/50 py-10 px-4 sm:px-6 print:bg-white print:py-0 print:px-0" dir={isAr ? 'rtl' : 'ltr'}>
      
      {/* Top Action Bar (Hidden when printing) */}
      <div className="max-w-3xl mx-auto mb-6 flex items-center justify-between no-print gap-4">
        <Button
          variant="outline"
          onClick={() => window.close()}
          className="rounded-xl font-bold flex items-center gap-2 bg-background"
        >
          <ArrowLeft className={`h-4 w-4 ${isAr ? 'rotate-180' : ''}`} />
          <span>{isAr ? 'إغلاق' : 'Close'}</span>
        </Button>

        <Button
          onClick={handlePrint}
          className="rounded-xl font-bold flex items-center gap-2 bg-foreground text-background hover:bg-foreground/90"
        >
          <Printer className="h-4 w-4" />
          <span>{isAr ? 'طباعة وحفظ كـ PDF' : 'Print / Save PDF'}</span>
        </Button>
      </div>

      {/* Invoice Card */}
      <div className="max-w-3xl mx-auto bg-card border border-border/80 shadow-md rounded-2xl p-8 sm:p-12 print:shadow-none print:border-none print:p-0">
        
        {/* Invoice Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-border/40 pb-8 gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight text-foreground">ErpLink</h1>
            <p className="text-xs text-muted-foreground">مزامنة المبيعات والمنتجات بين زد وأودو</p>
          </div>
          <div className="text-start sm:text-end space-y-1">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-black bg-emerald-50 border border-emerald-200 text-emerald-700 uppercase">
              {isAr ? 'مقبول وتم الدفع' : 'Paid'}
            </span>
            <p className="text-sm font-bold text-foreground mt-2">{invoiceNum}</p>
            <p className="text-xs text-muted-foreground">
              {isAr ? 'تاريخ الفاتورة: ' : 'Invoice Date: '}
              <strong>{formatDate(subscription.created_at.slice(0, 10))}</strong>
            </p>
          </div>
        </div>

        {/* Invoice Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-8 border-b border-border/40">
          {/* Bill To */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {isAr ? 'فوتورت إلى' : 'Billed To'}
            </h3>
            <div className="text-sm space-y-1">
              <p className="font-extrabold text-foreground">{subscription.client_name || '—'}</p>
              <p className="text-muted-foreground">{subscription.client_email}</p>
              <div className="pt-2 mt-2 border-t border-dashed border-border/30">
                <p className="text-xs text-muted-foreground">
                  {isAr ? 'مساحة العمل: ' : 'Workspace: '}
                  <strong className="text-foreground">{subscription.workspace_name}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  {isAr ? 'رقم الاشتراك: ' : 'Subscription No: '}
                  <strong className="text-foreground font-mono">{subscription.workspace_sub_num || '—'}</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Payment Method / Terms */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {isAr ? 'تفاصيل السداد' : 'Payment Details'}
            </h3>
            <div className="text-sm space-y-1">
              <p className="font-semibold text-foreground">تحويل بنكي / يدوي</p>
              <p className="text-xs text-muted-foreground">تمت التسوية يدوياً من قِبل الإدارة</p>
              <div className="pt-2 mt-2 border-t border-dashed border-border/30">
                <p className="text-xs text-muted-foreground">
                  {isAr ? 'فترة الاشتراك: ' : 'Billing Period: '}
                  <strong className="text-foreground">
                    {formatDate(subscription.start_date)} - {formatDate(subscription.end_date)}
                  </strong>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Invoice Table */}
        <div className="py-8 space-y-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-muted-foreground border-b border-border/40 pb-2">
                <th className="py-2 text-start font-bold">{isAr ? 'الخدمة / الوصف' : 'Description'}</th>
                <th className="py-2 text-center font-bold">{isAr ? 'المدة' : 'Duration'}</th>
                <th className="py-2 text-end font-bold">{isAr ? 'المبلغ' : 'Amount'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              <tr>
                <td className="py-4 text-start font-semibold">
                  اشتراك منصة ErpLink
                  <p className="text-xs text-muted-foreground font-normal mt-0.5">
                    {isAr ? 'مدة الاشتراك: ' : 'Subscription Period: '}
                    {formatDate(subscription.start_date)} - {formatDate(subscription.end_date)}
                  </p>
                </td>
                <td className="py-4 text-center">
                  {subscription.months_paid} {isAr ? 'شهر' : 'Mo'}
                </td>
                <td className="py-4 text-end font-semibold">
                  {Number(subscription.amount_paid).toLocaleString('en-US')} {subscription.currency}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Invoice Summary */}
          <div className="flex justify-end pt-4">
            <div className="w-full sm:w-64 space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{isAr ? 'المجموع الفرعي' : 'Subtotal'}</span>
                <span>{Number(subscription.amount_paid).toLocaleString('en-US')} {subscription.currency}</span>
              </div>
              <div className="flex justify-between text-muted-foreground pb-2 border-b border-border/30">
                <span>{isAr ? 'الضريبة (0%)' : 'Tax (0%)'}</span>
                <span>0.00 {subscription.currency}</span>
              </div>
              <div className="flex justify-between font-black text-foreground text-base">
                <span>{isAr ? 'إجمالي المدفوع' : 'Total Paid'}</span>
                <span>{Number(subscription.amount_paid).toLocaleString('en-US')} {subscription.currency}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Invoice Footer */}
        <div className="pt-8 border-t border-border/40 text-center text-xs text-muted-foreground space-y-1">
          <p>شكراً لثقتكم واختياركم منصة ErpLink لتسهيل عملياتكم التجارية.</p>
          <p>إذا كان لديكم أي استفسار حول هذه الفاتورة، يرجى التواصل مع الدعم الفني.</p>
        </div>

      </div>

      {/* Embedded Print Styling */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background-color: white !important;
            color: black !important;
          }
          .print\\:shadow-none {
            box-shadow: none !important;
          }
          .print\\:border-none {
            border: none !important;
          }
          .print\\:p-0 {
            padding: 0 !important;
          }
          .print\\:bg-white {
            background-color: white !important;
          }
          .print\\:py-0 {
            padding-top: 0 !important;
            padding-bottom: 0 !important;
          }
          .print\\:px-0 {
            padding-left: 0 !important;
            padding-right: 0 !important;
          }
        }
      `}</style>
    </div>
  )
}
