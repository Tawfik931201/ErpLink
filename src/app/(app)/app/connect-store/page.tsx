import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { Suspense } from 'react'

import { getActiveWorkspaceZidTokens, getActiveWorkspaceSallaTokens, getActiveWorkspaceShopifyTokens } from '@/app/actions/workspaces'
import { resolveLanguage } from '@/lib/translations'

import StoreSelector from './store-selector'

export const metadata: Metadata = {
  title: 'ربط المتجر — ErpLink',
  description: 'إدارة وتوصيل متجرك الإلكتروني وقنوات البيع',
}

export default async function ConnectZidPage() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const installUrl = `${baseUrl}/api/zid/connect`
  const sallaInstallUrl = `${baseUrl}/api/salla/connect`

  const tokenRes = await getActiveWorkspaceZidTokens()
  const zidTokens = tokenRes.success ? tokenRes.tokens : []

  const sallaTokenRes = await getActiveWorkspaceSallaTokens()
  const sallaTokens = sallaTokenRes.success ? sallaTokenRes.tokens : []

  const shopifyTokenRes = await getActiveWorkspaceShopifyTokens()
  const shopifyTokens = shopifyTokenRes.success ? shopifyTokenRes.tokens : []

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <div>
        <div className="mb-1 flex items-center gap-2">
          <div className="h-6 w-1 rounded-full bg-primary" />
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {lang === 'ar' ? 'المتجر' : 'Stores'}
          </h1>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {lang === 'ar'
            ? 'إدارة وتوصيل متجرك الإلكتروني وقنوات البيع.'
            : 'Manage and connect your online store and sales channels.'}
        </p>
      </div>

      {!tokenRes.success && (
        <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          {lang === 'ar'
            ? 'تعذر تحميل متاجر زد المتصلة. أعد تحميل الصفحة، وإذا استمرت المشكلة تواصل مع الدعم.'
            : 'Could not load connected Zid stores. Reload the page, or contact support if the problem continues.'}
        </p>
      )}

      <Suspense fallback={<div className="animate-pulse h-48 rounded-xl bg-muted/40" />}>
        <StoreSelector
          zidTokens={zidTokens}
          sallaTokens={sallaTokens}
          shopifyTokens={shopifyTokens}
          installUrl={installUrl}
          sallaInstallUrl={sallaInstallUrl}
          lang={lang}
          dir={dir}
        />
      </Suspense>
    </div>
  )
}
