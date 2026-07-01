'use client'

import React, { useState, useEffect } from 'react'
import { 
  Plus, 
  Edit, 
  Trash2, 
  SlidersHorizontal, 
  ArrowRight, 
  Database, 
  Layers, 
  Calendar,
  AlertTriangle,
  Loader2,
  History
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ZID_EVENTS } from './field-mapping-form'
import FieldMappingForm from './field-mapping-form'
import { getFieldMappings, deleteFieldMapping } from '@/app/actions/field-mappings'
import { useLanguage } from '@/components/language-provider'
import { formatFieldLabel } from '@/lib/translations'
import SyncLogModal from './sync-log-modal'

interface FieldMappingClientProps {
  initialModels: Array<{ model: string; name: string }>
  hasOdooConnection: boolean
  preloadedModel: string
  preloadedFields: any[]
}

export default function FieldMappingClient({
  initialModels,
  hasOdooConnection,
  preloadedModel,
  preloadedFields
}: FieldMappingClientProps) {
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list')
  const [mappings, setMappings] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedMapping, setSelectedMapping] = useState<any>(null)
  const { t, lang, dir } = useLanguage()
  
  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Logs state
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [logMappingId, setLogMappingId] = useState<string | undefined>(undefined)
  const [logMappingName, setLogMappingName] = useState<string | undefined>(undefined)

  // Load mappings on mount
  const loadMappings = async () => {
    setIsLoading(true)
    try {
      const res = await getFieldMappings()
      if (res.success) {
        setMappings(res.mappings || [])
      }
    } catch (err) {
      console.error('Failed to load mappings:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadMappings()
  }, [])

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const res = await deleteFieldMapping(id)
      if (res.success) {
        setMappings(prev => prev.filter(m => m.id !== id))
        setDeleteConfirmId(null)
      }
    } catch (err) {
      console.error('Failed to delete mapping:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  const getEventBadgeStyles = (eventId: string) => {
    if (eventId.startsWith('product')) {
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    }
    if (eventId.startsWith('order')) {
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
    }
    if (eventId.startsWith('customer')) {
      return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
    }
    if (eventId.startsWith('category')) {
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    }
    return 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20'
  }

  const getEventName = (eventId: string) => {
    const found = ZID_EVENTS.find(e => e.id === eventId)
    return found ? formatFieldLabel(found.name, lang) : eventId
  }

  // Count total fields in all mappings nested object
  const countTotalMappedFields = (mappingsObj: any) => {
    if (!mappingsObj) return 0
    let total = 0
    Object.values(mappingsObj).forEach((arr: any) => {
      if (Array.isArray(arr)) {
        total += arr.length
      }
    })
    return total
  }

  if (view === 'create') {
    return (
      <div className="space-y-4" dir={dir}>
        <Button 
          variant="ghost" 
          onClick={() => setView('list')} 
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg mb-2"
        >
          <ArrowRight className={cn("h-4 w-4", lang === 'ar' ? "rotate-0" : "rotate-180")} />
          {lang === 'ar' ? 'العودة للقائمة' : 'Back to List'}
        </Button>
        <FieldMappingForm
          initialModels={initialModels}
          hasOdooConnection={hasOdooConnection}
          preloadedModel={preloadedModel}
          preloadedFields={preloadedFields}
          onCancel={() => setView('list')}
          onSuccess={() => {
            loadMappings()
            setView('list')
          }}
        />
      </div>
    )
  }

  if (view === 'edit' && selectedMapping) {
    // Extract related models from mappings keys other than primary odoo_model
    const allModelKeys = Object.keys(selectedMapping.mappings || {})
    const primaryModel = selectedMapping.odoo_model
    const initialRelated = allModelKeys.filter(k => k !== primaryModel)

    return (
      <div className="space-y-4" dir={dir}>
        <Button 
          variant="ghost" 
          onClick={() => {
            setSelectedMapping(null)
            setView('list')
          }} 
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg mb-2"
        >
          <ArrowRight className={cn("h-4 w-4", lang === 'ar' ? "rotate-0" : "rotate-180")} />
          {lang === 'ar' ? 'العودة للقائمة' : 'Back to List'}
        </Button>
        <FieldMappingForm
          initialModels={initialModels}
          hasOdooConnection={hasOdooConnection}
          preloadedModel={preloadedModel}
          preloadedFields={preloadedFields}
          editingId={selectedMapping.id}
          initialName={selectedMapping.name}
          initialAction={selectedMapping.action}
          initialOdooModel={selectedMapping.odoo_model}
          initialOdooOperation={selectedMapping.odoo_operation || 'create'}
          initialOdooMatchField={selectedMapping.odoo_match_field || ''}
          initialZidMatchField={selectedMapping.zid_match_field || ''}
          initialMappings={selectedMapping.mappings}
          initialRelatedModels={initialRelated}
          onCancel={() => {
            setSelectedMapping(null)
            setView('list')
          }}
          onSuccess={() => {
            setSelectedMapping(null)
            loadMappings()
            setView('list')
          }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4 font-sans" dir={dir}>
      
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
            {t('nav.fieldMapping')}
          </h1>
          <p className="mt-1 text-muted-foreground text-[11px]">
            {t('map.desc')}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            onClick={() => {
              setLogMappingId(undefined)
              setLogMappingName(undefined)
              setIsLogOpen(true)
            }}
            className="border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 gap-1.5 font-medium rounded-lg h-9 text-xs shadow-sm"
          >
            <History className="h-3.5 w-3.5 text-muted-foreground" />
            {lang === 'ar' ? 'سجل المزامنة العام' : 'Global Sync Log'}
          </Button>
          <Button 
            onClick={() => setView('create')}
            className="gradient-brand text-white gap-1.5 font-medium rounded-lg h-9 text-xs shadow-sm hover:scale-[1.01] transition-transform duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'إضافة ربط جديد' : 'Add New Mapping'}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] bg-white border border-slate-200/80 rounded-xl p-8">
          <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
          <p className="text-xs text-muted-foreground font-medium">{lang === 'ar' ? 'جاري تحميل إعدادات الربط...' : 'Loading field mappings...'}</p>
        </div>
      ) : mappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center min-h-[250px] bg-white rounded-xl border border-slate-200/80 p-6 shadow-sm">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/10 to-purple-500/10 flex items-center justify-center mb-4">
            <SlidersHorizontal className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-sm font-bold text-foreground mb-1">{lang === 'ar' ? 'لا يوجد ربط حقول حالياً' : 'No Field Mappings Found'}</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4 leading-relaxed">
            {lang === 'ar' 
              ? 'قم بربط وتخصيص كيفية انتقال الحقول بين منصتي زد وأودو لإيقاف المزامنة اليدوية وبدء المزامنة التلقائية.' 
              : 'Map and customize how fields flow between Zid and Odoo to automate data synchronization.'}
          </p>
          <Button 
            onClick={() => setView('create')}
            className="gradient-brand text-white gap-1.5 font-semibold rounded-lg h-9 text-xs shadow-sm hover:scale-[1.01] transition-transform duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'ابدأ ربط الحقول الآن' : 'Start Mapping Fields'}
          </Button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200/80 shadow-sm rounded-xl overflow-hidden divide-y divide-border/60">
          {mappings.map((item) => {
            const totalFields = countTotalMappedFields(item.mappings)
            const formattedDate = item.created_at 
              ? new Date(item.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })
              : '-'

            return (
              <div 
                key={item.id} 
                className="p-4 hover:bg-muted/5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                {/* Details */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary mt-0.5">
                    <SlidersHorizontal className="h-4.5 w-4.5" />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-xs text-foreground break-all">
                        {item.name || (lang === 'ar' ? 'ربط حقول غير مسمى' : 'Unnamed field mapping')}
                      </span>
                      <span className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold",
                        getEventBadgeStyles(item.action)
                      )}>
                        {getEventName(item.action)}
                      </span>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20">
                        {item.odoo_operation === 'delete'
                          ? t('map.operationDelete')
                          : item.odoo_operation === 'update'
                            ? t('map.operationUpdate')
                            : t('map.operationCreate')}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Database className="h-3 w-3 text-muted-foreground" />
                        <span>{lang === 'ar' ? 'نموذج أودو: ' : 'Odoo Model: '}<span className="font-mono text-foreground font-semibold">{item.odoo_model}</span></span>
                      </span>
                      {(item.odoo_operation === 'update' || item.odoo_operation === 'delete') && (item.odoo_match_field || item.zid_match_field) && (
                        <span className="flex items-center gap-1">
                          <Layers className="h-3 w-3 text-muted-foreground" />
                          <span>{lang === 'ar' ? 'مطابقة: ' : 'Matching: '}<span className="font-mono text-foreground font-semibold">{item.odoo_match_field || '-'} ⇄ {item.zid_match_field || '-'}</span></span>
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                        <span>{lang === 'ar' ? 'الحقول المربوطة: ' : 'Mapped fields: '}<span className="font-semibold text-foreground">{totalFields}</span></span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Operations */}
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {deleteConfirmId === item.id ? (
                    <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-lg p-1 animate-in fade-in zoom-in duration-200">
                      <span className="text-[10px] font-semibold text-destructive px-1.5">{lang === 'ar' ? 'تأكيد؟' : 'Confirm?'}</span>
                      <Button 
                        size="sm" 
                        variant="destructive" 
                        disabled={isDeleting}
                        onClick={() => handleDelete(item.id)}
                        className="h-6 px-2 text-xs font-semibold rounded-md"
                      >
                        {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : t('ws.deleteBtn')}
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        onClick={() => setDeleteConfirmId(null)}
                        className="h-6 px-2 text-xs font-semibold text-muted-foreground rounded-md hover:bg-muted"
                      >
                        {t('ws.cancelBtn')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setLogMappingId(item.id)
                          setLogMappingName(item.name)
                          setIsLogOpen(true)
                        }}
                        className="h-8 w-8 text-muted-foreground hover:text-primary rounded-lg hover:bg-primary/5"
                        title={lang === 'ar' ? 'سجل المزامنة' : 'Sync Log'}
                      >
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setSelectedMapping(item)
                          setView('edit')
                        }}
                        className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                        title={t('ws.editBtn')}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteConfirmId(item.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10"
                        title={t('ws.deleteBtn')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      
      <SyncLogModal 
        isOpen={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        mappingId={logMappingId}
        mappingName={logMappingName}
        mappingsList={mappings.map(m => ({ id: m.id, name: m.name }))}
      />
    </div>
  )
}
