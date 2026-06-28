import type { Metadata } from 'next'
import Link from 'next/link'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getOdooModels, getOdooModelFields } from '@/app/actions/odoo'
import FieldMappingClient from './field-mapping-client'

export const metadata: Metadata = {
  title: 'Field Mapping — ZidLink',
  description: 'ربط الحقول بين منصة زد ونظام أودو (Field Mapping)',
}

export default async function FieldMappingPage() {
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

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {!hasOdooConnection && (
        <div className="flex flex-col sm:flex-row items-start gap-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-amber-800 dark:text-amber-300">
          <AlertCircle className="h-6 w-6 shrink-0 mt-0.5" />
          <div className="space-y-2 flex-1">
            <h4 className="font-bold text-sm">أنت غير متصل بنظام أودو (Odoo not connected)</h4>
            <p className="text-xs leading-relaxed text-muted-foreground">
              يرجى ضبط بيانات الاتصال مع أودو أولاً لتتمكن من جلب النماذج والحقول الحية وتخصيصها. يتم عرض بيانات افتراضية للمعاينة الآن.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2 border-amber-500/20 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-xs font-semibold gap-1.5 rounded-lg">
              <Link href="/dashboard/connect-odoo">
                انتقل لصفحة ربط أودو
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      )}

      <FieldMappingClient 
        initialModels={initialModels || []} 
        hasOdooConnection={hasOdooConnection}
        preloadedModel={preloadedModel}
        preloadedFields={preloadedFields}
      />
    </div>
  )
}
