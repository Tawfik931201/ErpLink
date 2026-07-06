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

interface NavSection {
  items: NavItem[]
}

interface SidebarNavProps {
  sections: NavSection[]
}

import { useLanguage } from '@/components/language-provider'

export default function SidebarNav({ sections }: SidebarNavProps) {
  const pathname = usePathname()
  const { dir } = useLanguage()

  return (
    <nav className="flex flex-col gap-1 px-3 flex-1 py-4">
      {sections.map((section, sectionIdx) => (
        <React.Fragment key={sectionIdx}>
          {/* Section Items */}
          <div className="flex flex-col gap-1">
            {section.items.map(({ href, icon, label }) => {
              const Icon = ICON_MAP[icon] || LayoutDashboard
              // Handle active state: Exact match for dashboard home, prefix match for sub-routes
              const isActive = href === '/dashboard' 
                ? pathname === '/dashboard'
                : pathname.startsWith(href)

              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 outline-none select-none",
                    isActive 
                      ? "text-gray-900 dark:text-white" 
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/50 dark:hover:bg-secondary/40"
                  )}
                >
                  {/* Sliding Active Background Pill */}
                  {isActive && (
                    <motion.div
                      layoutId="activeNavPill"
                      className="absolute inset-0 bg-gray-100/90 dark:bg-secondary/80 rounded-lg -z-10 shadow-sm border border-transparent"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}

                  {/* Icon */}
                  <Icon 
                    className={cn(
                      "h-[18px] w-[18px] transition-colors duration-200 shrink-0",
                      isActive
                        ? "text-gray-900 dark:text-white"
                        : "text-gray-500 dark:text-gray-400 group-hover:text-gray-900 dark:group-hover:text-white"
                    )} 
                  />

                  {/* Label */}
                  <span className={cn(
                    "flex-1 transition-transform duration-200 truncate",
                    dir === 'rtl' ? "group-hover:translate-x-[-1px]" : "group-hover:translate-x-[1px]"
                  )}>
                    {label}
                  </span>
                </Link>
              )
            })}
          </div>

          {/* Section Divider - rendered between sections */}
          {sectionIdx < sections.length - 1 && (
            <hr className="border-border/60 dark:border-border/20 my-2.5 mx-1" />
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}

