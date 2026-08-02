'use client'

import { X, Loader2, Trash2, CheckCircle2, AlertCircle, Clock } from 'lucide-react'
import React, { useState, useEffect } from 'react'

import { findDuplicateOrders, dedupOrderGroup } from '@/app/actions/order-merge'
import type { DuplicateGroup } from '@/app/actions/order-merge'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'

interface Props {
  open: boolean
  onClose: () => void
  lang: 'ar' | 'en'
  onDedupDone: () => void
}

export default function DuplicateOrdersModal({ open, onClose, lang, onDedupDone }: Props) {
  const { toast } = useToast()
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isDeduping, setIsDeduping] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setIsLoading(true)
      findDuplicateOrders().then(res => {
        if (res.success) setGroups(res.groups || [])
        else toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
        setIsLoading(false)
      })
    }
  }, [open])

  const handleDedup = async (zidEntityId: string) => {
    setIsDeduping(zidEntityId)
    const res = await dedupOrderGroup(zidEntityId)
    if (res.success) {
      toast({
        title: lang === 'ar' ? 'تم الدمج' : 'Dedup completed',
        description: lang === 'ar' ? `تم إزالة ${res.removed} سجل مكرر` : `Removed ${res.removed} duplicate records`
      })
      setGroups(prev => prev.filter(g => g.zidEntityId !== zidEntityId))
      onDedupDone()
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
    setIsDeduping(null)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-background rounded-2xl border border-border shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-extrabold text-foreground">
              {lang === 'ar' ? 'الطلبات المكررة' : 'Duplicate Orders'}
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {lang === 'ar'
                ? 'طلبات بنفس المعرف تم مزامنتها أكثر من مرة — يمكن دمجها وإزالة المكرر'
                : 'Orders with the same ID synced multiple times — merge and remove the duplicates'}
            </p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {lang === 'ar' ? 'لا توجد طلبات مكررة' : 'No duplicate orders found'}
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.zidEntityId} className="rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-b border-border">
                    <span className="text-xs font-bold text-foreground font-mono">{group.zidEntityId}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {lang === 'ar' ? `${group.entries.length} سجل` : `${group.entries.length} records`}
                    </span>
                  </div>
                  <div className="divide-y divide-border/40">
                    {group.entries.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 px-4 py-2">
                        <div>
                          {entry.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                            : entry.status === 'failed' ? <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                            : <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />}
                        </div>
                        <span className="text-[11px] font-medium text-foreground flex-1">{entry.event}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          entry.status === 'success' ? 'bg-green-100 text-green-700' :
                          entry.status === 'failed' ? 'bg-red-100 text-red-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {entry.status}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(entry.created_at).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    ))}
                    {group.entries.length > 5 && (
                      <div className="px-4 py-2 text-[10px] text-muted-foreground text-center">
                        {lang === 'ar' ? `و ${group.entries.length - 5} سجلات أخرى` : `+${group.entries.length - 5} more records`}
                      </div>
                    )}
                  </div>
                  <div className="px-4 py-2 border-t border-border bg-muted/10 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDedup(group.zidEntityId)}
                      disabled={isDeduping === group.zidEntityId}
                      className="h-7 text-[10px] gap-1"
                    >
                      {isDeduping === group.zidEntityId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      {lang === 'ar' ? 'دمج وإزالة المكررات' : 'Merge & Remove Duplicates'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
