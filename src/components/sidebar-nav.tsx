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
  ChevronRight,
  SlidersHorizontal,
  Puzzle,
  Inbox,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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
  sliders: SlidersHorizontal,
  puzzle: Puzzle,
  inbox: Inbox,
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

interface FlyoutState {
  href: string
  top: number
  left: number
  right: number
  rtl: boolean
}

function isItemActive(pathname: string, item: NavItem): boolean {
  if (pathname === item.href) return true
  if (item.exact) return false
  return item.href !== '/app/dashboard' && pathname.startsWith(item.href + '/')
}

export default function SidebarNav({ sections }: SidebarNavProps) {
  const pathname = usePathname()
  const cleanPathname = stripLocaleFromPathname(pathname)
  const [flyout, setFlyout] = useState<FlyoutState | null>(null)
  const navRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setFlyout(null)
  }, [cleanPathname])

  useEffect(() => {
    if (!flyout) return
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node
      if (navRef.current?.contains(target)) return
      const menu = document.getElementById('sidebar-flyout')
      if (menu?.contains(target)) return
      setFlyout(null)
    }
    function handleDismiss() {
      setFlyout(null)
    }
    document.addEventListener('mousedown', handleOutside)
    window.addEventListener('scroll', handleDismiss, true)
    window.addEventListener('resize', handleDismiss)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      window.removeEventListener('scroll', handleDismiss, true)
      window.removeEventListener('resize', handleDismiss)
    }
  }, [flyout])

  const flyoutItem = flyout
    ? sections.flatMap((section) => section.items).find((item) => item.href === flyout.href)
    : undefined

  const flyoutActiveChild = (flyoutItem?.children ?? [])
    .filter((child) => isItemActive(cleanPathname, child))
    .sort((a, b) => b.href.length - a.href.length)[0]

  const openFlyout = (event: React.MouseEvent<HTMLButtonElement>, item: NavItem) => {
    if (flyout?.href === item.href) {
      setFlyout(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const estimatedHeight = 40 + (item.children?.length ?? 0) * 36
    const top = Math.min(rect.top, Math.max(8, window.innerHeight - estimatedHeight - 8))
    const rtl = navRef.current ? getComputedStyle(navRef.current).direction === 'rtl' : false
    setFlyout({
      href: item.href,
      top,
      left: rect.right + 8,
      right: window.innerWidth - rect.left + 8,
      rtl,
    })
  }

  return (
    <nav ref={navRef} className="flex flex-col gap-0.5 px-3 flex-1 py-3">
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
                const isOpen = flyout?.href === href
                return (
                  <button
                    key={href}
                    type="button"
                    onClick={(event) => openFlyout(event, item)}
                    aria-expanded={isOpen}
                    aria-haspopup="menu"
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 outline-none select-none w-full",
                      isOpen || isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    {content}
                    {/* Points at the flyout panel, not down: the item opens a
                        side menu, so a downward chevron read as "expands
                        inline" and looked broken. Mirrored in RTL. */}
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                  </button>
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

      {flyout && flyoutItem && typeof document !== 'undefined' && createPortal(
        <div
          id="sidebar-flyout"
          role="menu"
          className={cn(
            "fixed z-[60] w-56 bg-sidebar border border-border rounded-lg p-1.5 flex flex-col gap-0.5 shadow-lg animate-in fade-in-50 duration-150",
            flyout.rtl ? "slide-in-from-right-2" : "slide-in-from-left-2"
          )}
          style={flyout.rtl
            ? { top: flyout.top, right: flyout.right }
            : { top: flyout.top, left: flyout.left }}
        >
          <div className="px-2 py-1 border-b border-border/40 text-[9px] font-extrabold text-muted-foreground uppercase mb-1">
            {flyoutItem.label}
          </div>
          {flyoutItem.children?.map((child) => {
            const ChildIcon = ICON_MAP[child.icon] || LayoutDashboard
            const childIsActive = child === flyoutActiveChild
            return (
              <Link
                key={child.href}
                href={child.href}
                role="menuitem"
                onClick={() => setFlyout(null)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-medium transition-colors text-start",
                  childIsActive
                    ? "bg-muted/60 text-primary"
                    : "text-foreground hover:bg-muted/40"
                )}
              >
                <ChildIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{child.label}</span>
              </Link>
            )
          })}
        </div>,
        document.body
      )}
    </nav>
  )
}
