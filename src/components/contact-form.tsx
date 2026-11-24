'use client'

import {
  Building2,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Send,
  User,
} from 'lucide-react'
import { useState } from 'react'

import { submitContact } from '@/app/actions/contact'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const FIELD_CLASS =
  'h-11 w-full rounded-xl border border-border bg-background/70 ps-10 pe-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/45 focus:bg-card focus:ring-2 focus:ring-primary/10'
const ICON_CLASS = 'pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70'
const LABEL_CLASS = 'mb-1.5 block text-[11px] font-semibold text-muted-foreground'

export function ContactForm({ lang }: { lang: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const isAr = lang === 'ar'

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('loading')
    setErrorCode(null)

    const formData = new FormData(e.currentTarget)
    const result = await submitContact(formData)

    if (result.success) {
      setStatus('success')
      return
    }

    setErrorCode(result.error ?? null)
    setStatus('error')
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center px-2 py-8 text-center">
        <span className="rise-in flex h-14 w-14 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
          <Check className="h-6 w-6" />
        </span>
        <h2 className="rise-in mt-5 text-xl font-black tracking-tight" style={{ animationDelay: '60ms' }}>
          {isAr ? 'وصلتنا رسالتك' : 'Message received'}
        </h2>
        <p
          className="rise-in mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground"
          style={{ animationDelay: '120ms' }}
        >
          {isAr
            ? 'سنراجع رسالتك ونرد عليك على البريد الذي كتبته. لا حاجة لإرسالها مرة أخرى.'
            : 'We will review your message and reply to the email you provided. No need to send it again.'}
        </p>
        <button
          type="button"
          onClick={() => setStatus('idle')}
          className="mt-6 text-xs font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          {isAr ? 'إرسال رسالة أخرى' : 'Send another message'}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className={LABEL_CLASS}>
            {isAr ? 'الاسم الكامل' : 'Full name'}
            <span className="ms-1 text-primary">*</span>
          </label>
          <div className="relative">
            <User className={ICON_CLASS} />
            <input
              id="contact-name"
              type="text"
              name="name"
              required
              autoComplete="name"
              className={FIELD_CLASS}
              placeholder={isAr ? 'مثال: أحمد محمد' : 'e.g. John Doe'}
            />
          </div>
        </div>

        <div>
          <label htmlFor="contact-email" className={LABEL_CLASS}>
            {isAr ? 'البريد الإلكتروني' : 'Email'}
            <span className="ms-1 text-primary">*</span>
          </label>
          <div className="relative">
            <Mail className={ICON_CLASS} />
            <input
              id="contact-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              dir="ltr"
              className={cn(FIELD_CLASS, 'text-start')}
              placeholder="name@company.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="contact-phone" className={LABEL_CLASS}>
            {isAr ? 'رقم الجوال' : 'Phone'}
            <span className="ms-1 text-primary">*</span>
          </label>
          <div className="relative">
            <Phone className={ICON_CLASS} />
            <input
              id="contact-phone"
              type="tel"
              name="phone"
              required
              autoComplete="tel"
              dir="ltr"
              className={cn(FIELD_CLASS, 'text-start')}
              placeholder={isAr ? '05xxxxxxxx' : '+966 5x xxx xxxx'}
            />
          </div>
        </div>

        <div>
          <label htmlFor="contact-company" className={LABEL_CLASS}>
            {isAr ? 'الشركة / المتجر' : 'Company / store'}
            <span className="ms-1 text-primary">*</span>
          </label>
          <div className="relative">
            <Building2 className={ICON_CLASS} />
            <input
              id="contact-company"
              type="text"
              name="company"
              required
              autoComplete="organization"
              className={FIELD_CLASS}
              placeholder={isAr ? 'اسم الشركة' : 'Company name'}
            />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="contact-message" className={LABEL_CLASS}>
          {isAr ? 'الرسالة' : 'Message'}
          <span className="ms-1 text-primary">*</span>
        </label>
        <div className="relative">
          <MessageSquare className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground/70" />
          <textarea
            id="contact-message"
            name="message"
            required
            rows={5}
            className={cn(FIELD_CLASS, 'h-auto resize-y py-2.5')}
            placeholder={
              isAr
                ? 'اشرح طلبك بإيجاز — اذكر اسم المنصة أو رقم الطلب إن وُجد.'
                : 'Briefly describe your request — mention the platform or order number if any.'
            }
          />
        </div>
      </div>

      {status === 'error' && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/[0.06] px-3.5 py-2.5 text-xs font-medium text-destructive"
        >
          {errorCode === 'rate_limited'
            ? isAr
              ? 'أرسلت عدة رسائل في وقت قصير. انتظر عشر دقائق ثم أعد المحاولة.'
              : 'You sent several messages in a short time. Please wait ten minutes and try again.'
            : isAr
              ? 'لم يتم إرسال الرسالة. تحقق من الاتصال وحاول مرة أخرى.'
              : 'Your message was not sent. Check your connection and try again.'}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {isAr
            ? 'تُستخدم بياناتك للرد على رسالتك فقط.'
            : 'Your details are only used to reply to this message.'}
        </p>
        <Button
          type="submit"
          variant="brand"
          disabled={status === 'loading'}
          className="h-11 w-full rounded-xl px-6 text-sm font-bold sm:w-auto sm:min-w-[150px]"
        >
          {status === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className={cn('h-4 w-4', isAr && '-scale-x-100')} />
          )}
          {status === 'loading' ? (isAr ? 'جاري الإرسال...' : 'Sending...') : isAr ? 'إرسال الرسالة' : 'Send message'}
        </Button>
      </div>
    </form>
  )
}
