'use client'

import { Check, ChevronDown } from 'lucide-react'
import React from 'react'

import { cn } from '@/lib/utils'

/**
 * Compact dropdown used by the Odoo-style list pages (logs, custom mapping,
 * admin subscriptions). It is the visual contract those pages share: a small
 * label, a bordered trigger, and an absolute panel — never a full-width card.
 *
 * Extracted from logs-client so a second page can look identical without
 * copy-pasting the open/close plumbing.
 */
export function FilterSelect({
  label,
  icon,
  buttonRef,
  isOpen,
  onToggle,
  triggerText,
  minWidth = 'min-w-[120px]',
  children,
}: {
  label: string
  icon?: React.ReactNode
  buttonRef: React.RefObject<HTMLDivElement | null>
  isOpen: boolean
  onToggle: () => void
  triggerText: string
  minWidth?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5 relative select-none" ref={buttonRef}>
      {icon}
      <span className="text-[11px] font-bold text-muted-foreground me-1 shrink-0">{label}</span>
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'text-xs bg-muted/60 hover:bg-muted border border-border/70 px-3 py-1.5',
            'focus:outline-none focus:ring-1 focus:ring-primary/30 font-semibold flex items-center gap-2',
            'select-none justify-between text-start transition-colors',
            minWidth
          )}
        >
          <span className="truncate max-w-[150px]">{triggerText}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </button>
        {isOpen && (
          <div className="absolute z-50 mt-1.5 w-56 bg-card border border-border/70 py-1.5 shadow-card animate-in fade-in scale-in duration-150 max-h-60 overflow-y-auto">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

/** Checkbox row inside a FilterSelect panel. */
export function CheckRow({
  checked,
  onChange,
  danger = false,
  children,
}: {
  checked: boolean
  onChange: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted text-xs font-medium cursor-pointer text-muted-foreground select-none transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className={cn(
          'rounded border-border/70 h-3.5 w-3.5',
          danger ? 'text-destructive focus:ring-destructive/30' : 'text-primary focus:ring-primary/30'
        )}
      />
      <span className="flex items-center gap-1.5 truncate">{children}</span>
    </label>
  )
}

/** Single-choice row inside a FilterSelect panel. */
export function ChoiceRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 px-3 py-2 text-xs transition-colors',
        selected
          ? 'bg-muted/60 font-bold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-muted'
      )}
    >
      <span className="truncate">{children}</span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  )
}