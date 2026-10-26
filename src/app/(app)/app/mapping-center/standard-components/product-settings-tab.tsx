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

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import SearchableSelect from '../searchable-select'

// Odoo-style borderless table classes
const tableClassName = "w-full text-start border-collapse"
const theadClassName = "bg-muted/50 border-b border-border/70 text-[11px] font-bold text-muted-foreground uppercase tracking-wider"
const trClassName = "divide-y divide-border/60 text-xs"
const thClassName = "py-3.5 px-4 text-start"
const tdClassName = "py-3.5 px-4"

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
  setCostSource: (val: number) => void
  priceSource: string
  setPriceSource: (val: number) => void
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
}

// Helper to render an Odoo-style borderless table section
const renderTableSection = (
  titleKeyAr: string,
  titleKeyEn: string,
  rows: React.ReactNode
) => (
  <div className="card-base border border-border/70 rounded-lg shadow-card overflow-hidden">
    <div className="overflow-x-auto">
      <table className={tableClassName}>
        <thead className={theadClassName}>
          <tr>
            <th className={thClassName} colSpan={2}>
              {lang === 'ar' ? titleKeyAr : titleKeyEn}
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

export function ProductSettingsTab({
  lang,
  dir: _dir,
  standardStoreTab,
  invSyncStoreNameAr,
  invSyncStoreNameEn,
  isSallaInvSync,
  // Product type & Inventory
  productType,
  setProductType,
  productTypeOptions,
  isLoadingProductOpts,
  trackInventory,
  setTrackInventory,
  trackingMethod,
  setTrackingMethod,
  trackingOptions,
  // Company
  productCompanyId,
  setProductCompanyId,
  productLinkCompany,
  setProductLinkCompany,
  companyOptions,
  isLoadingCompanies,
  fetchCompanies,
  // Pricing
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
  // Name & Description
  nameLanguage,
  setNameLanguage,
  nameFallback,
  setNameFallback,
  descLanguage,
  setDescLanguage,
  descFallback,
  setDescFallback,
}: any) {
  return (
    <div className="space-y-4">
      {/* 1. Product Type */}
      {renderTableSection(
        lang === 'ar' ? 'نوع المنتج' : 'Product Type',
        lang === 'ar' ? 'Product Type' : 'Product Type',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
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
            </td>
          </tr>
        )
      )}

      {/* 2. Inventory */}
      {renderTableSection(
        lang === 'ar' ? 'المخزون' : 'Inventory',
        lang === 'ar' ? 'Inventory' : 'Inventory',
        (
          <tr>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'تفعيل المخزون' : 'Track Inventory'}
                </label>
                <select
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  value={trackInventory}
                  onChange={(e) => setTrackInventory(e.target.value === 'true')}
                >
                  <option value="true">
                    {lang === 'ar' ? 'مفعل' : 'Enabled'}
                  </option>
                  <option value="false">
                    {lang === 'ar' ? 'غير مُفعل' : 'Disabled'}
                  </option>
                </select>
              </div>
            </td>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'طريقة التتبع' : 'Tracking Method'}
                </label>
                <select
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  value={trackingMethod}
                  onChange={(e) => setTrackingMethod(e.target.value)}
                >
                  {trackingOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </td>
          </tr>
        )
      )}

      {/* 3. Company */}
      {renderTableSection(
        lang === 'ar' ? 'الشركة' : 'Company',
        lang === 'ar' ? 'Company' : 'Company',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
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
            </td>
          </tr>
        )
      )}

      {productCompanyId && (
        <div className="p-3 rounded-xl border border-border/70 bg-muted/50 text-xs font-medium">
          <span>
            {lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
          </span>
        </div>
      )}

      {/* 4. Pricing */}
      {renderTableSection(
        lang === 'ar' ? 'التسعير' : 'Pricing',
        lang === 'ar' ? 'Pricing' : 'Pricing',
        (
          <tr>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'الزيادة%' : 'Markup %'}
                </label>
                <input
                  type="number"
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(Number(e.target.value) || 0)}
                  className="w-full h-8 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                />
              </div>
            </td>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'مصدر التكلفة' : 'Cost Source'}
                </label>
                <select
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  value={costSource}
                  onChange={(e) => setCostSource(e.target.value)}
                >
                  <option value="cost">{lang === 'ar' ? 'التكلفة' : 'Cost'}</option>
                  <option value="price">{lang === 'ar' ? 'السعر' : 'Price'}</option>
                </select>
              </div>
            </td>
          </tr>
        )
      )}

      {/* 5. Rounding */}
      {renderTableSection(
        lang === 'ar' ? 'التقريب' : 'Rounding',
        lang === 'ar' ? 'Rounding' : 'Rounding',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={rounding}
                onChange={(e) => setRounding(e.target.value)}
              >
                <option value="">— استخدم الإعداد الافتراضي في أودو —</option>
                <option value="ceil">{lang === 'ar' ? 'أعلى' : 'Ceiling'}</option>
                <option value="floor">{lang === 'ar' ? 'أدنى' : 'Floor'}</option>
                <option value="round">{lang === 'ar' ? 'إلى الأقرب' : 'Round'}</option>
              </select>
            </td>
          </tr>
        )
      )}

      {/* 6. Decimal Places */}
      {renderTableSection(
        lang === 'ar' ? 'الأرقام العشرية' : 'Decimal Places',
        lang === 'ar' ? 'Decimal Places' : 'Decimal Places',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={decimalPlaces}
                onChange={(e) => setDecimalPlaces(Number(e.target.value) || 2)}
              >
                <option value={0}>{lang === 'ar' ? '0' : '0'}</option>
                <option value={1}>{lang === 'ar' ? '1' : '1'}</option>
                <option value={2}>{lang === 'ar' ? '2' : '2'}</option>
                <option value={3}>{lang === 'ar' ? '3' : '3'}</option>
              </select>
            </td>
          </tr>
        )
      )}

      {/* 7. Name & Description */}
      {renderTableSection(
        lang === 'ar' ? 'اسم ووصف' : 'Name & Description',
        lang === 'ar' ? 'Name & Description' : 'Name & Description',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-muted-foreground">
                    {lang === 'ar' ? 'اسم المنتج' : 'Product Name'}
                    <span className="text-destructive ms-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    value={nameLanguage}
                    onChange={(e) => setNameLanguage(e.target.value)}
                    className="w-full h-8 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    placeholder={lang === 'ar' ? 'اسم المنتج' : 'Product name'}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-muted-foreground">
                    {lang === 'ar' ? 'لغة الوصف' : 'Description Language'}
                  </label>
                  <select
                    className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                    value={descLanguage}
                    onChange={(e) => setDescLanguage(e.target.value)}
                  >
                    <option value="ar">{lang === 'ar' ? 'العربية' : 'Arabic'}</option>
                    <option value="en">{lang === 'ar' ? 'English' : 'English'}</option>
                  </select>
                </div>
              </div>
            </td>
          </tr>
        )
      )}
    </div>
  )
}