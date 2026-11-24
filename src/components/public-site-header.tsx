import { auth } from '@clerk/nextjs/server'
import Link from 'next/link'

import LanguageSwitcher from '@/components/language-switcher'
import ThemeSwitcher from '@/components/theme-switcher'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { type Language } from '@/lib/translations'

export async function PublicSiteHeader({ lang }: { lang: Language }) {
  const { userId } = await auth()
  const isSignedIn = !!userId

  return (
    // `sticky` only works if no ancestor creates a scroll container. The public
    // page wrappers therefore use `overflow-x-clip`, NOT `overflow-x-hidden`:
    // `hidden` on one axis forces the other to `auto`, which silently turns the
    // wrapper into a scrollport and pins this header to it (it scrolls away).
    // Verified 2026-10-25: with `overflow-x-hidden` the header sat at
    // `top: -900` after 900px of scrolling.
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
      <div className="flex h-14 items-center justify-between px-6 md:px-12 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center select-none" aria-label="ErpLink Home">
          <Logo variant="horizontal" size="md" priority />
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-muted-foreground">
          <Link href="/integrations" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'التكاملات' : 'Integrations'}
          </Link>
          <Link href="/docs" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'التوثيق' : 'Docs'}
          </Link>
          <Link href="/guides" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'مركز المعرفة' : 'Knowledge Center'}
          </Link>
          <Link href="/pricing" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'الأسعار' : 'Pricing'}
          </Link>
          <Link href="/contact" className="transition-colors hover:text-foreground">
            {lang === 'ar' ? 'اتصل بنا' : 'Contact Us'}
          </Link>
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher compact placement="down" />
          <ThemeSwitcher compact placement="down" />
          <span className="hidden sm:block mx-0.5 h-5 w-px bg-border" aria-hidden />
          {isSignedIn ? (
            <Button asChild size="sm" className="h-8 text-[11px] font-bold px-3.5">
              <Link href="/app/dashboard">
                {lang === 'ar' ? 'لوحة التحكم' : 'Dashboard'}
              </Link>
            </Button>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
              >
                {lang === 'ar' ? 'تسجيل الدخول' : 'Sign In'}
              </Link>
              <Button asChild size="sm" variant="brand" className="h-8 text-[11px] font-bold px-3.5">
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
