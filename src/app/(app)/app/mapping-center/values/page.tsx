import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { resolveLanguage } from '@/lib/translations'

import { getFirstPlatform, getMappingCenterConnection } from '../mapping-center-data'
import MappingCenterHeader from '../mapping-center-header'
import MappingCenterNotice from '../mapping-center-notice'
import StaticMappingEditor from '../static-mapping-editor'

export const metadata: Metadata = {
  title: 'تحويل القيم — مركز الربط — ErpLink',
  description: 'ربط القيم الثابتة بين المتجر ونظام ERP',
}

export default async function ValueMappingPage() {
  const { erpType, hasErpConnection, zidStores, sallaStores, shopifyStores } =
    await getMappingCenterConnection()

  // The editor loads its own rows per table + platform and lets the user
  // switch platform inside — the server only picks the initial one.
  const defaultPlatform = getFirstPlatform(zidStores, sallaStores, shopifyStores)

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <MappingCenterHeader erpType={erpType} />

      {!hasErpConnection && (
        <MappingCenterNotice lang={lang} dir={dir} erpType={erpType} />
      )}

      <div className="max-w-7xl mx-auto space-y-5 pt-[33px] md:pt-[25px]" dir={dir}>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-semibold text-muted-foreground">
              {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
            </span>
            <span className="text-muted-foreground/30 text-xs">{'/'}</span>
            <h1 className="text-xl font-extrabold tracking-tight text-foreground">
              {lang === 'ar' ? 'تحويل القيم' : 'Value Mapping'}
            </h1>
          </div>
          <p className="text-muted-foreground text-[11px]">
            {lang === 'ar'
              ? 'ربط القيم الثابتة بين المتجر ونظام ERP (طرق الدفع، الشحن، المستودعات، العملات، الضرائب)'
              : 'Map static values between store and ERP (payment methods, shipping, warehouses, currencies, taxes)'}
          </p>
        </div>
        <StaticMappingEditor storeType={defaultPlatform} />
      </div>
    </div>
  )
}
