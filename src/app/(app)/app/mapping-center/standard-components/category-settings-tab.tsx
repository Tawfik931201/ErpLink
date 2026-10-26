'use client'

import {
  AlertTriangle,
  Building2,
  GitCompare,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Sliders,
  Trash2,
} from 'lucide-react'
import React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import SearchableSelect from '../searchable-select'

// Odoo-style borderless table classes
const tableClassName = "w-full text-start border-collapse"
const theadClassName = "bg-muted/50 border-b border-border/70 text-[11px] font-bold text-muted-foreground uppercase tracking-wider"
const trClassName = "divide-y divide-border/60 text-xs"
const thClassName = "py-3.5 px-4 text-start"
const tdClassName = "py-3.5 px-4"

export function CategorySettingsTab({
  lang,
  dir: _dir,
  costMethod,
  setCostMethod,
  isLoadingOdooOpts,
  costMethodOptions,
  inventoryValuation,
  setInventoryValuation,
  valuationOptions,
  categoryCompanyId,
  setCategoryCompanyId,
  categoryLinkCompany,
  setCategoryLinkCompany,
  isLoadingCompanies,
  companyOptions,
  onDeleteAction,
  setOnDeleteAction,
  matchZidField,
  setMatchZidField,
  matchOdooField,
  setMatchOdooField,
  categoryFields,
  odooCategoryFields,
  isLoadingOdooFields,
  fetchOdooCategoryFields,
  enabledActions,
  setEnabledActions,
  disabled,
  setDisabled,
  isSaving,
  handleSave,
  setIsCategoryMappingOpen,
  setIsCategoryLogOpen,
}: any) {
  const syncActionOptions = [
    { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
    { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
    { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
  ]

  const renderTable = (rows: React.ReactNode, theadText: string) => (
    <div className="card-base border border-border/70 rounded-lg shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className={tableClassName}>
          <thead className={theadClassName}>
            <tr>
              <th className={thClassName} colSpan={2}>
                {lang === 'ar' ? theadText : theadText}
              </th>
            </tr>
          </thead>
          <tbody className={trClassName}>
            {rows}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 1. Inventory Valuation & Costing */}
      {renderTable(
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={costMethod}
                onChange={(e) => setCostMethod(e.target.value)}
              >
                <option value="">
                  {lang === 'ar' ? '— استخدم الإعداد الافتراضي في أودو —' : '— Use Odoo default —'}
                </option>
                {isLoadingOdooOpts ? (
                  <option disabled>{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</option>
                ) : (
                  costMethodOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
            </td>
          </tr>
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={inventoryValuation}
                onChange={(e) => setInventoryValuation(e.target.value)}
              >
                <option value="">
                  {lang === 'ar' ? '— استخدم الإعداد الافتراضي في أودو —' : '— Use Odoo default —'}
                </option>
                {isLoadingOdooOpts ? (
                  <option disabled>{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</option>
                ) : (
                  valuationOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))
                )}
              </select>
            </td>
          </tr>
        ),
        lang === 'ar' ? 'تقييم المخزون وطريقة التكلفة' : 'Inventory Valuation & Costing'
      )}

      {/* 2. Default Company */}
      {renderTable(
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={categoryCompanyId}
                onChange={(e) => setCategoryCompanyId(e.target.value)}
                disabled={isLoadingCompanies}
              >
                <option value="">
                  {lang === 'ar' ? '— اختر الشركة (اختياري) —' : '— Select Company (Optional) —'}
                </option>
                {companyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ),
        lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'
      )}

      {categoryCompanyId && (
        <div className="p-3 rounded-xl border border-border/70 bg-muted/50 text-xs font-medium">
          <span>
            {lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
          </span>
        </div>
      )}

      {/* 3. On Delete */}
      {renderTable(
        (
          <tr>
            <td className={tdClassName} colSpan={4}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={onDeleteAction}
                onChange={(e) => setOnDeleteAction(e.target.value)}
              >
                [
                  { value: 'nothing', labelAr: 'لا شيء (تجاهل الحذف)', labelEn: 'Nothing' },
                  { value: 'delete', labelAr: 'حذف من أودو', labelEn: 'Delete' },
                  { value: 'archive', labelAr: 'أرشفة السجل', labelEn: 'Archive' },
                  { value: 'delete_or_archive', labelAr: 'محاولة الحذف فإن لم تنجح يتم الأرشفة', labelEn: 'Try Delete, then Archive' },
                ].map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {lang === 'ar' ? opt.labelAr : opt.labelEn}
                  </option>
                ))
              </select>
            </td>
          </tr>
        ),
        lang === 'ar' ? 'إجراء الحذف في المتجر' : 'On Store Deletion'
      )}

      {/* 4. Match Field */}
      {renderTable(
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <SearchableSelect
                options={categoryFields}
                value={matchZidField}
                onChange={setMatchZidField}
                placeholder={lang === 'ar' ? '— choisir حقل المتجر —' : '— Select store field —'}
              />
            </td>
            <td className={tdClassName} colSpan={2}>
              <SearchableSelect
                options={odooCategoryFields}
                value={matchOdooField}
                onChange={setMatchOdooField}
                placeholder={lang === 'ar' ? '— choisir حقل أودو —' : '— Select Odoo field —'}
                disabled={isLoadingOdooFields}
              />
            </td>
          </tr>
        ),
        lang === 'ar' ? 'حقل المطابقة والمزامنة' : 'Match Field'
      )}

      {/* 5. Sync Actions & Status */}
      {renderTable(
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <div className="flex items-center gap-2 p-2 rounded-lg border border-border/70 bg-muted/50 text-xs font-medium">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  {lang === 'ar' ? 'تفعيل مزامنة التصنيفات' : 'Enable Category Sync'}
                </span>
              </div>
            </td>
            <td className={tdClassName} colSpan={2} />

            <td className={tdClassName} colSpan={4}>
              <SearchableSelect
                multiple={true}
                collapseTags={false}
                value={enabledActions}
                onChange={setEnabledActions}
                options={syncActionOptions}
                disabled={disabled}
                placeholder={
                  lang === 'ar'
                    ? disabled
                      ? '— المزامنة معطلة —'
                      : '— اختر العمليات المصرح بها —'
                    : disabled
                      ? '— Sync is disabled —'
                      : '— Select operations —'
                }
              />
            </td>
          </tr>
        ),
        lang === 'ar' ? 'إعدادات وعمليات المزامنة' : 'Sync Operations & Rules'
      )}

      {/* Action Footer */}
      <div className="pt-2 flex flex-wrap items-center gap-2.5">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl h-10 px-6 text-xs shadow-sm gap-2 transition-all"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{lang === 'ar' ? 'حفظ إعدادات الكاتيجوري' : 'Save Category Settings'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsCategoryMappingOpen(true)}
          className="rounded-xl h-10 px-4 text-xs gap-2 border-border/80 hover:bg-muted/50"
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'ربط يدوي للتصنيفات' : 'Manual Mapping'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsCategoryLogOpen(true)}
          className="rounded-xl h-10 px-4 text-xs gap-2 border-border/80 hover:bg-muted/50"
        >
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'سجل مزامنة الكاتيجوري' : 'Category Sync Log'}</span>
        </Button>
      </div>
    </div>
  )
}