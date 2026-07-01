'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sliders, Briefcase } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/components/language-provider'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { lang, dir } = useLanguage()

  const settingsNavItems = [
    {
      href: '/dashboard/settings',
      label: lang === 'ar' ? 'الإعدادات العامة' : 'General Settings',
      icon: Sliders,
      exact: true
    },
    {
      href: '/dashboard/settings/workspace',
      label: lang === 'ar' ? 'بيئات العمل' : 'Workspaces',
      icon: Briefcase,
      exact: false
    }
  ]

  return (
    <div className="space-y-6 animate-fade-in" dir={dir}>
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-black text-foreground tracking-tight">
          {lang === 'ar' ? 'الإعدادات' : 'Settings'}
        </h1>
        <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">
          {lang === 'ar' 
            ? 'تفضيلات النظام، إعدادات المظهر واللغة، وإدارة مساحات العمل الخاصة بك.' 
            : 'System preferences, interface language, theme options, and workspace management.'}
        </p>
      </div>

      {/* Settings Container */}
      <div className="flex flex-col md:flex-row gap-8 items-start">
        {/* Inner Settings Sidebar */}
        <aside className="w-full md:w-56 shrink-0 flex md:flex-col gap-1 p-1 bg-secondary/10 rounded-xl border border-border/40 overflow-x-auto md:overflow-x-visible">
          {settingsNavItems.map((item) => {
            const Icon = item.icon
            const isActive = item.exact 
              ? pathname === item.href 
              : pathname.startsWith(item.href) && pathname !== '/dashboard/settings'

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all duration-300 outline-none select-none flex-1 md:flex-initial",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {/* Active Indicator Pill */}
                {isActive && (
                  <div className="absolute inset-0 bg-secondary rounded-lg border border-border/30 -z-10 shadow-sm" />
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
                <span>{item.label}</span>
              </Link>
            )
          })}
        </aside>

        {/* Nested Content Panel */}
        <div className="flex-1 w-full bg-card rounded-2xl border border-border shadow-card p-6 md:p-8 min-h-[400px]">
          {children}
        </div>
      </div>
    </div>
  )
}
