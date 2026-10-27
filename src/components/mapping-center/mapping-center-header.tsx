'use client'

import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Shared page header for every Mapping Center section.
 *
 * The sidebar already carries the "Mapping Center" parent label, so the page
 * header only owns its own section title + subtitle + trailing actions. This
 * keeps `page.tsx`, `custom/page.tsx`, `categories/page.tsx` and
 * `add-field/page.tsx` on one visual line instead of each re-implementing the
 * same breadcrumb + title + button row (which is how they drifted apart).
 *
 * RTL-aware: the trailing action block flips to the start when `dir === 'rtl'`
 * so the back button and the primary CTA read naturally in Arabic.
 */
export function MappingCenterHeader({
  title,
  subtitle,
  actions,
  dir = 'ltr',
  className,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  dir?: 'ltr' | 'rtl'
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center justify-between gap-3',
        className
      )}
      dir={dir}
    >
      <div className="min-w-0">
        <h2 className="text-base font-bold text-foreground truncate">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}