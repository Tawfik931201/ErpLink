import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { resolveLanguage } from '@/lib/translations'

import { getMappingCenterConnection } from './mapping-center-data'
import MappingCenterNotice from './mapping-center-notice'
import StandardMappingClient from './standard-mapping-client'

export const metadata: Metadata = {
  title: 'Mapping Center — ErpLink',
  description: 'تخصيص ربط الحقول وإعدادات المزامنة بين المتجر ونظام ERP',
}

export default async function MappingCenterPage(
  props: {
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
  }
) {
  const searchParams = await props.searchParams
  const subtabParam = typeof searchParams?.subtab === 'string' ? searchParams.subtab : undefined
  const initialSubTab = subtabParam === 'orders' || subtabParam === 'products' || subtabParam === 'customers'
    ? subtabParam
    : undefined

  // Standard mapping needs only the connection + store lists.
  // Odoo models/fields are fetched lazily per entity tab inside the client,
  // so this page never pays for the custom-mapping form data.
  const { erpType, hasErpConnection, zidStores, sallaStores, shopifyStores } =
    await getMappingCenterConnection()

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      {!hasErpConnection && (
        <MappingCenterNotice lang={lang} dir={dir} erpType={erpType} />
      )}

      <StandardMappingClient
        hasOdooConnection={hasErpConnection}
        erpType={erpType}
        zidStores={zidStores}
        sallaStores={sallaStores}
        shopifyStores={shopifyStores}
        initialSubTab={initialSubTab}
      />
    </div>
  )
}
