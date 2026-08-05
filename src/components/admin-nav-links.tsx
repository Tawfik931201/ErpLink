'use client'

import {
  BarChart3,
  Users,
  CalendarCheck,
  DollarSign,
  Contact,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

const links: { href: string; icon: React.ComponentType<{ className?: string }>; labelAr: string; labelEn: string }[] = [
  { href: '/admin', icon: BarChart3, labelAr: 'الإحصائيات', labelEn: 'Stats' },
  { href: '/admin/clients', icon: Contact, labelAr: 'العملاء', labelEn: 'Clients' },
  { href: '/admin/partners', icon: Users, labelAr: 'الأفلييت', labelEn: 'Affiliates' },
  { href: '/admin/subscriptions', icon: CalendarCheck, labelAr: 'الاشتراكات', labelEn: 'Subscriptions' },
  { href: '/admin/commissions', icon: DollarSign, labelAr: 'العمولات', labelEn: 'Commissions' },
]

export default function AdminNavLinks({ lang }: { lang: Language }) {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {links.map((link) => {
        const Icon = link.icon
        const isActive = pathname === link.href || pathname.startsWith(link.href + '/')
        return (
          <Link
            key={link.href}
            href={link.href}
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
