'use client'

import { SignedIn, SignedOut } from '@clerk/nextjs'
import Link from 'next/link'

import { useLanguage } from '@/components/language-provider'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'

export function SiteHeader() {
  const { t } = useLanguage()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
      <div className="flex h-14 items-center justify-between px-6 md:px-12 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center select-none" aria-label="ErpLink Home">
          <Logo variant="horizontal" size="md" priority />
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-muted-foreground">
          <Link
            href="/pricing"
            className="transition-colors hover:text-foreground"
          >
            {t('landing.pricing')}
          </Link>
          <Link
            href="/contact"
            className="transition-colors hover:text-foreground"
          >
            {t('landing.contact' as never) || 'Contact'}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
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
                <Link href="/app/dashboard">{t('landing.goToDashboard')}</Link>
              </Button>
            </SignedIn>
          </>
        </div>
      </div>
    </header>
  )
}
