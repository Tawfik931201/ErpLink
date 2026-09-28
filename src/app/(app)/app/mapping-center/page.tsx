import { AlertCircle, ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { getOdooModels, getOdooModelFields, getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { getActiveWorkspaceZidToken, getActiveWorkspaceSallaToken, getActiveWorkspaceShopifyToken } from '@/app/actions/workspaces'
import { Button } from '@/components/ui/button'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

import FieldMappingClient from './field-mapping-client'

export const metadata: Metadata = {
  title: 'Mapping Center — ErpLink',
  description: 'تخصيص ربط الحقول وإعدادات المزامنة بين المتجر ونظام ERP',
}

export default async function MappingCenterPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const subtabParam = typeof searchParams?.subtab === 'string' ? searchParams.subtab : undefined
  const initialSubTab = subtabParam === 'orders' || subtabParam === 'products' || subtabParam === 'customers'
    ? subtabParam
    : undefined

  const [connRes, zidTokenRes, sallaTokenRes, shopifyTokenRes] = await Promise.all([
    getActiveWorkspaceErpConnection(),
    getActiveWorkspaceZidToken(),
    getActiveWorkspaceSallaToken(),
    getActiveWorkspaceShopifyToken(),
  ])

  const erpType = connRes.success && connRes.connection?.erp_type ? connRes.connection.erp_type : 'odoo'
  const hasErpConnection = connRes.success && !!connRes.connection
  const isZidConnected = zidTokenRes.success && !!zidTokenRes.token
  const isSallaConnected = sallaTokenRes.success && !!sallaTokenRes.token
  const isShopifyConnected = shopifyTokenRes.success && !!shopifyTokenRes.token

  let initialModels: any[] = []
  let preloadedFields: any[] = []
  let preloadedModel = ''

  if (hasErpConnection) {
    const modelsRes = await getOdooModels()
    if (modelsRes.success && modelsRes.models) {
      initialModels = modelsRes.models
      if (initialModels.length > 0) {
        preloadedModel = initialModels[0].model
        const fieldsRes = await getOdooModelFields(preloadedModel)
        if (fieldsRes.success && fieldsRes.fields) {
          preloadedFields = fieldsRes.fields
        }
      }
    }
  }

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const getErpName = (type: string) => {
    if (type === 'odoo') return 'أودو ERP'
    if (type === 'zoho') return 'زوهو ERP'
    if (type === 'erpnext') return 'ERPNext'
    return 'ERP'
  }
  const getErpNameEn = (type: string) => {
    if (type === 'odoo') return 'Odoo ERP'
    if (type === 'zoho') return 'Zoho ERP'
    if (type === 'erpnext') return 'ERPNext'
    return 'ERP'
  }

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      
      {!hasErpConnection && (
        <div className="flex flex-col sm:flex-row items-start gap-3 rounded-lg border bg-muted p-3.5">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="space-y-1.5 flex-1">
            <h4 className="font-bold text-xs text-foreground">
              {lang === 'ar' ? `أنت غير متصل بنظام ${getErpName(erpType)}` : `${getErpNameEn(erpType)} is not connected`}
            </h4>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {lang === 'ar' 
                ? `يرجى ضبط بيانات الاتصال مع ${getErpName(erpType)} أولاً لتتمكن من جلب النماذج والحقول الحية وتخصيصها. يتم عرض بيانات افتراضية للمعاينة الآن.` 
                : `Please configure your ${getErpNameEn(erpType)} connection first to retrieve live models and fields. Showing offline demo data for preview now.`}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1 text-[10px] h-7 font-semibold gap-1 rounded-lg">
              <Link href="/app/connect-odoo">
                {lang === 'ar' ? `انتقل لصفحة ربط الـ ERP` : `Go to Connect ERP`}
                <ArrowRight className={cn("h-3 w-3", lang === 'ar' ? "rotate-180" : "")} />
              </Link>
            </Button>
          </div>
        </div>
      )}

      <FieldMappingClient 
        initialModels={initialModels || []} 
        hasOdooConnection={hasErpConnection}
        erpType={erpType}
        preloadedModel={preloadedModel}
        preloadedFields={preloadedFields}
        isZidConnected={isZidConnected}
        isSallaConnected={isSallaConnected}
        isShopifyConnected={isShopifyConnected}
        zidStoreName={zidTokenRes.success && zidTokenRes.token ? (zidTokenRes.token.name || null) : null}
        sallaStoreName={sallaTokenRes.success && sallaTokenRes.token ? (sallaTokenRes.token.store_name || sallaTokenRes.token.name || null) : null}
        shopifyStoreName={shopifyTokenRes.success && shopifyTokenRes.token ? (shopifyTokenRes.token.name || null) : null}
        initialSubTab={initialSubTab}
      />
    </div>
  )
}

