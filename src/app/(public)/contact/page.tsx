import { Mail } from 'lucide-react'
import { cookies } from 'next/headers'

import { ContactForm } from '@/components/contact-form'
import { PublicSiteFooter } from '@/components/public-site-footer'
import { PublicSiteHeader } from '@/components/public-site-header'
import { resolveLanguage } from '@/lib/translations'

export default function ContactPage() {
  const cookieStore = cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div
      className="flex min-h-screen flex-col bg-background text-foreground font-sans overflow-x-hidden"
      dir={dir}
    >
      <PublicSiteHeader lang={lang} />

      <main className="flex-1">
        <section className="pt-20 pb-24 px-6 md:px-12 relative">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col items-center text-center gap-6 max-w-3xl mx-auto mb-16">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-muted border border-border">
                <Mail className="h-3 w-3 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {lang === 'ar' ? 'تواصل معنا' : 'Contact Us'}
                </span>
              </div>

              <h1 className="text-4xl md:text-5xl font-black text-foreground leading-[1.15] tracking-tight">
                {lang === 'ar' ? 'نحن هنا لمساعدتك' : "We're Here to Help"}
              </h1>

              <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
                {lang === 'ar'
                  ? 'تواصل معنا لأي استفسار أو سؤال — سنعود إليك في أقرب وقت.'
                  : 'Reach out for any inquiry or question — we will get back to you as soon as possible.'}
              </p>
            </div>

            <ContactForm lang={lang} />
          </div>
        </section>
      </main>

      <PublicSiteFooter lang={lang} />
    </div>
  )
}
