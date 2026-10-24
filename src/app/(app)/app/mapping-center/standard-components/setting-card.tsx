'use client'

import React from 'react'

import { cn } from '@/lib/utils'

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
    <div
      className={cn(
        'rounded-2xl border border-border/80 bg-card/95 shadow-[0_1px_3px_0_rgba(0,0,0,0.03)] backdrop-blur-sm transition-all duration-200 hover:border-border hover:shadow-[0_4px_12px_0_rgba(0,0,0,0.05)] overflow-hidden',
        className
      )}
    >
      <div className="px-5 py-4 border-b border-border/60 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="h-9 w-9 rounded-xl bg-background border border-border/70 shadow-xs flex items-center justify-center shrink-0 text-foreground/80 mt-0.5 sm:mt-0">
              {icon}
            </div>
          )}
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
              {badge}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
            )}
          </div>
        </div>
        {headerAction && <div className="shrink-0 flex items-center gap-2">{headerAction}</div>}
      </div>
      <div className={cn('p-5 space-y-4', contentClassName)}>{children}</div>
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
        'flex items-center justify-between gap-4 p-3.5 rounded-xl border border-border/70 bg-background/50 hover:bg-background transition-colors',
        disabled && 'opacity-60 cursor-not-allowed',
        className
      )}
    >
      <div className="space-y-0.5">
        <span className="text-xs font-medium text-foreground block">{label}</span>
        {description && <span className="text-[11px] text-muted-foreground block">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        dir="ltr"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed',
          checked ? 'border-transparent bg-primary shadow-xs' : 'border-border bg-muted-foreground/25'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200',
            checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
          )}
        />
      </button>
    </div>
  )
}
