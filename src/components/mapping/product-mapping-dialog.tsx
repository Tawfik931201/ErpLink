'use client'

import { Plus, Pencil, Trash2, Loader2, X, Check, Search, Download, AlertTriangle, RefreshCw } from 'lucide-react'
import React, { useState, useEffect, useCallback } from 'react'

import SearchableSelect from '@/app/(app)/dashboard/mapping-center/searchable-select'
import { batchImportProductMappings, deleteProductMapping, fetchStoreProducts, getProductMappings, saveProductMapping } from '@/app/actions/product-mappings'
import { searchOdooProducts } from '@/app/actions/odoo'
import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { getProductName } from '@/lib/product-name'
import { cn } from '@/lib/utils'

interface ProductMappingDialogProps {
  isOpen: boolean
  onClose: () => void
  platform?: string
}

export default function ProductMappingDialog({ isOpen, onClose, platform = 'zid' }: ProductMappingDialogProps) {
  const { lang, dir } = useLanguage()
  const { toast } = useToast()

  const [mappings, setMappings] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    source_product_id: '',
    odoo_product_id: '',
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [storeProducts, setStoreProducts] = useState<any[]>([])
  const [, setIsLoadingStore] = useState(false)
  const [isBatchImporting, setIsBatchImporting] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [odooProductOpts, setOdooProductOpts] = useState<{ value: string; label: string }[]>([])
  const [isLoadingOdoo, setIsLoadingOdoo] = useState(false)

  const loadMappings = useCallback(async () => {
    setIsLoading(true)
    const res = await getProductMappings(platform)
    if (res.success) {
      setMappings(res.mappings)
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
    setIsLoading(false)
  }, [platform, lang, toast])

  const loadOdooProducts = async () => {
    setIsLoadingOdoo(true)
    const odooRes = await searchOdooProducts('')
    if (odooRes.success) {
      setOdooProductOpts(odooRes.options || [])
    }
    setIsLoadingOdoo(false)
  }

  const loadStoreProducts = async () => {
    setIsLoadingStore(true)
    const res = await fetchStoreProducts(platform)
    if (res.success) {
      setStoreProducts(res.products || [])
    }
    setIsLoadingStore(false)
  }

  useEffect(() => {
    if (isOpen) {
      setConfirmClose(false)
      setDirty(false)
      resetForm()
      loadMappings()
      loadOdooProducts()
      loadStoreProducts()
    }
  }, [isOpen, loadMappings])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([
      loadMappings(),
      loadOdooProducts(),
      loadStoreProducts(),
    ])
    setIsRefreshing(false)
    toast({
      title: lang === 'ar' ? 'تم التحديث' : 'Refreshed',
      description: lang === 'ar' ? 'تم تحديث البيانات من المتجر وأودو بنجاح' : 'Data refreshed from store and Odoo successfully',
    })
  }

  const handleClose = () => {
    if (dirty) {
      setConfirmClose(true)
    } else {
      resetForm()
      onClose()
    }
  }

  const updateField = (field: string, value: string) => {
    setDirty(true)
    setForm(p => ({ ...p, [field]: value }))
  }

  const resetForm = () => {
    setEditingId(null)
    setForm({
      source_product_id: '',
      odoo_product_id: '',
    })
    setDirty(false)
  }

  const startEdit = (m: any) => {
    setEditingId(m.id)
    setForm({
      source_product_id: m.source_product_id ? String(m.source_product_id) : '',
      odoo_product_id: m.odoo_product_id ? String(m.odoo_product_id) : '',
    })
  }

  const handleSave = async () => {
    if (!form.source_product_id && !form.odoo_product_id) {
      toast({
        title: lang === 'ar' ? 'تنبيه' : 'Warning',
        description: lang === 'ar' ? 'اختر منتج المتجر ومنتج أودو' : 'Select a store product and an Odoo product',
        variant: 'destructive'
      })
      return
    }
    setIsSaving(true)
    setDirty(false)

    const selectedStoreProduct = storeProducts.find(p => String(p.id) === String(form.source_product_id))

    const payload: any = {
      platform,
      source_product_id: form.source_product_id || null,
      source_product_name: selectedStoreProduct ? getProductName(selectedStoreProduct) : '',
      source_sku: selectedStoreProduct?.sku || '',
      odoo_product_id: form.odoo_product_id ? Number(form.odoo_product_id) : null,
    }

    if (!payload.source_product_name) {
      const existingRow = mappings.find(m => m.id === editingId)
      payload.source_product_name = existingRow?.source_product_name || ''
    }

    const res = await saveProductMapping(payload)
    if (res.success) {
      toast({
        title: lang === 'ar' ? 'تم الحفظ' : 'Saved',
        description: lang === 'ar' ? 'تم حفظ ربط المنتج' : 'Product mapping saved'
      })
      resetForm()
      loadMappings()
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
    setIsSaving(false)
  }

  const handleDelete = async (id: string) => {
    const res = await deleteProductMapping(id)
    if (res.success) {
      toast({
        title: lang === 'ar' ? 'تم الحذف' : 'Deleted',
        description: lang === 'ar' ? 'تم حذف ربط المنتج' : 'Product mapping deleted'
      })
      if (editingId === id) resetForm()
      loadMappings()
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: res.error, variant: 'destructive' })
    }
  }

  const handleBatchImport = async () => {
    setIsBatchImporting(true)
    const res = await fetchStoreProducts(platform)
    if (!res.success || !res.products?.length) {
      toast({
        title: lang === 'ar' ? 'خطأ' : 'Error',
        description: res.error || (lang === 'ar' ? 'لا توجد منتجات في المتجر' : 'No products found in store'),
        variant: 'destructive',
      })
      setIsBatchImporting(false)
      return
    }
    const items = res.products.map((p: any) => ({
      id: String(p.id),
      name: getProductName(p),
      sku: p.sku || '',
    })).filter((p: any) => p.id && p.name)
    const result = await batchImportProductMappings(platform, items)
    if (result.success) {
      toast({
        title: lang === 'ar' ? 'تم الاستيراد' : 'Imported',
        description: lang === 'ar'
          ? `تم استيراد ${result.imported} منتج${result.imported !== 1 ? '' : ''} بنجاح`
          : `Successfully imported ${result.imported} product${result.imported === 1 ? '' : 's'}`,
      })
      loadMappings()
    } else {
      toast({ title: lang === 'ar' ? 'خطأ' : 'Error', description: result.error, variant: 'destructive' })
    }
    setIsBatchImporting(false)
  }

  const formatStoreProductLabel = (p: any): string => {
    const name = getProductName(p)
    return p.sku ? `${name} — ${p.sku}` : name
  }

  const filteredMappings = mappings.filter(m =>
    !searchQuery
    || (m.source_product_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    || (m.source_sku || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const storeProductOptions = storeProducts.map(p => {
    return { value: String(p.id), label: formatStoreProductLabel(p) }
  })

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto flex flex-col" dir={dir}>
        <DialogHeader className="pb-3 border-b border-border">
          <DialogTitle>{lang === 'ar' ? 'ربط المنتجات يدوياً' : 'Manual Product Mapping'}</DialogTitle>
          <DialogDescription>
            {lang === 'ar'
              ? 'اربط منتجات المتجر بمنتجات أودو مباشرة لضبط توافق المزامنة'
              : 'Map store products directly to Odoo products to configure sync matching'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Action Bar (Search & Buttons) ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mt-4 mb-2 shrink-0">
          {/* Search Input */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              className="w-full h-8 pl-9 pr-3 rounded-lg border border-input bg-inputBg text-xs text-foreground focus:border-foreground focus:ring-1 focus:ring-foreground outline-none transition-all"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={lang === 'ar' ? 'بحث عن منتج أو SKU...' : 'Search product or SKU...'}
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Refresh Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5 rounded-lg h-8 text-[11px] px-3 font-medium transition-all"
              title={lang === 'ar' ? 'تحديث البيانات من المتجر وأودو' : 'Refresh Store & Odoo Data'}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              {lang === 'ar' ? 'تحديث البيانات' : 'Refresh'}
            </Button>

            {/* Import All Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBatchImport}
              disabled={isBatchImporting}
              className="gap-1.5 rounded-lg h-8 text-[11px] px-3 font-medium transition-all"
              title={lang === 'ar' ? 'جلب واستيراد كل منتجات المتجر' : 'Fetch and import all store products'}
            >
              {isBatchImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {lang === 'ar' ? 'استيراد الكل' : 'Import All'}
            </Button>

            {/* Add New Row Button */}
            <Button
              type="button"
              onClick={() => {
                resetForm()
                setEditingId('new')
              }}
              disabled={editingId === 'new'}
              className="bg-foreground text-background hover:bg-foreground/90 gap-1.5 rounded-lg h-8 text-[11px] px-3 font-semibold transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'إضافة سطر جديد' : 'Add New Row'}
            </Button>
          </div>
        </div>

        {/* ── Simplified Table ── */}
        <div className="border border-border rounded-xl overflow-hidden flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-start px-3 py-2.5 font-bold text-muted-foreground w-1/2">
                  {lang === 'ar' ? 'منتج المتجر (زد)' : 'Store Product (Zid)'}
                </th>
                <th className="text-start px-3 py-2.5 font-bold text-muted-foreground w-1/2">
                  {lang === 'ar' ? 'منتج أودو' : 'Odoo Product'}
                </th>
                <th className="text-center px-3 py-2.5 font-bold text-muted-foreground w-[100px]">
                  {lang === 'ar' ? 'إجراءات' : 'Actions'}
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Add New Row Mode */}
              {editingId === 'new' && (
                <tr className="bg-muted/15 border-b border-border animate-in fade-in duration-200">
                  <td className="px-3 py-2.5">
                    <SearchableSelect
                      options={storeProductOptions}
                      value={form.source_product_id}
                      onChange={(val) => updateField('source_product_id', val)}
                      placeholder={lang === 'ar' ? 'اختر منتج زد' : 'Select Zid Product'}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <SearchableSelect
                      options={odooProductOpts}
                      value={form.odoo_product_id}
                      onChange={(val) => updateField('odoo_product_id', val)}
                      placeholder={lang === 'ar' ? 'اختر منتج أودو' : 'Select Odoo Product'}
                      disabled={isLoadingOdoo}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="p-1.5 hover:bg-muted rounded-md transition-colors text-green-600 dark:text-green-400 disabled:opacity-50"
                        title={lang === 'ar' ? 'حفظ' : 'Save'}
                      >
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground" /> : <Check className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={resetForm}
                        className="p-1.5 hover:bg-muted rounded-md transition-colors text-muted-foreground"
                        title={lang === 'ar' ? 'إلغاء' : 'Cancel'}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {isLoading ? (
                <tr>
                  <td colSpan={3} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-1" />
                    <span>{lang === 'ar' ? 'جاري تحميل جدول الربط...' : 'Loading mappings...'}</span>
                  </td>
                </tr>
              ) : filteredMappings.length === 0 && editingId !== 'new' ? (
                <tr>
                  <td colSpan={3} className="text-center py-10 text-muted-foreground">
                    {lang === 'ar' ? 'لا توجد منتجات مرتبطة يدوياً بعد' : 'No manual product mappings yet'}
                  </td>
                </tr>
              ) : (
                filteredMappings.map(m => {
                  const isEditing = editingId === m.id

                  // Resolve Odoo Product Label
                  const odooOpt = odooProductOpts.find(o => o.value === String(m.odoo_product_id))
                  const odooLabel = odooOpt ? odooOpt.label : (m.odoo_product_id ? `#${m.odoo_product_id}` : '—')

                  // Resolve Store Product Label (prefer live store data)
                  const storeOpt = storeProductOptions.find(o => o.value === String(m.source_product_id))
                  const storeLabel = storeOpt?.label || (m.source_product_name ? (m.source_sku ? `${m.source_product_name} — ${m.source_sku}` : m.source_product_name) : `#${m.source_product_id}`)

                  if (isEditing) {
                    return (
                      <tr key={m.id} className="bg-muted/15 border-b border-border">
                        <td className="px-3 py-2.5 align-middle">
                          <span className="text-xs font-semibold text-foreground bg-muted px-2.5 py-1.5 rounded-lg border border-border text-start inline-block max-w-full truncate">
                            {storeLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <SearchableSelect
                            options={odooProductOpts}
                            value={form.odoo_product_id}
                            onChange={(val) => updateField('odoo_product_id', val)}
                            placeholder={lang === 'ar' ? 'اختر منتج أودو' : 'Select Odoo Product'}
                            disabled={isLoadingOdoo}
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={handleSave}
                              disabled={isSaving}
                              className="p-1.5 hover:bg-muted rounded-md transition-colors text-green-600 dark:text-green-400 disabled:opacity-50"
                              title={lang === 'ar' ? 'تحديث' : 'Update'}
                            >
                              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground" /> : <Check className="h-3.5 w-3.5" />}
                            </button>
                            <button
                              onClick={resetForm}
                              className="p-1.5 hover:bg-muted rounded-md transition-colors text-muted-foreground"
                              title={lang === 'ar' ? 'إلغاء' : 'Cancel'}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  }

                  return (
                    <tr key={m.id} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                      <td className="px-3 py-3 font-semibold text-foreground">{storeLabel}</td>
                      <td className="px-3 py-3 font-medium text-muted-foreground">{odooLabel}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => startEdit(m)}
                            className="p-1 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground"
                            title={lang === 'ar' ? 'تعديل' : 'Edit'}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(m.id)}
                            className="p-1 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-md transition-colors text-red-500 hover:text-red-600"
                            title={lang === 'ar' ? 'حذف' : 'Delete'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Unsaved Changes Confirmation ── */}
        {confirmClose && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-xl mx-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-9 w-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {lang === 'ar' ? 'تغييرات غير محفوظة' : 'Unsaved Changes'}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {lang === 'ar'
                      ? 'لديك تغييرات لم يتم حفظها. هل تريد تجاهلها؟'
                      : 'You have unsaved changes. Discard them?'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end mt-4">
                <Button variant="outline" onClick={() => setConfirmClose(false)} className="rounded-lg h-8 text-xs px-4 font-semibold">
                  {lang === 'ar' ? 'رجوع' : 'Go Back'}
                </Button>
                <Button onClick={() => { setConfirmClose(false); resetForm(); onClose() }} className="bg-destructive text-destructive-foreground rounded-lg h-8 text-xs px-4 font-semibold">
                  {lang === 'ar' ? 'تجاهل التغييرات' : 'Discard'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}