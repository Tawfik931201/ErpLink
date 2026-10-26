'use client'

import {
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  DollarSign,
  GitCompare,
  History,
  Loader2,
  Package,
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

interface OrderSettingsTabProps {
  lang: string
  dir: string
  standardStoreTab: string
  statusStoreNameAr: string
  statusStoreNameEn: string
  statusFieldDefaultName: string
  orderDisabled: boolean
  setOrderDisabled: (val: boolean) => void
  orderEnabledActions: string[]
  setOrderEnabledActions: (val: string[]) => void
  orderMatchZidField: string
  setOrderMatchZidField: (val: string) => void
  orderMatchOdooField: string
  setOrderMatchOdooField: (val: string) => void
  setOrderMatchOdooField2: (val: string) => void
  orderCompanyId: string
  setOrderCompanyId: (val: string) => void
  orderLinkCompany: boolean
  setOrderLinkCompany: (val: boolean) => void
  orderWarehouseId: string
  setOrderWarehouseId: (val: string) => void
  orderPricelistId: string
  setOrderPricelistId: (val: string) => void
  orderPaymentTermId: string
  setOrderPaymentTermId: (val: string) => void
  orderAutoConfirm: boolean
  setOrderAutoConfirm: (val: boolean) => void
  orderAutoInvoice: boolean
  setOrderAutoInvoice: (val: boolean) => void
  orderPartialFulfillment: boolean
  setOrderPartialFulfillment: (val: boolean) => void
  // Returns
  orderReturnsMode: string
  setOrderReturnsMode: (val: string) => void
  orderReturnsCreditNote: boolean
  setOrderReturnsCreditNote: (val: boolean) => void
  orderReturnsJournalId: string
  setOrderReturnsJournalId: (val: string) => void
  orderReturnsFallback: string
  setOrderReturnsFallback: (val: string) => void
  orderReturnsReason: string
  setOrderReturnsReason: (val: string) => void
  // Warehouse rules
  storeWarehouseRules: any[]
  setStoreWarehouseRules: (val: any[]) => void
  // Analytic
  orderAnalyticEnabled: boolean
  setOrderAnalyticEnabled: (val: boolean) => void
  orderAnalyticRules: any[]
  setOrderAnalyticRules: (val: any[]) => void
  // Shipping
  orderAddShipping: boolean
  setOrderAddShipping: (val: boolean) => void
  orderShippingProductId: string
  setOrderShippingProductId: (val: string) => void
  orderShippingProductSku: string
  setOrderShippingProductSku: (val: string) => void
  // COD
  orderAddCod: boolean
  setOrderAddCod: (val: boolean) => void
  orderCodProductId: string
  setOrderCodProductId: (val: string) => void
  orderCodProductSku: string
  setOrderCodProductSku: (val: string) => void
  orderCodAmount: string
  setOrderCodAmount: (val: string) => void
  // Discount
  orderAddDiscount: boolean
  setOrderAddDiscount: (val: boolean) => void
  orderDiscountProductId: string
  setOrderDiscountProductId: (val: string) => void
  orderDiscountProductSku: string
  setOrderDiscountProductSku: (val: string) => void
  orderDiscountMode: string
  setOrderDiscountMode: (val: string) => void
  // VAT
  orderEnableVat: boolean
  setOrderEnableVat: (val: boolean) => void
  orderVatSaudiTaxId: string
  setOrderVatSaudiTaxId: (val: string) => void
  orderVatNonSaudiTaxId: string
  setOrderVatNonSaudiTaxId: (val: string) => void
  // Custom status
  orderUpdateCustomStatus: boolean
  setOrderUpdateCustomStatus: (val: boolean) => void
  orderStatusCustomField: string
  setOrderStatusCustomField: (val: string) => void
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

export function OrderSettingsTab({
  lang,
  dir: _dir,
  standardStoreTab,
  statusStoreNameAr,
  statusStoreNameEn,
  statusFieldDefaultName,
  orderDisabled,
  setOrderDisabled,
  orderEnabledActions,
  setOrderEnabledActions,
  orderMatchZidField,
  setOrderMatchZidField,
  orderMatchOdooField,
  setOrderMatchOdooField,
  setOrderMatchOdooField2,
  orderCompanyId,
  setOrderCompanyId,
  orderLinkCompany,
  setOrderLinkCompany,
  orderWarehouseId,
  setOrderWarehouseId,
  orderPricelistId,
  setOrderPricelistId,
  orderPaymentTermId,
  setOrderPaymentTermId,
  orderAutoConfirm,
  setOrderAutoConfirm,
  orderAutoInvoice,
  setOrderAutoInvoice,
  orderPartialFulfillment,
  setOrderPartialFulfillment,
  // Returns
  orderReturnsMode,
  setOrderReturnsMode,
  orderReturnsCreditNote,
  setOrderReturnsCreditNote,
  orderReturnsJournalId,
  setOrderReturnsJournalId,
  orderReturnsFallback,
  setOrderReturnsFallback,
  orderReturnsReason,
  setOrderReturnsReason,
  // Warehouse rules
  storeWarehouseRules,
  setStoreWarehouseRules,
  // Analytic
  orderAnalyticEnabled,
  setOrderAnalyticEnabled,
  orderAnalyticRules,
  setOrderAnalyticRules,
  // Shipping
  orderAddShipping,
  setOrderAddShipping,
  orderShippingProductId,
  setOrderShippingProductId,
  orderShippingProductSku,
  setOrderShippingProductSku,
  // COD
  orderAddCod,
  setOrderAddCod,
  orderCodProductId,
  setOrderCodProductId,
  orderCodProductSku,
  setOrderCodProductSku,
  orderCodAmount,
  setOrderCodAmount,
  // Discount
  orderAddDiscount,
  setOrderAddDiscount,
  orderDiscountProductId,
  setOrderDiscountProductId,
  orderDiscountProductSku,
  setOrderDiscountProductSku,
  orderDiscountMode,
  setOrderDiscountMode,
  // VAT
  orderEnableVat,
  setOrderEnableVat,
  orderVatSaudiTaxId,
  setOrderVatSaudiTaxId,
  orderVatNonSaudiTaxId,
  setOrderVatNonSaudiTaxId,
  // Custom status
  orderUpdateCustomStatus,
  setOrderUpdateCustomStatus,
  orderStatusCustomField,
  setOrderStatusCustomField,
}: any) {
  return (
    <div className="space-y-4">
      {/* 1. Status & Company */}
      {renderTableSection(
        lang === 'ar' ? 'حالة الطلب والشركة' : 'Order Status & Company',
        lang === 'ar' ? 'Order Status & Company' : 'Order Status & Company',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={orderDisabled}
                onChange={(e) => setOrderDisabled(e.target.value === 'true')}
              >
                <option value="true">
                  {lang === 'ar' ? 'معطّل' : 'Disabled'}
                </option>
                <option value="false">
                  {lang === 'ar' ? 'مفعل' : 'Enabled'}
                </option>
              </select>
            </td>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={orderCompanyId}
                onChange={(e) => setOrderCompanyId(e.target.value)}
              >
                <option value="">
                  {lang === 'ar' ? '— اختر الشركة —' : '— Select Company —'}
                </option>
                {orderLinkCompany ? (
                  <option value="true" selected>
                    {lang === 'ar' ? 'مرتبطة' : 'Linked'}
                  </option>
                ) : (
                  <option value="false">
                    {lang === 'ar' ? 'غير المرتبطة' : 'Unlinked'}
                  </option>
                )}
              </select>
            </td>
          </tr>
        )
      )}

      {/* 2. Enabled Actions */}
      {renderTableSection(
        lang === 'ar' ? 'العمليات المصرح بها' : 'Allowed Operations',
        lang === 'ar' ? 'Allowed Operations' : 'Allowed Operations',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <SearchableSelect
                multiple={true}
                collapseTags={false}
                value={orderEnabledActions}
                onChange={setOrderEnabledActions}
                options={[
                  { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
                  { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
                  { value: 'cancel', label: lang === 'ar' ? 'إلغاء (Cancel)' : 'Cancel' },
                  { value: 'deliver', label: lang === 'ar' ? 'تسليم (Deliver)' : 'Deliver' },
                ]}
                disabled={orderDisabled}
                placeholder={
                  lang === 'ar'
                    ? orderDisabled
                      ? '— المزامنة معطلة —'
                      : '— اختر العمليات المصرح بها —'
                    : orderDisabled
                      ? '— Sync is disabled —'
                      : '— Select operations —'
                }
              />
            </td>
            <td className={tdClassName} colSpan={2} />

            <td className={tdClassName} colSpan={4} />

            <td className={tdClassName} colSpan={4} />
          </tr>
        )
      )}

      {/* 3. Match Fields */}
      {renderTableSection(
        lang === 'ar' ? 'حقول المطابقة' : 'Match Fields',
        lang === 'ar' ? 'Match Fields' : 'Match Fields',
        (
          <tr>
            <td className={tdClassName}>
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'حقل المتجر' : 'Store Field'}
              </label>
              <SearchableSelect
                options={[]}
                value={orderMatchZidField}
                onChange={(e: any) => setOrderMatchZidField(e.target.value)}
                placeholder={lang === 'ar' ? '— choisir حقل المتجر —' : '— Select store field —'}
              />
            </td>
            <td className={tdClassName}>
              <label className="block text-xs font-medium text-foreground/80">
                {lang === 'ar' ? 'حقل أودو' : 'Odoo Field'}
              </label>
              <SearchableSelect
                options={[]}
                value={orderMatchOdooField}
                onChange={(e: any) => setOrderMatchOdooField(e.target.value)}
                placeholder={lang === 'ar' ? '— elegir حقل أودو —' : '— Select Odoo field —'}
              />
            </td>
          </tr>
        )
      )}

      {/* 4. Warehouse Rules */}
      {renderTableSection(
        lang === 'ar' ? 'قواعد المستودعات' : 'Warehouse Rules',
        lang === 'ar' ? 'Warehouse Rules' : 'Warehouse Rules',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <SearchableSelect
                multiple={true}
                collapseTags={false}
                value={storeWarehouseRules.map(r => r.zid_location_id).filter(Boolean)}
                onChange={(vals: string[]) => {
                  // Update warehouse rules based on selected locations
                  const newRules = storeWarehouseRules.map((rule, i) => {
                    const newZidId = vals[i] || ''
                    return { ...rule, zid_location_id: newZidId }
                  })
                  setStoreWarehouseRules(newRules)
                }}
                options={[]}
                placeholder={lang === 'ar' ? 'اختر مواقع زد' : 'Select Zid Locations'}
              />
            </td>
            <td className={tdClassName} colSpan={2} />

            <td className={tdClassName} colSpan={4} />

            <td className={tdClassName} colSpan={4} />
          </tr>
        )
      )}

      {/* 5. Analytic Distribution */}
      {renderTableSection(
        lang === 'ar' ? 'التوزيع التحليلي' : 'Analytic Distribution',
        lang === 'ar' ? 'Analytic Distribution' : 'Analytic Distribution',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <SearchableSelect
                checked={orderAnalyticEnabled}
                onChange={(active: boolean) => setOrderAnalyticEnabled(active)}
                label={lang === 'ar' ? 'تفعيل التوزيع التحليلي' : 'Enable Analytic Distribution'}
                description={
                  lang === 'ar'
                    ? 'عند التعطيل لن يتم تطبيق أي توزيع تحليلي'
                    : 'When disabled, no analytic distribution will be applied'
                }
              />
            </td>
            <td className={tdClassName} colSpan={2} />

            <td className={tdClassName} colSpan={4} />

            <td className={tdClassName} colSpan={4} />
          </tr>
        )
      )}

      {/* 6. Shipping */}
      {renderTableSection(
        lang === 'ar' ? 'الشحن' : 'Shipping',
        lang === 'ar' ? 'Shipping' : 'Shipping',
        (
          <tr>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'إضافة الشحن كبند' : 'Add Shipping as Line'}
                </label>
                <select
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  value={orderAddShipping}
                  onChange={(e: any) => setOrderAddShipping(e.target.value === 'true')}
                >
                  <option value="true">
                    {lang === 'ar' ? 'نعم' : 'Yes'}
                  </option>
                  <option value="false">
                    {lang === 'ar' ? 'لا' : 'No'}
                  </option>
                </select>
              </div>
            </td>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'منتج الشحن' : 'Shipping Product'}
                </label>
                <SearchableSelect
                  options={[]}
                  value={orderShippingProductId}
                  onChange={(e: any) => setOrderShippingProductId(e.target.value)}
                  placeholder={lang === 'ar' ? '— choisir produit d'expédition —' : '— Select shipping product —'}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'SKU الشحن' : 'Shipping SKU'}
                </label>
                <input
                  type="text"
                  value={orderShippingProductSku}
                  onChange={(e: any) => setOrderShippingProductSku(e.target.value)}
                  className="w-full h-8 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder={lang === 'ar' ? 'SKU الشحن' : 'Shipping SKU'}
                />
              </div>
            </td>
          </tr>
        )
      )}

      {/* 7. COD */}
      {renderTableSection(
        lang === 'ar' ? 'رسوم الدفع عند الاستلام' : 'COD Fee',
        lang === 'ar' ? 'COD Fee' : 'COD Fee',
        (
          <tr>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'إضافة رسوم الدفع عند الاستلام' : 'Add COD Fee'}
                </label>
                <select
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  value={orderAddCod}
                  onChange={(e: any) => setOrderAddCod(e.target.value === 'true')}
                >
                  <option value="true">
                    {lang === 'ar' ? 'نعم' : 'Yes'}
                  </option>
                  <option value="false">
                    {lang === 'ar' ? 'لا' : 'No'}
                  </option>
                </select>
              </div>
            </td>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'منتج الرسوم' : 'COD Product'}
                </label>
                <SearchableSelect
                  options={[]}
                  value={orderCodProductId}
                  onChange={(e: any) => setOrderCodProductId(e.target.value)}
                  placeholder={lang === 'ar' ? '— choisir produit de paiement —' : '— Select COD product —'}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'SKU الرسوم' : 'COD SKU'}
                </label>
                <input
                  type="text"
                  value={orderCodProductSku}
                  onChange={(e: any) => setOrderCodProductSku(e.target.value)}
                  className="w-full h-8 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder={lang === 'ar' ? 'SKU الرسوم' : 'COD SKU'}
                />
              </div>
            </td>
          </tr>
        )
      )}

      {/* 8. Discount */}
      {renderTableSection(
        lang === 'ar' ? 'الخصم' : 'Discount',
        lang === 'ar' ? 'Discount' : 'Discount',
        (
          <tr>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'إضافة خصم كبند' : 'Add Discount as Line'}
                </label>
                <select
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  value={orderAddDiscount}
                  onChange={(e: any) => setOrderAddDiscount(e.target.value === 'true')}
                >
                  <option value="true">
                    {lang === 'ar' ? 'نعم' : 'Yes'}
                  </option>
                  <option value="false">
                    {lang === 'ar' ? 'لا' : 'No'}
                  </option>
                </select>
              </div>
            </td>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'منتج الخصم' : 'Discount Product'}
                </label>
                <SearchableSelect
                  options={[]}
                  value={orderDiscountProductId}
                  onChange={(e: any) => setOrderDiscountProductId(e.target.value)}
                  placeholder={lang === 'ar' ? '— choisir produit de réduction —' : '— Select discount product —'}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'SKU الخصم' : 'Discount SKU'}
                </label>
                <input
                  type="text"
                  value={orderDiscountProductSku}
                  onChange={(e: any) => setOrderDiscountProductSku(e.target.value)}
                  className="w-full h-8 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder={lang === 'ar' ? 'SKU الخصم' : 'Discount SKU'}
                />
              </div>
            </td>
          </tr>
        )
      )}

      {/* 9. VAT */}
      {renderTableSection(
        lang === 'ar' ? 'الضريبة' : 'VAT',
        lang === 'ar' ? 'VAT' : 'VAT',
        (
          <tr>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'تفعيل الضريبة' : 'Enable VAT'}
                </label>
                <select
                  className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  value={orderEnableVat}
                  onChange={(e: any) => setOrderEnableVat(e.target.value === 'true')}
                >
                  <option value="true">
                    {lang === 'ar' ? 'نعم' : 'Yes'}
                  </option>
                  <option value="false">
                    {lang === 'ar' ? 'لا' : 'No'}
                  </option>
                </select>
              </div>
            </td>
            <td className={tdClassName}>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'الضريبة السعودية' : 'Saudi Tax'}
                </label>
                <input
                  type="text"
                  value={orderVatSaudiTaxId}
                  onChange={(e: any) => setOrderVatSaudiTaxId(e.target.value)}
                  className="w-full h-8 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder={lang === 'ar' ? 'الضريبة السعودية' : 'Saudi tax ID'}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/80">
                  {lang === 'ar' ? 'الضريبة غير السعودية' : 'Non-Saudi Tax'}
                </label>
                <input
                  type="text"
                  value={orderVatNonSaudiTaxId}
                  onChange={(e: any) => setOrderVatNonSaudiTaxId(e.target.value)}
                  className="w-full h-8 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder={lang === 'ar' ? 'الضريبة غير السعودية' : 'Non-Saudi tax ID'}
                />
              </div>
            </td>
          </tr>
        )
      )}

      {/* 10. Custom Status Field */}
      {renderTableSection(
        lang === 'ar' ? 'حالة الحالة المخصصة' : 'Custom Status Field',
        lang === 'ar' ? 'Custom Status Field' : 'Custom Status Field',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <div className="flex items-center gap-2 p-2 rounded-lg border border-border/70 bg-muted/50 text-xs font-medium">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  {lang === 'ar' ? 'حالة الحقل المخصص' : 'Custom Status Field'}
                </span>
              </div>
            </td>
            <td className={tdClassName} colSpan={2} />

            <td className={tdClassName} colSpan={4} />

            <td className={tdClassName} colSpan={4} />
          </tr>
        )
      )}
    </div>
  )
}