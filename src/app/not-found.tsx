import { FileQuestion, Home, LifeBuoy } from 'lucide-react'
import { cookies } from 'next/headers'
import Link from 'next/link'

import type { Language } from '@/lib/translations'

export default function GlobalNotFound() {
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  const isAr = lang === 'ar'

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 md:p-8" dir={dir}>
      <div className="w-full max-w-xl mx-auto space-y-4 animate-in fade-in duration-300">
        {/* Header section matching Connect Store header style */}
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            {isAr ? 'الصفحة غير موجودة (404)' : 'Page Not Found (404)'}
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
            {isAr 
              ? 'يبدو أن الصفحة التي تحاول الوصول إليها غير موجودة أو تم نقلها.' 
              : 'The page you are trying to access does not exist or has been moved.'}
          </p>
        </div>

        {/* Card component matching StoreSelector table/panel borders and colors */}
        <div className="border border-border bg-card overflow-hidden">
          {/* Card Title Toolbar */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2 bg-muted/30">
            <span className="text-[11px] font-medium text-foreground">
              {isAr ? 'خطأ في المسار' : 'Route Error'}
            </span>
            <span className="text-[11px] text-muted-foreground font-mono">404_NOT_FOUND</span>
          </div>

          {/* Card Content */}
          <div className="p-6 flex flex-col items-center text-center space-y-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/30">
              <FileQuestion className="h-6 w-6 text-muted-foreground" />
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">
                {isAr ? 'لم نتمكن من العثور على الصفحة المطلوبة' : 'We couldn\'t find the requested page'}
              </h2>
              <p className="text-[11px] text-muted-foreground max-w-md leading-relaxed mx-auto">
                {isAr
                  ? 'يرجى التأكد من كتابة الرابط بشكل صحيح، أو العودة إلى لوحة التحكم للبدء من جديد.'
                  : 'Please check that the URL is spelled correctly, or return to the dashboard to start fresh.'}
              </p>
            </div>

            {/* Quick links buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 w-full max-w-xs mx-auto">
              <Link 
                href="/dashboard"
                className="flex items-center justify-center gap-1.5 w-full rounded border border-foreground/20 bg-background hover:bg-muted px-3 h-8 text-[11px] font-medium text-foreground transition-colors"
              >
                <Home className="h-3.5 w-3.5" />
                <span>{isAr ? 'الرئيسية' : 'Home'}</span>
              </Link>
              <Link 
                href="/dashboard/tickets"
                className="flex items-center justify-center gap-1.5 w-full rounded border border-border bg-background hover:bg-muted px-3 h-8 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                <span>{isAr ? 'تذاكر الدعم' : 'Support Tickets'}</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
