'use client'

import {
  BarChart3,
  CalendarCheck,
  Contact,
  Inbox,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'

const links: { href: string; icon: React.ComponentType<{ className?: string }>; labelAr: string; labelEn: string }[] = [
  { href: '/admin', icon: BarChart3, labelAr: 'الإحصائيات', labelEn: 'Stats' },
  { href: '/admin/clients', icon: Contact, labelAr: 'العملاء', labelEn: 'Clients' },
  { href: '/admin/subscriptions', icon: CalendarCheck, labelAr: 'الاشتراكات', labelEn: 'Subscriptions' },
  { href: '/admin/messages', icon: Inbox, labelAr: 'الرسائل', labelEn: 'Messages' },
]

export default function AdminNavLinks({
  lang,
  newMessages = 0,
}: {
  lang: Language
  newMessages?: number
}) {
  const pathname = usePathname()

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {links.map((link) => {
        const Icon = link.icon
        const isActive = pathname === link.href || pathname.startsWith(link.href + '/')
        // Only the messages link carries a counter; anything else would need a
        // polling mechanism the admin panel does not have.
        const badge = link.href === '/admin/messages' && newMessages > 0 ? newMessages : 0
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
            {badge > 0 && (
              <span className="ms-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold leading-none text-primary-foreground">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
