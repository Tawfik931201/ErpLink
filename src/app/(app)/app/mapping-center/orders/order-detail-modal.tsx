'use client'

import { X, Loader2, User, Package, CreditCard, FileText, Calendar } from 'lucide-react'
import React, { useState, useEffect } from 'react'

import { getOrderDetail } from '@/app/actions/order-timeline'
import type { OrderDetail } from '@/app/actions/order-timeline'
import { useToast } from '@/hooks/use-toast'

interface Props {
  open: boolean
  onClose: () => void
  zidEntityId: string | null
  storeId?: string
  lang: 'ar' | 'en'
}

function Label({ ar }: { ar: string; en?: string }) {
  return <span className="text-[10px] font-semibold text-muted-foreground">{ar}</span>
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-foreground">{children || '—'}</span>
}

export default function OrderDetailModal({ open, onClose, zidEntityId, storeId, lang }: Props) {
  const { toast } = useToast()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (open && zidEntityId) {
      setIsLoading(true)
      getOrderDetail(zidEntityId, storeId).then(res => {
        if (res.success) setDetail(res.detail || null)
        else toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
        setIsLoading(false)
      })
    }
  }, [open, zidEntityId, storeId, lang, toast])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-background rounded-2xl border border-border shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-extrabold text-foreground">
              {lang === 'ar' ? 'تفاصيل الطلب' : 'Order Details'}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{zidEntityId}</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !detail ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {lang === 'ar' ? 'لا توجد بيانات متاحة لهذا الطلب' : 'No data available for this order'}
            </div>
          ) : (
            <>
              {/* Platform & Status */}
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                  detail.platform === 'Shopify' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                  detail.platform === 'Salla' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                }`}>{detail.platform}</span>
                {detail.status && (
                  <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-muted text-muted-foreground">{detail.status}</span>
                )}
              </div>

              {/* Customer */}
              {detail.customer && (
                <div className="rounded-xl border border-border p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[11px] font-bold text-foreground">{lang === 'ar' ? 'العميل' : 'Customer'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {detail.customer.name && <div><Label ar="الاسم" en="Name" /><Value>{detail.customer.name}</Value></div>}
                    {detail.customer.email && <div><Label ar="البريد" en="Email" /><Value>{detail.customer.email}</Value></div>}
                    {detail.customer.phone && <div><Label ar="الجوال" en="Phone" /><Value>{detail.customer.phone}</Value></div>}
                  </div>
                </div>
              )}

              {/* Items */}
              {detail.items && detail.items.length > 0 && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center gap-1.5 px-4 py-2.5 bg-muted/20 border-b border-border">
                    <Package className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[11px] font-bold text-foreground">
                      {lang === 'ar' ? 'المنتجات' : 'Items'} ({detail.items.length})
                    </span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {detail.items.map((item, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-foreground truncate">{item.name || item.sku || `#${i + 1}`}</p>
                          {item.sku && <p className="text-[9px] text-muted-foreground">SKU: {item.sku}</p>}
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-[11px] font-bold text-foreground">{item.qty} x {item.price?.toFixed(2)}</p>
                          {item.total !== undefined && <p className="text-[10px] text-muted-foreground">{detail.totals?.currency} {item.total?.toFixed(2)}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              {detail.totals && (
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-center gap-1.5 mb-2">
                    <CreditCard className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[11px] font-bold text-foreground">{lang === 'ar' ? 'المبالغ' : 'Amounts'}</span>
                  </div>
                  <div className="space-y-1.5">
                    {detail.totals.subtotal !== undefined && detail.totals.subtotal > 0 && (
                      <div className="flex justify-between"><span className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'المجموع الفرعي' : 'Subtotal'}</span><span className="text-[10px] font-medium text-foreground">{detail.totals.currency} {detail.totals.subtotal.toFixed(2)}</span></div>
                    )}
                    {detail.totals.shipping !== undefined && detail.totals.shipping > 0 && (
                      <div className="flex justify-between"><span className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'الشحن' : 'Shipping'}</span><span className="text-[10px] font-medium text-foreground">{detail.totals.currency} {detail.totals.shipping.toFixed(2)}</span></div>
                    )}
                    {detail.totals.discount !== undefined && detail.totals.discount > 0 && (
                      <div className="flex justify-between"><span className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'الخصم' : 'Discount'}</span><span className="text-[10px] font-medium text-red-500">-{detail.totals.currency} {detail.totals.discount.toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between border-t border-border pt-1.5 mt-1.5"><span className="text-[11px] font-bold text-foreground">{lang === 'ar' ? 'الإجمالي' : 'Total'}</span><span className="text-sm font-extrabold text-foreground">{detail.totals.currency} {detail.totals.total?.toFixed(2) || '0.00'}</span></div>
                  </div>
                </div>
              )}

              {/* Payment Method */}
              {detail.paymentMethod && (
                <div className="flex items-center gap-2"><CreditCard className="h-3 w-3 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'طريقة الدفع:' : 'Payment:'}</span><span className="text-[10px] font-semibold text-foreground">{detail.paymentMethod}</span></div>
              )}

              {/* Notes */}
              {detail.notes && (
                <div className="flex items-start gap-2"><FileText className="h-3 w-3 text-muted-foreground mt-0.5" /><span className="text-[10px] text-muted-foreground flex-1">{detail.notes}</span></div>
              )}

              {/* Created At */}
              {detail.createdAt && (
                <div className="flex items-center gap-2"><Calendar className="h-3 w-3 text-muted-foreground" /><span className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'تاريخ الطلب:' : 'Order date:'}</span><span className="text-[10px] font-semibold text-foreground">{new Date(detail.createdAt).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}</span></div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
