import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { resolveLanguage } from '@/lib/translations'

import CustomMappingClient from '../custom-mapping-client'
import {
  getFirstStoreId,
  getMappingCenterConnection,
  getMappingCenterModels,
  getMappingCenterPreloadedFields,
} from '../mapping-center-data'
import MappingCenterHeader from '../mapping-center-header'
import MappingCenterNotice from '../mapping-center-notice'

export const metadata: Metadata = {
  title: 'تخصيص الربط — مركز الربط — ErpLink',
  description: 'ربط وتخصيص كيفية انتقال الحقول بين المتجر ونظام ERP',
}

export default async function CustomMappingPage() {
  const { erpType, hasErpConnection, zidStores, sallaStores, shopifyStores } =
    await getMappingCenterConnection()

  // The create/edit form needs the Odoo model catalogue + first-model fields.
  const initialModels = await getMappingCenterModels(hasErpConnection)
  const { preloadedModel, preloadedFields } = await getMappingCenterPreloadedFields(initialModels)

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <MappingCenterHeader erpType={erpType} />

      {!hasErpConnection && (
        <MappingCenterNotice lang={lang} dir={dir} erpType={erpType} />
      )}

      <CustomMappingClient
        initialModels={initialModels || []}
        hasOdooConnection={hasErpConnection}
        erpType={erpType}
        preloadedModel={preloadedModel}
        preloadedFields={preloadedFields}
        isZidConnected={zidStores.length > 0}
        isSallaConnected={sallaStores.length > 0}
        isShopifyConnected={shopifyStores.length > 0}
        zidStores={zidStores}
        sallaStores={sallaStores}
        shopifyStores={shopifyStores}
        defaultStoreKey={getFirstStoreId(zidStores, sallaStores, shopifyStores)}
      />
    </div>
  )
}
