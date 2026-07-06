import type { Metadata } from 'next'
import { Suspense } from 'react'
import { cookies } from 'next/headers'

import { getActiveWorkspaceZidToken, getActiveWorkspaceSallaToken } from '@/app/actions/workspaces'
import type { Language } from '@/lib/translations'
import { translations } from '@/lib/translations'
import StoreSelector from './store-selector'

export const metadata: Metadata = {
  title: 'ربط المتجر — ZidLink',
  description: 'إدارة وتوصيل متجرك الإلكتروني وقنوات البيع',
}

export default async function ConnectZidPage() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const installUrl = `${appUrl}/api/zid/connect`
  const sallaInstallUrl = `${appUrl}/api/salla/connect`

  const tokenRes = await getActiveWorkspaceZidToken()
  const token = tokenRes.success ? tokenRes.token : null

  const sallaTokenRes = await getActiveWorkspaceSallaToken()
  const sallaToken = sallaTokenRes.success ? sallaTokenRes.token : null

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <div>
        <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          {t('zid.title')}
        </h1>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('zid.desc')}
        </p>
      </div>

      <Suspense fallback={<div className="animate-pulse h-48 rounded-xl bg-muted/40" />}>
        <StoreSelector
          token={token}
          sallaToken={sallaToken}
          installUrl={installUrl}
          sallaInstallUrl={sallaInstallUrl}
          appUrl={appUrl}
          lang={lang}
          dir={dir}
        />
      </Suspense>
    </div>
  )
}
