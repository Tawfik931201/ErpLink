import { Layers } from 'lucide-react'
import Link from 'next/link'

import LanguageSwitcher from '@/components/language-switcher'
import ThemeSwitcher from '@/components/theme-switcher'
import type { Language } from '@/lib/translations'

const dict: Record<Language, Record<string, string>> = {
  ar: {
    'landing.heroSubtitle': 'مزامنة تلقائية وفورية للطلبات والمنتجات والمخزون والعملاء بين متجرك ونظام الـ ERP — دون أي تدخل يدوي.',
    'landing.pricing': 'الأسعار',
    'footer.contact': 'اتصل بنا',
    'footer.privacy': 'الخصوصية',
    'footer.terms': 'الشروط',
    'footer.rights': '© 2024 ERP Link. جميع الحقوق محفوظة.',
  },
  en: {
    'landing.heroSubtitle': 'Real-time automatic sync of orders, products, inventory, and customers between your store and ERP — no manual work.',
    'landing.pricing': 'Pricing',
    'footer.contact': 'Contact Us',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.rights': '© 2024 ERP Link. All rights reserved.',
  },
}

const t = (lang: Language, key: string): string =>
  dict[lang]?.[key] || dict['ar'][key] || key

export function PublicSiteFooter({ lang }: { lang: Language }) {
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
              {t(lang, 'landing.heroSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap gap-8">
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {lang === 'ar' ? 'الصفحات' : 'Pages'}
              </h4>
              <ul className="space-y-1.5">
                <li><Link href="/pricing" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'landing.pricing')}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {lang === 'ar' ? 'الشركة' : 'Company'}
              </h4>
              <ul className="space-y-1.5">
                <li><Link href="/contact" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'footer.contact')}</Link></li>
                <li><Link href="/privacy" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'footer.privacy')}</Link></li>
                <li><Link href="/terms" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'footer.terms')}</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[10px] text-muted-foreground">
            {t(lang, 'footer.rights')}
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
