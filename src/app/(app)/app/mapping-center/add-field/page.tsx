import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { MappingCenterHeader } from '@/components/mapping-center/mapping-center-header'
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
        <MappingCenterHeader
          title={lang === 'ar' ? 'إضافة حقل' : 'Add Field'}
          subtitle={lang === 'ar'
            ? 'إضافة حقل مخصص لنظام ERP'
            : 'Add a custom field to your ERP system'}
          dir={dir}
        />
        <AddCustomFieldForm
          initialModels={[]}
          hasOdooConnection={hasErpConnection}
          erpType={erpType}
        />
      </div>
    </div>
  )
}
