'use client'

import { ArrowRight, Edit, History, Trash2, Database, SlidersHorizontal, Layers } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import { deleteFieldMapping } from '@/app/actions/field-mappings'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SALLA_EVENTS } from '@/lib/platforms/salla/fields'
import { SHOPIFY_EVENTS } from '@/lib/platforms/shopify/fields'
import { ZID_EVENTS } from '@/lib/platforms/zid/fields'
import { formatFieldLabel } from '@/lib/translations'
import { cn } from '@/lib/utils'

import SyncLogModal from '../../sync-log-modal'

interface Props {
  mapping: any
  lang: 'ar' | 'en'
  dir: 'rtl' | 'ltr'
}

export default function CustomMappingDetailClient({ mapping, lang, dir }: Props) {
  const router = useRouter()
  const ar = lang === 'ar'
  const [, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isLogOpen, setIsLogOpen] = useState(false)

  const getEventName = (eventId: string) => {
    const found = ZID_EVENTS.find((e: any) => e.id === eventId) || SALLA_EVENTS.find((e: any) => e.id === eventId) || SHOPIFY_EVENTS.find((e: any) => e.id === eventId)
    return found ? formatFieldLabel(found.name, lang) : eventId
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await deleteFieldMapping(mapping.id)
      if (res.success) {
        router.push('/app/mapping-center/custom')
      }
    } catch (err) {
      console.error('Failed to delete mapping:', err)
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const flattenMappings = (mappingsObj: any) => {
    if (!mappingsObj) return []
    const pairs: { model: string; storeField: string; erpField: string }[] = []
    Object.entries(mappingsObj).forEach(([model, fields]: [string, any]) => {
      if (model === '__settings') return
      if (Array.isArray(fields)) {
        fields.forEach(f => {
          pairs.push({ model, storeField: f.storeField || f.zidField, erpField: f.erpField })
        })
      }
    })
    return pairs
  }

  const fieldPairs = flattenMappings(mapping.mappings)

  return (
    <div className="max-w-6xl mx-auto space-y-6" dir={dir}>
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 card-base p-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/app/mapping-center/custom')}
            className="gap-2 text-muted-foreground hover:text-foreground text-xs font-semibold rounded-lg"
          >
            <ArrowRight className={cn("h-4 w-4", lang === 'ar' ? "rotate-0" : "rotate-180")} />
            {ar ? 'العودة للقائمة' : 'Back to List'}
          </Button>
          <div className="h-4 w-px bg-border/70" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-extrabold text-foreground">{mapping.name}</h1>
              <span className="font-mono text-[10px] bg-muted px-2 py-0.5 rounded text-muted-foreground">
                {mapping.id}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {ar ? 'الحدث:' : 'Event:'} <span className="font-semibold text-foreground">{getEventName(mapping.action)}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsLogOpen(true)}
            className="h-8 text-xs gap-1.5"
          >
            <History className="h-3.5 w-3.5" />
            {ar ? 'سجل المزامنة' : 'Sync Logs'}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            className="h-8 text-xs gap-1.5"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {ar ? 'حذف' : 'Delete'}
          </Button>
        </div>
      </div>

      {/* Grid Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* General Metadata */}
        <div className="card-base p-5 space-y-4">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            {ar ? 'المعلومات الهيكلية' : 'Structural Information'}
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">{ar ? 'نموذج أودوو الأساسي' : 'Primary Odoo Model'}</span>
              <span className="font-mono font-semibold text-foreground">{mapping.odoo_model}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">{ar ? 'العملية في أودوو' : 'Odoo Operation'}</span>
              <span className="font-semibold text-foreground uppercase">{mapping.odoo_operation || 'create'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">{ar ? 'اتجاه المزامنة' : 'Sync Direction'}</span>
              <span className="font-semibold text-foreground">{mapping.sync_direction || 'store_to_erp'}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">{ar ? 'معرّف المتجر / التاجر' : 'Store / Merchant ID'}</span>
              <span className="font-mono text-foreground">{mapping.merchant_id || '-'}</span>
            </div>
          </div>
        </div>

        {/* Sync Configuration */}
        <div className="card-base p-5 space-y-4">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            {ar ? 'إعدادات المطابقة والسياسات' : 'Matching & Policy Config'}
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">{ar ? 'حقل مطابقة أودوو' : 'Odoo Match Field'}</span>
              <span className="font-mono font-semibold text-foreground">{mapping.odoo_match_field || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">{ar ? 'حقل مطابقة المتجر' : 'Store Match Field'}</span>
              <span className="font-mono font-semibold text-foreground">{mapping.zid_match_field || '-'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-muted-foreground">{ar ? 'سياسة البديل (Fallback)' : 'Fallback Policy'}</span>
              <span className="font-semibold text-foreground">{mapping.odoo_fallback_policy || 'none'}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-muted-foreground">{ar ? 'تاريخ الإنشاء' : 'Created At'}</span>
              <span className="font-mono text-foreground">
                {mapping.created_at ? new Date(mapping.created_at).toLocaleString() : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Field Mappings Pairs Table */}
      <div className="card-base overflow-hidden">
        <div className="p-4 bg-muted/50 border-b border-border/70 flex items-center justify-between">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            {ar ? 'ثنائيات ربط الحقول المخصصة' : 'Mapped Field Pairs'} ({fieldPairs.length})
          </h3>
        </div>
        {fieldPairs.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {ar ? 'لا توجد حقول مربوطة في هذا التخصيص' : 'No mapped fields in this custom mapping'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="bg-muted/30 border-b border-border/70 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  <th className="py-3 px-4 text-start">{ar ? 'نموذج أودوو' : 'Odoo Model'}</th>
                  <th className="py-3 px-4 text-start">{ar ? 'حقل المتجر (Store Field)' : 'Store Field'}</th>
                  <th className="py-3 px-4 text-start">{ar ? 'حقل أودوو (ERP Field)' : 'ERP Field'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-xs">
                {fieldPairs.map((pair, idx) => (
                  <tr key={idx} className="hover:bg-muted/50 transition-colors">
                    <td className="py-3 px-4 font-mono text-muted-foreground">{pair.model}</td>
                    <td className="py-3 px-4 font-mono font-semibold text-foreground">{pair.storeField}</td>
                    <td className="py-3 px-4 font-mono font-semibold text-primary">{pair.erpField}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SyncLogModal
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        mappingId={mapping.id}
        mappingName={mapping.name}
        mappingsList={[{ id: mapping.id, name: mapping.name }]}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={ar ? 'حذف الربط' : 'Delete Mapping'}
        description={ar ? 'هل أنت متأكد من حذف هذا التخصيص؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you sure you want to delete this custom mapping? This action cannot be undone.'}
        confirmText={ar ? 'حذف' : 'Delete'}
        cancelText={ar ? 'إلغاء' : 'Cancel'}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
