'use client'

import { ArrowRightLeft, Database, Puzzle, SlidersHorizontal } from 'lucide-react'
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
    {
      href: '/app/mapping-center/values',
      labelAr: 'تحويل القيم',
      labelEn: 'Value Mapping',
      icon: <Database className="h-4 w-4" />,
      exact: true,
    },
  ]

  return (
    <div
      className="fixed top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      style={{ insetInlineStart: '200px', insetInlineEnd: '0px' }}
      dir={dir}
    >
      <div className="flex items-center gap-0.5 px-6 h-14">
        <span className={cn(
          'text-sm font-bold text-foreground tracking-tight shrink-0',
          dir === 'rtl' ? 'ml-6' : 'mr-6'
        )}>
          {lang === 'ar' ? 'مركز الربط' : 'Mapping Center'}
        </span>
        <div className="h-5 w-px bg-border/60" />
        {items.map((item) => {
          const isActive = item.exact
            ? cleanPathname === item.href
            : cleanPathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex items-center gap-2 px-4 h-14 text-sm font-semibold transition-all duration-200 border-b-2',
                isActive
                  ? 'text-foreground border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/30'
              )}
            >
              <span className="flex items-center gap-1.5">
                {item.icon}
                <span>{lang === 'ar' ? item.labelAr : item.labelEn}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
