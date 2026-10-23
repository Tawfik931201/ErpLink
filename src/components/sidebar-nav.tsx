'use client'

import { motion } from 'framer-motion'
import {
  LayoutDashboard,
  Store,
  Database,
  GitCompare,
  RefreshCw,
  Settings,
  Ticket,
  Shield,
  Users,
  ShoppingCart,
  CreditCard,
  ScrollText,
  ChevronDown,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useState } from 'react'

import { PendingTicketsBadge } from '@/components/pending-tickets-badge'
import { stripLocaleFromPathname } from '@/lib/locale'
import { cn } from '@/lib/utils'

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  store: Store,
  database: Database,
  mapping: GitCompare,
  transfer: RefreshCw,
  settings: Settings,
  ticket: Ticket,
  admin: Shield,
  users: Users,
  order: ShoppingCart,
  card: CreditCard,
  logs: ScrollText,
}

export interface NavItem {
  href: string
  icon: string
  label: string
  hasBadge?: boolean
  exact?: boolean
  children?: NavItem[]
}

export interface NavSection {
  label?: string
  items: NavItem[]
}

interface SidebarNavProps {
  sections: NavSection[]
}

function isItemActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true
  if (item.exact) return false
  return item.href !== '/app/dashboard' && pathname.startsWith(item.href + '/')
}

export default function SidebarNav({ sections }: SidebarNavProps) {
  const pathname = usePathname()
  const cleanPathname = stripLocaleFromPathname(pathname)
  const [closedMenus, setClosedMenus] = useState<Record<string, boolean>>({})

  return (
    <nav className="flex flex-col gap-0.5 px-3 flex-1 py-3">
      {sections.map((section, sectionIdx) => (
        <React.Fragment key={sectionIdx}>
          {section.label && (
            <span className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 select-none">
              {section.label}
            </span>
          )}

          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const { href, icon, label, hasBadge, children } = item
              const Icon = ICON_MAP[icon] || LayoutDashboard
              const activeChild = (children ?? [])
                .filter((child) => isItemActive(cleanPathname, child))
                .sort((a, b) => b.href.length - a.href.length)[0]
              const childActive = !!activeChild
              const isActive = childActive || cleanPathname === href
              const isOpen = closedMenus[href] !== undefined ? !closedMenus[href] : childActive

              const content = (
                <>
                  {isActive && (
                    <motion.div
                      layoutId="activeNavPill"
                      className="absolute inset-0 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15 -z-10"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}

                  <Icon
                    className={cn(
                      "h-[16px] w-[16px] transition-colors duration-150 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />

                  <span className="flex-1 truncate text-start">{label}</span>

                  {href === '/app/tickets' ? (
                    <PendingTicketsBadge />
                  ) : hasBadge && (
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-foreground opacity-60"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-foreground"></span>
                    </span>
                  )}
                </>
              )

              if (children && children.length > 0) {
                return (
                  <div key={href} className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => setClosedMenus((prev) => ({ ...prev, [href]: isOpen }))}
                      aria-expanded={isOpen}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 outline-none select-none w-full",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      )}
                    >
                      {content}
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition-transform duration-200 text-muted-foreground",
                          isOpen && "rotate-180"
                        )}
                      />
                    </button>

                    {isOpen && (
                      <div className="flex flex-col gap-0.5 ps-4 ms-4 border-s border-border/70">
                        {children.map((child) => {
                          const ChildIcon = ICON_MAP[child.icon] || LayoutDashboard
                          const childIsActive = child === activeChild
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={cn(
                                "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 outline-none select-none",
                                childIsActive
                                  ? "text-primary bg-primary/5"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                              )}
                            >
                              <ChildIcon
                                className={cn(
                                  "h-[14px] w-[14px] transition-colors duration-150 shrink-0",
                                  childIsActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                                )}
                              />
                              <span className="flex-1 truncate">{child.label}</span>
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 outline-none select-none",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {content}
                </Link>
              )
            })}
          </div>

          {sectionIdx < sections.length - 1 && (
            <hr className="border-border my-1.5 mx-1" />
          )}
        </React.Fragment>
      ))}
    </nav>
  )
}
