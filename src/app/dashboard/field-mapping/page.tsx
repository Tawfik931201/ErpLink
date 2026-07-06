import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOdooModels, getOdooModelFields, getActiveWorkspaceErpConnection } from '@/app/actions/odoo'
import { getActiveWorkspaceZidToken, getActiveWorkspaceSallaToken } from '@/app/actions/workspaces'
import { getFixedMappings } from '@/app/actions/fixed-mappings'
import FieldMappingClient from './field-mapping-client'
import { Language, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Field Mapping — ZidLink',
  description: 'ربط الحقول بين منصة زد ونظام ERP (Field Mapping)',
}

export default async function FieldMappingPage() {
  const connRes = await getActiveWorkspaceErpConnection()
  const erpType = connRes.success && connRes.connection?.erp_type ? connRes.connection.erp_type : 'odoo'
  const hasErpConnection = connRes.success && !!connRes.connection

  const modelsRes = await getOdooModels()
  const initialModels = (modelsRes.success && modelsRes.models) ? modelsRes.models : []

  // Retrieve store connection tokens
  const zidTokenRes = await getActiveWorkspaceZidToken()
  const sallaTokenRes = await getActiveWorkspaceSallaToken()
  const isZidConnected = zidTokenRes.success && !!zidTokenRes.token
  const isSallaConnected = sallaTokenRes.success && !!sallaTokenRes.token

  // Prefetch fields for the primary model on the server to prevent loading lag
  let preloadedFields: any[] = []
  let preloadedModel = ''
  if (hasErpConnection && initialModels.length > 0) {
    preloadedModel = initialModels[0].model
    const fieldsRes = await getOdooModelFields(preloadedModel)
    if (fieldsRes.success && fieldsRes.fields) {
      preloadedFields = fieldsRes.fields
    }
  }

  // Fetch fixed mappings
  const fixedMappingsRes = await getFixedMappings()
  const initialFixedMappings = fixedMappingsRes.success ? fixedMappingsRes.mappings : []

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

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
        <div className="flex flex-col sm:flex-row items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="space-y-1.5 flex-1">
            <h4 className="font-bold text-xs">
              {lang === 'ar' ? `أنت غير متصل بنظام ${getErpName(erpType)}` : `${getErpNameEn(erpType)} is not connected`}
            </h4>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {lang === 'ar' 
                ? `يرجى ضبط بيانات الاتصال مع ${getErpName(erpType)} أولاً لتتمكن من جلب النماذج والحقول الحية وتخصيصها. يتم عرض بيانات افتراضية للمعاينة الآن.` 
                : `Please configure your ${getErpNameEn(erpType)} connection first to retrieve live models and fields. Showing offline demo data for preview now.`}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1 border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[10px] h-7 font-semibold gap-1 rounded-lg">
              <Link href="/dashboard/connect-odoo">
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
        zidStoreName={zidTokenRes.success && zidTokenRes.token ? (zidTokenRes.token.name || null) : null}
        sallaStoreName={sallaTokenRes.success && sallaTokenRes.token ? (sallaTokenRes.token.store_name || sallaTokenRes.token.name || null) : null}
        initialFixedMappings={initialFixedMappings}
      />
    </div>
  )
}
