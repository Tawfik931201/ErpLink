import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOdooModels, getOdooModelFields } from '@/app/actions/odoo'
import TransferClient from './transfer-client'
import { Language, translations } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Initial Data Transfer — ZidLink',
  description: 'نقل البيانات من متجر زد إلى نظام أودو (Initial Data Transfer)',
}

export default async function InitialTransferPage() {
  const modelsRes = await getOdooModels()
  
  const hasOdooConnection = modelsRes.success
  const initialModels = modelsRes.success ? modelsRes.models : []

  // Prefetch fields for the primary model on the server to prevent loading lag
  let preloadedFields: any[] = []
  let preloadedModel = ''
  if (hasOdooConnection && initialModels.length > 0) {
    preloadedModel = initialModels[0].model
    const fieldsRes = await getOdooModelFields(preloadedModel)
    if (fieldsRes.success && fieldsRes.fields) {
      preloadedFields = fieldsRes.fields
    }
  }

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  return (
    <div className="w-full max-w-[95%] mx-auto space-y-4 animate-in fade-in duration-300" dir={dir}>
      
      {!hasOdooConnection && (
        <div className="flex flex-col sm:flex-row items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="space-y-1.5 flex-1">
            <h4 className="font-bold text-xs">{lang === 'ar' ? 'أنت غير متصل بنظام أودو ERP' : 'Odoo ERP is not connected'}</h4>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {lang === 'ar' 
                ? 'يرجى ضبط بيانات الاتصال مع أودو أولاً لتتمكن من جلب النماذج والحقول الحية وتخصيصها. يتم عرض بيانات افتراضية للمعاينة الآن.' 
                : 'Please configure your Odoo connection first to retrieve live models and fields. Showing offline demo data for preview now.'}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-1 border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[10px] h-7 font-semibold gap-1 rounded-lg">
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
        preloadedModel={preloadedModel}
        preloadedFields={preloadedFields}
      />
    </div>
  )
}
