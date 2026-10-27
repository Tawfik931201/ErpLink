'use client'

import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Check, Loader2, AlertTriangle, ChevronDown,
  Info, Wand2, X, RefreshCw, Database, ArrowRight, Calendar, Edit
} from 'lucide-react'
import React, { useState, useEffect, useCallback, useRef } from 'react'

import {
  createCustomOdooField,
  getCustomOdooFields,
  deleteCustomOdooField,
  updateCustomOdooField,
  type CreateCustomFieldData,
  type CustomFieldView,
  type UpdateCustomFieldData,
} from '@/app/actions/custom-fields'
import {
  createCustomErpNextField,
  getCustomErpNextFields,
  deleteCustomErpNextField,
  updateCustomErpNextField,
} from '@/app/actions/custom-fields-erpnext'
import { getOdooGroups, getOdooModels } from '@/app/actions/odoo'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { sanitizeTechnicalName, sanitizeTechnicalNameErpNext } from '@/lib/field-utils'
import { cn } from '@/lib/utils'

import SearchableSelect from './searchable-select'


// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectionOption { key: string; label: string }

interface CreatedField {
  id?: string
  odoo_field_id?: number
  field_name: string
  field_label: string
  odoo_model: string
  field_type: string
  views?: string
  created_at?: string
  properties?: {
    readonly?: boolean
    required?: boolean
    copy?: boolean
    help?: string
    relation?: string
    selection_options?: Array<{ key: string; label: string }>
    group_ids?: number[]
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_TYPES = [
  { value: 'char',      label: 'Text (char)',           descAr: 'نص قصير',           descEn: 'Short text' },
  { value: 'text',      label: 'Long Text (text)',      descAr: 'نص طويل',           descEn: 'Long text' },
  { value: 'integer',   label: 'Integer (integer)',     descAr: 'عدد صحيح',          descEn: 'Whole number' },
  { value: 'float',     label: 'Float (float)',         descAr: 'عدد عشري',          descEn: 'Decimal number' },
  { value: 'boolean',   label: 'Boolean (boolean)',     descAr: 'نعم/لا',            descEn: 'Yes or No' },
  { value: 'date',      label: 'Date (date)',           descAr: 'تاريخ',             descEn: 'Date only' },
  { value: 'datetime',  label: 'Datetime (datetime)',   descAr: 'تاريخ ووقت',        descEn: 'Date & time' },
  { value: 'many2one',  label: 'Many2one (many2one)',   descAr: 'ارتباط بسجل',       descEn: 'Link to record' },
  { value: 'selection', label: 'Selection (selection)', descAr: 'قائمة اختيارات',    descEn: 'Dropdown list' },
  { value: 'monetary',  label: 'Monetary (monetary)',   descAr: 'قيمة نقدية',        descEn: 'Currency amount' },
]

const TYPE_COLORS: Record<string, string> = {
  char:      'bg-muted text-muted-foreground border-border',
  text:      'bg-muted text-muted-foreground border-border',
  integer:   'bg-muted text-muted-foreground border-border',
  float:     'bg-muted text-muted-foreground border-border',
  boolean:   'bg-muted text-muted-foreground border-border',
  date:      'bg-muted text-muted-foreground border-border',
  datetime:  'bg-muted text-muted-foreground border-border',
  many2one:  'bg-muted text-muted-foreground border-border',
  selection: 'bg-muted text-muted-foreground border-border',
  monetary:  'bg-muted text-muted-foreground border-border',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AddCustomFieldFormProps {
  initialModels: Array<{ model: string; name: string }>
  hasOdooConnection: boolean
  erpType?: string
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AddCustomFieldForm({ initialModels, hasOdooConnection, erpType = 'odoo' }: AddCustomFieldFormProps) {
  const { lang, dir } = useLanguage()

  // 'list' | 'form'
  const [view, setView] = useState<'list' | 'form'>('list')
  const [editingField, setEditingField] = useState<CreatedField | null>(null)

  const fieldTypesList = erpType === 'erpnext' ? [
    { value: 'char',      label: 'Data (Data)',           descAr: 'نص قصير (Data)',           descEn: 'Short text (Data)' },
    { value: 'text',      label: 'Small Text / Text',     descAr: 'نص طويل (Text)',           descEn: 'Long text (Text)' },
    { value: 'integer',   label: 'Int (Int)',             descAr: 'عدد صحيح (Int)',          descEn: 'Whole number (Int)' },
    { value: 'float',     label: 'Float (Float)',         descAr: 'عدد عشري (Float)',         descEn: 'Decimal number (Float)' },
    { value: 'boolean',   label: 'Check (Check)',         descAr: 'نعم/لا (Check)',            descEn: 'Yes or No (Check)' },
    { value: 'date',      label: 'Date (Date)',           descAr: 'تاريخ (Date)',             descEn: 'Date only (Date)' },
    { value: 'datetime',  label: 'Datetime (Datetime)',   descAr: 'تاريخ ووقت (Datetime)',    descEn: 'Date & time (Datetime)' },
    { value: 'many2one',  label: 'Link (Link)',           descAr: 'ارتباط بسجل (Link)',       descEn: 'Link to record (Link)' },
    { value: 'selection', label: 'Select (Select)',       descAr: 'قائمة اختيارات (Select)',    descEn: 'Dropdown list (Select)' },
    { value: 'monetary',  label: 'Currency (Currency)',   descAr: 'قيمة نقدية (Currency)',        descEn: 'Currency amount (Currency)' },
  ] : FIELD_TYPES

  // Form state
  const [fieldLabel, setFieldLabel] = useState('')
  const [technicalName, setTechnicalName] = useState('')
  const [techNameManual, setTechNameManual] = useState(false)
  const [fieldType, setFieldType] = useState('char')
  // Models load lazily (only when the form view opens): the page no longer
  // blocks its server render on the Odoo ir.model round-trip, and the default
  // "list" view never needs them at all.
  const [models, setModels] = useState<Array<{ model: string; name: string }>>(initialModels || [])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(initialModels[0]?.model || '')
  const [selectedView, setSelectedView] = useState<CustomFieldView>('form')
  const [isReadonly, setIsReadonly] = useState(false)
  const [isRequired, setIsRequired] = useState(false)
  const [isCopy, setIsCopy] = useState(true)
  const [helpText, setHelpText] = useState('')
  const [relationModel, setRelationModel] = useState('')
  const [selectionOpts, setSelectionOpts] = useState<SelectionOption[]>([{ key: '', label: '' }])
  const [odooGroups, setOdooGroups] = useState<Array<{ id: number; name: string }>>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])

  // UI
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setShowSuccess] = useState(false)
  const [viewWarning, setViewWarning] = useState<string | null>(null)
  const [injectedViews, setInjectedViews] = useState<string[]>([])

  // List
  const [createdFields, setCreatedFields] = useState<CreatedField[]>([])
  const [isLoadingFields, setIsLoadingFields] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Auto-generate technical name from label
  useEffect(() => {
    if (!techNameManual && fieldLabel) {
      setTechnicalName(
        erpType === 'erpnext'
          ? sanitizeTechnicalNameErpNext(fieldLabel)
          : sanitizeTechnicalName(fieldLabel)
      )
    }
  }, [fieldLabel, techNameManual, erpType])

  // Load fields (network-hardened: a rejected server-action fetch used to
  // leave the spinner stuck forever plus an unhandled "Failed to fetch").
  const [fieldsError, setFieldsError] = useState<string | null>(null)
  const loadFields = useCallback(async () => {
    setIsLoadingFields(true)
    setFieldsError(null)
    try {
      const res = erpType === 'erpnext'
        ? await getCustomErpNextFields()
        : await getCustomOdooFields()
      if (res.success) {
        setCreatedFields((res.fields || []) as CreatedField[])
      } else {
        setFieldsError(res.error || 'Failed to load fields')
      }
    } catch (err) {
      console.error('loadFields failed:', err)
      setFieldsError(err instanceof Error ? err.message : 'Failed to load fields')
    } finally {
      setIsLoadingFields(false)
    }
  }, [erpType])

  useEffect(() => { loadFields() }, [loadFields])

  // Models fetch, StrictMode-safe and manual-first.
  // The old effect used a `cancelled` boolean: in dev (reactStrictMode) the
  // effect mounts, unmounts and remounts — run #1 set isLoadingModels(true)
  // then got cancelled, run #2 bailed out early on isLoadingModels, and run
  // #1's `finally` skipped setIsLoadingModels(false) because it was
  // cancelled. Result: the select sat on "loading" forever. The request id
  // below means only the LATEST request may write state, so a stale
  // cancellation can never freeze the spinner.
  // No auto-retry loop: one automatic attempt per form visit; a failure sets
  // a stable modelsError, and further refreshes are manual via the
  // circular-arrow button (or the retry link under the error).
  const modelsReqId = useRef(0)
  const loadModels = useCallback(async () => {
    if (!hasOdooConnection) return
    const reqId = ++modelsReqId.current
    setIsLoadingModels(true)
    setModelsError(null)
    try {
      const res = await getOdooModels()
      if (modelsReqId.current !== reqId) return
      if (res.success && res.models) {
        setModels(res.models)
        setSelectedModel(prev => prev || res.models[0]?.model || '')
      } else {
        setModelsError(res.error || 'Failed to load models')
      }
    } catch (err) {
      if (modelsReqId.current !== reqId) return
      setModelsError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      if (modelsReqId.current === reqId) setIsLoadingModels(false)
    }
  }, [hasOdooConnection])

  // One automatic attempt when the form view opens (skipped when models are
  // already loaded). Afterwards the user refreshes manually.
  const modelsAutoTried = useRef(false)
  useEffect(() => {
    if (view !== 'form' || !hasOdooConnection || models.length > 0 || modelsAutoTried.current) return
    modelsAutoTried.current = true
    loadModels()
  }, [view, hasOdooConnection, models.length, loadModels])

  // Load groups lazily too — only for the form view, never for the list.
  useEffect(() => {
    if (view !== 'form' || !hasOdooConnection || erpType === 'erpnext' || odooGroups.length > 0) return
    let cancelled = false
    const loadGroups = async () => {
      try {
        const res = await getOdooGroups()
        if (!cancelled && res.success && res.groups) {
          setOdooGroups(res.groups)
        }
      } catch (err) {
        console.error('Failed to load Odoo groups:', err)
      }
    }
    loadGroups()
    return () => { cancelled = true }
  }, [view, hasOdooConnection, erpType, odooGroups.length])

  // Reset form
  const resetForm = () => {
    setFieldLabel(''); setTechnicalName(''); setTechNameManual(false)
    setFieldType('char'); setSelectedView('form'); setIsReadonly(false)
    setIsRequired(false); setIsCopy(true); setHelpText('')
    setRelationModel(''); setSelectionOpts([{ key: '', label: '' }])
    setSelectedGroups([])
    setSaveError(null)
    setEditingField(null)
  }

  const goToList = () => { resetForm(); setView('list') }
  const goToForm = () => { resetForm(); modelsAutoTried.current = false; setView('form') }

  const startEditField = (field: CreatedField) => {
    setEditingField(field)
    setFieldLabel(field.field_label)
    setTechnicalName(field.field_name)
    setTechNameManual(true)
    setFieldType(field.field_type)
    setSelectedModel(field.odoo_model)
    // properties:
    const props = field.properties || {}
    setIsReadonly(props.readonly ?? false)
    setIsRequired(props.required ?? false)
    setIsCopy(props.copy ?? true)
    setHelpText(props.help ?? '')
    setRelationModel(props.relation ?? '')
    setSelectionOpts(props.selection_options && props.selection_options.length > 0 ? props.selection_options : [{ key: '', label: '' }])
    setSelectedGroups((props.group_ids || []).map(String))
    setSaveError(null)
    modelsAutoTried.current = false
    setView('form')
  }

  // Validate
  const isErpNext = erpType === 'erpnext'
  const techNameValid = isErpNext
    ? /^custom_[a-z][a-z0-9_]{0,61}$/.test(technicalName)
    : /^x_[a-z][a-z0-9_]{0,61}$/.test(technicalName)

  const techNameError = technicalName && !techNameValid
    ? (isErpNext
      ? (lang === 'ar'
        ? 'يجب أن يبدأ بـ custom_ ويحتوي على حروف صغيرة وأرقام وشرطة سفلية فقط'
        : 'Must start with custom_ and use only lowercase letters, numbers, underscores')
      : (lang === 'ar'
        ? 'يجب أن يبدأ بـ x_ ويحتوي على حروف صغيرة وأرقام وشرطة سفلية فقط'
        : 'Must start with x_ and use only lowercase letters, numbers, underscores'))
    : null

  // Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fieldLabel.trim() || !technicalName || !selectedModel || !techNameValid) return
    setSaveError(null)
    setIsSaving(true)

    if (editingField) {
      if (erpType === 'erpnext') {
        if (!editingField.id) {
          setSaveError('Field identifiers missing')
          setIsSaving(false)
          return
        }

        const payload = {
          id: editingField.id,
          fieldname: editingField.field_name,
          docType: editingField.odoo_model,
          fieldLabel: fieldLabel.trim(),
          readonly: isReadonly,
          required: isRequired,
          help: helpText.trim(),
          ...(fieldType === 'selection' ? { selectionOptions: selectionOpts.filter(o => o.key.trim() && o.label.trim()) } : {}),
        }

        const res = await updateCustomErpNextField(payload)
        setIsSaving(false)

        if (res.success) {
          setShowSuccess(true)
          setTimeout(() => { setShowSuccess(false); loadFields(); setView('list'); setEditingField(null) }, 2000)
        } else {
          setSaveError(res.error || 'Unknown error')
        }
      } else {
        if (!editingField.id || !editingField.odoo_field_id) {
          setSaveError('Field identifiers missing')
          setIsSaving(false)
          return
        }

        const payload: UpdateCustomFieldData = {
          id: editingField.id,
          odooFieldId: editingField.odoo_field_id,
          fieldLabel: fieldLabel.trim(),
          readonly: isReadonly,
          required: isRequired,
          copy: isCopy,
          help: helpText.trim(),
          ...(fieldType === 'selection' ? { selectionOptions: selectionOpts.filter(o => o.key.trim() && o.label.trim()) } : {}),
          groupIds: selectedGroups.map(Number),
        }

        const res = await updateCustomOdooField(payload)
        setIsSaving(false)

        if (res.success) {
          setShowSuccess(true)
          setTimeout(() => { setShowSuccess(false); loadFields(); setView('list'); setEditingField(null) }, 2000)
        } else {
          setSaveError(res.error || 'Unknown error')
        }
      }
    } else {
      const payload: CreateCustomFieldData = {
        fieldLabel: fieldLabel.trim(),
        technicalName,
        fieldType,
        odooModel: selectedModel,
        views: selectedView,
        readonly: isReadonly,
        required: isRequired,
        copy: isCopy,
        help: helpText.trim(),
        ...(fieldType === 'many2one' && relationModel ? { relation: relationModel } : {}),
        ...(fieldType === 'selection' ? { selectionOptions: selectionOpts.filter(o => o.key.trim() && o.label.trim()) } : {}),
        groupIds: selectedGroups.map(Number),
      }

      const res = erpType === 'erpnext'
        ? await createCustomErpNextField(payload)
        : await createCustomOdooField(payload)
      setIsSaving(false)

      if (res.success) {
        // Show which views were injected successfully
        const successViews = erpType === 'erpnext'
          ? [lang === 'ar' ? 'واجهات النظام تلقائياً' : 'System views automatically']
          : (res.viewResults || []).filter((r: any) => r.viewId).map((r: any) => r.type)
        setInjectedViews(successViews)
        setViewWarning(res.viewWarning || null)
        setShowSuccess(true)
        setTimeout(() => { setShowSuccess(false); setViewWarning(null); setInjectedViews([]); loadFields(); setView('list') }, 3000)
      } else {
        setSaveError(res.error || 'Unknown error')
      }
    }
  }

  // Delete
  const handleDelete = async (field: CreatedField) => {
    if (erpType !== 'erpnext' && !field.odoo_field_id) return
    const fid = field.id || field.field_name
    setDeletingId(fid)
    
    if (erpType === 'erpnext') {
      await deleteCustomErpNextField(field.field_name, field.odoo_model)
    } else {
      if (field.odoo_field_id) {
        await deleteCustomOdooField(field.odoo_field_id, field.id)
      }
    }
    
    setDeletingId(null)
    setDeleteConfirmId(null)
    loadFields()
  }

  // Selection helpers
  const addSelectionOpt = () => setSelectionOpts(p => [...p, { key: '', label: '' }])
  const removeSelectionOpt = (i: number) => setSelectionOpts(p => p.filter((_, idx) => idx !== i))
  const updateSelectionOpt = (i: number, f: 'key' | 'label', v: string) =>
    setSelectionOpts(p => p.map((o, idx) => idx === i ? { ...o, [f]: v } : o))

  const selectedTypeInfo = fieldTypesList.find(t => t.value === fieldType)

  // ── VIEW: FORM ─────────────────────────────────────────────────────────────
  if (view === 'form') {
    return (
      <div className="max-w-4xl mx-auto space-y-4 font-sans" dir={dir}>

        {/* Back button */}
        <Button
          variant="ghost"
          onClick={goToList}
          className="gap-2 text-muted-foreground hover:text-foreground text-sm font-semibold rounded-lg"
        >
          <ArrowRight className={cn('h-4 w-4', lang === 'ar' ? 'rotate-0' : 'rotate-180')} />
          {lang === 'ar' ? 'العودة للقائمة' : 'Back to List'}
        </Button>

        {/* Connection warning */}
        {!hasOdooConnection && (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted p-3.5">
            <AlertTriangle className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-foreground font-medium">
              {lang === 'ar'
                ? `يجب ربط ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'} أولاً لإنشاء حقول مخصصة.`
                : `${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'} must be connected before creating custom fields.`}
            </p>
          </div>
        )}

        {/* Success overlay */}
        <AnimatePresence>
          {saveSuccess && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="rounded-xl border border-border bg-muted p-4 space-y-2"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Check className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {editingField 
                      ? (lang === 'ar' ? `تم تحديث الحقل بنجاح في ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'} ✓` : `Field updated successfully in ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'} ✓`)
                      : (lang === 'ar' ? `تم إنشاء الحقل بنجاح في ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'} ✓` : `Field created successfully in ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'} ✓`)}
                  </p>
                  {!editingField && injectedViews.length > 0 && (
                    <p className="text-[11px] text-muted-foreground font-medium mt-0.5">
                      {lang === 'ar'
                        ? `تم إضافته تلقائياً إلى: ${injectedViews.map(v => v === 'form' ? 'شاشة النموذج' : 'شاشة القائمة').join(' + ')}`
                        : `Auto-added to: ${injectedViews.join(' + ')} view${injectedViews.length > 1 ? 's' : ''}`}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    {lang === 'ar' ? 'جاري العودة للقائمة...' : 'Returning to list...'}
                  </p>
                </div>
              </div>
              {!editingField && viewWarning && (
                <div className="flex items-start gap-2 rounded-lg bg-muted border border-border p-2.5 mt-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-foreground shrink-0 mt-0.5" />
                  <p className="text-[10px] text-foreground font-medium">{viewWarning}</p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form card */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">

            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-muted flex items-center justify-center">
                  <Plus className="h-4 w-4 text-foreground" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {editingField 
                      ? (lang === 'ar' ? 'تعديل الحقل المخصص' : 'Edit Custom Field')
                      : (lang === 'ar' ? 'إنشاء حقل مخصص جديد' : 'Create New Custom Field')}
                  </h3>
                  <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    {lang === 'ar' ? 'سيتم تفعيل store وتتبع التغييرات تلقائياً' : 'Auto-applies store=True and tracking=True'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-bold bg-muted text-muted-foreground border border-border">
                  <Check className="h-2.5 w-2.5" />store
                </span>
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[9px] font-bold bg-muted text-muted-foreground border border-border">
                  <Check className="h-2.5 w-2.5" />tracking
                </span>
              </div>
            </div>

            {/* Row 1: Label + Technical */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Field Label */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-muted-foreground">
                  {lang === 'ar' ? 'اسم الحقل للعرض' : 'Display Label'}
                  <span className="text-destructive ms-0.5">*</span>
                </label>
                <div className="rounded-xl border border-border bg-muted p-1">
                  <input
                    type="text" value={fieldLabel}
                    onChange={e => setFieldLabel(e.target.value)}
                    placeholder={lang === 'ar' ? 'مثال: درجة العميل' : 'e.g. Customer Grade'}
                    className="w-full h-8 bg-transparent border-0 px-2 text-xs font-semibold placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 text-foreground transition-all"
                    required autoFocus
                  />
                </div>
                <p className="text-[10px] text-muted-foreground font-medium">
                  {lang === 'ar' ? `الاسم الظاهر للمستخدمين في واجهة ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'}.` : `The human-readable label shown to users in ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'}.`}
                </p>
              </div>

              {/* Technical Name */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-muted-foreground flex items-center gap-1">
                    {lang === 'ar' ? `الاسم التقني (${erpType === 'erpnext' ? 'ERPNext' : 'أودو'})` : 'Technical Name'}
                    <span className="text-destructive">*</span>
                  </label>
                  {!editingField && (
                    <button
                      type="button"
                      onClick={() => {
                        setTechNameManual(false);
                        setTechnicalName(
                          erpType === 'erpnext'
                            ? sanitizeTechnicalNameErpNext(fieldLabel)
                            : sanitizeTechnicalName(fieldLabel)
                        )
                      }}
                      className="flex items-center gap-1 text-[10px] text-foreground hover:underline font-semibold"
                    >
                      <Wand2 className="h-3 w-3" />
                      {lang === 'ar' ? 'توليد تلقائي' : 'Auto-generate'}
                    </button>
                  )}
                </div>
                <div className={cn(
                  "rounded-xl border bg-muted p-1 transition-all",
                  techNameError ? 'border-destructive' : 'border-border',
                  editingField && 'opacity-65 cursor-not-allowed'
                )}>
                  <input
                    type="text" value={technicalName}
                    onChange={e => { setTechNameManual(true); setTechnicalName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_')) }}
                    placeholder={erpType === 'erpnext' ? "custom_field_name" : "x_field_name"}
                    className="w-full h-8 bg-transparent border-0 px-2 font-mono text-xs focus:outline-none focus:ring-0 text-foreground disabled:text-muted-foreground/60"
                    required
                    disabled={!!editingField}
                  />
                </div>
                {techNameError ? (
                  <p className="text-[10px] text-destructive flex items-center gap-1 font-medium">
                    <AlertTriangle className="h-3 w-3" />{techNameError}
                  </p>
                ) : technicalName && techNameValid ? (
                  <p className="text-[10px] text-foreground flex items-center gap-1 font-medium">
                    <Check className="h-3 w-3" />{lang === 'ar' ? `اسم صالح لـ ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'}` : `Valid ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'} field name`}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground font-medium">
                    {lang === 'ar' 
                      ? `اسم الحقل البرمجي في قاعدة البيانات، يجب أن يبدأ بـ ${erpType === 'erpnext' ? 'custom_' : 'x_'}.` 
                      : `Technical database key. Must start with ${erpType === 'erpnext' ? 'custom_' : 'x_'} prefix.`}
                  </p>
                )}
              </div>
            </div>

            {/* Row 2: Type + Model + View */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {/* Field Type */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-muted-foreground">{lang === 'ar' ? 'نوع الحقل' : 'Field Type'}</label>
                <div className={cn(
                  "rounded-xl border border-border bg-muted p-1 relative",
                  editingField && 'opacity-65 cursor-not-allowed'
                )}>
                  <select
                    value={fieldType} onChange={e => setFieldType(e.target.value)}
                    className="w-full h-8 bg-transparent border-0 px-2 text-xs font-semibold text-foreground focus:outline-none focus:ring-0 appearance-none cursor-pointer disabled:text-muted-foreground/60"
                    disabled={!!editingField}
                  >
                    {fieldTypesList.map(ft => (
                      <option key={ft.value} value={ft.value} className="bg-card text-foreground">
                        {ft.label}
                      </option>
                    ))}
                  </select>
                  {!editingField && <ChevronDown className="absolute end-3 top-3.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />}
                </div>
                {selectedTypeInfo && (
                  <p className="text-[10px] text-muted-foreground font-medium">
                    {lang === 'ar' ? selectedTypeInfo.descAr : selectedTypeInfo.descEn}
                  </p>
                )}
              </div>

              {/* ERP Model */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-[11px] font-bold text-muted-foreground">
                    {lang === 'ar' ? (erpType === 'erpnext' ? 'نوع المستند (DocType)' : 'موديول أودو') : (erpType === 'erpnext' ? 'ERPNext DocType' : 'Odoo Model')}
                  </label>
                  <button
                    type="button"
                    onClick={loadModels}
                    disabled={isLoadingModels || !hasOdooConnection}
                    title={lang === 'ar' ? 'تحديث قائمة الموديلات' : 'Refresh model list'}
                    className="flex items-center justify-center h-6 w-6 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-transparent hover:border-border disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', isLoadingModels && 'animate-spin')} />
                  </button>
                </div>
                <div className={cn(
                  "rounded-xl border border-border bg-muted p-0.5",
                  editingField && 'opacity-65 cursor-not-allowed'
                )}>
                  <SearchableSelect
                    options={models.map(m => ({
                      value: m.model,
                      label: m.name || m.model,
                      desc: m.model,
                    }))}
                    value={selectedModel}
                    onChange={(val: string) => setSelectedModel(val)}
                    placeholder={isLoadingModels
                      ? (lang === 'ar' ? 'جاري تحميل الموديلات...' : 'Loading models...')
                      : (lang === 'ar' ? (erpType === 'erpnext' ? 'ابحث عن نوع مستند...' : 'ابحث عن موديول...') : (erpType === 'erpnext' ? 'Search DocType...' : 'Search model...'))}
                    disabled={!!editingField || isLoadingModels}
                  />
                </div>
                {modelsError ? (
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] text-destructive font-medium flex-1">{modelsError}</p>
                    <button
                      type="button"
                      onClick={loadModels}
                      className="shrink-0 text-[10px] font-bold text-foreground hover:underline"
                    >
                      {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                    </button>
                  </div>
                ) : selectedModel ? (
                  <p className="text-[10px] font-mono text-muted-foreground font-medium">{selectedModel}</p>
                ) : (
                  <p className="text-[10px] text-muted-foreground font-medium">
                    {lang === 'ar' 
                      ? (erpType === 'erpnext' ? 'نوع المستند الذي سيتم إضافة الحقل إليه.' : 'الموديل الذي سيتم إضافة الحقل إليه.') 
                      : `The target ${erpType === 'erpnext' ? 'DocType' : 'model'} where this field will reside.`}
                  </p>
                )}
              </div>

              {/* View */}
              <div className="space-y-1.5 opacity-80">
                <label className="block text-[11px] font-bold text-muted-foreground">{lang === 'ar' ? 'يظهر في الشاشة' : 'Appears in View'}</label>
                <div className="rounded-xl border border-border bg-muted p-1 cursor-not-allowed">
                  <div className="w-full h-8 flex items-center px-2 text-xs font-semibold text-muted-foreground">
                    {lang === 'ar' ? 'نموذج (Form View) فقط' : 'Form View only'}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground font-medium">
                  {lang === 'ar' ? 'سيتم ربط الحقل تلقائياً بشاشة النموذج.' : 'The custom field is automatically integrated in the form.'}
                </p>
              </div>
            </div>

            {/* Many2one */}
            <AnimatePresence>
              {fieldType === 'many2one' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-visible relative z-20 space-y-1.5"
                >
                  <label className="block text-[11px] font-bold text-muted-foreground">
                    {lang === 'ar' ? (erpType === 'erpnext' ? 'المستند المرتبط (DocType)' : 'النموذج المرتبط') : (erpType === 'erpnext' ? 'Related DocType' : 'Related Model')}<span className="text-destructive ms-0.5">*</span>
                  </label>
                  <div className={cn(
                    "rounded-xl border border-border bg-muted p-0.5",
                    editingField && 'opacity-65 cursor-not-allowed'
                  )}>
                    <SearchableSelect
                      options={models.map(m => ({
                        value: m.model,
                        label: m.name || m.model,
                        desc: m.model,
                      }))}
                      value={relationModel}
                      onChange={(val: string) => setRelationModel(val)}
                      placeholder={isLoadingModels
                        ? (lang === 'ar' ? 'جاري تحميل الموديلات...' : 'Loading models...')
                        : (lang === 'ar' ? (erpType === 'erpnext' ? 'ابحث عن نوع مستند...' : 'ابحث عن موديول...') : (erpType === 'erpnext' ? 'Search DocType...' : 'Search model...'))}
                      disabled={!!editingField || isLoadingModels}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground font-medium">
                    {lang === 'ar' ? 'الموديل المرتبط بعلاقة many2one.' : 'The related relational model for this field.'}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Selection Options */}
            <AnimatePresence>
              {fieldType === 'selection' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="space-y-3.5 overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-bold text-muted-foreground">{lang === 'ar' ? 'خيارات القائمة' : 'Selection Options'}</label>
                    <button type="button" onClick={addSelectionOpt} className="flex items-center gap-1 text-[10px] font-bold text-foreground hover:underline">
                      <Plus className="h-3 w-3" />{lang === 'ar' ? 'إضافة خيار' : 'Add option'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {selectionOpts.map((opt, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="flex-1 rounded-xl border border-border bg-muted p-1">
                          <input type="text" value={opt.key} onChange={e => updateSelectionOpt(i, 'key', e.target.value.toLowerCase().replace(/\s/g, '_'))} placeholder="key" className="w-full h-8 bg-transparent border-0 px-2 font-mono text-xs focus:outline-none focus:ring-0 text-foreground" />
                        </div>
                        <div className="flex-1 rounded-xl border border-border bg-muted p-1">
                          <input type="text" value={opt.label} onChange={e => updateSelectionOpt(i, 'label', e.target.value)} placeholder={lang === 'ar' ? 'العنوان' : 'Label'} className="w-full h-8 bg-transparent border-0 px-2 text-xs font-semibold focus:outline-none focus:ring-0 text-foreground" />
                        </div>
                        <button type="button" onClick={() => removeSelectionOpt(i)} disabled={selectionOpts.length <= 1} className="h-9 w-9 flex items-center justify-center rounded-xl border border-border bg-card hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-30 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Properties */}
            <div className="space-y-5 pt-3 border-t border-border">
              <h4 className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                {lang === 'ar' ? 'خصائص الحقل' : 'Field Properties'}
              </h4>
              <div className={cn("grid gap-3", erpType === 'erpnext' ? "grid-cols-2" : "grid-cols-3")}>
                <ToggleProp checked={isReadonly} onToggle={() => setIsReadonly(p => !p)} labelAr="للقراءة فقط" labelEn="Read-only" descAr="لا يُعدَّل" descEn="Cannot edit" lang={lang} />
                <ToggleProp checked={isRequired} onToggle={() => setIsRequired(p => !p)} labelAr="إلزامي" labelEn="Required" descAr="يجب ملؤه" descEn="Must fill" lang={lang} />
                {erpType !== 'erpnext' && (
                  <ToggleProp checked={isCopy} onToggle={() => setIsCopy(p => !p)} labelAr="قابل للنسخ" labelEn="Copyable" descAr="ينسخ مع السجل" descEn="Copied on dup" lang={lang} />
                )}
              </div>

              {/* Odoo Groups (Access Rights) */}
              {erpType !== 'erpnext' && (
                <div className="space-y-1.5 pt-1">
                  <label className="block text-[11px] font-bold text-muted-foreground flex items-center gap-1.5">
                    {lang === 'ar' ? 'صلاحيات المجموعات (Odoo Groups)' : 'Security Groups (Access Rights)'}
                  </label>
                  <div className="rounded-xl border border-border bg-muted p-0.5">
                    <SearchableSelect
                      options={odooGroups.map(g => ({
                        value: String(g.id),
                        label: g.name,
                        desc: `res.groups #${g.id}`
                      }))}
                      value={selectedGroups}
                      onChange={(vals: string[]) => setSelectedGroups(vals)}
                      placeholder={lang === 'ar' ? 'اختر المجموعات المصرح لها...' : 'Select authorized groups...'}
                      multiple={true}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground font-medium">
                    {lang === 'ar' ? 'حدد المجموعات التي يمكنها عرض/تعديل هذا الحقل. اتركه فارغاً للجميع.' : 'Define security groups authorized to see/edit this field. Leave empty for all.'}
                  </p>
                </div>
              )}
            </div>

            {/* Help */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-muted-foreground">{lang === 'ar' ? 'تلميح المساعدة (Help Text)' : 'Help Tooltip Text'}</label>
              <div className="rounded-xl border border-border bg-muted p-1">
                <textarea
                  value={helpText} onChange={e => setHelpText(e.target.value)} rows={2}
                  placeholder={lang === 'ar' ? 'تلميح يظهر للمستخدم عند تمرير الفأرة فوق الحقل...' : 'Tooltip text shown to users when hovering over the field...'}
                  className="w-full bg-transparent border-0 px-2 py-1.5 text-xs font-semibold placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 text-foreground resize-none"
                />
              </div>
              <p className="text-[10px] text-muted-foreground font-medium">
                {lang === 'ar' 
                  ? `نص توضيحي يظهر للمستخدم في ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'} لتسهيل إدخال البيانات.` 
                  : `Instructional tooltip text displayed in ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'}.`}
              </p>
            </div>
          </div>

          {/* Error */}
          <AnimatePresence>
            {saveError && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-3.5">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive font-semibold">{saveError}</p>
                <button type="button" onClick={() => setSaveError(null)} className="ms-auto">
                  <X className="h-3.5 w-3.5 text-destructive/60" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <Button
            type="submit"
            disabled={isSaving || !fieldLabel.trim() || !selectedModel || !techNameValid}
            className="w-full bg-foreground text-background font-bold rounded-xl h-11 text-xs gap-2 transition-transform"
          >
            {isSaving
              ? <><Loader2 className="h-4 w-4 animate-spin" />{lang === 'ar' ? 'جاري حفظ التغييرات...' : 'Saving changes...'}</>
              : editingField 
                ? <><Check className="h-4 w-4" />{lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}</>
                : <><Plus className="h-4 w-4" />{lang === 'ar' ? `إنشاء الحقل مدمجاً في ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'}` : `Create Custom Field in ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'}`}</>
            }
          </Button>
        </form>
      </div>
    )
  }

  // ── VIEW: LIST ─────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-4 font-sans" dir={dir}>

      {/* List header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">
            {lang === 'ar' ? 'الحقول المخصصة' : 'Custom Fields'}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {lang === 'ar' 
              ? `حقول مخصصة مُضافة إلى ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'} مع تتبع وتزامن تلقائي` 
              : `Custom fields added to ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'} with automatic syncing & tracking`}
            {createdFields.length > 0 && (
              <span className="ms-2 inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground text-[10px] font-bold px-1.5 min-w-[20px]">
                {createdFields.length}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={loadFields}
            className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
            title={lang === 'ar' ? 'تحديث' : 'Refresh'}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoadingFields && 'animate-spin')} />
          </button>
          <Button
            onClick={goToForm}
            className="bg-foreground text-background gap-1.5 font-semibold rounded-lg h-8 text-xs transition-transform"
          >
            <Plus className="h-3.5 w-3.5" />
            {lang === 'ar' ? 'إضافة حقل جديد' : 'Add New Field'}
          </Button>
        </div>
      </div>

      {/* List card */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {isLoadingFields ? (
          <div className="flex items-center justify-center h-44">
            <Loader2 className="h-6 w-6 text-foreground animate-spin" />
          </div>
        ) : fieldsError ? (
          <div className="flex flex-col items-center justify-center h-52 text-center p-6">
            <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertTriangle className="h-7 w-7 text-destructive/60" />
            </div>
            <p className="text-sm font-bold text-foreground mb-1">
              {lang === 'ar' ? 'تعذّر تحميل الحقول' : 'Failed to load fields'}
            </p>
            <p className="text-[11px] text-muted-foreground max-w-xs mb-1" dir="ltr">
              {fieldsError}
            </p>
            <p className="text-[11px] text-muted-foreground max-w-xs mb-4">
              {lang === 'ar'
                ? 'تحقق من اتصال السيرفر ثم أعد المحاولة'
                : 'Check the server connection and try again'}
            </p>
            <Button onClick={loadFields} className="bg-foreground text-background gap-1.5 font-semibold rounded-lg h-8 text-xs transition-transform">
              <RefreshCw className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
            </Button>
          </div>
        ) : createdFields.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-52 text-center p-6">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Database className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-bold text-foreground mb-1">
              {lang === 'ar' ? 'لا توجد حقول مخصصة بعد' : 'No custom fields yet'}
            </p>
            <p className="text-[11px] text-muted-foreground max-w-xs mb-4">
              {lang === 'ar'
                ? `أضف حقولاً مخصصة إلى موديولات ${erpType === 'erpnext' ? 'ERPNext' : 'أودو'} مع تزامن وتتبع تلقائي`
                : `Add custom fields to ${erpType === 'erpnext' ? 'ERPNext' : 'Odoo'} models with automatic syncing & tracking`}
            </p>
            <Button onClick={goToForm} className="bg-foreground text-background gap-1.5 font-semibold rounded-lg h-8 text-xs transition-transform">
              <Plus className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'إضافة أول حقل' : 'Add First Field'}
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {/* Rows */}
            <AnimatePresence mode="popLayout">
              {createdFields.map((field) => {
                const fieldId = field.id || field.field_name
                const isDeleting = deletingId === fieldId
                const isConfirming = deleteConfirmId === fieldId
                return (
                  <motion.div
                    key={fieldId}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    className="p-4 hover:bg-muted/5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    {/* Details */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground mt-0.5 animate-in zoom-in-50 duration-200">
                        <Database className="h-4.5 w-4.5" />
                      </div>
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-xs text-foreground break-all">
                            {field.field_label}
                          </span>
                          {/* Technical Name Badge */}
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-mono font-bold bg-muted text-muted-foreground border border-border">
                            {field.field_name}
                          </span>
                          {/* Type Badge */}
                          <span className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold',
                            TYPE_COLORS[field.field_type] || 'bg-muted text-muted-foreground border-border'
                          )}>
                            {field.field_type}
                          </span>
                          {/* Properties Badges */}
                          {field.properties?.required && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border bg-destructive/10 text-destructive border-destructive/20">
                              {lang === 'ar' ? 'إلزامي' : 'Required'}
                            </span>
                          )}
                          {field.properties?.readonly && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border bg-muted text-muted-foreground border-border">
                              {lang === 'ar' ? 'للقراءة فقط' : 'Read-only'}
                            </span>
                          )}
                          {field.properties?.copy && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border bg-muted text-muted-foreground border-border">
                              {lang === 'ar' ? 'قابل للنسخ' : 'Copyable'}
                            </span>
                          )}
                          {field.field_type === 'many2one' && field.properties?.relation && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border bg-muted text-muted-foreground border-border">
                              {lang === 'ar' ? `يرتبط بـ: ${field.properties.relation}` : `Relation: ${field.properties.relation}`}
                            </span>
                          )}
                          {field.field_type === 'selection' && field.properties?.selection_options && field.properties.selection_options.length > 0 && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold border bg-muted text-muted-foreground border-border">
                              {lang === 'ar' 
                                ? `${field.properties.selection_options.length} خيارات` 
                                : `${field.properties.selection_options.length} Options`}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Database className="h-3 w-3 text-muted-foreground" />
                            <span>{lang === 'ar' ? (erpType === 'erpnext' ? 'مستند ERPNext: ' : 'نموذج أودو: ') : (erpType === 'erpnext' ? 'ERPNext DocType: ' : 'Odoo Model: ')}<span className="font-mono text-foreground font-semibold">{field.odoo_model}</span></span>
                          </span>
                          {field.created_at && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              <span>
                                {lang === 'ar' ? 'تاريخ الإنشاء: ' : 'Created At: '}
                                <span className="font-semibold text-foreground">
                                  {new Date(field.created_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', {
                                    year: 'numeric',
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                              </span>
                            </span>
                          )}
                          {field.properties?.help && (
                            <span className="flex items-center gap-1 col-span-full">
                              <Info className="h-3 w-3 text-muted-foreground" />
                              <span>{lang === 'ar' ? 'الوصف: ' : 'Help: '}<span className="text-foreground italic">{field.properties.help}</span></span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Operations */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {isConfirming ? (
                        <div className="flex items-center gap-1 bg-destructive/10 border border-destructive/20 rounded-lg p-1 animate-in fade-in zoom-in duration-200">
                          <span className="text-[10px] font-semibold text-destructive px-1.5">{lang === 'ar' ? 'تأكيد؟' : 'Confirm?'}</span>
                          <Button 
                            size="sm" 
                            variant="destructive" 
                            disabled={isDeleting}
                            onClick={() => handleDelete(field)}
                            className="h-6 px-2 text-xs font-semibold rounded-md"
                          >
                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : (lang === 'ar' ? 'حذف' : 'Delete')}
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => setDeleteConfirmId(null)}
                            className="h-6 px-2 text-xs font-semibold text-muted-foreground rounded-md hover:bg-muted"
                          >
                            {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                          </Button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditField(field)}
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title={lang === 'ar' ? 'تعديل الحقل' : 'Edit Field'}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button 
                            onClick={() => setDeleteConfirmId(fieldId)} 
                            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title={lang === 'ar' ? 'حذف الحقل' : 'Delete Field'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Toggle Prop ──────────────────────────────────────────────────────────────

function ToggleProp({ checked, onToggle, labelAr, labelEn, descAr, descEn, lang }: {
  checked: boolean; onToggle: () => void
  labelAr: string; labelEn: string; descAr: string; descEn: string; lang: string
}) {
  const isRTL = lang === 'ar'
  return (
    <button type="button" onClick={onToggle}
      className={cn(
        'flex flex-col items-start gap-1 p-3 rounded-xl border text-start transition-all duration-150 w-full',
        checked ? 'bg-muted border-border' : 'bg-muted border-border hover:border-border'
      )}>
      <div className="flex items-center justify-between w-full">
        <span className={cn('text-[11px] font-semibold', checked ? 'text-foreground' : 'text-muted-foreground')}>
          {lang === 'ar' ? labelAr : labelEn}
        </span>
        <div className={cn('h-4 w-7 rounded-full transition-colors flex items-center px-0.5 relative', checked ? 'bg-foreground' : 'bg-muted-foreground/30')}>
          <div
            className={cn(
              "h-3 w-3 rounded-full bg-background transition-transform duration-200 absolute",
              isRTL 
                ? (checked ? 'left-1' : 'left-3') 
                : (checked ? 'left-3' : 'left-1')
            )}
          />
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground">{lang === 'ar' ? descAr : descEn}</span>
    </button>
  )
}
