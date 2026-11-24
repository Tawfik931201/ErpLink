'use client'

import {
  BookOpen,
  ChevronRight,
  Layers,
  LayoutDashboard,
  LogIn,
  Mail,
  Menu,
  Tag,
  X,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

export function PublicSiteMobileNav({ lang, isSignedIn }: { lang: Language; isSignedIn: boolean }) {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const isAr = lang === 'ar'

  // Close menu on route change
  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const navLinks = [
    {
      href: '/pricing',
      label: isAr ? 'الأسعار والباقات' : 'Pricing & Plans',
      desc: isAr ? 'سعر واحد، كل المزايا مع تجربة ٧ أيام' : 'One price, all features with 7-day trial',
      icon: Tag,
    },
    {
      href: '/contact',
      label: isAr ? 'اتصل بنا' : 'Contact Us',
      desc: isAr ? 'تواصل مع فريق الدعم الفني' : 'Get in touch with support',
      icon: Mail,
    },
    {
      href: '/integrations',
      label: isAr ? 'التكاملات والربط' : 'Integrations',
      desc: isAr ? 'زد، سلة، شوبيفاي، أودوو' : 'Zid, Salla, Shopify, Odoo',
      icon: Layers,
    },
    {
      href: '/guides',
      label: isAr ? 'مركز المعرفة' : 'Knowledge Center',
      desc: isAr ? 'أدلة إرشادية وخطوات عملية' : 'Step-by-step setup guides',
      icon: BookOpen,
    },
  ]

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        aria-expanded={isOpen}
        aria-label={isOpen ? (isAr ? 'إغلاق القائمة' : 'Close menu') : (isAr ? 'فتح القائمة' : 'Open menu')}
      >
        {isOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 top-14 z-40 bg-background/70 backdrop-blur-sm transition-opacity duration-200"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Slide-down Drawer Panel */}
          <div
            className="fixed inset-x-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-border bg-background/95 backdrop-blur-md px-5 py-6 shadow-2xl transition-all duration-200 animate-in slide-in-from-top-2"
            dir={isAr ? 'rtl' : 'ltr'}
          >
            {/* Navigation links */}
            <nav className="space-y-1.5" aria-label="Mobile Navigation">
              {navLinks.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      'flex items-center justify-between rounded-xl p-3 transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary font-bold'
                        : 'text-foreground/90 hover:bg-muted/70 hover:text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="text-sm font-bold leading-tight">{item.label}</div>
                        <div className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                          {item.desc}
                        </div>
                      </div>
                    </div>
                    <ChevronRight
                      className={cn('h-4 w-4 text-muted-foreground/60 shrink-0', isAr && 'rotate-180')}
                    />
                  </Link>
                )
              })}
            </nav>

            <div className="my-5 border-t border-border" />

            {/* Auth Actions */}
            <div className="space-y-2.5">
              {isSignedIn ? (
                <Button asChild className="h-11 w-full justify-center gap-2 rounded-xl text-sm font-bold">
                  <Link href="/app/dashboard" onClick={() => setIsOpen(false)}>
                    <LayoutDashboard className="h-4 w-4" />
                    <span>{isAr ? 'لوحة التحكم' : 'Dashboard'}</span>
                  </Link>
                </Button>
              ) : (
                <>
                  <Button
                    asChild
                    variant="brand"
                    className="h-11 w-full justify-center gap-2 rounded-xl text-sm font-bold shadow-sm"
                  >
                    <Link href="/sign-up" onClick={() => setIsOpen(false)}>
                      <Zap className="h-4 w-4" />
                      <span>{isAr ? 'ابدأ مجاناً — تجربة ٧ أيام' : 'Start Free — 7-Day Trial'}</span>
                    </Link>
                  </Button>

                  <Button
                    asChild
                    variant="outline"
                    className="h-11 w-full justify-center gap-2 rounded-xl text-sm font-semibold"
                  >
                    <Link href="/sign-in" onClick={() => setIsOpen(false)}>
                      <LogIn className="h-4 w-4" />
                      <span>{isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
                    </Link>
                  </Button>
                </>
              )}
            </div>

            {/* Small reassurance note */}
            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              {isAr ? 'لا حاجة لبطاقة ائتمانية للبدء' : 'No credit card required to start'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}
