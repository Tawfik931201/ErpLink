'use client'

import {
  AlertTriangle,
  Building2,
  CreditCard,
  GitCompare,
  History,
  Loader2,
  RefreshCw,
  Save,
  Sliders,
  Trash2,
  Users,
} from 'lucide-react'
import React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import SearchableSelect from '../searchable-select'

import { SettingCard, SettingToggle } from './setting-card'

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
  customerCompanyId: string
  setCustomerCompanyId: (val: string) => void
  customerLinkCompany: boolean
  setCustomerLinkCompany: (val: boolean) => void
  isLoadingCompanies: boolean
  companyOptions: { value: string; label: string }[]
  customerOnDelete: string
  setCustomerOnDelete: (val: string) => void
  customerMatchZidField: string
  setCustomerMatchZidField: (val: string) => void
  customerMatchOdooField: string
  setCustomerMatchOdooField: (val: string) => void
  customerFields: { value: string; label: string }[]
  odooCustomerFields: { value: string; label: string }[]
  isLoadingCustomerFields: boolean
  fetchOdooCustomerFields: (force?: boolean) => void
  customerEnabledActions: string[]
  setCustomerEnabledActions: (val: string[]) => void
  customerDisabled: boolean
  setCustomerDisabled: (val: boolean) => void
  isSavingCustomers: boolean
  handleSaveCustomers: () => void
  setIsLogOpen: (val: boolean) => void
}

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
  customerCompanyId,
  setCustomerCompanyId,
  customerLinkCompany,
  setCustomerLinkCompany,
  isLoadingCompanies,
  companyOptions,
  customerOnDelete,
  setCustomerOnDelete,
  customerMatchZidField,
  setCustomerMatchZidField,
  customerMatchOdooField,
  setCustomerMatchOdooField,
  customerFields,
  odooCustomerFields,
  isLoadingCustomerFields,
  fetchOdooCustomerFields,
  customerEnabledActions,
  setCustomerEnabledActions,
  customerDisabled,
  setCustomerDisabled,
  isSavingCustomers,
  handleSaveCustomers,
  setIsLogOpen,
}: CustomerSettingsTabProps) {
  const syncActionOptions = [
    { value: 'create', label: lang === 'ar' ? 'إنشاء (Create)' : 'Create' },
    { value: 'update', label: lang === 'ar' ? 'تعديل (Update)' : 'Update' },
    { value: 'delete', label: lang === 'ar' ? 'حذف (Delete)' : 'Delete' },
  ]

  return (
    <div className="space-y-4">
      {/* 1. Customer Type */}
      <SettingCard
        icon={<Users className="h-4 w-4 text-primary" />}
        title={lang === 'ar' ? 'نوع العميل الافتراضي' : 'Default Customer Type'}
        description={
          lang === 'ar'
            ? 'تحديد طبيعة الحساب (فرد أو شركة) المنشأ في أودو للعملاء الجدد'
            : 'Specify whether new customers in Odoo should be treated as individuals or companies'
        }
      >
        <div className="max-w-md space-y-1.5">
          <label className="block text-xs font-medium text-foreground/80">
            {lang === 'ar' ? 'طبيعة حساب العميل' : 'Customer Account Type'}
          </label>
          <select
            className="w-full h-9 px-3 rounded-none border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            value={customerDefaultType}
            onChange={(e) => setCustomerDefaultType(e.target.value)}
          >
            <option value="auto">
              {lang === 'ar' ? 'تلقائي (تحديد فرد أو شركة حسب الحقول)' : 'Auto (Detect individual/company)'}
            </option>
            <option value="person">{lang === 'ar' ? 'فرد (Individual)' : 'Individual (Person)'}</option>
            <option value="company">{lang === 'ar' ? 'شركة (Company)' : 'Company'}</option>
          </select>
        </div>
      </SettingCard>

      {/* 2. Accounting Accounts */}
      <SettingCard
        icon={<CreditCard className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'الحسابات المحاسبية الافتراضية' : 'Default Accounts'}
        description={
          lang === 'ar'
            ? 'تحديد حسابات المدينين والدائنين في دفتر الأستاذ للعملاء الجدد في أودو'
            : 'Default receivable and payable ledger accounts for customer records in Odoo'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'حساب المدينين (Account Receivable)' : 'Account Receivable'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-none border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={receivableAccountId}
              onChange={(e) => setReceivableAccountId(e.target.value)}
              disabled={isLoadingAccounts}
            >
              <option value="">
                {lang === 'ar' ? '— اختر حساب المدينين —' : '— Select Account Receivable —'}
              </option>
              {receivableAccountOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'حساب الدائنين (Account Payable)' : 'Account Payable'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-none border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
              value={payableAccountId}
              onChange={(e) => setPayableAccountId(e.target.value)}
              disabled={isLoadingAccounts}
            >
              <option value="">
                {lang === 'ar' ? '— اختر حساب الدائنين —' : '— Select Account Payable —'}
              </option>
              {payableAccountOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </SettingCard>

      {/* 3. Company */}
      <SettingCard
        icon={<Building2 className="h-4 w-4 text-sky-600" />}
        title={lang === 'ar' ? 'الشركة الافتراضية (Odoo Company)' : 'Default Company'}
        description={
          lang === 'ar'
            ? 'تحديد الشركة التابع لها العميل لضمان اتساق الحسابات المحاسبية'
            : 'Specify the Odoo company associated with customer records'
        }
      >
        <div className="space-y-3">
          <div className="max-w-md space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'اختر الشركة' : 'Company'}
            </label>
            <select
              className="w-full h-9 px-3 rounded-none border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
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
          </div>

          {customerCompanyId && (
            <div className="pt-2">
              <SettingToggle
                checked={customerLinkCompany}
                onChange={setCustomerLinkCompany}
                label={lang === 'ar' ? 'ربط وتحديد الشركة بالسجل في أودو' : 'Link and set company on the Odoo record'}
                description={
                  lang === 'ar'
                    ? 'يضمن قصر وصول واستخدام العميل داخل الشركة المحددة فقط'
                    : 'Restricts the customer record to the chosen company in Odoo'
                }
              />
            </div>
          )}
        </div>
      </SettingCard>

      {/* 4. On Delete */}
      <SettingCard
        icon={<Trash2 className="h-4 w-4 text-amber-600" />}
        title={lang === 'ar' ? 'إجراء الحذف في المتجر' : 'On Store Deletion'}
        description={
          lang === 'ar'
            ? 'الإجراء المتخذ في أودو عند حذف العميل من المتجر الإلكتروني'
            : 'Action taken in Odoo when a customer is deleted in the store'
        }
      >
        <div className="max-w-md space-y-1.5">
          <label className="block text-xs font-medium text-foreground/80">
            {lang === 'ar' ? 'الإجراء في أودو' : 'Action in Odoo'}
          </label>
          <select
            className="w-full h-9 px-3 rounded-none border border-input bg-background/80 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
            value={customerOnDelete}
            onChange={(e) => setCustomerOnDelete(e.target.value)}
          >
            {[
              { value: 'nothing', labelAr: 'لا شيء (تجاهل الحذف)', labelEn: 'Nothing' },
              { value: 'delete', labelAr: 'حذف من أودو', labelEn: 'Delete' },
              { value: 'archive', labelAr: 'أرشفة السجل (Active = false)', labelEn: 'Archive (Active = false)' },
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

      {/* 5. Match Field */}
      <SettingCard
        icon={<GitCompare className="h-4 w-4 text-indigo-600" />}
        title={lang === 'ar' ? 'حقل المطابقة والمزامنة' : 'Match Field'}
        description={
          lang === 'ar'
            ? 'حدد الحقل في المتجر المقابل لحقل أودو للتعرف على العميل وتجنب تكرار بياناته'
            : 'Select store and Odoo fields used to match customers and prevent duplication'
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/80">
              {lang === 'ar' ? 'حقل المتجر' : 'Store Field'}
            </label>
            <SearchableSelect
              options={customerFields}
              value={customerMatchZidField}
              onChange={setCustomerMatchZidField}
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
                onClick={() => fetchOdooCustomerFields(true)}
                disabled={isLoadingCustomerFields}
                className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 text-[11px] flex items-center gap-1"
                title={lang === 'ar' ? 'تحديث حقول أودو' : 'Refresh Odoo Fields'}
              >
                <RefreshCw className={cn('h-3 w-3', isLoadingCustomerFields && 'animate-spin')} />
                <span>{lang === 'ar' ? 'تحديث' : 'Refresh'}</span>
              </button>
            </div>
            <SearchableSelect
              options={odooCustomerFields}
              value={customerMatchOdooField}
              onChange={setCustomerMatchOdooField}
              placeholder={lang === 'ar' ? '— اختر حقل أودو —' : '— Select Odoo field —'}
              disabled={isLoadingCustomerFields}
            />
          </div>
        </div>
      </SettingCard>

      {/* 6. Sync Actions */}
      <SettingCard
        icon={<Sliders className="h-4 w-4 text-emerald-600" />}
        title={lang === 'ar' ? 'إعدادات وعمليات المزامنة' : 'Sync Operations & Rules'}
        description={
          lang === 'ar'
            ? 'حدد العمليات المسموح بها لبيانات العملاء وحالة التفعيل الشاملة'
            : 'Select permitted operations and toggle customer synchronization'
        }
      >
        <div className="space-y-4">
          <SettingToggle
            checked={!customerDisabled}
            onChange={(active) => setCustomerDisabled(!active)}
            label={lang === 'ar' ? 'تفعيل مزامنة العملاء' : 'Enable Customer Sync'}
            description={
              lang === 'ar'
                ? 'عند التعطيل لن يتم إنشاء أو تعديل أي سجل عميل في أودو'
                : 'When disabled, no customers will be created, updated, or deleted in Odoo'
            }
          />

          {customerDisabled && (
            <div className="flex items-center gap-2 p-3 rounded-none border border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {lang === 'ar'
                  ? 'مزامنة العملاء معطلة حالياً — لن تنعكس أي تغييرات على أودو.'
                  : 'Customer sync is disabled — changes will not propagate to Odoo.'}
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
          </div>
        </div>
      </SettingCard>

      {/* Action Footer */}
      <div className="pt-2 flex flex-wrap items-center gap-2.5">
        <Button
          onClick={handleSaveCustomers}
          disabled={isSavingCustomers}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-none h-10 px-6 text-xs shadow-sm gap-2 transition-all"
        >
          {isSavingCustomers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          <span>{lang === 'ar' ? 'حفظ إعدادات العملاء' : 'Save Customer Settings'}</span>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => setIsLogOpen(true)}
          className="rounded-none h-10 px-4 text-xs gap-2 border-border/80 hover:bg-muted/50"
        >
          <History className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{lang === 'ar' ? 'سجل مزامنة العملاء' : 'Customer Sync Log'}</span>
        </Button>
      </div>
    </div>
  )
}
