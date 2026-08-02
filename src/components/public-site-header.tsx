import { auth } from '@clerk/nextjs/server'
import { Layers } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { type Language } from '@/lib/translations'

export function PublicSiteHeader({ lang, isPartnersPage }: { lang: Language; isPartnersPage?: boolean }) {
  const { userId } = auth()
  const isSignedIn = !!userId

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
      <div className="flex h-14 items-center justify-between px-6 md:px-12 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-2 select-none">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-foreground text-background">
            <Layers className="h-4 w-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-foreground">
            ERP Link
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-muted-foreground">
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'الأسعار' : 'Pricing'}
          </Link>
          <Link href="/partners" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'الشركاء' : 'Partners'}
          </Link>
          <Link href="/contact" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'اتصل بنا' : 'Contact Us'}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {isSignedIn ? (
            <Button
              asChild
              size="sm"
              className="bg-foreground text-background hover:bg-foreground/90 h-8 text-[11px] font-bold px-3.5"
            >
              <Link href="/dashboard">
                {lang === 'ar' ? 'لوحة التحكم' : 'Dashboard'}
              </Link>
            </Button>
          ) : isPartnersPage ? (
            <>
              <Link
                href="/sign-in"
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
              >
                {lang === 'ar' ? 'تسجيل الدخول' : 'Sign In'}
              </Link>
              <Button
                asChild
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90 h-8 text-[11px] font-bold px-3.5"
              >
                <Link href="/api/sign-up-intent/set?intent=partner">
                  {lang === 'ar' ? 'انضم الآن' : 'Join Now'}
                </Link>
              </Button>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
              >
                {lang === 'ar' ? 'تسجيل الدخول' : 'Sign In'}
              </Link>
              <Button
                asChild
                size="sm"
                className="bg-foreground text-background hover:bg-foreground/90 h-8 text-[11px] font-bold px-3.5"
              >
                <Link href="/sign-up">
                  {lang === 'ar' ? 'ابدأ مجاناً' : 'Start Free'}
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
