import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { resolveLanguage } from '@/lib/translations'

import { getMappingCenterConnection } from '../mapping-center-data'
import MappingCenterHeader from '../mapping-center-header'
import MappingCenterNotice from '../mapping-center-notice'
import StandardMappingClient from '../standard-mapping-client'

export const metadata: Metadata = {
  title: 'Category Mapping — Mapping Center — ErpLink',
  description: 'إعدادات ربط التصنيفات بين المتجر وأودو',
}

export default async function CategoriesPage() {
  const { erpType, hasErpConnection, zidStores, sallaStores, shopifyStores } =
    await getMappingCenterConnection()

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <MappingCenterHeader erpType={erpType} />

      {!hasErpConnection && (
        <MappingCenterNotice lang={lang} dir={dir} erpType={erpType} />
      )}

      <StandardMappingClient
        hasOdooConnection={hasErpConnection}
        erpType={erpType}
        zidStores={zidStores}
        sallaStores={sallaStores}
        shopifyStores={shopifyStores}
        initialSubTab="categories"
      />
    </div>
  )
}
