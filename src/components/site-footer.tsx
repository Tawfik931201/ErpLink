'use client'

import { Layers } from 'lucide-react'
import Link from 'next/link'

import { useLanguage } from '@/components/language-provider'
import LanguageSwitcher from '@/components/language-switcher'
import ThemeSwitcher from '@/components/theme-switcher'

export function SiteFooter() {
  const { lang, t } = useLanguage()

  return (
    <footer className="border-t border-border py-10 bg-muted/30">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <div className="flex flex-col md:flex-row items-start justify-between gap-8 mb-8">
          <div>
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-foreground text-background">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-bold text-foreground">
                ERP Link
              </span>
            </Link>
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-2 max-w-xs">
              {t('landing.heroSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap gap-8">
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {lang === 'ar' ? 'الصفحات' : 'Pages'}
              </h4>
              <ul className="space-y-1.5">
                <li><Link href="/pricing" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t('landing.pricing')}</Link></li>
                <li><Link href="/partners" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{lang === 'ar' ? 'الشركاء' : 'Partners'}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {lang === 'ar' ? 'الشركة' : 'Company'}
              </h4>
              <ul className="space-y-1.5">
                <li><Link href="/contact" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t('footer.contact')}</Link></li>
                <li><Link href="/privacy" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t('footer.privacy')}</Link></li>
                <li><Link href="/terms" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t('footer.terms')}</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground">
            {t('footer.rights')}
          </p>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher />
          </div>
        </div>
      </div>
    </footer>
  )
}
