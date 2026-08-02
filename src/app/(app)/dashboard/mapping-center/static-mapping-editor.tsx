'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Loader2, Save, X, Pencil } from 'lucide-react'
import React, { useState, useEffect, useCallback } from 'react'

import { getStaticMappings, saveStaticMapping, deleteStaticMapping } from '@/app/actions/static-mappings'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type MappingTable = 'payment_method_mappings' | 'shipping_method_mappings' | 'warehouse_mappings' | 'currency_mappings' | 'tax_mappings' | 'payment_term_mappings' | 'pricelist_mappings'

interface MappingTypeConfig {
  key: MappingTable
  labelAr: string
  labelEn: string
  icon: string
  sourceLabelAr: string
  sourceLabelEn: string
  targetLabelAr: string
  targetLabelEn: string
  sourceField: string
  targetFields: { key: string; labelAr: string; labelEn: string; type: 'number' | 'text' | 'boolean' | 'decimal' }[]
  extraFields?: { key: string; labelAr: string; labelEn: string; type: 'number' | 'text' | 'boolean' }[]
}

const MAPPING_TYPES: MappingTypeConfig[] = [
  {
    key: 'payment_method_mappings',
    labelAr: 'طرق الدفع',
    labelEn: 'Payment Methods',
    icon: '💳',
    sourceLabelAr: 'طريقة الدفع في المتجر',
    sourceLabelEn: 'Store Payment Method',
    targetLabelAr: 'طريقة الدفع في أودو',
    targetLabelEn: 'Odoo Payment Method',
    sourceField: 'source_method',
    targetFields: [
      { key: 'odoo_journal_id', labelAr: 'معرف اليومية (Journal ID)', labelEn: 'Journal ID', type: 'number' },
      { key: 'odoo_payment_method_id', labelAr: 'معرف طريقة الدفع', labelEn: 'Payment Method ID', type: 'number' },
    ],
  },
  {
    key: 'shipping_method_mappings',
    labelAr: 'طرق الشحن',
    labelEn: 'Shipping Methods',
    icon: '🚚',
    sourceLabelAr: 'طريقة الشحن في المتجر',
    sourceLabelEn: 'Store Shipping Method',
    targetLabelAr: 'طريقة الشحن في أودو',
    targetLabelEn: 'Odoo Shipping Method',
    sourceField: 'source_method_name',
    targetFields: [
      { key: 'odoo_carrier_id', labelAr: 'معرف الناقل (Carrier ID)', labelEn: 'Carrier ID', type: 'number' },
      { key: 'odoo_product_id', labelAr: 'معرف منتج الشحن', labelEn: 'Shipping Product ID', type: 'number' },
    ],
  },
  {
    key: 'warehouse_mappings',
    labelAr: 'المستودعات',
    labelEn: 'Warehouses',
    icon: '🏭',
    sourceLabelAr: 'الموقع في المتجر',
    sourceLabelEn: 'Store Location',
    targetLabelAr: 'المستودع في أودو',
    targetLabelEn: 'Odoo Warehouse',
    sourceField: 'source_location_id',
    targetFields: [
      { key: 'odoo_warehouse_id', labelAr: 'معرف المستودع (Warehouse ID)', labelEn: 'Warehouse ID', type: 'number' },
      { key: 'odoo_location_id', labelAr: 'معرف الموقع (Location ID)', labelEn: 'Location ID', type: 'number' },
    ],
    extraFields: [
      { key: 'source_location_name', labelAr: 'اسم الموقع في المتجر', labelEn: 'Store Location Name', type: 'text' },
    ],
  },
  {
    key: 'tax_mappings',
    labelAr: 'الضرائب',
    labelEn: 'Taxes',
    icon: '📊',
    sourceLabelAr: 'الضريبة في المتجر',
    sourceLabelEn: 'Store Tax',
    targetLabelAr: 'الضريبة في أودو',
    targetLabelEn: 'Odoo Tax',
    sourceField: 'source_tax_name',
    targetFields: [
      { key: 'odoo_tax_id', labelAr: 'معرف الضريبة (Tax ID)', labelEn: 'Tax ID', type: 'number' },
    ],
  },
  {
    key: 'currency_mappings',
    labelAr: 'العملات',
    labelEn: 'Currencies',
    icon: '💰',
    sourceLabelAr: 'العملة في المتجر',
    sourceLabelEn: 'Store Currency',
    targetLabelAr: 'العملة في أودو',
    targetLabelEn: 'Odoo Currency',
    sourceField: 'source_currency',
    targetFields: [
      { key: 'odoo_currency_id', labelAr: 'معرف العملة (Currency ID)', labelEn: 'Currency ID', type: 'number' },
      { key: 'conversion_rate', labelAr: 'سعر التحويل', labelEn: 'Conversion Rate', type: 'decimal' },
    ],
    extraFields: [
      { key: 'auto_update', labelAr: 'تحديث تلقائي', labelEn: 'Auto Update', type: 'boolean' },
    ],
  },
  {
    key: 'payment_term_mappings',
    labelAr: 'شروط الدفع',
    labelEn: 'Payment Terms',
    icon: '📅',
    sourceLabelAr: 'شرط الدفع في المتجر',
    sourceLabelEn: 'Store Payment Term',
    targetLabelAr: 'شرط الدفع في أودو',
    targetLabelEn: 'Odoo Payment Term',
    sourceField: 'source_payment_term',
    targetFields: [
      { key: 'odoo_payment_term_id', labelAr: 'معرف شرط الدفع', labelEn: 'Payment Term ID', type: 'number' },
    ],
  },
  {
    key: 'pricelist_mappings',
    labelAr: 'قوائم الأسعار',
    labelEn: 'Pricelists',
    icon: '🏷️',
    sourceLabelAr: 'قائمة الأسعار في المتجر',
    sourceLabelEn: 'Store Pricelist',
    targetLabelAr: 'قائمة الأسعار في أودو',
    targetLabelEn: 'Odoo Pricelist',
    sourceField: 'source_pricelist',
    targetFields: [
      { key: 'odoo_pricelist_id', labelAr: 'معرف قائمة الأسعار', labelEn: 'Pricelist ID', type: 'number' },
    ],
  },
]

interface StaticMappingEditorProps {
  storeType?: string
}

export default function StaticMappingEditor({ storeType = 'zid' }: StaticMappingEditorProps) {
  const { lang, dir } = useLanguage()
  const { toast } = useToast()

  const [activeType, setActiveType] = useState<MappingTable>('payment_method_mappings')
  const [mappings, setMappings] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [formData, setFormData] = useState<Record<string, any>>({})
  const [platform, setPlatform] = useState(storeType)

  const config = MAPPING_TYPES.find(t => t.key === activeType)!

  const loadMappings = useCallback(async () => {
    setIsLoading(true)
    const res = await getStaticMappings(activeType, platform)
    if (res.success) {
      setMappings(res.mappings)
    } else {
      toast({
        title: lang === 'ar' ? 'خطأ في التحميل' : 'Load Error',
        description: res.error,
        variant: 'destructive',
      })
    }
    setIsLoading(false)
  }, [activeType, platform, lang, toast])

  useEffect(() => {
    loadMappings()
  }, [loadMappings])

  const resetForm = () => {
    setFormData({})
    setShowForm(false)
  }

  const handleEdit = (row: any) => {
    setFormData({ ...row })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    const res = await deleteStaticMapping(activeType, id)
    if (res.success) {
      toast({
        title: lang === 'ar' ? 'تم الحذف' : 'Deleted',
        description: lang === 'ar' ? 'تم حذف التحويل بنجاح' : 'Mapping deleted successfully',
      })
      loadMappings()
    } else {
      toast({
        title: lang === 'ar' ? 'خطأ في الحذف' : 'Delete Error',
        description: res.error,
        variant: 'destructive',
      })
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    const payload = { ...formData }
    delete payload.workspace_id
    delete payload.created_at
    delete payload.updated_at

    const res = await saveStaticMapping(activeType, payload, platform)
    if (res.success) {
      toast({
        title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
        description: lang === 'ar' ? 'تم حفظ التحويل بنجاح' : 'Mapping saved successfully',
      })
      resetForm()
      loadMappings()
    } else {
      toast({
        title: lang === 'ar' ? 'خطأ في الحفظ' : 'Save Error',
        description: res.error,
        variant: 'destructive',
      })
    }
    setIsSaving(false)
  }

  const renderFormField = (field: { key: string; labelAr: string; labelEn: string; type: string }, value: any, onChange: (val: any) => void) => {
    if (field.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={e => onChange(e.target.checked)}
            className="rounded border-input"
          />
          <span className="text-xs text-muted-foreground">{lang === 'ar' ? field.labelAr : field.labelEn}</span>
        </label>
      )
    }
    return (
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-muted-foreground">
          {lang === 'ar' ? field.labelAr : field.labelEn}
        </label>
        <input
          type={field.type === 'number' || field.type === 'decimal' ? 'number' : 'text'}
          step={field.type === 'decimal' ? '0.000001' : '1'}
          className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
          value={value ?? ''}
          onChange={e => onChange(field.type === 'number' || field.type === 'decimal' ? (e.target.value ? parseFloat(e.target.value) : null) : e.target.value)}
          placeholder={lang === 'ar' ? `أدخل ${field.labelAr}` : `Enter ${field.labelEn}`}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4" dir={dir}>
      {/* Sub-tabs for each mapping type */}
      <div className="flex flex-wrap gap-1.5">
        {MAPPING_TYPES.map((type) => (
          <button
            key={type.key}
            onClick={() => { setActiveType(type.key); resetForm() }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
              activeType === type.key
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            )}
          >
            <span>{type.icon}</span>
            <span>{lang === 'ar' ? type.labelAr : type.labelEn}</span>
          </button>
        ))}
      </div>

      <div className="card-base overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/50">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              {lang === 'ar' ? config.labelAr : config.labelEn}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {lang === 'ar'
                ? `ربط ${config.sourceLabelAr} ب ${config.targetLabelAr} في أودو`
                : `Map ${config.sourceLabelEn} to ${config.targetLabelEn} in Odoo`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={platform}
              onChange={e => { setPlatform(e.target.value); resetForm() }}
              className="h-8 px-2 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
            >
              <option value="zid">Zid</option>
              <option value="salla">Salla</option>
              <option value="shopify">Shopify</option>
            </select>
            <Button
              onClick={() => { resetForm(); setShowForm(true) }}
              className="bg-foreground text-background gap-1.5 rounded-lg h-8 text-xs px-4"
            >
              <Plus className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'إضافة' : 'Add'}
            </Button>
          </div>
        </div>

        {/* Form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-border/50"
            >
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-muted-foreground">
                      {lang === 'ar' ? config.sourceLabelAr : config.sourceLabelEn}
                    </label>
                    <input
                      type="text"
                      className="w-full h-9 px-3 rounded-lg border border-input bg-inputBg text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
                      value={formData[config.sourceField] || ''}
                      onChange={e => setFormData(prev => ({ ...prev, [config.sourceField]: e.target.value }))}
                      placeholder={lang === 'ar' ? `أدخل ${config.sourceLabelAr}` : `Enter ${config.sourceLabelEn}`}
                    />
                  </div>
                  {config.targetFields.map(field => (
                    <div key={field.key}>
                      {renderFormField(field, formData[field.key], (val) => setFormData(prev => ({ ...prev, [field.key]: val })))}
                    </div>
                  ))}
                  {config.extraFields?.map(field => (
                    <div key={field.key}>
                      {renderFormField(field, formData[field.key], (val) => setFormData(prev => ({ ...prev, [field.key]: val })))}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-foreground text-background gap-1.5 rounded-lg h-8 text-xs px-4"
                  >
                    {isSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {lang === 'ar' ? 'حفظ' : 'Save'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetForm}
                    className="gap-1.5 rounded-lg h-8 text-xs px-4"
                  >
                    <X className="h-3.5 w-3.5" />
                    {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : mappings.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">
                {lang === 'ar' ? 'لا توجد تحويلات بعد' : 'No mappings yet'}
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-1">
                {lang === 'ar'
                  ? 'انقر على "إضافة" لإنشاء أول تحويل'
                  : 'Click "Add" to create your first mapping'}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground border-b border-border/60">
                  <th className="px-4 py-2.5 font-bold whitespace-nowrap">
                    {lang === 'ar' ? config.sourceLabelAr : config.sourceLabelEn}
                  </th>
                  {config.targetFields.map(field => (
                    <th key={field.key} className="px-4 py-2.5 font-bold whitespace-nowrap">
                      {lang === 'ar' ? field.labelAr : field.labelEn}
                    </th>
                  ))}
                  {config.extraFields?.map(field => (
                    <th key={field.key} className="px-4 py-2.5 font-bold whitespace-nowrap">
                      {lang === 'ar' ? field.labelAr : field.labelEn}
                    </th>
                  ))}
                  <th className="px-4 py-2.5 font-bold whitespace-nowrap w-20">
                    {lang === 'ar' ? 'إجراءات' : 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {mappings.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/10">
                    <td className="px-4 py-2.5 font-semibold text-foreground whitespace-nowrap">
                      {row[config.sourceField]}
                    </td>
                    {config.targetFields.map(field => (
                      <td key={field.key} className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {field.type === 'boolean' ? (row[field.key] ? '✓' : '—') : (row[field.key] ?? '—')}
                      </td>
                    ))}
                    {config.extraFields?.map(field => (
                      <td key={field.key} className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                        {field.type === 'boolean' ? (row[field.key] ? '✓' : '—') : (row[field.key] ?? '—')}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleEdit(row)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                          title={lang === 'ar' ? 'تعديل' : 'Edit'}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(row.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all"
                          title={lang === 'ar' ? 'حذف' : 'Delete'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
