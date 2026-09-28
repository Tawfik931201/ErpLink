'use client'

import { X, Loader2, Bug, BarChart3 } from 'lucide-react'
import React, { useState, useEffect, useCallback } from 'react'

import { ExpandableError } from '@/app/(app)/app/mapping-center/orders/expandable-error'
import { getErrorSummary } from '@/app/actions/order-timeline'
import type { ErrorGroup } from '@/app/actions/order-timeline'
import { useToast } from '@/hooks/use-toast'

interface Props {
  open: boolean
  onClose: () => void
  platformFilter?: string
  lang: 'ar' | 'en'
}

export default function ErrorSummaryModal({ open, onClose, platformFilter, lang }: Props) {
  const { toast } = useToast()
  const [groups, setGroups] = useState<ErrorGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    const res = await getErrorSummary(platformFilter)
    if (res.success) setGroups(res.groups || [])
    else toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    setIsLoading(false)
  }, [platformFilter, lang, toast])

  useEffect(() => { if (open) load() }, [open, load])

  if (!open) return null

  const totalErrors = groups.reduce((s, g) => s + g.count, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-background rounded-2xl border border-border shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-destructive" />
            <div>
              <h2 className="text-sm font-extrabold text-foreground">
                {lang === 'ar' ? 'ملخص الأخطاء' : 'Error Summary'}
              </h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {lang === 'ar'
                  ? `${totalErrors} خطأ في ${groups.length} نمط`
                  : `${totalErrors} errors across ${groups.length} patterns`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircleIcon className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{lang === 'ar' ? 'لا توجد أخطاء' : 'No errors found'}</p>
            </div>
          ) : (
            groups.map((g, i) => (
              <div key={i} className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-destructive/5 border-b border-border">
                  <BarChart3 className="h-3 w-3 text-destructive" />
                  <span className="text-[11px] font-bold text-destructive">{g.count}x</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{new Date(g.sample_date).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')}</span>
                </div>
                <div className="px-4 py-2.5 space-y-1.5">
                  <ExpandableError message={g.error_message} />
                  <p className="text-[10px] text-muted-foreground">
                    {lang === 'ar' ? 'حدث:' : 'Event:'} {g.sample_event}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
