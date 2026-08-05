import { cookies } from 'next/headers'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { getActiveWorkspaceZidToken, getActiveWorkspaceSallaToken, getActiveWorkspaceShopifyToken } from '@/app/actions/workspaces'
import { Button } from '@/components/ui/button'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

import StockSyncClient from './stock-sync-client'

export const metadata = {
  title: 'Bulk Stock Sync — ErpLink',
  description: 'مزامنة المخزون الجماعية بين المتجر ونظام ERP',
}

export default async function StockSyncPage() {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const [connRes, zidRes, sallaRes, shopifyRes] = await Promise.all([
    getActiveWorkspaceErpConnection(),
    getActiveWorkspaceZidToken(),
    getActiveWorkspaceSallaToken(),
    getActiveWorkspaceShopifyToken(),
  ])

  const hasErp = connRes.success && !!connRes.connection
  const erpType = connRes.success && connRes.connection?.erp_type ? connRes.connection.erp_type : 'odoo'
  const isZidConnected = zidRes.success && !!zidRes.token
  const isSallaConnected = sallaRes.success && !!sallaRes.token
  const isShopifyConnected = shopifyRes.success && !!shopifyRes.token

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <Link href="/dashboard/mapping-center">
            <ArrowLeft className={cn("h-4 w-4", lang === 'ar' && "rotate-180")} />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg font-bold">
            {lang === 'ar' ? 'مزامنة المخزون الجماعية' : 'Bulk Stock Sync'}
          </h1>
          <p className="text-xs text-muted-foreground">
            {lang === 'ar'
              ? 'مزامنة كميات المخزون من المتجر إلى أودو دفعة واحدة'
              : 'Sync stock quantities from your store to Odoo in bulk'}
          </p>
        </div>
      </div>

      <StockSyncClient
        hasErp={hasErp}
        erpType={erpType}
        isZidConnected={isZidConnected}
        isSallaConnected={isSallaConnected}
        isShopifyConnected={isShopifyConnected}
        zidStoreName={zidRes.success && zidRes.token ? (zidRes.token.name || null) : null}
        sallaStoreName={sallaRes.success && sallaRes.token ? (sallaRes.token.store_name || sallaRes.token.name || null) : null}
        shopifyStoreName={shopifyRes.success && shopifyRes.token ? (shopifyRes.token.name || null) : null}
      />
    </div>
  )
}
