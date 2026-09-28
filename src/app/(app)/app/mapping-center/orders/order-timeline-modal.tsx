'use client'

import { X, CheckCircle2, XCircle, AlertCircle, Clock, Loader2 } from 'lucide-react'
import React from 'react'

import type { TimelineEntry } from '@/app/actions/order-timeline'

interface Props {
  open: boolean
  onClose: () => void
  zidEntityId: string | null
  entries: TimelineEntry[]
  isLoading: boolean
  lang: 'ar' | 'en'
}

const getEventLabel = (ev: string, lang: 'ar' | 'en') => {
  const map: Record<string, string> = {
    'order.created': lang === 'ar' ? 'إنشاء طلب' : 'Order Created',
    'order.updated': lang === 'ar' ? 'تحديث طلب' : 'Order Updated',
    'order.status.update': lang === 'ar' ? 'تحديث حالة' : 'Status Updated',
    'order.cancelled': lang === 'ar' ? 'إلغاء طلب' : 'Order Cancelled',
    'order.delivered': lang === 'ar' ? 'توصيل طلب' : 'Order Delivered',
    'orders/create': lang === 'ar' ? 'إنشاء طلب' : 'Order Created',
    'orders/updated': lang === 'ar' ? 'تحديث طلب' : 'Order Updated',
    'orders/cancelled': lang === 'ar' ? 'إلغاء طلب' : 'Order Cancelled',
    'orders/fulfilled': lang === 'ar' ? 'طلب مكتمل' : 'Order Fulfilled',
  }
  return map[ev] || ev
}

const formatTime = (iso: string, lang: 'ar' | 'en') => {
  const d = new Date(iso)
  return d.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

export default function OrderTimelineModal({ open, onClose, zidEntityId, entries, isLoading, lang }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-background rounded-2xl border border-border shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-extrabold text-foreground">
              {lang === 'ar' ? 'السجل الزمني للطلب' : 'Order Timeline'}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{zidEntityId}</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {lang === 'ar' ? 'لا توجد أحداث مسجلة لهذا الطلب' : 'No events recorded for this order'}
            </div>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[11px] top-1 bottom-1 w-px bg-border" />

              <div className="space-y-0">
                {entries.map((entry) => (
                  <div key={entry.id} className="relative flex gap-4 pb-5 last:pb-0">
                    {/* Dot */}
                    <div className="relative z-10 mt-0.5 flex-shrink-0">
                      {entry.status === 'success' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : entry.status === 'failed' ? (
                        <XCircle className="h-5 w-5 text-red-500" />
                      ) : (
                        <AlertCircle className="h-5 w-5 text-yellow-500" />
                      )}
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground">
                          {getEventLabel(entry.event, lang)}
                        </span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          entry.status === 'success' ? 'bg-green-100 text-green-700' :
                          entry.status === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {entry.status === 'success' ? (lang === 'ar' ? 'ناجح' : 'OK') :
                           entry.status === 'failed' ? (lang === 'ar' ? 'فاشل' : 'Fail') :
                           (lang === 'ar' ? 'متخطى' : 'Skip')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground">{formatTime(entry.created_at, lang)}</span>
                        {entry.odoo_record_id && (
                          <span className="text-[10px] text-muted-foreground">
                            Odoo #{entry.odoo_record_id}
                          </span>
                        )}
                      </div>
                      {entry.error_message && (
                        <p className="text-[10px] text-red-500 mt-1 leading-relaxed">{entry.error_message}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
