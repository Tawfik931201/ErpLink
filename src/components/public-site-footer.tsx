import Link from 'next/link'

import { Logo } from '@/components/ui/logo'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'
import type { Language } from '@/lib/translations'

const dict: Record<Language, Record<string, string>> = {
  ar: {
    'landing.heroSubtitle': 'مزامنة تلقائية وفورية للطلبات والمنتجات والمخزون والعملاء بين متجرك ونظام الـ ERP — دون أي تدخل يدوي.',
    'landing.pricing': 'الأسعار',
    'footer.about': 'من نحن',
    'footer.supportEmail': 'البريد الإلكتروني للتواصل',
    'footer.contact': 'اتصل بنا',
    'footer.privacy': 'الخصوصية',
    'footer.terms': 'الشروط',
    'footer.rights': '© 2026 ERP Link. جميع الحقوق محفوظة.',
  },
  en: {
    'landing.heroSubtitle': 'Real-time automatic sync of orders, products, inventory, and customers between your store and ERP — no manual work.',
    'landing.pricing': 'Pricing',
    'footer.about': 'About',
    'footer.supportEmail': 'Contact email',
    'footer.contact': 'Contact Us',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.rights': '© 2026 ERP Link. All rights reserved.',
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
            <Link href="/" className="flex items-center" aria-label="ErpLink Home">
              <Logo variant="horizontal" size="sm" />
            </Link>
            <p className="text-[11px] text-muted-foreground leading-relaxed mt-2 max-w-xs">
              {t(lang, 'landing.heroSubtitle')}
            </p>
          </div>

          <div className="flex flex-wrap gap-8">
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {lang === 'ar' ? 'المعرفة والتوثيق' : 'Knowledge & Docs'}
              </h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="/guides"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-foreground/90 hover:text-primary transition-colors"
                  >
                    <span>{lang === 'ar' ? 'مركز المعرفة والأدلة الفنية' : 'Knowledge'}</span>
                  </Link>
                </li>
                <li>
                  <Link
                    href="/docs"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-foreground/90 hover:text-primary transition-colors"
                  >
                    <span>{lang === 'ar' ? 'التوثيق ودليل الاستخدام' : 'Documentation'}</span>
                  </Link>
                </li>
                <li>
                  <Link href="/integrations" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">
                    {lang === 'ar' ? 'ربط المتاجر بأودوو' : 'Odoo Integrations'}
                  </Link>
                </li>
                <li>
                  <Link href="/integrations/zid-odoo" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">
                    {lang === 'ar' ? 'ربط زد بأودوو' : 'Zid + Odoo'}
                  </Link>
                </li>
                <li>
                  <Link href="/integrations/salla-odoo" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">
                    {lang === 'ar' ? 'ربط سلة بأودوو' : 'Salla + Odoo'}
                  </Link>
                </li>
                <li>
                  <Link href="/integrations/shopify-odoo" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">
                    {lang === 'ar' ? 'ربط شوبيفاي بأودوو' : 'Shopify + Odoo'}
                  </Link>
                </li>
                <li>
                  <Link href="/pricing" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">
                    {t(lang, 'landing.pricing')}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {lang === 'ar' ? 'الشركة' : 'Company'}
              </h4>
              <ul className="space-y-1.5">
                <li><Link href="/about" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'footer.about')}</Link></li>
                <li><Link href="/contact" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'footer.contact')}</Link></li>
                <li><Link href="/privacy" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'footer.privacy')}</Link></li>
                <li><Link href="/terms" className="text-[11px] text-foreground/60 hover:text-foreground transition-colors">{t(lang, 'footer.terms')}</Link></li>
                <li><a href={`mailto:${PUBLIC_CONTACT_EMAIL}`} className="text-[11px] text-foreground/60 hover:text-foreground transition-colors" aria-label={t(lang, 'footer.supportEmail')}>{PUBLIC_CONTACT_EMAIL}</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-6 flex items-center justify-center">
          <p className="text-[10px] text-muted-foreground">
            {t(lang, 'footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  )
}
