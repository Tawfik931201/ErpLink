import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Suspense } from 'react'

import { getActiveWorkspaceZidToken, getActiveWorkspaceSallaToken, getActiveWorkspaceShopifyToken } from '@/app/actions/workspaces'
import type { Language } from '@/lib/translations'
import { translations } from '@/lib/translations'

import StoreSelector from './store-selector'

export const metadata: Metadata = {
  title: 'ربط المتجر — ErpLink',
  description: 'إدارة وتوصيل متجرك الإلكتروني وقنوات البيع',
}

export default async function ConnectZidPage() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const installUrl = `${baseUrl}/api/zid/connect`
  const sallaInstallUrl = `${baseUrl}/api/salla/connect`

  const tokenRes = await getActiveWorkspaceZidToken()
  const token = tokenRes.success ? tokenRes.token : null

  const sallaTokenRes = await getActiveWorkspaceSallaToken()
  const sallaToken = sallaTokenRes.success ? sallaTokenRes.token : null

  const shopifyTokenRes = await getActiveWorkspaceShopifyToken()
  const shopifyToken = shopifyTokenRes.success ? shopifyTokenRes.token : null

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">
          {t('zid.title')}
        </h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
          {t('zid.desc')}
        </p>
        <ol className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <li><span className="font-semibold text-foreground">1.</span> {lang === 'ar' ? 'اختر منصتك' : 'Pick your platform'}</li>
          <li><span className="font-semibold text-foreground">2.</span> {lang === 'ar' ? 'وافق على الصلاحيات' : 'Approve permissions'}</li>
          <li><span className="font-semibold text-foreground">3.</span> {lang === 'ar' ? 'المزامنة تعمل تلقائياً' : 'Sync runs automatically'}</li>
        </ol>
      </div>

      <Suspense fallback={<div className="animate-pulse h-48 rounded-xl bg-muted/40" />}>
        <StoreSelector
          token={token}
          sallaToken={sallaToken}
          shopifyToken={shopifyToken}
          installUrl={installUrl}
          sallaInstallUrl={sallaInstallUrl}
          lang={lang}
          dir={dir}
        />
      </Suspense>
    </div>
  )
}
