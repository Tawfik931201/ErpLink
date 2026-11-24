import { ArrowLeft, ArrowRight, Zap } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import type { Language } from '@/lib/translations'

interface GuideCtaProps {
  lang: Language
  title?: string
  subtitle?: string
}

export function GuideCta({ lang, title, subtitle }: GuideCtaProps) {
  const isAr = lang === 'ar'
  const Arrow = isAr ? ArrowLeft : ArrowRight

  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-8 md:p-12 shadow-sm">
      <div className="blueprint-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />

      <div className="relative max-w-2xl">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
          <Zap className="h-3 w-3" />
          <span>{isAr ? 'تكامل فوري وموثوق' : 'Instant & Reliable Sync'}</span>
        </div>

        <h3 className="mt-4 text-2xl font-black tracking-tight text-foreground md:text-3xl">
          {title || (isAr ? 'جاهز لربط متجرك بنظام ERP؟' : 'Ready to connect your store to ERP?')}
        </h3>

        <p className="mt-3 text-xs leading-relaxed text-muted-foreground md:text-sm">
          {subtitle ||
            (isAr
              ? 'اربط متجرك في زد أو سلة أو شوبيفاي بنظام أودوو خلال دقائق، ونسّق الطلبات والمنتجات والمخزون والفواتير بدقة وتلقائية.'
              : 'Connect your Zid, Salla, or Shopify store with Odoo in minutes. Automate orders, products, inventory, and customer invoicing with zero friction.')}
        </p>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button asChild size="default" variant="brand" className="h-10 text-xs font-bold px-5">
            <Link href="/sign-up">
              <span>{isAr ? 'ابدأ باستخدام ERP Link' : 'Start with ERP Link'}</span>
              <Arrow className="h-3.5 w-3.5 ms-1.5" />
            </Link>
          </Button>

          <Button asChild size="default" variant="outline" className="h-10 text-xs font-bold px-5">
            <Link href="/integrations">
              <span>{isAr ? 'استكشف التكاملات' : 'Explore Integrations'}</span>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
