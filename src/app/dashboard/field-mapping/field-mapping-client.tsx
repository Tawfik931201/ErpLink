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
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ZID_EVENTS } from './field-mapping-form'
import FieldMappingForm from './field-mapping-form'
import { getFieldMappings, deleteFieldMapping } from '@/app/actions/field-mappings'

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
  
  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

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
    return found ? found.name : eventId
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
      <div className="space-y-4">
        <Button 
          variant="ghost" 
          onClick={() => setView('list')} 
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg mb-2"
        >
          <ArrowRight className="h-4 w-4" />
          العودة للقائمة (Back to List)
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
      <div className="space-y-4">
        <Button 
          variant="ghost" 
          onClick={() => {
            setSelectedMapping(null)
            setView('list')
          }} 
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg mb-2"
        >
          <ArrowRight className="h-4 w-4" />
          العودة للقائمة (Back to List)
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
    <div className="space-y-6">
      
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-[#00878a] to-purple-600 bg-clip-text text-transparent">
            ربط الحقول (Field Mapping)
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            تخصيص ومطابقة الحقول بين نظام أودو ERP ومتجر زد لضمان دقة مزامنة البيانات والمنتجات تلقائياً.
          </p>
        </div>
        <Button 
          onClick={() => setView('create')}
          className="bg-[#00878a] hover:bg-[#007073] text-white gap-2 font-medium rounded-xl shadow-lg shadow-[#00878a]/10 transition-all self-start sm:self-center"
        >
          <Plus className="h-4 w-4" />
          إضافة ربط جديد
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[300px] bg-card rounded-2xl border border-border/60 p-12">
          <Loader2 className="h-10 w-10 text-[#00878a] animate-spin mb-4" />
          <p className="text-sm text-muted-foreground font-medium">جاري تحميل إعدادات الربط...</p>
        </div>
      ) : mappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center min-h-[350px] bg-card rounded-2xl border border-border/60 p-8 md:p-12 shadow-sm font-sans">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-[#00878a]/10 to-purple-500/10 flex items-center justify-center mb-6">
            <SlidersHorizontal className="h-8 w-8 text-[#00878a]" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">لا يوجد ربط حقول حالياً (No Mappings Found)</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-6 leading-relaxed">
            قم بربط وتخصيص كيفية انتقال الحقول بين منصتي زد وأودو لإيقاف المزامنة اليدوية وبدء المزامنة التلقائية.
          </p>
          <Button 
            onClick={() => setView('create')}
            className="bg-[#00878a] hover:bg-[#007073] text-white gap-2 font-semibold rounded-xl"
          >
            <Plus className="h-4 w-4" />
            ابدأ ربط الحقول الآن
          </Button>
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border shadow-md overflow-hidden font-sans">
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-border/80 bg-muted/30 text-muted-foreground text-xs font-bold uppercase tracking-wider">
                  <th className="py-4 px-6">الاسم (Name)</th>
                  <th className="py-4 px-6">الحدث (Zid Event)</th>
                  <th className="py-4 px-6 text-center">عملية أودو</th>
                  <th className="py-4 px-6 text-center">الموديل الأساسي (Odoo Model)</th>
                  <th className="py-4 px-6 text-center">مفتاح المطابقة</th>
                  <th className="py-4 px-6">الموديلات المرتبطة وحقولها (Mapped Tables)</th>
                  <th className="py-4 px-6 text-center">تاريخ الإنشاء (Created At)</th>
                  <th className="py-4 px-6 text-center">العمليات (Actions)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {mappings.map((item) => {
                  const totalFields = countTotalMappedFields(item.mappings)
                  const relatedKeys = Object.keys(item.mappings || {})
                  const formattedDate = item.created_at 
                    ? new Date(item.created_at).toLocaleString('ar-EG', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : '-'

                  return (
                    <tr 
                      key={item.id} 
                      className="hover:bg-muted/10 transition-colors group"
                    >
                      {/* Name */}
                      <td className="py-4 px-6 font-semibold text-sm text-foreground">
                        {item.name || 'ربط حقول غير مسمى'}
                      </td>

                      {/* Zid Event */}
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold border",
                            getEventBadgeStyles(item.action)
                          )}>
                            {getEventName(item.action)}
                          </span>
                        </div>
                      </td>

                      {/* Odoo Operation */}
                      <td className="py-4 px-6 text-center">
                        <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold border bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/20">
                          {item.odoo_operation === 'delete'
                            ? 'حذف'
                            : item.odoo_operation === 'update'
                              ? 'تعديل'
                              : 'إنشاء'}
                        </span>
                      </td>

                      {/* Primary Odoo Model */}
                      <td className="py-4 px-6 text-center">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-500/5 border border-zinc-500/10 text-sm font-medium text-foreground">
                          <Database className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-mono text-xs">{item.odoo_model}</span>
                        </div>
                      </td>

                      {/* Mapped Sub-tables details */}
                      <td className="py-4 px-6 text-center">
                        {item.odoo_operation === 'update' || item.odoo_operation === 'delete' ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {item.odoo_match_field || '-'} = {item.zid_match_field || '-'}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>

                      {/* Mapped Sub-tables details */}
                      <td className="py-4 px-6">
                        <div className="flex flex-col gap-1.5">
                          {relatedKeys.map((modelName) => {
                            const count = item.mappings[modelName]?.length || 0
                            return (
                              <div key={modelName} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-muted-foreground">{modelName}</span>
                                <span className="h-1.5 w-1.5 rounded-full bg-border" />
                                <span className="font-semibold text-foreground/80">{count} حقول</span>
                              </div>
                            )
                          })}
                          {relatedKeys.length === 0 && (
                            <span className="text-xs text-muted-foreground italic">لا توجد حقول مربوطة</span>
                          )}
                        </div>
                      </td>

                      {/* Created At */}
                      <td className="py-4 px-6 text-center text-xs text-muted-foreground font-medium">
                        <div className="inline-flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground/60" />
                          <span>{formattedDate}</span>
                        </div>
                      </td>

                      {/* Operations */}
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {deleteConfirmId === item.id ? (
                            <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-lg p-1 animate-in fade-in zoom-in duration-200">
                              <span className="text-[10px] font-semibold text-destructive px-1.5">هل أنت متأكد؟</span>
                              <Button 
                                size="sm" 
                                variant="destructive" 
                                disabled={isDeleting}
                                onClick={() => handleDelete(item.id)}
                                className="h-6 px-2 text-xs font-semibold rounded-md"
                              >
                                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'حذف'}
                              </Button>
                              <Button 
                                size="sm" 
                                variant="ghost" 
                                onClick={() => setDeleteConfirmId(null)}
                                className="h-6 px-2 text-xs font-semibold text-muted-foreground rounded-md hover:bg-muted"
                              >
                                إلغاء
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedMapping(item)
                                  setView('edit')
                                }}
                                className="h-8 w-8 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                                title="تعديل"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setDeleteConfirmId(item.id)}
                                className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10"
                                title="حذف"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
