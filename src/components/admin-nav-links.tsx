'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Users,
  Link2,
  DollarSign,
  CreditCard,
} from 'lucide-react'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

const links: { href: string; icon: React.ComponentType<{ className?: string }>; labelAr: string; labelEn: string }[] = [
  { href: '/admin/partners', icon: Users, labelAr: 'الشركاء', labelEn: 'Partners' },
  { href: '/admin/workspace-links', icon: Link2, labelAr: 'روابط العملاء', labelEn: 'Client Links' },
  { href: '/admin/commissions', icon: DollarSign, labelAr: 'العمولات', labelEn: 'Commissions' },
  { href: '/admin/payouts', icon: CreditCard, labelAr: 'الصرف', labelEn: 'Payouts' },
]

export default function AdminNavLinks({ lang }: { lang: Language }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
      {links.map((link) => {
        const Icon = link.icon
        const isActive = pathname === link.href || pathname.startsWith(link.href + '/')
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-secondary/80 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{lang === 'ar' ? link.labelAr : link.labelEn}</span>
          </Link>
        )
      })}
    </nav>
  )
}
