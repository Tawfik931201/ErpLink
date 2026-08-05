'use client'

import { LayoutDashboard, Users, Receipt, Wallet } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

const links: { href: string; icon: React.ComponentType<{ className?: string }>; labelAr: string; labelEn: string }[] = [
  { href: '', icon: LayoutDashboard, labelAr: 'الرئيسية', labelEn: 'Dashboard' },
  { href: '/clients', icon: Users, labelAr: 'العملاء', labelEn: 'Clients' },
  { href: '/commissions', icon: Receipt, labelAr: 'العمولات', labelEn: 'Commissions' },
  { href: '/payouts', icon: Wallet, labelAr: 'المستحقات', labelEn: 'Payouts' },
]

export default function PartnerNavLinks({
  basePath,
  lang,
}: {
  basePath: string
  lang: Language
}) {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {links.map((link) => {
        const Icon = link.icon
        const href = `${basePath}${link.href}`
        const isActive =
          link.href === '' ? pathname === href : pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'text-foreground bg-secondary/80'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span>{lang === 'ar' ? link.labelAr : link.labelEn}</span>
          </Link>
        )
      })}
    </nav>
  )
}
