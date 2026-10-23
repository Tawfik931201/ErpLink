import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { Suspense } from 'react'

import {
  getActiveWorkspaceZidTokens,
  getActiveWorkspaceSallaTokens,
  getActiveWorkspaceShopifyTokens,
} from '@/app/actions/workspaces'
import { resolveLanguage } from '@/lib/translations'

import StoreSelector from '../../store-selector'

export const metadata: Metadata = {
  title: 'تفاصيل المتجر — ErpLink',
  description: 'حالة اتصال المتجر والتنبيهات وإعدادات المزامنة',
}

type DetailPageProps = {
  params: Promise<{ platform: string; slug: string }>
}

export default async function ConnectStoreDetailPage({ params }: DetailPageProps) {
  const { platform, slug } = await params

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const installUrl = `${baseUrl}/api/zid/connect`
  const sallaInstallUrl = `${baseUrl}/api/salla/connect`

  const [zidTokenRes, sallaTokenRes, shopifyTokenRes] = await Promise.all([
    getActiveWorkspaceZidTokens(),
    getActiveWorkspaceSallaTokens(),
    getActiveWorkspaceShopifyTokens(),
  ])
  const zidTokens = zidTokenRes.success ? zidTokenRes.tokens : []
  const sallaTokens = sallaTokenRes.success ? sallaTokenRes.tokens : []
  const shopifyTokens = shopifyTokenRes.success ? shopifyTokenRes.tokens : []

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <div>
        <div className="mb-1 flex items-center gap-2 text-xl font-bold tracking-tight">
          <div className="h-6 w-1 rounded-full bg-primary" />
          <Link
            href="/app/connect-store"
            className="text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            {lang === 'ar' ? 'المتجر' : 'Stores'}
          </Link>
          <span className="text-muted-foreground/40 font-normal" aria-hidden="true">/</span>
          <h1 className="text-foreground">
            {lang === 'ar' ? 'تفاصيل المتجر' : 'Store details'}
          </h1>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {lang === 'ar'
            ? 'حالة الاتصال والتنبيهات وإعدادات المزامنة لهذا المتجر.'
            : 'Connection, webhook health and sync settings for this store.'}
        </p>
      </div>

      <Suspense fallback={<div className="animate-pulse h-48 rounded-xl bg-muted/40" />}>
        <StoreSelector
          zidTokens={zidTokens}
          sallaTokens={sallaTokens}
          shopifyTokens={shopifyTokens}
          installUrl={installUrl}
          sallaInstallUrl={sallaInstallUrl}
          lang={lang}
          dir={dir}
          initialPlatform={platform}
          initialSlug={slug}
        />
      </Suspense>
    </div>
  )
}
