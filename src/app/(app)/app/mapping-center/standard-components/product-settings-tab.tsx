'use client'

import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  Building2,
  DollarSign,
  GitCompare,
  GitFork,
  History,
  Image as ImageIcon,
  Loader2,
  Package,
  Percent,
  Plus,
  RefreshCw,
  Save,
  Sliders,
  Trash2,
  Type,
  Zap,
} from 'lucide-react'
import React from 'react'

import type { OdooStockWebhookRefs } from '@/app/actions/inventory-sync'
import type { SallaLocation } from '@/app/actions/salla'
import type { ZidLocation } from '@/app/actions/zid'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import SearchableSelect from '../searchable-select'

import { SettingCard, SettingToggle } from './setting-card'

interface ProductSettingsTabProps {
  lang: string
  dir: string
  standardStoreTab: string
  invSyncStoreNameAr: string
  invSyncStoreNameEn: string
  isSallaInvSync: boolean
  // Product type & Inventory
  productType: string
  setProductType: (val: string) => void
  productTypeOptions: { value: string; label: string }[]
  isLoadingProductOpts: boolean
  trackInventory: boolean
  setTrackInventory: (val: boolean) => void
  trackingMethod: string
  setTrackingMethod: (val: string) => void
  trackingOptions: { value: string; label: string }[]
  // Company
  productCompanyId: string
  setProductCompanyId: (val: string) => void
  productLinkCompany: boolean
  setProductLinkCompany: (val: boolean) => void
  companyOptions: { value: string; label: string }[]
  isLoadingCompanies: boolean
  fetchCompanies: () => void
  // Pricing
  markupPercent: number
  setMarkupPercent: (val: number) => void
  costSource: string
  setCostSource: (val: string) => void
  priceSource: string
  setPriceSource: (val: string) => void
  rounding: string
  setRounding: (val: string) => void
  decimalPlaces: number
  setDecimalPlaces: (val: number) => void
  // Name & Description
  nameLanguage: string
  setNameLanguage: (val: string) => void
  nameFallback: boolean
  setNameFallback: (val: boolean) => void
  descLanguage: string
  setDescLanguage: (val: string) => void
  descFallback: string
  setDescFallback: (val: string) => void
  descCustomText: string
  setDescCustomText: (val: string) => void
  // Variants
  productVariantSyncMode: 'AS_VARIANTS' | 'AS_SEPARATE_PRODUCTS'
  setProductVariantSyncMode: (val: 'AS_VARIANTS' | 'AS_SEPARATE_PRODUCTS') => void
  // BoM
  bomEnabled: boolean
  setBomEnabled: (val: boolean) => void
  bomType: 'phantom' | 'normal'
  setBomType: (val: 'phantom' | 'normal') => void
  // Media & Categories & UOM
  imageSyncMode: string
  setImageSyncMode: (val: string) => void
  categorySyncMode: string
  setCategorySyncMode: (val: string) => void
  uomAutoCreate: boolean
  setUomAutoCreate: (val: boolean) => void
  // Tax
  taxSyncMode: string
  setTaxSyncMode: (val: string) => void
  defaultTaxIds: string[]
  setDefaultTaxIds: (val: string[]) => void
  taxOptions: { value: string; label: string; desc?: string }[]
  isLoadingTaxOpts: boolean
  // On Delete
  productOnDelete: string
  setProductOnDelete: (val: string) => void
  // Inventory Sync (Odoo -> Store)
  invSyncEnabled: boolean
  setInvSyncEnabled: (val: boolean) => void
  invSyncMode: 'actual' | 'forecast'
  setInvSyncMode: (val: 'actual' | 'forecast') => void
  odooStockWebhook: OdooStockWebhookRefs | null
  handleCreateOdooWebhook: () => void
  handleDeleteOdooWebhook: () => void
  isSyncingWebhook: boolean
  invSyncWebhookError: string
  isLoadingInvSync: boolean
  invSyncPairs: {
    id?: string
    source_location_id: string
    source_location_name: string
    odoo_location_id: string
    _removed?: boolean
  }[]
  handlePairChange: (
    index: number,
    field: 'source_location_id' | 'source_location_name' | 'odoo_location_id',
    value: string
  ) => void
  handleRemovePair: (index: number) => void
  handleAddPair: () => void
  handleSavePairs: () => void
  isSavingPairs: boolean
  handleRefreshInvLocations: () => void
  isRefreshingInvLocations: boolean
  usedPairSources: Set<string>
  allPairSourcesTaken: boolean
  zidLocations: ZidLocation[]
  sallaLocations: SallaLocation[]
  odooLocations: Array<{ id: number; name: string; complete_name: string; usage: string }>
  // Match Field
  productFields: { value: string; label: string }[]
  productMatchZidField: string
  setProductMatchZidField: (val: string) => void
  productMatchOdooField: string
  setProductMatchOdooField: (val: string) => void
  productOdooFields: { value: string; label: string }[]
  isLoadingProductFields: boolean
  fetchOdooProductFields: (force?: boolean) => void
  // Sync Actions
  productEnabledActions: string[]
  setProductEnabledActions: (val: string[]) => void
  productDisabled: boolean
  setProductDisabled: (val: boolean) => void
  // Save & Modals
  isSavingProducts: boolean
  handleSaveProducts: () => void
  setIsProductMappingOpen: (val: boolean) => void
  setIsProductLogOpen: (val: boolean) => void
}

export function ProductSettingsTab({
  lang,
  dir: _dir,
  standardStoreTab,
  invSyncStoreNameAr,
  invSyncStoreNameEn,
  isSallaInvSync,
  productType,
  setProductType,
  productTypeOptions,
  isLoadingProductOpts,
  trackInventory,
  setTrackInventory,
  trackingMethod,
  setTrackingMethod,
  trackingOptions,
  productCompanyId,
  setProductCompanyId,
  productLinkCompany,
  setProductLinkCompany,
  companyOptions,
  isLoadingCompanies,
  fetchCompanies,
  markupPercent,
  setMarkupPercent,
  costSource,
  setCostSource,
  priceSource,
  setPriceSource,
  rounding,
  setRounding,
  decimalPlaces,
  setDecimalPlaces,
  nameLanguage,
  setNameLanguage,
  nameFallback,
  setNameFallback,
  descLanguage,
  setDescLanguage,
  descFallback,
  setDescFallback,
  descCustomText,
  setDescCustomText,
  productVariantSyncMode,
  setProductVariantSyncMode,
  bomEnabled,
  setBomEnabled,
  bomType,
  setBomType,
  imageSyncMode,
  setImageSyncMode,
  categorySyncMode,
  setCategorySyncMode,
  uomAutoCreate,
  setUomAutoCreate,
  taxSyncMode,
  setTaxSyncMode,
  defaultTaxIds,
  setDefaultTaxIds,
  taxOptions,
  isLoadingTaxOpts,
  productOnDelete,
  setProductOnDelete,
  invSyncEnabled,
  setInvSyncEnabled,
  invSyncMode,
  setInvSyncMode,
  odooStockWebhook,
  handleCreateOdooWebhook,
  handleDeleteOdooWebhook,
  isSyncingWebhook,
  invSyncWebhookError,
  isLoadingInvSync,
  invSyncPairs,
  handlePairChange,
  handleRemovePair,
  handleAddPair,
  handleSavePairs,
  isSavingPairs,
  handleRefreshInvLocations,
  isRefreshingInvLocations,
  usedPairSources,
  allPairSourcesTaken: _allPairSourcesTaken,
  zidLocations,
  sallaLocations,
  odooLocations,
  productFields,
  productMatchZidField,
  setProductMatchZidField,
  productMatchOdooField,
  setProductMatchOdooField,
  productOdooFields,
  isLoadingProductFields,
  fetchOdooProductFields,
  productEnabledActions,
  setProductEnabledActions,
  productDisabled,
  setProductDisabled,
  isSavingProducts,
  handleSaveProducts,
  setIsProductMappingOpen,
  setIsProductLogOpen,
}: ProductSettingsTabProps) {
  const syncActionOptions = [
    { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
    { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
    { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
  ]

  return (
    <div className="space-y-4">
      {/* 1. Product Type & Inventory Tracking */}
      <SettingCard
        icon={<Package className="h-4 w-4 text-primary" />}
        title={lang === 'ar' ? 'نوع المنتج وتتبع المخزون' : 'Product Type & Inventory Tracking'}
        description={
          lang === 'ar'
            ? 'تحديد طبيعة المنتجات المنشأة في أودو وسياسة تتبع كميات المخزون'
            : 'Default product type and inventory tracking policy for Odoo products'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'نوع المنتج الافتراضي في أودو' : 'Default Product Type'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
            >
              <option value="">
                {lang === 'ar' ? '— استخدم الإعداد الافتراضي في أودو —' : '— Use Odoo default —'}
              </option>
              {isLoadingProductOpts ? (
                <option disabled>{lang === 'ar' ? 'جاري التحميل...' : 'Loading...'}</option>
              ) : (
                productTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'تتبع المخزون' : 'Track Inventory'}
            </label>
            <SettingToggle
              checked={trackInventory}
              onChange={setTrackInventory}
              label={lang === 'ar' ? 'تتبع كميات المخزون في أودو' : 'Track inventory in Odoo'}
              description={
                lang === 'ar'
                  ? 'تسجيل حركات الاستلام والصرف بدقة'
                  : 'Enables stock tracking and ledger movement'
              }
            />
          </div>
        </div>

        {trackInventory && (
          <div className="pt-2 max-w-md space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'طريقة التتبع (Tracking Method)' : 'Tracking Method'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={trackingMethod}
              onChange={(e) => setTrackingMethod(e.target.value)}
            >
              <option value="">{lang === 'ar' ? '— بدون تتبع دفعات أو سيريال —' : '— None —'}</option>
              {trackingOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </SettingCard>

      {/* 2. Default Company */}
      <SettingCard
        icon={<Building2 className="h-4 w-4 text-sky-600" />}
        title={lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'}
        description={
          lang === 'ar'
            ? 'تحديد الشركة التابع لها المنتج عند إنشائه في نظام أودو متعدد الشركات'
            : 'Specify the Odoo company associated with products'
        }
        headerAction={
          <button
            type="button"
            onClick={fetchCompanies}
            disabled={isLoadingCompanies}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 text-[11px] flex items-center gap-1"
            title={lang === 'ar' ? 'تحديث الشركات' : 'Refresh Companies'}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoadingCompanies && 'animate-spin')} />
            <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
          </button>
        }
      >
        <div className="space-y-3">
          <div className="max-w-md space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'اختر الشركة' : 'Company'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={productCompanyId}
              onChange={(e) => setProductCompanyId(e.target.value)}
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

          {productCompanyId && (
            <div className="pt-2">
              <SettingToggle
                checked={productLinkCompany}
                onChange={setProductLinkCompany}
                label={lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                description={
                  lang === 'ar'
                    ? 'يضمن قصر بيع والاطلاع على المنتج على هذه الشركة فقط'
                    : 'Restricts the product record to the chosen company in Odoo'
                }
              />
            </div>
          )}
        </div>
      </SettingCard>

      {/* 3. Pricing */}
      <SettingCard
        icon={<DollarSign className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'إعدادات وقواعد التسعير' : 'Pricing Settings'}
        description={
          lang === 'ar'
            ? 'تحديد مصادر الأسعار، نسب الربح، والتقريب للأسعار المزامنة'
            : 'Configure price source, markup rules, and decimal rounding'
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'نسبة الربح/الخصم %' : 'Markup/Discount %'}
            </label>
            <input
              type="number"
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={markupPercent}
              onChange={(e) => setMarkupPercent(Number(e.target.value))}
              placeholder="0"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'مصدر التكلفة' : 'Cost Source'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={costSource}
              onChange={(e) => setCostSource(e.target.value)}
            >
              <option value="cost">{lang === 'ar' ? 'حقل التكلفة (cost)' : 'Cost field'}</option>
              <option value="price">{lang === 'ar' ? 'حقل السعر (price)' : 'Price field'}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'مصدر السعر الأساسي' : 'Price Source'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={priceSource}
              onChange={(e) => setPriceSource(e.target.value)}
            >
              <option value="price">{lang === 'ar' ? 'السعر (price)' : 'Price'}</option>
              <option value="sale_price">{lang === 'ar' ? 'سعر التخفيض (sale_price)' : 'Sale Price'}</option>
              <option value="cost">{lang === 'ar' ? 'التكلفة (cost)' : 'Cost'}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'طريقة التقريب' : 'Rounding'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={rounding}
              onChange={(e) => setRounding(e.target.value)}
            >
              <option value="">{lang === 'ar' ? '— بدون تقريب —' : '— None —'}</option>
              <option value="nearest">{lang === 'ar' ? 'لأقرب رقم صحيح' : 'Nearest'}</option>
              <option value="ceil">{lang === 'ar' ? 'رفع لأعلى (Ceil)' : 'Ceil'}</option>
              <option value="floor">{lang === 'ar' ? 'خفض لأسفل (Floor)' : 'Floor'}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'عدد الخانات العشرية' : 'Decimal Places'}
            </label>
            <input
              type="number"
              min="0"
              max="6"
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={decimalPlaces}
              onChange={(e) => setDecimalPlaces(Number(e.target.value))}
            />
          </div>
        </div>
      </SettingCard>

      {/* 4. Name & Description */}
      <SettingCard
        icon={<Type className="h-4 w-4 text-purple-600" />}
        title={lang === 'ar' ? 'الاسم والوصف واللغات' : 'Name & Description'}
        description={
          lang === 'ar'
            ? 'إعدادات لغة الاسم، النص الاحتياطي، ووصف المنتج المعتمد في أودو'
            : 'Configure languages, fallback rules, and custom text for names and descriptions'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'لغة اسم المنتج' : 'Name Language'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={nameLanguage}
              onChange={(e) => setNameLanguage(e.target.value)}
            >
              <option value="ar">{lang === 'ar' ? 'العربية' : 'Arabic'}</option>
              <option value="en">{lang === 'ar' ? 'الإنجليزية' : 'English'}</option>
              <option value="both">{lang === 'ar' ? 'اللغتين معاً' : 'Both'}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'لغة وصف المنتج' : 'Description Language'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={descLanguage}
              onChange={(e) => setDescLanguage(e.target.value)}
            >
              <option value="ar">{lang === 'ar' ? 'العربية' : 'Arabic'}</option>
              <option value="en">{lang === 'ar' ? 'الإنجليزية' : 'English'}</option>
              <option value="both">{lang === 'ar' ? 'اللغتين معاً' : 'Both'}</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <SettingToggle
              checked={nameFallback}
              onChange={setNameFallback}
              label={lang === 'ar' ? 'استخدام اللغة البديلة للاسم عند عدم توفرها' : 'Fallback to Other Language for Name'}
              description={
                lang === 'ar'
                  ? 'إذا لم يتوفر الاسم باللغة المختارة يتم اعتماد لغة المتجر الأخرى تلقائياً'
                  : 'Automatically uses the alternative store language if the chosen one is empty'
              }
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'الرجوع في الوصف (Description Fallback)' : 'Description Fallback'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={descFallback}
              onChange={(e) => setDescFallback(e.target.value)}
            >
              <option value="none">{lang === 'ar' ? '— بدون بديل —' : '— None —'}</option>
              <option value="name">{lang === 'ar' ? 'استخدام اسم المنتج كوصف' : 'Use Product Name'}</option>
              <option value="custom">{lang === 'ar' ? 'نص مخصص ثابت' : 'Custom Fixed Text'}</option>
              <option value="empty">{lang === 'ar' ? 'ترك الحقل فارغاً' : 'Leave Empty'}</option>
            </select>
          </div>

          {descFallback === 'custom' && (
            <div className="space-y-1.5 md:col-span-2">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'النص المخصص للوصف' : 'Custom Description Text'}
              </label>
              <textarea
                className="w-full h-20 px-3 py-2 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all resize-none"
                value={descCustomText}
                onChange={(e) => setDescCustomText(e.target.value)}
                placeholder={lang === 'ar' ? 'أدخل نص الوصف المخصص هنا...' : 'Enter custom description text...'}
              />
            </div>
          )}
        </div>
      </SettingCard>

      {/* 5. Product Variants Mode */}
      <SettingCard
        icon={<GitFork className="h-4 w-4 text-indigo-600" />}
        title={lang === 'ar' ? 'خيارات مزامنة المتغيرات (Variants)' : 'Product Variant Sync Mode'}
        description={
          lang === 'ar'
            ? 'حدد كيفية إنشاء المنتجات ذات الخيارات المتعددة (المقاسات والألوان) في أودو'
            : 'Specify how multi-variant products should be structured in Odoo'
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200',
              productVariantSyncMode === 'AS_VARIANTS'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="productVariantSyncMode"
              value="AS_VARIANTS"
              checked={productVariantSyncMode === 'AS_VARIANTS'}
              onChange={() => setProductVariantSyncMode('AS_VARIANTS')}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <span className="font-semibold block text-xs">
                {lang === 'ar' ? 'منتج رئيسي بمتغيرات (AS_VARIANTS)' : 'Product Template with Variants'}
              </span>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'يتم إنشاء سجل Product Template واحد في أودو وربط الخيارات به كمتغيرات (Variant Attributes).'
                  : 'Creates a single product template in Odoo with attributes/values grouped under it.'}
              </span>
            </div>
          </label>

          <label
            className={cn(
              'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200',
              productVariantSyncMode === 'AS_SEPARATE_PRODUCTS'
                ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <input
              type="radio"
              name="productVariantSyncMode"
              value="AS_SEPARATE_PRODUCTS"
              checked={productVariantSyncMode === 'AS_SEPARATE_PRODUCTS'}
              onChange={() => setProductVariantSyncMode('AS_SEPARATE_PRODUCTS')}
              className="mt-0.5 h-4 w-4 text-primary border-border focus:ring-primary cursor-pointer"
            />
            <div className="space-y-1">
              <span className="font-semibold block text-xs">
                {lang === 'ar' ? 'منتجات مستقلة منفصلة (AS_SEPARATE_PRODUCTS)' : 'Separate Standalone Products'}
              </span>
              <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                {lang === 'ar'
                  ? 'يتم إنشاء كل خيار كمنتج مستقل تماماً في أودو مع دمج اسم المتغير في اسم المنتج.'
                  : 'Creates a standalone product for each variant option in Odoo.'}
              </span>
            </div>
          </label>
        </div>
      </SettingCard>

      {/* 6. Bundles & BoM */}
      <SettingCard
        icon={<Boxes className="h-4 w-4 text-amber-600" />}
        title={lang === 'ar' ? 'المنتجات المجمعة وقائمة المواد (BoM / Kits)' : 'Bundles & Bill of Materials'}
        description={
          lang === 'ar'
            ? 'تفعيل خيار إنشاء قائمة المواد (BoM / Kit) للمنتجات المجمعة في أودو'
            : 'Enable automatic Bill of Materials creation for bundled products in Odoo'
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={bomEnabled}
            onChange={setBomEnabled}
            label={lang === 'ar' ? 'تفعيل إنشاء قائمة المواد BoM' : 'Enable BoM Creation'}
            description={
              lang === 'ar'
                ? 'يقوم النظام تلقائياً بإنشاء قائمة المواد للمنتجات المجمعة حسب النوع المختار'
                : 'System will automatically generate a BoM with the selected structure below'
            }
          />

          {bomEnabled && (
            <div className="pt-2 space-y-2 animate-in fade-in duration-200">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'نوع قائمة المواد (BoM Type):' : 'BoM Type:'}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label
                  className={cn(
                    'flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200',
                    bomType === 'phantom'
                      ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                      : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  <input
                    type="radio"
                    name="bomType"
                    value="phantom"
                    checked={bomType === 'phantom'}
                    onChange={() => setBomType('phantom')}
                    className="mt-0.5 h-3.5 w-3.5 text-primary border-border focus:ring-primary cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <span className="font-semibold block text-xs">
                      {lang === 'ar' ? 'تجميع فوري (Kit / Phantom)' : 'Kit (Phantom)'}
                    </span>
                    <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                      {lang === 'ar'
                        ? 'تُباع كمجموعة ويتم خصم مكوناتها مباشرة من المخزن عند التسليم.'
                        : 'Sold as a kit; component stock is deducted directly from inventory.'}
                    </span>
                  </div>
                </label>

                <label
                  className={cn(
                    'flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all duration-200',
                    bomType === 'normal'
                      ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/30'
                      : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  <input
                    type="radio"
                    name="bomType"
                    value="normal"
                    checked={bomType === 'normal'}
                    onChange={() => setBomType('normal')}
                    className="mt-0.5 h-3.5 w-3.5 text-primary border-border focus:ring-primary cursor-pointer"
                  />
                  <div className="space-y-0.5">
                    <span className="font-semibold block text-xs">
                      {lang === 'ar' ? 'تصنيع (Manufacture / Normal)' : 'Manufacture (Normal)'}
                    </span>
                    <span className="text-[11px] leading-relaxed block text-muted-foreground font-normal">
                      {lang === 'ar'
                        ? 'منتج يتم تصنيعه عبر أمر تصنيع مخصص في وحدة الإنتاج.'
                        : 'Produced from components via a dedicated manufacturing order in Odoo.'}
                    </span>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>
      </SettingCard>

      {/* 7. Media & Category Sync */}
      <SettingCard
        icon={<ImageIcon className="h-4 w-4 text-teal-600" />}
        title={lang === 'ar' ? 'الوسائط والتصنيفات ووحدات القياس' : 'Media, Categories & UoM'}
        description={
          lang === 'ar'
            ? 'تحديد سياسات نقل الصور والتصنيفات وإنشاء وحدات القياس تلقائياً'
            : 'Configure media sync, category linkage, and automatic unit of measure creation'
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'مزامنة الصور' : 'Image Sync Mode'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={imageSyncMode}
              onChange={(e) => setImageSyncMode(e.target.value)}
            >
              <option value="all">{lang === 'ar' ? 'جميع الصور' : 'All Images'}</option>
              <option value="main_only">{lang === 'ar' ? 'الصورة الرئيسية فقط' : 'Main Only'}</option>
              <option value="skip">{lang === 'ar' ? 'تخطي الصور' : 'Skip Images'}</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'مزامنة التصنيفات' : 'Category Sync'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={categorySyncMode}
              onChange={(e) => setCategorySyncMode(e.target.value)}
            >
              <option value="auto">{lang === 'ar' ? 'تلقائي' : 'Auto'}</option>
              <option value="skip">{lang === 'ar' ? 'تخطي' : 'Skip'}</option>
              <option value="map_existing">{lang === 'ar' ? 'ربط بالموجود' : 'Map Existing'}</option>
            </select>
          </div>

          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'إنشاء وحدة القياس' : 'UoM Auto Create'}
            </label>
            <SettingToggle
              checked={uomAutoCreate}
              onChange={setUomAutoCreate}
              label={lang === 'ar' ? 'إنشاء تلقائي لوحدة القياس' : 'Auto create UoM'}
              description={
                lang === 'ar' ? 'إنشاء الوحدة في أودو إذا لم تكن موجودة' : 'Create UoM in Odoo if not found'
              }
            />
          </div>
        </div>
      </SettingCard>

      {/* 8. Tax */}
      <SettingCard
        icon={<Percent className="h-4 w-4 text-blue-600" />}
        title={lang === 'ar' ? 'إعدادات الضرائب الافتراضية' : 'Default Tax Settings'}
        description={
          lang === 'ar'
            ? 'تحديد ضريبة المنتجات المنشأة في أودو عند عدم ورود ضريبة محددة'
            : 'Tax mapping mode and default taxes applied to synced products'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'طريقة مزامنة الضريبة' : 'Tax Sync Mode'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={taxSyncMode}
              onChange={(e) => setTaxSyncMode(e.target.value)}
            >
              <option value="auto_by_name">{lang === 'ar' ? 'تلقائي حسب الاسم/النسبة' : 'Auto by Name'}</option>
              <option value="static_ids">{lang === 'ar' ? 'ضرائب ثابتة محددة' : 'Static IDs'}</option>
              <option value="skip">{lang === 'ar' ? 'تخطي (بدون ضريبة)' : 'Skip'}</option>
            </select>
          </div>

          {taxSyncMode === 'static_ids' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'الضرائب الافتراضية في أودو' : 'Default Tax IDs in Odoo'}
              </label>
              <SearchableSelect
                multiple={true}
                collapseTags={true}
                value={defaultTaxIds}
                onChange={setDefaultTaxIds}
                options={taxOptions}
                disabled={isLoadingTaxOpts}
                placeholder={lang === 'ar' ? '— اختر الضرائب —' : '— Select taxes —'}
              />
            </div>
          )}
        </div>
      </SettingCard>

      {/* 9. On Delete */}
      <SettingCard
        icon={<Trash2 className="h-4 w-4 text-amber-600" />}
        title={lang === 'ar' ? 'إجراء الحذف في المتجر' : 'On Store Deletion'}
        description={
          lang === 'ar'
            ? 'الإجراء المتخذ في أودو عند حذف المنتج من المتجر الإلكتروني'
            : 'Action taken in Odoo when a product is deleted in the store'
        }
      >
        <div className="max-w-md space-y-1.5">
          <label className="block text-xs font-medium text-foreground/80">
            {lang === 'ar' ? 'الإجراء في أودو' : 'Action in Odoo'}
          </label>
          <select
            className="w-full h-9 px-3 rounded-xl border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            value={productOnDelete}
            onChange={(e) => setProductOnDelete(e.target.value)}
          >
            {[
              { value: 'nothing', labelAr: 'لا شيء (تجاهل الحذف)', labelEn: 'Nothing' },
              { value: 'delete', labelAr: 'حذف المنتج من أودو', labelEn: 'Delete' },
              { value: 'archive', labelAr: 'أرشفة المنتج (نشط = خطأ)', labelEn: 'Archive (Active = false)' },
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

      {/* 10. Inventory Sync (Odoo -> Store) */}
      {(standardStoreTab === 'zid' || standardStoreTab === 'salla') && (
        <SettingCard
          icon={<ArrowRightLeft className="h-4 w-4 text-emerald-600" />}
          title={
            lang === 'ar'
              ? `مزامنة المخزون (من أودو إلى ${invSyncStoreNameAr})`
              : `Inventory Sync (Odoo → ${invSyncStoreNameEn})`
          }
          description={
            lang === 'ar'
              ? `أودو هو مصدر الحقيقة: أي تغيير في كميات أودو يحدّث كميات ${invSyncStoreNameAr} تلقائياً وفورياً`
              : `Odoo is the source of truth: stock changes in Odoo automatically update ${invSyncStoreNameEn}`
          }
        >
          <div className="space-y-4">
            <SettingToggle
              checked={invSyncEnabled}
              onChange={setInvSyncEnabled}
              label={lang === 'ar' ? 'تفعيل مزامنة المخزون التلقائية' : 'Enable Inventory Sync'}
              description={
                lang === 'ar'
                  ? 'مزامنة فورية عند تغير الأرصدة عبر الـ Webhook'
                  : 'Instant automatic updates on Odoo stock movements'
              }
            />

            {/* Odoo Webhook Management Card */}
            <div className="rounded-xl border border-border/80 bg-background/60 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-foreground block">
                    {lang === 'ar' ? 'استقبال تحديثات الكميات من أودو (Odoo Stock Webhook)' : 'Odoo Stock Webhook'}
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    {odooStockWebhook?.base_automation_id
                      ? lang === 'ar'
                        ? `تم إنشاء القاعدة الآلية بنجاح في أودو (#${odooStockWebhook.base_automation_id})`
                        : `Configured in Odoo (Base Automation #${odooStockWebhook.base_automation_id})`
                      : lang === 'ar'
                      ? 'لإرسال أي تغيير على كميات الأصناف من أودو تلقائياً، اضغط إنشاء الـ Webhook.'
                      : 'Create the automation rule in Odoo so quantity updates are sent immediately.'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCreateOdooWebhook}
                    disabled={isSyncingWebhook || !!odooStockWebhook}
                    className="h-8 text-xs gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{lang === 'ar' ? 'إنشاء Webhook' : 'Create Webhook'}</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleDeleteOdooWebhook}
                    disabled={isSyncingWebhook || !odooStockWebhook}
                    className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>{lang === 'ar' ? 'حذف' : 'Delete'}</span>
                  </Button>
                </div>
              </div>

              {isSyncingWebhook && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{lang === 'ar' ? 'جاري إعداد الـ Webhook في أودو...' : 'Configuring webhook in Odoo...'}</span>
                </div>
              )}

              {invSyncWebhookError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {invSyncWebhookError}
                </div>
              )}
            </div>

            {invSyncEnabled && (
              <div className="space-y-4 pt-2 border-t border-border/60">
                {/* Balance Mode */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-foreground/80">
                    {lang === 'ar' ? 'نوع الرصيد المراد مزامنته' : 'Balance to Sync'}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label
                      className={cn(
                        'flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors',
                        invSyncMode === 'actual'
                          ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/20'
                          : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <input
                        type="radio"
                        name="invSyncMode"
                        checked={invSyncMode === 'actual'}
                        onChange={() => setInvSyncMode('actual')}
                        className="mt-0.5 h-3.5 w-3.5 text-primary border-border focus:ring-primary cursor-pointer"
                      />
                      <div className="space-y-0.5">
                        <span className="font-semibold block text-xs">
                          {lang === 'ar' ? 'الرصيد الفعلي في المخزن (On Hand)' : 'On Hand (Actual)'}
                        </span>
                        <span className="text-[11px] block text-muted-foreground">
                          {lang === 'ar' ? 'الكميات المتواجدة فعلياً في المستودع' : 'Actual physical inventory'}
                        </span>
                      </div>
                    </label>

                    <label
                      className={cn(
                        'flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors',
                        invSyncMode === 'forecast'
                          ? 'bg-primary/5 border-primary text-foreground ring-1 ring-primary/20'
                          : 'bg-background/60 border-border/70 hover:border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <input
                        type="radio"
                        name="invSyncMode"
                        checked={invSyncMode === 'forecast'}
                        onChange={() => setInvSyncMode('forecast')}
                        className="mt-0.5 h-3.5 w-3.5 text-primary border-border focus:ring-primary cursor-pointer"
                      />
                      <div className="space-y-0.5">
                        <span className="font-semibold block text-xs">
                          {lang === 'ar' ? 'الرصيد المتوقع (Forecasted)' : 'Forecasted Balance'}
                        </span>
                        <span className="text-[11px] block text-muted-foreground">
                          {lang === 'ar' ? 'الفعلي + الوارد من الموردين – المحجوز للطلبات' : 'On Hand + incoming − outgoing'}
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Location Pairing */}
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-xs font-semibold text-foreground">
                        {lang === 'ar' ? 'ربط المواقع والمستودعات' : 'Warehouse / Location Pairing'}
                      </label>
                      <p className="text-[11px] text-muted-foreground">
                        {lang === 'ar'
                          ? `اربط موقع ${invSyncStoreNameAr} بموقع أودو لتحديث رصيد الصنف لكل فرع/مخزن`
                          : `Pair each ${invSyncStoreNameEn} location with its corresponding Odoo location`}
                      </p>
                    </div>
                  </div>

                  {isLoadingInvSync ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>{lang === 'ar' ? 'جاري تحميل المواقع...' : 'Loading locations...'}</span>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      {invSyncPairs.map((row, index) =>
                        row._removed ? null : (
                          <div
                            key={row.id || `pair-${index}`}
                            className="flex items-center gap-2 p-2 rounded-xl border border-border/60 bg-background/60"
                          >
                            <select
                              className="w-full h-8 px-2.5 rounded-lg border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                              value={row.source_location_id}
                              onChange={(e) => handlePairChange(index, 'source_location_id', e.target.value)}
                            >
                              <option value="">
                                {lang === 'ar' ? `— موقع ${invSyncStoreNameAr} —` : `— ${invSyncStoreNameEn} location —`}
                              </option>
                              {(isSallaInvSync ? sallaLocations : zidLocations).map((loc) => {
                                const locId = String(loc.id)
                                const taken = usedPairSources.has(locId) && String(row.source_location_id) !== locId
                                return (
                                  <option key={locId} value={locId} disabled={taken}>
                                    {loc.name || locId}
                                    {taken ? (lang === 'ar' ? ' (مربوط)' : ' (paired)') : ''}
                                  </option>
                                )
                              })}
                            </select>

                            <ArrowRightLeft className="h-4 w-4 shrink-0 text-muted-foreground/70" />

                            <select
                              className="w-full h-8 px-2.5 rounded-lg border border-input bg-background text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                              value={row.odoo_location_id}
                              onChange={(e) => handlePairChange(index, 'odoo_location_id', e.target.value)}
                            >
                              <option value="">
                                {lang === 'ar' ? '— موقع أودو —' : '— Odoo location —'}
                              </option>
                              {odooLocations.map((loc) => (
                                <option key={loc.id} value={String(loc.id)}>
                                  {loc.complete_name || loc.name}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => handleRemovePair(index)}
                              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title={lang === 'ar' ? 'حذف' : 'Remove'}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      )}

                      {invSyncPairs.filter((p) => !p._removed).length === 0 && (
                        <div className="p-3 text-center border border-dashed border-border/80 rounded-xl text-xs text-muted-foreground">
                          {lang === 'ar'
                            ? 'لا توجد أزواج مواقع بعد — أضف زوجاً لبدء مزامنة المخزون.'
                            : 'No paired locations yet — add a pair to begin stock sync.'}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleRefreshInvLocations}
                          disabled={isRefreshingInvLocations || isLoadingInvSync}
                          className="h-8 px-2.5 text-xs gap-1.5"
                          title={lang === 'ar' ? 'تحديث المواقع' : 'Refresh locations'}
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshingInvLocations && 'animate-spin')} />
                          <span>{lang === 'ar' ? 'تحديث المواقع' : 'Refresh'}</span>
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAddPair}
                          className="h-8 px-3 text-xs gap-1.5"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>{lang === 'ar' ? 'إضافة زوج موقع' : 'Add Pair'}</span>
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          onClick={handleSavePairs}
                          disabled={isSavingPairs || isLoadingInvSync}
                          className="h-8 px-4 text-xs gap-1.5 bg-primary text-primary-foreground font-semibold"
                        >
                          {isSavingPairs ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              <span>{lang === 'ar' ? 'حفظ...' : 'Saving...'}</span>
                            </>
                          ) : (
                            <span>{lang === 'ar' ? 'حفظ ربط المواقع' : 'Save Location Pairs'}</span>
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </SettingCard>
      )}

      {/* 11. Match Field */}
      <SettingCard
        icon={<GitCompare className="h-4 w-4 text-indigo-600" />}
        title={lang === 'ar' ? 'حقل المطابقة والمزامنة' : 'Match Field'}
        description={
          lang === 'ar'
            ? 'حدد الحقل في المتجر المقابل لحقل أودو (مثل SKU أو الباركود) للتعرف على المنتجات'
            : 'Select store and Odoo fields used to match and identify products'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'حقل المتجر' : 'Store Field'}
            </label>
            <SearchableSelect
              options={productFields}
              value={productMatchZidField}
              onChange={setProductMatchZidField}
              placeholder={lang === 'ar' ? '— اختر حقل المتجر —' : '— Select store field —'}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'حقل أودو المقابل' : 'Odoo Field'}
              </label>
              <button
                type="button"
                onClick={() => fetchOdooProductFields(true)}
                disabled={isLoadingProductFields}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 text-[11px] flex items-center gap-1"
                title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
              >
                <RefreshCw className={cn('h-3 w-3', isLoadingProductFields && 'animate-spin')} />
                <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
              </button>
            </div>
            <SearchableSelect
              options={productOdooFields}
              value={productMatchOdooField}
              onChange={setProductMatchOdooField}
              placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
              disabled={isLoadingProductFields}
            />
          </div>
        </div>
      </SettingCard>

      {/* 12. Sync Actions */}
      <SettingCard
        icon={<Sliders className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'إعدادات وعمليات المزامنة' : 'Sync Operations & Rules'}
        description={
          lang === 'ar'
            ? 'تحديد العمليات المسموح بها للمنتجات وحالة المزامنة الكلية'
            : 'Select permitted operations and toggle product synchronization'
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={!productDisabled}
            onChange={(active) => setProductDisabled(!active)}
            label={lang === 'ar' ? 'تفعيل مزامنة المنتجات' : 'Enable Product Sync'}
            description={
              lang === 'ar'
                ? 'عند التعطيل لن يتم إنشاء أو تعديل أي منتج في أودو'
                : 'When disabled, no products will be created, updated, or deleted in Odoo'
            }
          />

          {productDisabled && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {lang === 'ar'
                  ? 'مزامنة المنتجات معطلة حالياً — لن تنعكس أي تغييرات على أودو.'
                  : 'Product sync is disabled — changes will not propagate to Odoo.'}
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
              value={productEnabledActions}
              onChange={setProductEnabledActions}
              options={syncActionOptions}
              disabled={productDisabled}
              placeholder={
                lang === 'ar'
                  ? productDisabled
                    ? '— المزامنة معطلة —'
                    : '— اختر العمليات المصرح بها —'
                  : productDisabled
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
          onClick={handleSaveProducts}
          disabled={isSavingProducts}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl h-10 px-6 text-xs shadow-sm gap-2 transition-all"
        >
          {isSavingProducts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{lang === 'ar' ? 'حفظ إعدادات المنتجات' : 'Save Product Settings'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsProductMappingOpen(true)}
          className="rounded-xl h-10 px-4 text-xs gap-2 border-border/80 hover:bg-muted/50"
        >
          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'ربط يدوي وتلقائي' : 'Manual & Auto Mapping'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsProductLogOpen(true)}
          className="rounded-xl h-10 px-4 text-xs gap-2 border-border/80 hover:bg-muted/50"
        >
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'سجل مزامنة المنتجات' : 'Product Sync Log'}</span>
        </Button>
      </div>
    </div>
  )
}
