import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { getActiveWorkspaceSallaToken, getActiveWorkspaceShopifyToken, getActiveWorkspaceZidToken } from '@/app/actions/workspaces'
import { getActiveWorkspaceId } from '@/lib/auth'
import { autoBootstrapWorkspace } from '@/lib/auto-bootstrap'
import { resolveLanguage, translations } from '@/lib/translations'

import SetupWizard from './SetupWizard'

export const metadata: Metadata = {
  title: 'الإعداد السريع — ErpLink',
  description: 'معالج الإعداد السريع لربط متجرك بنظام الـ ERP وبدء المزامنة',
}

export default async function SetupPage() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
  const installUrl = `${baseUrl}/api/zid/connect`
  const sallaInstallUrl = `${baseUrl}/api/salla/connect`

  const [zidRes, sallaRes, shopifyRes, odooRes] = await Promise.all([
    getActiveWorkspaceZidToken(),
    getActiveWorkspaceSallaToken(),
    getActiveWorkspaceShopifyToken(),
    getActiveWorkspaceErpConnection(),
  ])

  const connectedStores: { id: 'zid' | 'salla' | 'shopify'; name: string }[] = []
  if (zidRes.success && zidRes.token) connectedStores.push({ id: 'zid', name: 'زد / Zid' })
  if (sallaRes.success && sallaRes.token) connectedStores.push({ id: 'salla', name: 'سلة / Salla' })
  if (shopifyRes.success && shopifyRes.token) connectedStores.push({ id: 'shopify', name: 'شوبيفاي / Shopify' })

  const odooConnected = !!(odooRes.success && odooRes.connection)
  const odooConnectionName = odooRes.success && odooRes.connection ? (odooRes.connection.connection_name || null) : null

  // Ensure workspace defaults are bootstrapped if both are connected
  if (odooConnected || connectedStores.length > 0) {
    getActiveWorkspaceId().then((wsId) => {
      if (wsId) autoBootstrapWorkspace(wsId).catch(() => {})
    }).catch(() => {})
  }

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  return (
    <div className="max-w-3xl mx-auto space-y-5 animate-in fade-in duration-300" dir={dir}>
      <div>
        <h1 className="text-base font-semibold tracking-tight text-foreground">{t('setup.title')}</h1>
        <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
          {t('setup.subtitle')}
        </p>
      </div>

      <SetupWizard
        lang={lang}
        dir={dir}
        connectedStores={connectedStores}
        odooConnected={odooConnected}
        odooConnectionName={odooConnectionName}
        installUrl={installUrl}
        sallaInstallUrl={sallaInstallUrl}
      />
    </div>
  )
}
