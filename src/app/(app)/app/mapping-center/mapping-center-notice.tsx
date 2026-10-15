import { AlertCircle, ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Shared "ERP not connected" banner for every Mapping Center section page.
 * Server component — `lang` is resolved by the page and passed in.
 */
export default function MappingCenterNotice({
  lang,
  dir,
  erpType,
}: {
  lang: 'ar' | 'en'
  dir: 'rtl' | 'ltr'
  erpType: string
}) {
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
    <div className="flex flex-col sm:flex-row items-start gap-3 rounded-lg border bg-muted p-3.5" dir={dir}>
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
  )
}
