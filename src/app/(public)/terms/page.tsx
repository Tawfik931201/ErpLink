import { Shield, ArrowLeft, ArrowUpRight, Mail, MessageSquareText } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { LegalTableOfContents } from '@/components/legal/legal-toc'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { termsSections, TERMS_LAST_UPDATED } from '@/lib/legal-content'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'
import { publicPageMetadata } from '@/lib/public-seo'
import { resolveLanguage, translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const generateMetadata = () => publicPageMetadata('/terms')

function t(lang: Language, key: string): string {
  const dict = translations[lang] as Record<string, string>
  if (dict && dict[key]) return dict[key]
  const fallbackDict = translations['ar'] as Record<string, string>
  if (fallbackDict && fallbackDict[key]) return fallbackDict[key]
  return key
}

export default async function TermsPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const dir = isAr ? 'rtl' : 'ltr'

  const tocItems = termsSections.map((section) => ({
    id: section.id,
    number: section.number,
    title: isAr ? section.ar.title : section.en.title,
  }))

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip bg-background text-foreground font-sans" dir={dir}>
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="pt-20 pb-12 px-6 md:px-12 relative overflow-hidden bg-secondary/20 border-b border-border/50">
          <div className="absolute top-[-80px] right-[-80px] w-[400px] h-[400px] rounded-full bg-primary/[0.04] blur-3xl pointer-events-none" />
          <div className="absolute bottom-[-80px] left-[-80px] w-[350px] h-[350px] rounded-full bg-foreground/[0.02] blur-3xl pointer-events-none" />

          <div className="max-w-4xl mx-auto flex flex-col items-center text-center gap-6 relative">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold">
              <Shield className="h-4 w-4" />
              <span>{t(lang, 'terms.badge')}</span>
            </div>

            <h1 className="text-4xl md:text-5xl font-black text-foreground leading-[1.15] tracking-tight">
              {t(lang, 'terms.pageTitle')}
            </h1>

            <p className="text-sm font-medium text-muted-foreground">
              {isAr ? `آخر تحديث رسمي: ${TERMS_LAST_UPDATED.ar}` : `Last officially updated: ${TERMS_LAST_UPDATED.en}`}
            </p>

            {/* Executive Summary Card */}
            <div className="w-full text-start bg-card/80 backdrop-blur-sm border border-border/80 rounded-2xl p-5 md:p-6 shadow-sm mt-2">
              <div className="flex items-center gap-2 mb-2 text-primary font-bold text-xs uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span>{isAr ? 'ملخص تمهيدي للشروط' : 'Executive Terms Summary'}</span>
              </div>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                {isAr
                  ? 'تحدد هذه الاتفاقية الإطار القانوني والتشغيلي المنظم لاستخدامك منصة ERP Link لربط المتاجر الإلكترونية مع أنظمة ERP. نؤكد أنك تحتفظ بكامل ملكية بياناتك التجارية، وتخضع عمليات المزامنة لإعداداتك وخياراتك، مع إتاحة فترة تجربة مجانية لمدة 7 أيام ودعم وسائل الدفع اليدوية بالفواتير المعتمدة دون تخزين بيانات بنكية حساسة.'
                  : 'This agreement governs your legal rights and operational responsibilities when using ERP Link to integrate e-commerce stores with ERP software. You retain exclusive ownership of your business data, synchronization logic mirrors your configured mappings, and services include a 7-day free trial with transparent manual bank billing and zero storage of sensitive payment instruments.'}
              </p>
            </div>

            {/* Quick Cross-Link Banner */}
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs md:text-sm text-muted-foreground pt-1">
              <span>
                {isAr ? 'هل تبحث عن سياسة الخصوصية وحماية البيانات؟' : 'Looking for our Privacy & Data Protection Policy?'}
              </span>
              <Link
                href="/privacy"
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline underline-offset-4"
              >
                <span>{isAr ? 'الانتقال إلى سياسة الخصوصية' : 'Go to Privacy Policy'}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors pt-2"
            >
              <ArrowLeft className={cn('h-3.5 w-3.5', isAr ? 'rotate-180' : '')} />
              <span>{isAr ? 'العودة إلى الصفحة الرئيسية' : 'Back to Home'}</span>
            </Link>
          </div>
        </section>

        {/* Full-Width Sticky Table of Contents */}
        <LegalTableOfContents items={tocItems} lang={lang} />

        {/* Content Section */}
        <section className="py-12 md:py-16 px-6 md:px-12">
          <div className="max-w-4xl mx-auto space-y-8">
            <article className="space-y-8">
              {termsSections.map((section) => {
                const content = isAr ? section.ar : section.en
                return (
                  <section
                    key={section.id}
                    id={section.id}
                    className="scroll-mt-36 bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm transition-all hover:border-border/80"
                  >
                    <header className="flex items-start gap-3.5 mb-4 border-b border-border/40 pb-4">
                      <span className="flex h-7 px-2.5 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono text-xs font-bold shrink-0 mt-0.5">
                        {String(section.number).padStart(2, '0')}
                      </span>
                      <div>
                        <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
                          {content.title}
                        </h2>
                        {content.summary && (
                          <p className="text-xs md:text-sm text-muted-foreground/80 mt-1">
                            {content.summary}
                          </p>
                        )}
                      </div>
                    </header>

                    <div className="space-y-4 text-sm md:text-base text-muted-foreground leading-[1.85]">
                      {content.paragraphs.map((paragraph, idx) => (
                        <p key={idx} className="whitespace-pre-line">
                          {paragraph}
                        </p>
                      ))}

                      {content.bullets && content.bullets.length > 0 && (
                        <ul className="space-y-2.5 pt-1">
                          {content.bullets.map((bullet, idx) => (
                            <li key={idx} className="flex items-start gap-2.5">
                              <span className="flex h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-2.5" />
                              <span className="flex-1">{bullet}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>
                )
              })}

              {/* Bottom Official Support Card */}
              <div className="bg-secondary/30 border border-border rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="space-y-1.5 text-center md:text-start">
                  <h3 className="text-base md:text-lg font-bold text-foreground">
                    {isAr ? 'هل لديك أي استفسار قانوني أو تعاقدي؟' : 'Have legal or contractual questions?'}
                  </h3>
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                    {isAr
                      ? `فريق الدعم الفني والقانوني متاح للإجابة على استفساراتك عبر البريد: ${PUBLIC_CONTACT_EMAIL}`
                      : `Our technical and legal support team is ready to answer inquiries at: ${PUBLIC_CONTACT_EMAIL}`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <a
                    href={`mailto:${PUBLIC_CONTACT_EMAIL}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs md:text-sm hover:opacity-90 transition-opacity shadow-sm"
                  >
                    <Mail className="h-4 w-4" />
                    <span>{isAr ? 'راسلنا مباشرة' : 'Email Us'}</span>
                  </a>
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border text-foreground font-semibold text-xs md:text-sm hover:bg-muted/60 transition-colors shadow-sm"
                  >
                    <MessageSquareText className="h-4 w-4" />
                    <span>{isAr ? 'نموذج التواصل' : 'Contact Form'}</span>
                  </Link>
                </div>
              </div>
            </article>
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
