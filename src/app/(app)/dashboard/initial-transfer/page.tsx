import { AlertCircle, ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { getOdooModels, getOdooModelFields } from '@/app/actions/odoo'
import { Button } from '@/components/ui/button'
import { getActiveWorkspaceId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Language} from '@/lib/translations';
import { cn } from '@/lib/utils'

import TransferClient from './transfer-client'

export const metadata: Metadata = {
  title: 'Initial Data Transfer — ErpLink',
  description: 'نقل البيانات من متجر زد إلى نظام أودو (Initial Data Transfer)',
}

export type ConnectedPlatform = 'zid' | 'salla' | 'shopify'

export interface ConnectedStore {
  platform: ConnectedPlatform
  label: string
  identifier: string // merchant_id or shop_domain
  storeId?: string   // zid store_id (if available)
}

export default async function InitialTransferPage() {
  const modelsRes = await getOdooModels()
  
  const hasOdooConnection = modelsRes.success
  const initialModels = modelsRes.success ? modelsRes.models : []

  // Prefetch fields for the primary model on the server to prevent loading lag
  let preloadedFields: any[] = []
  let preloadedModel = ''
  if (hasOdooConnection && initialModels && initialModels.length > 0) {
    preloadedModel = initialModels[0].model
    const fieldsRes = await getOdooModelFields(preloadedModel)
    if (fieldsRes.success && fieldsRes.fields) {
      preloadedFields = fieldsRes.fields
    }
  }

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // Detect connected stores for the active workspace
  const connectedStores: ConnectedStore[] = []
  const workspaceId = await getActiveWorkspaceId()

  if (workspaceId) {
    // Check Zid
    const { data: zidTok } = await supabase
      .from('merchant_tokens')
      .select('merchant_id, store_id, name')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (zidTok) {
      connectedStores.push({
        platform: 'zid',
        label: zidTok.name || zidTok.merchant_id,
        identifier: zidTok.merchant_id,
        storeId: zidTok.store_id || undefined,
      })
    }

    // Check Salla
    const { data: sallaTok } = await supabase
      .from('salla_tokens')
      .select('merchant_id, store_name, name')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (sallaTok) {
      connectedStores.push({
        platform: 'salla',
        label: sallaTok.store_name || sallaTok.name || sallaTok.merchant_id,
        identifier: sallaTok.merchant_id,
      })
    }

    // Check Shopify
    const { data: shopifyTok } = await supabase
      .from('shopify_tokens')
      .select('shop_domain, name')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (shopifyTok) {
      connectedStores.push({
        platform: 'shopify',
        label: shopifyTok.name || shopifyTok.shop_domain,
        identifier: shopifyTok.shop_domain,
      })
    }
  }

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      
      {!hasOdooConnection && (
        <div className="flex flex-col sm:flex-row items-start gap-3 rounded-lg border bg-muted p-3.5">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="space-y-1.5 flex-1">
            <h4 className="font-bold text-xs text-foreground">{lang === 'ar' ? 'أنت غير متصل بنظام أودو ERP' : 'Odoo ERP is not connected'}</h4>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {lang === 'ar' 
                ? 'يرجى ضبط بيانات الاتصال مع أودو أولاً لتتمكن من جلب النماذج والحقول الحية وتخصيصها. يتم عرض بيانات افتراضية للمعاينة الآن.' 
                : 'Please configure your Odoo connection first to retrieve live models and fields. Showing offline demo data for preview now.'}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1 text-[10px] h-7 font-semibold gap-1 rounded-lg">
              <Link href="/dashboard/connect-odoo">
                {lang === 'ar' ? 'انتقل لصفحة ربط أودو' : 'Go to Connect Odoo'}
                <ArrowRight className={cn("h-3 w-3", lang === 'ar' ? "rotate-180" : "")} />
              </Link>
            </Button>
          </div>
        </div>
      )}

      <TransferClient 
        initialModels={initialModels || []} 
        hasOdooConnection={hasOdooConnection}
        preloadedFields={preloadedFields}
        connectedStores={connectedStores}
      />
    </div>
  )
}
