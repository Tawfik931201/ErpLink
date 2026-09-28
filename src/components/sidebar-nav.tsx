'use client'

import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Store,
  Database,
  Briefcase,
  GitCompare,
  RefreshCw,
  Settings,
  Ticket,
  Bell,
  Handshake,
  Shield,
  Users,
  ShoppingCart,
  CreditCard,
  Rocket,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React from 'react'

import { PendingTicketsBadge } from '@/components/pending-tickets-badge'
import { stripLocaleFromPathname } from '@/lib/locale'
import { cn } from '@/lib/utils'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  store: Store,
  database: Database,
  workspace: Briefcase,
  mapping: GitCompare,
  transfer: RefreshCw,
  settings: Settings,
  ticket: Ticket,
  bell: Bell,
  partner: Handshake,
  admin: Shield,
  users: Users,
  order: ShoppingCart,
  card: CreditCard,
  setup: Rocket,
}

interface NavItem {
  href: string
  icon: string
  label: string
  hasBadge?: boolean
}

export interface NavSection {
  label?: string
  items: NavItem[]
}

interface SidebarNavProps {
  sections: NavSection[]
}

export default function SidebarNav({ sections }: SidebarNavProps) {
  const pathname = usePathname()
  const cleanPathname = stripLocaleFromPathname(pathname)

  return (
    <nav className="flex flex-col gap-0.5 px-3 flex-1 py-3">
      {sections.map((section, sectionIdx) => (
        <React.Fragment key={sectionIdx}>
          {/* Section Label */}
          {section.label && (
            <span className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 select-none">
              {section.label}
            </span>
          )}

          {/* Section Items */}
          <div className="flex flex-col gap-0.5">
            {section.items.map(({ href, icon, label, hasBadge }) => {
              const Icon = ICON_MAP[icon] || LayoutDashboard
              // Handle active state: Exact match, or sub-path (e.g. /app/settings/workspace matches /app/settings)
              const isActive = cleanPathname === href || (href !== '/app/dashboard' && cleanPathname.startsWith(href + '/'))

              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 outline-none select-none",
                    isActive
                      ? "bg-muted/60 dark:bg-[#424242f0] text-muted-foreground dark:text-[#999999] shadow-sm dark:shadow-none"
                      : "text-muted-foreground dark:text-[#999999] hover:text-foreground hover:bg-muted/40 dark:hover:bg-[#424242e0]"
                  )}
                >
                  {/* Sliding Active Background Pill */}
                  {isActive && (
                    <motion.div
                      layoutId="activeNavPill"
                      className="absolute inset-0 bg-muted/60 dark:bg-[#424242f0] -z-10 rounded-lg shadow-sm dark:shadow-none"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}

                  {/* Icon */}
                  <Icon
                    className={cn(
                      "h-[16px] w-[16px] transition-colors duration-150 shrink-0",
                      "text-muted-foreground dark:text-[#999999] group-hover:text-foreground"
                    )}
                  />

                  {/* Label */}
                  <span className="flex-1 truncate">{label}</span>

                  {/* Pulsing Pending-Status Dot */}
                  {href === '/app/tickets' ? (
                    <PendingTicketsBadge />
                  ) : hasBadge && (
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground opacity-60"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-foreground"></span>
                    </span>
                  )}
                </Link>
              )
            })}
          </div>

          {/* Section Divider - rendered between sections */}
          {sectionIdx < sections.length - 1 && (
            <hr className="border-border my-1.5 mx-1" />
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}

