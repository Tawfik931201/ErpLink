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

interface CustomerSettingsTabProps {
  lang: string
  dir?: string
  customerDefaultType: string
  setCustomerDefaultType: (val: string) => void
  receivableAccountId: string
  setReceivableAccountId: (val: string) => void
  payableAccountId: string
  setPayableAccountId: (val: string) => void
  receivableAccountOptions: { value: string; label: string }[]
  payableAccountOptions: { value: string; label: string }[]
  isLoadingAccounts: boolean
  companyOptions: { value: string; label: string }[]
  isLoadingCompanies: boolean
  customerCompanyId: string
  setCustomerCompanyId: (val: string) => void
  customerLinkCompany: boolean
  setCustomerLinkCompany: (val: boolean) => void
  customerOnDelete: string
  setCustomerOnDelete: (val: string) => void
  customerMatchZidField: string
  setCustomerMatchZidField: (val: string) => void
  customerMatchOdooField: string
  setCustomerMatchOdooField: (val: string) => void
  customerEnabledActions: string[]
  setCustomerEnabledActions: (val: string[]) => void
  customerDisabled: boolean
  setCustomerDisabled: (val: boolean) => void
  isSavingCustomers: boolean
  handleSaveCustomers: () => void
  setIsLogOpen: (val: boolean) => void
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

export function CustomerSettingsTab({
  lang,
  dir: _dir,
  customerDefaultType,
  setCustomerDefaultType,
  receivableAccountId,
  setReceivableAccountId,
  payableAccountId,
  setPayableAccountId,
  receivableAccountOptions,
  payableAccountOptions,
  isLoadingAccounts,
  companyOptions,
  isLoadingCompanies,
  customerCompanyId,
  setCustomerCompanyId,
  customerLinkCompany,
  setCustomerLinkCompany,
  customerOnDelete,
  setCustomerOnDelete,
  customerMatchZidField,
  setCustomerMatchZidField,
  customerMatchOdooField,
  setCustomerMatchOdooField,
  customerEnabledActions,
  setCustomerEnabledActions,
  customerDisabled,
  setCustomerDisabled,
  isSavingCustomers,
  handleSaveCustomers,
  setIsLogOpen,
}: any) {
  const syncActionOptions = [
    { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
    { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
    { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
  ]

  return (
    <div className="space-y-4">
      {/* 1. Default Customer Type */}
      {renderTableSection(
        lang === 'ar' ? 'نوع العميل الافتراضي' : 'Default Customer Type',
        lang === 'ar' ? 'Default Customer Type' : 'Default Customer Type',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={customerDefaultType}
                onChange={(e) => setCustomerDefaultType(e.target.value)}
              >
                <option value="auto">{lang === 'ar' ? 'تلقائي' : 'Auto'}</option>
                <option value="create_new">{lang === 'ar' ? 'إنشاء عميل جديد' : 'Create New Customer'}</option>
                <option value="skip_order">{lang === 'ar' ? 'تجاهل الطلب' : 'Skip Order'}</option>
                <option value="default_customer">{lang === 'ar' ? 'عميل افتراضي' : 'Default Customer'}</option>
              </select>
            </td>
          </tr>
        )
      )}

      {/* 2. Receivable Account */}
      {renderTableSection(
        lang === 'ar' ? 'حساب مسترد' : 'Receivable Account',
        lang === 'ar' ? 'Receivable Account' : 'Receivable Account',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={receivableAccountId}
                onChange={(e) => setReceivableAccountId(e.target.value)}
              >
                <option value="">
                  {lang === 'ar' ? '— اختر الحساب —' : '— Select Account —'}
                </option>
                {receivableAccountOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        )
      )}

      {/* 3. Payable Account */}
      {renderTableSection(
        lang === 'ar' ? 'حساب مدفوع' : 'Payable Account',
        lang === 'ar' ? 'Payable Account' : 'Payable Account',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={payableAccountId}
                onChange={(e) => setPayableAccountId(e.target.value)}
              >
                <option value="">
                  {lang === 'ar' ? '— اختر الحساب —' : '— Select Account —'}
                </option>
                {payableAccountOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        )
      )}

      {/* 4. Company */}
      {renderTableSection(
        lang === 'ar' ? 'الشركة' : 'Company',
        lang === 'ar' ? 'Company' : 'Company',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <select
                className="w-full h-9 px-3 rounded-lg border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                value={customerCompanyId}
                onChange={(e) => setCustomerCompanyId(e.target.value)}
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

      {customerCompanyId && (
        <div className="p-3 rounded-xl border border-border/70 bg-muted/50 text-xs font-medium">
          <span>
            {lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
          </span>
        </div>
      )}

      {/* 5. Sync Actions & Status */}
      {renderTableSection(
        lang === 'ar' ? 'إعدادات المزامنة' : 'Sync Actions & Status',
        lang === 'ar' ? 'Sync Actions & Status' : 'Sync Actions & Status',
        (
          <tr>
            <td className={tdClassName} colSpan={2}>
              <div className="flex items-center gap-2 p-2 rounded-lg border border-border/70 bg-muted/50 text-xs font-medium">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>
                  {lang === 'ar' ? 'تفعيل مزامنة العملاء' : 'Enable Customer Sync'}
                </span>
              </div>
            </td>
            <td className={tdClassName} colSpan={2} />

            <td className={tdClassName} colSpan={4}>
              <SearchableSelect
                multiple={true}
                collapseTags={false}
                value={customerEnabledActions}
                onChange={setCustomerEnabledActions}
                options={syncActionOptions}
                disabled={customerDisabled}
                placeholder={
                  lang === 'ar'
                    ? customerDisabled
                      ? '— المزامنة معطلة —'
                      : '— اختر العمليات المصرح بها —'
                    : customerDisabled
                      ? '— Sync is disabled —'
                      : '— Select operations —'
                }
              />
            </td>
          </tr>
        )
      )}

      {/* Action Footer */}
      <div className="pt-2 flex flex-wrap items-center gap-2.5">
        <Button
          onClick={handleSaveCustomers}
          disabled={isSavingCustomers}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl h-10 px-6 text-xs shadow-sm gap-2 transition-all"
        >
          <Save className="h-4 w-4" />
          <span>{lang === 'ar' ? 'حفظ إعدادات العملاء' : 'Save Customer Settings'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsLogOpen(true)}
          className="rounded-xl h-10 px-4 text-xs gap-2 border-border/80 hover:bg-muted/50"
        >
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'سجل مزامنة العملاء' : 'Customer Sync Log'}</span>
        </Button>
      </div>
    </div>
  )
}