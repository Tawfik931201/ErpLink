import { Lock, ArrowLeft, ArrowUpRight, Mail, MessageSquareText } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { LegalTableOfContents } from '@/components/legal/legal-toc'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { privacySections, PRIVACY_LAST_UPDATED } from '@/lib/legal-content'
import { PUBLIC_CONTACT_EMAIL } from '@/lib/public-contact'
import { publicPageMetadata } from '@/lib/public-seo'
import { resolveLanguage, translations, type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

export const generateMetadata = () => publicPageMetadata('/privacy')

function t(lang: Language, key: string): string {
  const dict = translations[lang] as Record<string, string>
  if (dict && dict[key]) return dict[key]
  const fallbackDict = translations['ar'] as Record<string, string>
  if (fallbackDict && fallbackDict[key]) return fallbackDict[key]
  return key
}

export default async function PrivacyPage() {
  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const isAr = lang === 'ar'
  const dir = isAr ? 'rtl' : 'ltr'

  const tocItems = privacySections.map((section) => ({
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
              <Lock className="h-4 w-4" />
              <span>{t(lang, 'privacy.badge')}</span>
            </div>

            <h1 className="text-4xl md:text-5xl font-black text-foreground leading-[1.15] tracking-tight">
              {t(lang, 'privacy.pageTitle')}
            </h1>

            <p className="text-sm font-medium text-muted-foreground">
              {isAr ? `آخر تحديث رسمي: ${PRIVACY_LAST_UPDATED.ar}` : `Last officially updated: ${PRIVACY_LAST_UPDATED.en}`}
            </p>

            {/* Executive Summary Card */}
            <div className="w-full text-start bg-card/80 backdrop-blur-sm border border-border/80 rounded-2xl p-5 md:p-6 shadow-sm mt-2">
              <div className="flex items-center gap-2 mb-2 text-primary font-bold text-xs uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span>{isAr ? 'ملخص سياسة الخصوصية' : 'Executive Privacy Summary'}</span>
              </div>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                {isAr
                  ? 'توضح هذه السياسة كيفية تعامل منصة ERP Link مع البيانات الشخصية والتشغيلية. نؤكد أن التاجر يظل المتحكم الحصري في بيانات متجره وعملائه بينما تعمل المنصة كمعالج تقني لتنفيذ المزامنة فقط. بيانات الاعتماد الحساسة مشفرة في السكون عبر AES-256-GCM، ولا نبيع بياناتك، ولا نستخدم ملفات تتبع إعلانية، ويتم تطهير بيانات مساحة العمل نهائياً برمجياً فور حذفها.'
                  : 'This policy governs how ERP Link handles personal and operational synchronization data. The Merchant remains the exclusive Data Controller of their store records while ERP Link functions strictly as a technical Data Processor. Sensitive credentials are encrypted at rest using authenticated AES-256-GCM. We never sell your data, deploy zero advertising cookies, and systematically purge workspace resources upon deletion.'}
              </p>
            </div>

            {/* Quick Cross-Link Banner */}
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs md:text-sm text-muted-foreground pt-1">
              <span>
                {isAr ? 'هل تبحث عن الشروط والأحكام التعاقدية؟' : 'Looking for our contractual Terms of Service?'}
              </span>
              <Link
                href="/terms"
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline underline-offset-4"
              >
                <span>{isAr ? 'الانتقال إلى الشروط والأحكام' : 'Go to Terms & Conditions'}</span>
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

        {/* Content Section with TOC Sidebar */}
        <section className="py-12 md:py-16 px-6 md:px-12">
          <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-8 lg:gap-12 items-start">
            {/* Sidebar Table of Contents */}
            <aside className="w-full lg:w-72 shrink-0">
              <LegalTableOfContents items={tocItems} lang={lang} />
            </aside>

            {/* Main Legal Sections */}
            <article className="flex-1 w-full max-w-3xl space-y-8">
              {privacySections.map((section) => {
                const content = isAr ? section.ar : section.en
                return (
                  <section
                    key={section.id}
                    id={section.id}
                    className="scroll-mt-28 bg-card border border-border rounded-2xl p-6 md:p-8 shadow-sm transition-all hover:border-border/80"
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
                    {isAr ? 'هل لديك أي استفسار حول الخصوصية وحماية البيانات؟' : 'Have privacy or data protection inquiries?'}
                  </h3>
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                    {isAr
                      ? `يمكنك دائماً التواصل مع مسؤول الخصوصية وحماية البيانات عبر البريد: ${PUBLIC_CONTACT_EMAIL}`
                      : `You can reach our privacy and data protection team directly at: ${PUBLIC_CONTACT_EMAIL}`}
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
