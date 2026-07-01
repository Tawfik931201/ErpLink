'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Store,
  Database,
  Briefcase,
  GitCompare,
  RefreshCw,
  Settings,
} from 'lucide-react'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  store: Store,
  database: Database,
  workspace: Briefcase,
  mapping: GitCompare,
  transfer: RefreshCw,
  settings: Settings,
}

interface NavItem {
  href: string
  icon: string
  label: string
}

interface SidebarNavProps {
  items: NavItem[]
}

import { useLanguage } from '@/components/language-provider'

export default function SidebarNav({ items }: SidebarNavProps) {
  const pathname = usePathname()
  const { dir } = useLanguage()

  return (
    <nav className="flex flex-col gap-1 px-2.5 flex-1 py-3">
      {items.map(({ href, icon, label }) => {
        const Icon = ICON_MAP[icon] || LayoutDashboard
        // Handle active state
        // Exact match for dashboard home, prefix match for sub-routes
        const isActive = href === '/dashboard' 
          ? pathname === '/dashboard'
          : pathname.startsWith(href)

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all duration-300 outline-none select-none",
              isActive 
                ? "text-foreground" 
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {/* Sliding Active Background Pill */}
            {isActive && (
              <motion.div
                layoutId="activeNavPill"
                className="absolute inset-0 bg-secondary/80 rounded-lg border border-border/30 -z-10 shadow-sm"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}

            {/* Icon Container */}
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-300 shrink-0",
                isActive
                  ? "bg-gradient-to-br from-primary to-purple-600 text-white shadow-md shadow-primary/20 scale-105"
                  : "bg-secondary text-muted-foreground group-hover:bg-secondary/70 group-hover:text-foreground group-hover:scale-105"
              )}
            >
              <Icon className="h-4 w-4" />
            </span>

            {/* Label */}
            <span className={cn(
              "flex-1 transition-transform duration-300 truncate",
              dir === 'ar' ? "group-hover:translate-x-[-2px]" : "group-hover:translate-x-[2px]"
            )}>
              {label}
            </span>

            {/* Active indicator dot */}
            {isActive && (
              <span className={cn(
                "absolute flex h-1.5 w-1.5 rounded-full bg-gradient-to-r from-primary to-purple-600 shadow-sm animate-pulse",
                dir === 'ar' ? "left-3" : "right-3"
              )} />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
