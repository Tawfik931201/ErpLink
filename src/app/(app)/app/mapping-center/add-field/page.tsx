import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { resolveLanguage } from '@/lib/translations'

import AddCustomFieldForm from '../add-custom-field-form'
import MappingCenterNotice from '../mapping-center-notice'

export const metadata: Metadata = {
  title: 'إضافة حقل — مركز الربط — ErpLink',
  description: 'إضافة حقل مخصص لنظام ERP',
}

export default async function AddFieldPage() {
  // Fast path: this page needs ONLY the ERP connection. The old code called
  // getMappingCenterConnection() (1 user lookup + 4 Supabase selects for
  // erp/zid/salla/shopify, none of the store lists are used here) and then
  // blocked the whole render on getOdooModels() — an Odoo XML-RPC round-trip
  // over ir.model (1000+ rows) that the default "list" view never uses.
  // Models + groups now load lazily on the client, only when the form view opens.
  const connRes = await getActiveWorkspaceErpConnection()
  const erpType = connRes.success && connRes.connection?.erp_type ? connRes.connection.erp_type : 'odoo'
  const hasErpConnection = connRes.success && !!connRes.connection

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      {!hasErpConnection && (
        <MappingCenterNotice lang={lang} dir={dir} erpType={erpType} />
      )}

      <div className="max-w-7xl mx-auto space-y-5" dir={dir}>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-semibold text-muted-foreground">
              {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
            </span>
            <span className="text-muted-foreground/30 text-xs">{'/'}</span>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              {lang === 'ar' ? 'إضافة حقل' : 'Add Field'}
            </h1>
          </div>
          <p className="text-muted-foreground text-[11px]">
            {lang === 'ar' ? 'إضافة حقل مخصص لنظام ERP' : 'Add a custom field to your ERP system'}
          </p>
        </div>
        <AddCustomFieldForm
          initialModels={[]}
          hasOdooConnection={hasErpConnection}
          erpType={erpType}
        />
      </div>
    </div>
  )
}
