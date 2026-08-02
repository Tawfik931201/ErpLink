'use client'

import { Mail, Phone, Building2, User, MessageSquare, Check, Send } from 'lucide-react'
import { useState } from 'react'

import { submitContact } from '@/app/actions/contact'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ContactForm({ lang }: { lang: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('loading')

    const formData = new FormData(e.currentTarget)
    const result = await submitContact(formData)

    setStatus(result.success ? 'success' : 'error')
  }

  if (status === 'success') {
    return (
      <div className="max-w-lg mx-auto text-center">
        <div className="bg-card border border-border p-10">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background">
              <Check className="h-6 w-6" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">
            {lang === 'ar' ? 'تم استلام رسالتك!' : 'Message Received!'}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {lang === 'ar'
              ? 'شكراً لتواصلك معنا. سنقوم بمراجعة رسالتك والرد عليك في أقرب وقت.'
              : 'Thank you for reaching out. We will review your message and get back to you shortly.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-4">
      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
          {lang === 'ar' ? 'الاسم الكامل' : 'Full Name'} *
        </label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type="text"
            name="name"
            required
            className="w-full bg-card border border-border pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30 transition-colors"
            placeholder={lang === 'ar' ? 'مثال: أحمد محمد' : 'e.g. John Doe'}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
          {lang === 'ar' ? 'البريد الإلكتروني' : 'Email'} *
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type="email"
            name="email"
            required
            className="w-full bg-card border border-border pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30 transition-colors"
            placeholder={lang === 'ar' ? 'مثال: Ahmed@example.com' : 'e.g. john@example.com'}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
          {lang === 'ar' ? 'رقم الجوال' : 'Phone Number'} *
        </label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type="tel"
            name="phone"
            required
            className="w-full bg-card border border-border pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30 transition-colors"
            placeholder={lang === 'ar' ? 'مثال: 0501234567' : 'e.g. +966 50 123 4567'}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
          {lang === 'ar' ? 'الشركة' : 'Company'} *
        </label>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type="text"
            name="company"
            required
            className="w-full bg-card border border-border pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30 transition-colors"
            placeholder={lang === 'ar' ? 'اسم الشركة' : 'Company name'}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-muted-foreground mb-1.5">
          {lang === 'ar' ? 'الرسالة' : 'Message'} *
        </label>
        <div className="relative">
          <MessageSquare className="absolute left-3 top-3 h-4 w-4 text-muted-foreground/50" />
          <textarea
            name="message"
            required
            rows={5}
            className="w-full bg-card border border-border pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-foreground/30 transition-colors resize-y"
            placeholder={lang === 'ar' ? 'اكتب رسالتك هنا...' : 'Write your message here...'}
          />
        </div>
      </div>

      {status === 'error' && (
        <div className="bg-card border border-border p-3 text-center">
          <p className="text-[11px] text-foreground">
            {lang === 'ar'
              ? 'فشل في إرسال البيانات، حاول مرة أخرى لاحقاً'
              : 'Failed to send your message, please try again later'}
          </p>
        </div>
      )}

      <Button
        type="submit"
        disabled={status === 'loading'}
        className="w-full bg-foreground text-background hover:bg-foreground/90 h-10 text-xs font-bold px-5 disabled:opacity-50"
      >
        <Send className={cn('h-3.5 w-3.5', lang === 'ar' ? 'ml-1.5' : 'mr-1.5')} />
        {status === 'loading'
          ? (lang === 'ar' ? 'جاري الإرسال...' : 'Sending...')
          : (lang === 'ar' ? 'إرسال' : 'Send Message')}
      </Button>
    </form>
  )
}
