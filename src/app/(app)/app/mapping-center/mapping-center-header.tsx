'use client'

import { ArrowRightLeft, Puzzle, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useLanguage } from '@/components/language-provider'
import { stripLocaleFromPathname } from '@/lib/locale'
import { cn } from '@/lib/utils'

/**
 * Shared Mapping Center header: the four sections are real routes, not tabs.
 * Each page loads only its own code + data; this bar only navigates.
 *
 * Rendered `fixed` with the same geometry the old tab row used
 * (insetInlineStart: 200px clears the sidebar), so every section page
 * keeps identical top spacing without duplicating the markup.
 */
export default function MappingCenterHeader({ erpType = 'odoo' }: { erpType?: string }) {
  const pathname = usePathname()
  const cleanPathname = stripLocaleFromPathname(pathname)
  const { lang, dir } = useLanguage()

  const items = [
    {
      href: '/app/mapping-center',
      labelAr: 'ستاندرد مابينج',
      labelEn: 'Standard Mapping',
      icon: <ArrowRightLeft className="h-4 w-4" />,
      exact: true,
    },
    {
      href: '/app/mapping-center/custom',
      labelAr: 'تخصيص الربط',
      labelEn: 'Custom Mapping',
      icon: <SlidersHorizontal className="h-4 w-4" />,
      exact: true,
    },
    // Add Field exists only where the ERP supports custom fields (same
    // rule the old tab row used).
    ...((erpType === 'odoo' || erpType === 'erpnext'
      ? [
          {
            href: '/app/mapping-center/add-field',
            labelAr: 'إضافة حقل',
            labelEn: 'Add Field',
            icon: <Puzzle className="h-4 w-4" />,
            exact: true,
          },
        ]
      : [])),
  ]

  return (
    <div
      className="fixed top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60"
      style={{ insetInlineStart: '200px', insetInlineEnd: '0px' }}
      dir={dir}
    >
      <div className="flex items-center gap-3 px-6 h-14">
        <span className={cn(
          'flex items-center gap-2 text-sm font-bold text-foreground tracking-tight shrink-0',
          dir === 'rtl' ? 'ml-4' : 'mr-4'
        )}>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
        </span>
        <div className="h-5 w-px bg-border/70" />
        <nav className="flex items-center gap-1 rounded-full bg-muted/70 p-1">
          {items.map((item) => {
            const isActive = item.exact
              ? cleanPathname === item.href
              : cleanPathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 h-8 rounded-full text-[13px] font-semibold transition-colors duration-200',
                  isActive
                    ? 'bg-card text-primary shadow-sm ring-1 ring-border/70'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/70'
                )}
              >
                {item.icon}
                <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
