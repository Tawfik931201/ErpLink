import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function PartnerCtaButtons({
  lang,
  isSignedIn = false,
  variant = 'default',
}: {
  lang: string
  isSignedIn?: boolean
  variant?: 'default' | 'outline'
}) {
  const ctaClass = cn(
    'rounded-lg h-10 text-xs font-bold px-5',
    variant === 'outline'
      ? 'border-border text-foreground hover:bg-muted'
      : 'bg-foreground text-background hover:bg-foreground/90'
  )

  return isSignedIn ? (
    <Button asChild className={ctaClass}>
      <Link href="/onboarding/partner" className="flex items-center gap-1.5">
        {lang === 'ar' ? 'استمرار' : 'Continue'}
        <ArrowLeft className={cn('h-3.5 w-3.5', lang === 'ar' ? '' : 'rotate-180')} />
      </Link>
    </Button>
  ) : (
    <Button asChild className={ctaClass}>
      <Link href="/api/sign-up-intent/set?intent=partner" className="flex items-center gap-1.5">
        {lang === 'ar' ? 'انضم الآن' : 'Join Now'}
        <ArrowLeft className={cn('h-3.5 w-3.5', lang === 'ar' ? '' : 'rotate-180')} />
      </Link>
    </Button>
  )
}

export function PartnerCardButton({
  lang,
  isSignedIn = false,
  recommended = false,
}: {
  lang: string
  isSignedIn?: boolean
  recommended?: boolean
}) {
  const ctaClass = cn(
    'rounded-lg h-8 text-[11px] font-bold px-3.5 mt-auto',
    recommended
      ? 'bg-foreground text-background hover:bg-foreground/90'
      : 'border-border text-foreground hover:bg-muted'
  )

  const href = isSignedIn ? '/onboarding/partner' : '/api/sign-up-intent/set?intent=partner'

  return (
    <Button asChild variant={recommended ? 'default' : 'outline'} className={ctaClass}>
      <Link href={href}>
        {lang === 'ar' ? 'ابدأ الآن' : 'Get Started'}
      </Link>
    </Button>
  )
}
