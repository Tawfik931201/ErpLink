import { HelpCircle } from 'lucide-react'

import type { GuideFaq } from '@/lib/knowledge-center/types'
import type { Language } from '@/lib/translations'

interface GuideFaqProps {
  faqs: GuideFaq[]
  lang: Language
}

export function GuideFaqSection({ faqs, lang }: GuideFaqProps) {
  const isAr = lang === 'ar'
  if (!faqs || faqs.length === 0) return null

  return (
    <section className="mt-16 rounded-3xl border border-border bg-card/60 p-6 md:p-10">
      <div className="flex items-center gap-2.5 text-primary">
        <HelpCircle className="h-5 w-5" />
        <h2 className="text-xl font-black text-foreground md:text-2xl">
          {isAr ? 'الأسئلة الشائعة حول هذا الموضوع' : 'Frequently Asked Questions'}
        </h2>
      </div>

      <div className="mt-6 divide-y divide-border border-y border-border">
        {faqs.map((faq, idx) => (
          <div key={idx} className="py-5">
            <h3 className="text-sm font-bold text-foreground md:text-base">
              {faq.question[lang]}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground md:text-sm">
              {faq.answer[lang]}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
