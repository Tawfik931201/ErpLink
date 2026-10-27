'use client'

import React from 'react'

import { cn } from '@/lib/utils'

/**
 * Section container for the Standard Mapping tabs.
 *
 * Deliberately the same visual language as `/app/logs`: a square card with a
 * flat `bg-muted/60` header strip (uppercase tracking-wide title) and no
 * shadow / blur / rounded corners. The four entity tabs (categories,
 * products, customers, orders) all render through this component, so this is
 * the one place the Odoo-style chrome is defined — do not re-add `rounded-*`
 * or `shadow-*` on an individual tab.
 */
interface SettingCardProps {
  icon?: React.ReactNode
  title: string
  description?: string
  badge?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
  headerAction?: React.ReactNode
}

export function SettingCard({
  icon,
  title,
  description,
  badge,
  children,
  className,
  contentClassName,
  headerAction,
}: SettingCardProps) {
  return (
    <div className={cn('overflow-hidden border border-border bg-card', className)}>
      <div className="flex flex-col justify-between gap-2 border-b border-border bg-muted/60 px-3 py-2 sm:flex-row sm:items-center">
        <div className="flex items-start gap-2">
          {icon && (
            <span className="mt-0.5 flex shrink-0 items-center text-muted-foreground">{icon}</span>
          )}
          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-foreground/80">{title}</h3>
              {badge}
            </div>
            {description && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {headerAction && <div className="flex shrink-0 items-center gap-2">{headerAction}</div>}
      </div>
      <div className={cn('space-y-3 p-3', contentClassName)}>{children}</div>
    </div>
  )
}

interface SettingToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  className?: string
}

export function SettingToggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
}: SettingToggleProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border border-border bg-card px-3 py-2 transition-colors hover:bg-muted/40',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    >
      <div className="space-y-0.5">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        {description && <span className="block text-[10px] text-muted-foreground">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        dir="ltr"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed',
          checked ? 'border-transparent bg-primary' : 'border-border bg-muted-foreground/25'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200',
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          )}
        />
      </button>
    </div>
  )
}
