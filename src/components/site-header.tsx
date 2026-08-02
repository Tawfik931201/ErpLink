'use client'

import { SignedIn, SignedOut } from '@clerk/nextjs'
import { Layers } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'

export function SiteHeader() {
  const { lang, t } = useLanguage()
  const pathname = usePathname()
  const isPartnersPage = pathname?.includes('/partners')

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
          <Link
            href="/pricing"
            className="transition-colors hover:text-foreground"
          >
            {t('landing.pricing')}
          </Link>
          <Link
            href="/partners"
            className="transition-colors hover:text-foreground"
          >
            {lang === 'ar' ? 'الشركاء' : 'Partners'}
          </Link>
          <Link
            href="/contact"
            className="transition-colors hover:text-foreground"
          >
            {lang === 'ar' ? 'اتصل بنا' : 'Contact Us'}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {isPartnersPage ? (
            <>
              <SignedOut>
                <Link
                  href="/sign-in"
                  className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
                >
                  {t('partners.navSignIn')}
                </Link>
                <Button
                  asChild
                  size="sm"
                  className="bg-foreground text-background hover:bg-foreground/90 h-8 text-[11px] font-bold px-3.5"
                >
                  <Link href="/api/sign-up-intent/set?intent=partner">{t('partners.ctaJoin')}</Link>
                </Button>
              </SignedOut>
              <SignedIn>
                <Button
                  asChild
                  size="sm"
                  className="bg-foreground text-background hover:bg-foreground/90 h-8 text-[11px] font-bold px-3.5"
                >
                  <Link href="/onboarding/partner">{t('partners.ctaContinue')}</Link>
                </Button>
              </SignedIn>
            </>
          ) : (
            <>
              <SignedOut>
                <Link
                  href="/sign-in"
                  className="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
                >
                  {t('landing.signIn')}
                </Link>
                <Button
                  asChild
                  size="sm"
                  className="bg-foreground text-background hover:bg-foreground/90 h-8 text-[11px] font-bold px-3.5"
                >
                  <Link href="/sign-up">{t('landing.startFree')}</Link>
                </Button>
              </SignedOut>
              <SignedIn>
                <Button
                  asChild
                  size="sm"
                  className="bg-foreground text-background hover:bg-foreground/90 h-8 text-[11px] font-bold px-3.5"
                >
                  <Link href="/dashboard">{t('landing.goToDashboard')}</Link>
                </Button>
              </SignedIn>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
