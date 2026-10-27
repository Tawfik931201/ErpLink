'use client'

import {
  AlertTriangle,
  Building2,
  GitCompare,
  History,
  Layers,
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

import { SettingCard, SettingToggle } from './setting-card'

interface CategorySettingsTabProps {
  lang: string
  dir?: string
  costMethod: string
  setCostMethod: (val: string) => void
  isLoadingOdooOpts: boolean
  costMethodOptions: { value: string; label: string }[]
  inventoryValuation: string
  setInventoryValuation: (val: string) => void
  valuationOptions: { value: string; label: string }[]
  categoryCompanyId: string
  setCategoryCompanyId: (val: string) => void
  categoryLinkCompany: boolean
  setCategoryLinkCompany: (val: boolean) => void
  isLoadingCompanies: boolean
  companyOptions: { value: string; label: string }[]
  onDeleteAction: string
  setOnDeleteAction: (val: string) => void
  matchZidField: string
  setMatchZidField: (val: string) => void
  matchOdooField: string
  setMatchOdooField: (val: string) => void
  categoryFields: { value: string; label: string }[]
  odooCategoryFields: { value: string; label: string }[]
  isLoadingOdooFields: boolean
  fetchOdooCategoryFields: (force?: boolean) => void
  enabledActions: string[]
  setEnabledActions: (val: string[]) => void
  disabled: boolean
  setDisabled: (val: boolean) => void
  isSaving: boolean
  handleSave: () => void
  setIsCategoryMappingOpen: (val: boolean) => void
  setIsCategoryLogOpen: (val: boolean) => void
}

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
}: CategorySettingsTabProps) {
  const syncActionOptions = [
    { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
    { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
    { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
  ]

  return (
    <div className="space-y-4">
      {/* 1. Inventory Valuation */}
      <SettingCard
        icon={<Layers className="h-4 w-4 text-primary" />}
        title={lang === 'ar' ? 'تقييم المخزون وطريقة التكلفة' : 'Inventory Valuation & Costing'}
        description={
          lang === 'ar'
            ? 'إعدادات تقييم المخزون الافتراضية عند إنشاء تصنيف (Category) جديد في أودو'
            : 'Default inventory valuation and costing method for new categories in Odoo'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'طريقة حساب التكلفة (Costing Method)' : 'Costing Method'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
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
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'تقييم المخزون (Inventory Valuation)' : 'Inventory Valuation'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
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
          </div>
        </div>
      </SettingCard>

      {/* 2. Default Company */}
      <SettingCard
        icon={<Building2 className="h-4 w-4 text-sky-600" />}
        title={lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'}
        description={
          lang === 'ar'
            ? 'تحديد الشركة التابع لها التصنيف في نظام أودو متعدد الشركات'
            : 'Specify the Odoo company associated with categories'
        }
      >
        <div className="space-y-3">
          <div className="max-w-md space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'اختر الشركة' : 'Company'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
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
          </div>

          {categoryCompanyId && (
            <div className="pt-2">
              <SettingToggle
                checked={categoryLinkCompany}
                onChange={setCategoryLinkCompany}
                label={lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                description={
                  lang === 'ar'
                    ? 'يضمن تقييد التصنيف بالشركة المحددة فقط داخل أودو'
                    : 'Restricts the category to the chosen company in Odoo'
                }
              />
            </div>
          )}
        </div>
      </SettingCard>

      {/* 3. On Delete */}
      <SettingCard
        icon={<Trash2 className="h-4 w-4 text-amber-600" />}
        title={lang === 'ar' ? 'إجراء الحذف في المتجر' : 'On Store Deletion'}
        description={
          lang === 'ar'
            ? 'الإجراء المتخذ في أودو عند حذف الكاتيجوري من المتجر الإلكتروني'
            : 'Action taken in Odoo when a category is deleted from the store'
        }
      >
        <div className="max-w-md space-y-1.5">
          <label className="block text-xs font-medium text-foreground/80">
            {lang === 'ar' ? 'الإجراء في أودو' : 'Action in Odoo'}
          </label>
          <select
            className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            value={onDeleteAction}
            onChange={(e) => setOnDeleteAction(e.target.value)}
          >
            {[
              { value: 'nothing', labelAr: 'لا شيء (تجاهل الحذف)', labelEn: 'Nothing' },
              { value: 'delete', labelAr: 'حذف من أودو', labelEn: 'Delete' },
              { value: 'archive', labelAr: 'أرشفة السجل', labelEn: 'Archive' },
              {
                value: 'delete_or_archive',
                labelAr: 'محاولة الحذف فإن لم تنجح يتم الأرشفة',
                labelEn: 'Try Delete, then Archive',
              },
            ].map((opt) => (
              <option key={opt.value} value={opt.value}>
                {lang === 'ar' ? opt.labelAr : opt.labelEn}
              </option>
            ))}
          </select>
        </div>
      </SettingCard>

      {/* 4. Match Field */}
      <SettingCard
        icon={<GitCompare className="h-4 w-4 text-indigo-600" />}
        title={lang === 'ar' ? 'حقل المطابقة والمزامنة' : 'Match Field'}
        description={
          lang === 'ar'
            ? 'حدد الحقل في المتجر المقابل لحقل أودو لربط التصنيفات بدقة وتفادي التكرار'
            : 'Select store and Odoo fields used to match and identify categories'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'حقل المتجر' : 'Store Field'}
            </label>
            <SearchableSelect
              options={categoryFields}
              value={matchZidField}
              onChange={setMatchZidField}
              placeholder={lang === 'ar' ? '— اختر حقل المتجر —' : '— Select store field —'}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'حقل أودو' : 'Odoo Field'}
              </label>
              <button
                type="button"
                onClick={() => fetchOdooCategoryFields(true)}
                disabled={isLoadingOdooFields}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 text-[11px] flex items-center gap-1"
                title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
              >
                <RefreshCw className={cn('h-3 w-3', isLoadingOdooFields && 'animate-spin')} />
                <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
              </button>
            </div>
            <SearchableSelect
              options={odooCategoryFields}
              value={matchOdooField}
              onChange={setMatchOdooField}
              placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
              disabled={isLoadingOdooFields}
            />
          </div>
        </div>
      </SettingCard>

      {/* 5. Sync Actions & Status */}
      <SettingCard
        icon={<Sliders className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'إعدادات وعمليات المزامنة' : 'Sync Operations & Rules'}
        description={
          lang === 'ar'
            ? 'حدد العمليات المصرح بها لتصنيفات المنتجات وحالة المزامنة الكلية'
            : 'Select permitted operations and toggle category synchronization'
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={!disabled}
            onChange={(active) => setDisabled(!active)}
            label={lang === 'ar' ? 'تفعيل مزامنة التصنيفات' : 'Enable Category Sync'}
            description={
              lang === 'ar'
                ? 'عند التعطيل لن يتم إرسال أي تغييرات في التصنيفات إلى أودو'
                : 'When disabled, no categories will be created, updated, or deleted in Odoo'
            }
          />

          {disabled && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {lang === 'ar'
                  ? 'مزامنة التصنيفات معطلة حالياً — لن يتم إنشاء أو تعديل أي تصنيف في أودو.'
                  : 'Category sync is disabled — changes will not propagate to Odoo.'}
              </span>
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'العمليات المسموح بها' : 'Allowed Operations'}
            </label>
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
          </div>
        </div>
      </SettingCard>

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
