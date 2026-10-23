import { ChevronLeft, ChevronRight } from 'lucide-react'
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
        <div className="mb-1 flex items-center gap-2">
          <div className="h-6 w-1 rounded-full bg-primary" />
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {lang === 'ar' ? 'تفاصيل المتجر' : 'Store details'}
          </h1>
          <Link
            href="/app/connect-store"
            aria-label={lang === 'ar' ? 'رجوع إلى المتاجر' : 'Back to stores'}
            title={lang === 'ar' ? 'رجوع إلى المتاجر' : 'Back to stores'}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
          >
            {dir === 'rtl' ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </Link>
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
