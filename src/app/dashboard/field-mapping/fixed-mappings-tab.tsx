'use client'

import React, { useState, useEffect } from 'react'
import { 
  Plus, 
  Trash2, 
  Loader2, 
  SlidersHorizontal, 
  Layers, 
  ArrowRightLeft, 
  AlertCircle,
  ArrowRight,
  Pencil
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/components/language-provider'
import { getOdooModelFields } from '@/app/actions/odoo'
import { saveFixedMapping, deleteFixedMapping } from '@/app/actions/fixed-mappings'
import SearchableSelect from './searchable-select'
import { ODOO_FIELDS, ZID_FIELDS, SALLA_FIELDS, ZID_EVENTS, SALLA_EVENTS, ODOO_MODELS } from './field-mapping-form'
import { motion, AnimatePresence } from 'framer-motion'

interface FixedMappingTabProps {
  initialModels: Array<{ model: string; name: string }>
  hasOdooConnection: boolean
  isZidConnected: boolean
  isSallaConnected: boolean
  fixedMappings: any[]
  onFixedMappingsChange: (newMappings: any[]) => void
  erpType?: string
}

const SUPPORTED_MODELS_STATIC = [
  { id: 'product.template', nameAr: 'المنتجات (product.template)', nameEn: 'Products (product.template)' },
  { id: 'res.partner', nameAr: 'العملاء (res.partner)', nameEn: 'Customers (res.partner)' },
  { id: 'sale.order', nameAr: 'الطلبات (sale.order)', nameEn: 'Orders (sale.order)' },
  { id: 'product.category', nameAr: 'التصنيفات (product.category)', nameEn: 'Categories (product.category)' },
]

export default function FixedMappingsTab({
  initialModels,
  hasOdooConnection,
  isZidConnected,
  isSallaConnected,
  fixedMappings,
  onFixedMappingsChange,
  erpType = 'odoo',
}: FixedMappingTabProps) {
  const { lang, dir } = useLanguage()

  const getErpName = (type: string) => {
    if (type === 'odoo') return 'أودو'
    if (type === 'zoho') return 'زوهو'
    if (type === 'erpnext') return 'ERPNext'
    return 'أودو'
  }
  const getErpNameEn = (type: string) => {
    if (type === 'odoo') return 'Odoo'
    if (type === 'zoho') return 'Zoho'
    if (type === 'erpnext') return 'ERPNext'
    return 'Odoo'
  }
  const [view, setView] = useState<'list' | 'form'>('list')
  const [isSaving, setIsSaving] = useState(false)
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [editingMapping, setEditingMapping] = useState<any | null>(null)

  // Form State
  const [platform, setPlatform] = useState<'zid' | 'salla'>(() => {
    return isSallaConnected && !isZidConnected ? 'salla' : 'zid'
  })
  
  const defaultModel = hasOdooConnection && initialModels.length > 0
    ? initialModels[0].model
    : 'product.template'
    
  const [odooModel, setOdooModel] = useState(defaultModel)
  
  const defaultEvent = platform === 'salla' ? 'product.created' : 'product.create'
  const [action, setAction] = useState(defaultEvent)
  const [odooField, setOdooField] = useState('')
  const [platformField, setPlatformField] = useState('')

  // Odoo Fields state
  const [odooFieldsList, setOdooFieldsList] = useState<any[]>([])
  const [isLoadingFields, setIsLoadingFields] = useState(false)

  // Align starting event when platform changes
  useEffect(() => {
    if (view === 'form') {
      if (editingMapping) {
        if (platform !== editingMapping.platform) {
          const fallbackEvent = platform === 'salla' ? 'product.created' : 'product.create'
          setAction(fallbackEvent)
        }
      } else {
        const fallbackEvent = platform === 'salla' ? 'product.created' : 'product.create'
        setAction(fallbackEvent)
      }
    }
  }, [platform, view, editingMapping])

  // Sync Odoo Model when selected Event (action) changes
  useEffect(() => {
    if (view === 'form') {
      if (editingMapping) {
        if (action !== editingMapping.action) {
          const eventsList = platform === 'salla' ? SALLA_EVENTS : ZID_EVENTS
          const selectedEventObj = eventsList.find(e => e.id === action)
          if (selectedEventObj?.targetModel) {
            setOdooModel(selectedEventObj.targetModel)
          }
        }
      } else {
        const eventsList = platform === 'salla' ? SALLA_EVENTS : ZID_EVENTS
        const selectedEventObj = eventsList.find(e => e.id === action)
        if (selectedEventObj?.targetModel) {
          setOdooModel(selectedEventObj.targetModel)
        }
      }
    }
  }, [action, platform, view, editingMapping])

  // Fetch Odoo Fields for the selected model
  useEffect(() => {
    if (hasOdooConnection) {
      setIsLoadingFields(true)
      getOdooModelFields(odooModel)
        .then(res => {
          if (res.success && res.fields) {
            setOdooFieldsList(res.fields)
          } else {
            setOdooFieldsList(ODOO_FIELDS[odooModel] || [])
          }
        })
        .catch(err => {
          console.error('Failed to fetch Odoo fields:', err)
          setOdooFieldsList(ODOO_FIELDS[odooModel] || [])
        })
        .finally(() => {
          setIsLoadingFields(false)
        })
    } else {
      setOdooFieldsList(ODOO_FIELDS[odooModel] || [])
    }
    
    if (editingMapping && editingMapping.odoo_model === odooModel) {
      setOdooField(editingMapping.odoo_field)
    } else {
      setOdooField('')
    }
  }, [odooModel, hasOdooConnection, editingMapping])

  // Get Platform fields list based on platform and event (action)
  const getPlatformFields = () => {
    const fieldsMap = platform === 'salla' ? SALLA_FIELDS : ZID_FIELDS
    const eventKey = action
    
    if (platform === 'salla') {
      if (SALLA_FIELDS[eventKey]) return SALLA_FIELDS[eventKey]
      if (eventKey === 'product.deleted') return SALLA_FIELDS['product.delete'] || []
      if (['product.updated', 'product.publish', 'product.available', 'product.quantity.low'].includes(eventKey)) {
        return SALLA_FIELDS['product.update'] || []
      }
      if (eventKey.startsWith('product')) return SALLA_FIELDS['product.template'] || []
      if (eventKey.startsWith('order') || eventKey.startsWith('abandoned.cart')) return SALLA_FIELDS['sale.order'] || []
      if (eventKey.startsWith('customer') || eventKey.startsWith('store.branch')) return SALLA_FIELDS['res.partner'] || []
      if (eventKey.startsWith('category')) return SALLA_FIELDS['product.category'] || []
    } else {
      if (ZID_FIELDS[eventKey]) return ZID_FIELDS[eventKey]
      if (eventKey === 'product.delete') return ZID_FIELDS['product.delete'] || []
      if (eventKey === 'product.update' || eventKey === 'product.publish') return ZID_FIELDS['product.update'] || []
      if (eventKey === 'category.delete') return ZID_FIELDS['product.category.delete'] || []
      if (eventKey.startsWith('product') || eventKey.startsWith('category')) {
        if (odooModel.includes('category')) return ZID_FIELDS['product.category'] || []
        return ZID_FIELDS['product.template'] || []
      }
      if (eventKey === 'cart.abandoned') return ZID_FIELDS['cart.abandoned'] || []
      if (eventKey.startsWith('order')) return ZID_FIELDS['sale.order'] || []
      if (eventKey.startsWith('customer')) return ZID_FIELDS['res.partner'] || []
    }
    
    if (odooModel.includes('partner') || odooModel.includes('customer')) return fieldsMap['res.partner'] || []
    if (odooModel.includes('order')) return fieldsMap['sale.order'] || []
    return fieldsMap['product.template'] || []
  }

  const platformFieldsList = getPlatformFields()

  // Reset platform field when event or platform changes
  useEffect(() => {
    if (editingMapping && editingMapping.platform === platform && editingMapping.action === action) {
      setPlatformField(editingMapping.platform_field)
    } else {
      setPlatformField('')
    }
  }, [action, platform, editingMapping])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!odooField || !platformField) {
      setErrorMessage(lang === 'ar' ? 'يرجى اختيار الحقلين للربط' : 'Please select both fields to map')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const res = await saveFixedMapping({
        id: editingMapping?.id || undefined,
        platform,
        odooModel,
        action,
        odooField,
        platformField,
      })

      if (res.success) {
        // Reload/Upsert local state to update the list view
        const updatedMappings = [...fixedMappings]
        const existingIdx = editingMapping
          ? updatedMappings.findIndex(m => m.id === editingMapping.id)
          : updatedMappings.findIndex(
              m => m.platform === platform && m.odoo_model === odooModel && m.action === action
            )

        const newObj = {
          id: editingMapping?.id || Math.random().toString(), // local random ID until page reload
          platform,
          odoo_model: odooModel,
          action,
          odoo_field: odooField,
          platform_field: platformField,
        }

        if (existingIdx > -1) {
          updatedMappings[existingIdx] = { ...updatedMappings[existingIdx], ...newObj }
        } else {
          updatedMappings.push(newObj)
        }

        onFixedMappingsChange(updatedMappings)
        setView('list')
        setEditingMapping(null)
        setOdooField('')
        setPlatformField('')
      } else {
        setErrorMessage(res.error || (lang === 'ar' ? 'فشل حفظ الربط الثابت' : 'Failed to save fixed mapping'))
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error occurred')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = (mapping: any) => {
    setEditingMapping(mapping)
    setPlatform(mapping.platform)
    setOdooModel(mapping.odoo_model)
    setAction(mapping.action)
    setView('form')
  }

  const handleDelete = async (id: string) => {
    setIsDeletingId(id)
    try {
      const res = await deleteFixedMapping(id)
      if (res.success) {
        onFixedMappingsChange(fixedMappings.filter(m => m.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete:', err)
    } finally {
      setIsDeletingId(null)
    }
  }

  const getModelName = (modelId: string) => {
    const found = initialModels.find(m => m.model === modelId) || SUPPORTED_MODELS_STATIC.find(m => m.id === modelId)
    if (!found) return modelId
    if ('name' in found) return found.name
    return lang === 'ar' ? found.nameAr : found.nameEn
  }

  const getEventName = (eventId: string, platformVal: 'zid' | 'salla') => {
    const eventsList = platformVal === 'salla' ? SALLA_EVENTS : ZID_EVENTS
    const found = eventsList.find(e => e.id === eventId)
    return found ? found.name : eventId
  }

  const modelsOptions = initialModels.length > 0
    ? initialModels.map((m: any) => ({ value: m.model, label: `${m.name} (${m.model})` }))
    : ODOO_MODELS.map((m: any) => ({ value: m.id, label: m.name }))

  const eventsOptions = (platform === 'salla' ? SALLA_EVENTS : ZID_EVENTS).map((e: any) => ({
    value: e.id,
    label: e.name,
    group: e.group
  }))

  if (view === 'form') {
    return (
      <div className="space-y-4" dir={dir}>
        <Button 
          variant="ghost" 
          onClick={() => {
            setView('list')
            setEditingMapping(null)
            setErrorMessage('')
          }} 
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg mb-2"
        >
          <ArrowRight className={cn("h-4 w-4", lang === 'ar' ? "rotate-0" : "rotate-180")} />
          {lang === 'ar' ? 'العودة للقائمة' : 'Back to List'}
        </Button>

        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-xs text-foreground">
              {editingMapping 
                ? (lang === 'ar' ? 'تعديل الربط الثابت' : 'Edit Fixed Mapping') 
                : (lang === 'ar' ? 'إضافة ربط ثابت جديد' : 'Add New Fixed Mapping')}
            </h3>
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 text-xs bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded-lg">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            {/* Platform Selection Tab Header */}
            <div className="space-y-1.5 max-w-[200px]">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {lang === 'ar' ? 'المنصة' : 'Platform'}
              </label>
              <div className="flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/50 rounded-lg p-1">
                {(!isZidConnected && !isSallaConnected) || isZidConnected ? (
                  <button
                    type="button"
                    onClick={() => setPlatform('zid')}
                    className={cn(
                      'flex-1 text-center py-1 rounded-md text-[10px] font-bold transition-all duration-200',
                      platform === 'zid'
                        ? 'bg-white dark:bg-slate-700 text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {lang === 'ar' ? 'زد' : 'Zid'}
                  </button>
                ) : null}
                {isSallaConnected ? (
                  <button
                    type="button"
                    onClick={() => setPlatform('salla')}
                    className={cn(
                      'flex-1 text-center py-1 rounded-md text-[10px] font-bold transition-all duration-200',
                      platform === 'salla'
                        ? 'bg-white dark:bg-slate-700 text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {lang === 'ar' ? 'سله' : 'Salla'}
                  </button>
                ) : null}
              </div>
            </div>

            {/* Row 1: Odoo Model & Platform Event */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {lang === 'ar' ? `نموذج ${getErpName(erpType)} (${getErpNameEn(erpType)} Model)` : `${getErpNameEn(erpType)} Model`}
                </label>
                <SearchableSelect
                  value={odooModel}
                  onChange={(val) => setOdooModel(val)}
                  options={modelsOptions}
                  placeholder={lang === 'ar' ? 'اختر النموذج...' : 'Select model...'}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {platform === 'salla' 
                    ? (lang === 'ar' ? 'حدث سلة (Salla Event)' : 'Salla Event') 
                    : (lang === 'ar' ? 'حدث زد (Zid Event)' : 'Zid Event')}
                </label>
                <SearchableSelect
                  value={action}
                  onChange={(val) => setAction(val)}
                  options={eventsOptions}
                  placeholder={lang === 'ar' ? 'اختر الحدث...' : 'Select event...'}
                />
              </div>
            </div>

            {/* Row 2: ERP Field & Store Field */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {lang === 'ar' ? `حقل ${getErpName(erpType)} (${getErpNameEn(erpType)} Field)` : `${getErpNameEn(erpType)} Field`}
                </label>
                <SearchableSelect
                  value={odooField}
                  onChange={(val) => setOdooField(val)}
                  options={odooFieldsList.map(f => ({ value: f.value, label: f.label }))}
                  placeholder={isLoadingFields ? 'Loading...' : (lang === 'ar' ? 'اختر الحقل...' : 'Select field...')}
                  disabled={isLoadingFields}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  {lang === 'ar' ? 'حقل المتجر (Store Field)' : 'Store Field'}
                </label>
                <SearchableSelect
                  value={platformField}
                  onChange={(val) => setPlatformField(val)}
                  options={platformFieldsList.map(f => ({ value: f.value, label: f.label }))}
                  placeholder={lang === 'ar' ? 'اختر الحقل...' : 'Select field...'}
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Button
                type="submit"
                disabled={isSaving || !odooField || !platformField}
                className="gradient-brand text-white text-xs font-semibold h-9 px-5 rounded-lg shadow-sm hover:scale-[1.01] transition-transform duration-200"
              >
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : editingMapping ? (
                  lang === 'ar' ? 'تعديل الربط الثابت' : 'Update Fixed Mapping'
                ) : (
                  lang === 'ar' ? 'حفظ الربط الثابت' : 'Save Fixed Mapping'
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200" dir={dir}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
            {lang === 'ar' ? 'إعدادات الربط الثابت' : 'Fixed Mapping Settings'}
          </h1>
          <p className="mt-1 text-muted-foreground text-[11px]">
            {lang === 'ar' 
              ? 'تحديد معرفات المطابقة الافتراضية وحقول الربط الثابتة التي سيتم تعبئتها تلقائياً عند إنشاء أو تعديل روابط الحقول.' 
              : 'Configure default match keys and static fields that auto-populate when creating or editing field mappings.'}
          </p>
        </div>
        <Button 
          onClick={() => {
            setEditingMapping(null)
            setPlatform(isSallaConnected && !isZidConnected ? 'salla' : 'zid')
            setOdooModel(defaultModel)
            setAction(defaultEvent)
            setOdooField('')
            setPlatformField('')
            setView('form')
          }}
          className="gradient-brand text-white gap-1.5 font-medium rounded-lg h-9 text-xs shadow-sm hover:scale-[1.01] transition-transform duration-200"
        >
          <Plus className="h-3.5 w-3.5" />
          {lang === 'ar' ? 'إضافة ربط ثابت جديد' : 'Add New Fixed Mapping'}
        </Button>
      </div>

      {fixedMappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center min-h-[250px] bg-white dark:bg-slate-900 rounded-xl border border-slate-200/80 dark:border-slate-800 p-6 shadow-sm">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary/10 to-purple-500/10 flex items-center justify-center mb-4">
            <Layers className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-sm font-bold text-foreground mb-1">
            {lang === 'ar' ? 'لا يوجد ربط ثابت حالياً' : 'No Fixed Mappings Yet'}
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4 leading-relaxed">
            {lang === 'ar' 
              ? `قم بتحديد معرفات ربط ثابتة ليتم تعبئتها تلقائياً مثل ربط معرف منتج زد (id) بحقل مخصص في ${getErpName(erpType)} (x_zid_id).` 
              : `Define static mapping identifiers to automatically populate them inside new mappings (e.g. matching Zid id to ${getErpNameEn(erpType)} x_zid_id).`}
          </p>
          <Button 
            onClick={() => {
              setEditingMapping(null)
              setPlatform(isSallaConnected && !isZidConnected ? 'salla' : 'zid')
              setOdooModel(defaultModel)
              setAction(defaultEvent)
              setOdooField('')
              setPlatformField('')
              setView('form')
            }}
            className="gradient-brand text-white gap-1.5 font-semibold rounded-lg h-9 text-xs shadow-sm hover:scale-[1.01] transition-transform duration-200"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'إضافة ربط ثابت الآن' : 'Add Fixed Mapping Now'}
          </Button>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm rounded-xl overflow-hidden divide-y divide-border/60 animate-in fade-in-50 slide-in-from-bottom-2 duration-200">
          {fixedMappings.map((item) => {
            const isPlatformSalla = item.platform === 'salla'
            return (
              <div 
                key={item.id}
                className="p-4 hover:bg-muted/5 transition-colors flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 mt-0.5">
                    <ArrowRightLeft className="h-4.5 w-4.5" />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-xs text-foreground">
                        {getModelName(item.odoo_model)}
                      </span>
                      {/* Platform Source Badge */}
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border',
                        isPlatformSalla
                          ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-400/30'
                          : 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-400/30'
                      )}>
                        <span className={cn(
                          'inline-block w-1.5 h-1.5 rounded-full',
                          isPlatformSalla ? 'bg-teal-500' : 'bg-violet-500'
                        )} />
                        {isPlatformSalla ? (lang === 'ar' ? 'سله' : 'Salla') : (lang === 'ar' ? 'زد' : 'Zid')}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[9px] font-semibold text-muted-foreground border">
                        {getEventName(item.action, item.platform)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{lang === 'ar' ? `حقل ${getErpName(erpType)}: ` : `${getErpNameEn(erpType)} Field: `}</span>
                      <span className="font-mono text-foreground font-semibold bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">{item.odoo_field}</span>
                      <span className="text-muted-foreground/50">⇄</span>
                      <span>{lang === 'ar' ? 'حقل المنصة: ' : 'Platform Field: '}</span>
                      <span className="font-mono text-foreground font-semibold bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">{item.platform_field}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => handleEdit(item)}
                    className="h-8 w-8 text-muted-foreground hover:text-primary rounded-lg hover:bg-primary/10"
                    title={lang === 'ar' ? 'تعديل الربط الثابت' : 'Edit Fixed Mapping'}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={isDeletingId === item.id}
                    onClick={() => handleDelete(item.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive rounded-lg hover:bg-destructive/10"
                    title={lang === 'ar' ? 'حذف الربط الثابت' : 'Delete Fixed Mapping'}
                  >
                    {isDeletingId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
