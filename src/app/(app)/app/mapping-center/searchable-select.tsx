'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'

import { useLanguage } from '@/components/language-provider'
import { formatFieldLabel } from '@/lib/translations'
import { cn } from '@/lib/utils'


interface Option {
  value: string
  label: string
  desc?: string
  group?: string
  type?: string
}

interface SearchableSelectProps {
  options: Option[]
  value: string | string[]
  onChange: (value: any) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  variant?: 'default' | 'cell'
  multiple?: boolean
  collapseTags?: boolean
}

export default function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  variant = 'default',
  multiple = false,
  collapseTags = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [dropdownDirection, setDropdownDirection] = useState<'down' | 'up'>('down')
  const [dropdownCoords, setDropdownCoords] = useState({ top: 0, left: 0, width: 0 })
  const [portalTarget, setPortalTarget] = useState<Element | null>(null)

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const target = document.querySelector('[role="dialog"]') || document.body
      setPortalTarget(target)
    }
  }, [isOpen])
  const { lang, dir } = useLanguage()

  const defaultPlaceholder = lang === 'ar' ? 'بحث...' : 'Search...'
  const finalPlaceholder = placeholder || defaultPlaceholder
  
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Calculate dropdown positioning dynamically (upward/downward) based on screen space
  // Recalculates on scroll/resize while open (Bug 2 fix)
  useEffect(() => {
    if (!isOpen) return
    const updateCoords = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top
        
        const dialogEl = document.querySelector('[role="dialog"]')
        const isInsideDialog = dialogEl && dialogEl.contains(containerRef.current)

        if (isInsideDialog && dialogEl) {
          const dialogRect = dialogEl.getBoundingClientRect()
          if (spaceBelow < 240 && spaceAbove > spaceBelow) {
            setDropdownDirection('up')
            setDropdownCoords({
              top: dialogRect.bottom - rect.top,
              left: rect.left - dialogRect.left,
              width: rect.width
            })
          } else {
            setDropdownDirection('down')
            setDropdownCoords({
              top: rect.bottom - dialogRect.top,
              left: rect.left - dialogRect.left,
              width: rect.width
            })
          }
        } else {
          if (spaceBelow < 240 && spaceAbove > spaceBelow) {
            setDropdownDirection('up')
            setDropdownCoords({ top: window.innerHeight - rect.top, left: rect.left, width: rect.width })
          } else {
            setDropdownDirection('down')
            setDropdownCoords({ top: rect.bottom, left: rect.left, width: rect.width })
          }
        }
      }
    }
    updateCoords()
    window.addEventListener('scroll', updateCoords, true)
    window.addEventListener('resize', updateCoords)
    return () => {
      window.removeEventListener('scroll', updateCoords, true)
      window.removeEventListener('resize', updateCoords)
    }
  }, [isOpen])

  // Find currently selected option (only for single select)
  const selectedOption = useMemo(() => (
    !multiple && typeof value === 'string'
      ? options.find((opt) => opt.value === value)
      : null
  ), [multiple, value, options])

  // Filter options based on search query. Memoized (was recomputed on every
  // render) and capped: with 1000+ Odoo models an empty query rendered 1000+
  // DOM rows on every keystroke/open, which froze the dropdown.
  const MAX_VISIBLE_OPTIONS = 200
  const { visibleOptions: filteredOptions, totalMatches } = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) {
      return {
        visibleOptions: options.slice(0, MAX_VISIBLE_OPTIONS),
        totalMatches: options.length,
      }
    }
    const matches = options.filter((opt) => {
      const cleanLabelStr = formatFieldLabel(opt.label, lang).toLowerCase()
      const cleanGroupStr = opt.group ? formatFieldLabel(opt.group, lang).toLowerCase() : ''
      return (
        cleanLabelStr.includes(query) ||
        opt.value.toLowerCase().includes(query) ||
        (opt.desc && opt.desc.toLowerCase().includes(query)) ||
        cleanGroupStr.includes(query)
      )
    })
    return {
      visibleOptions: matches.slice(0, MAX_VISIBLE_OPTIONS),
      totalMatches: matches.length,
    }
  }, [options, searchQuery, lang])

  // Close dropdown on click outside (checks both trigger and portal list)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node) &&
          !(listRef.current && listRef.current.contains(event.target as Node))) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[focusedIndex] as HTMLElement
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [focusedIndex])

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        setIsOpen(true)
        setFocusedIndex(0)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocusedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0))
        break
      case 'Enter':
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          handleSelect(filteredOptions[focusedIndex].value)
        }
        break
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setSearchQuery('')
        inputRef.current?.blur()
        break
      case 'Tab':
        setIsOpen(false)
        setSearchQuery('')
        break
    }
  }

  const handleSelect = (val: string) => {
    if (multiple) {
      const currentValues = Array.isArray(value) ? value : []
      const newValues = currentValues.includes(val)
        ? currentValues.filter((v) => v !== val)
        : [...currentValues, val]
      
      onChange(newValues)
      setSearchQuery('')
      inputRef.current?.focus()
    } else {
      onChange(val)
      setIsOpen(false)
      setSearchQuery('')
      inputRef.current?.blur()
    }
  }

  // Determine what text to display in the input
  const getDisplayText = () => {
    if (multiple) {
      if (isOpen) {
        return searchQuery
      }
      if (collapseTags && Array.isArray(value) && value.length > 0) {
        if (value.length === 1) {
          const opt = options.find((o) => o.value === value[0])
          return opt ? formatFieldLabel(opt.label, lang) : ''
        }
        return lang === 'ar' 
          ? `تم تحديد (${value.length})` 
          : `${value.length} selected`
      }
      return ''
    }
    if (isOpen) {
      return searchQuery
    }
    return selectedOption ? formatFieldLabel(selectedOption.label, lang) : ''
  }

  return (
    <div ref={containerRef} className={cn('relative w-full', className)} dir={dir}>
      <div
        className={cn(
          'flex w-full items-center justify-between rounded-none text-sm ring-offset-background transition-all',
          variant === 'cell'
            ? 'border border-transparent bg-transparent hover:bg-muted/30 hover:border-input'
            : 'border border-input bg-inputBg',
          multiple && !collapseTags ? 'min-h-[36px] flex-wrap p-1.5 gap-1.5' : 'h-9 pl-3 pr-2',
          isOpen && 'border-foreground ring-1 ring-foreground bg-inputBg',
          disabled && 'cursor-not-allowed opacity-50 bg-muted/40'
        )}
      >
        <div className={cn("flex-1 flex items-center", multiple && !collapseTags ? "flex-wrap gap-1.5" : "gap-1.5 overflow-hidden")}>
          {/* Search Icon */}
          {!multiple && isOpen && <Search className={cn("h-4 w-4 text-muted-foreground shrink-0", dir === 'rtl' ? "ml-1.5" : "mr-1.5")} />}
          
          {/* Multi-select Badges */}
          {multiple && !collapseTags && Array.isArray(value) && value.map((val) => {
            const opt = options.find((o) => o.value === val)
            if (!opt) return null
            return (
              <span
                key={val}
                className="inline-flex items-center gap-1 bg-muted text-foreground text-xs font-semibold px-2 py-0.5 rounded-none border border-border animate-in zoom-in-95 duration-150 whitespace-normal break-words"
              >
                {formatFieldLabel(opt.label, lang)}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const newValues = (value as string[]).filter((v) => v !== val)
                    onChange(newValues)
                  }}
                  className="hover:text-destructive text-muted-foreground/60 transition-colors rounded-none p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}

          <input
            ref={inputRef}
            type="text"
            disabled={disabled}
            placeholder={multiple && !collapseTags && Array.isArray(value) && value.length > 0 ? '' : finalPlaceholder}
            value={getDisplayText()}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (!isOpen) setIsOpen(true)
              setFocusedIndex(0)
            }}
            onFocus={() => {
              setIsOpen(true)
              if (!multiple && selectedOption) {
                setFocusedIndex(filteredOptions.findIndex((o) => o.value === selectedOption.value))
              } else {
                setFocusedIndex(0)
              }
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 min-w-[60px] bg-transparent outline-none border-0 p-0 text-sm focus:ring-0 focus:border-0 placeholder:text-muted-foreground text-foreground"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {searchQuery && isOpen && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('')
                inputRef.current?.focus()
              }}
              className="text-muted-foreground/60 hover:text-foreground p-0.5 rounded-none animate-in fade-in"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (isOpen) {
                setIsOpen(false)
                setSearchQuery('')
              } else {
                inputRef.current?.focus()
              }
            }}
            className="text-muted-foreground/60 hover:text-foreground rounded-none p-1"
          >
            <ChevronsUpDown className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </div>

      {/* Dropdown Popover - Rendered via React Portal to avoid overflow clipping */}
      {portalTarget && createPortal(
        <AnimatePresence>
          {isOpen && !disabled && (
            <motion.div
              ref={listRef}
              initial={{ opacity: 0, y: dropdownDirection === 'up' ? -4 : 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: dropdownDirection === 'up' ? -4 : 4 }}
              transition={{ duration: 0.1 }}
              style={{
                position: portalTarget && portalTarget !== document.body ? 'absolute' : 'fixed',
                ...(dropdownDirection === 'up'
                  ? { bottom: dropdownCoords.top }
                  : { top: dropdownCoords.top }),
                left: dropdownCoords.left,
                width: dropdownCoords.width,
              }}
              className={cn(
                "calm-ui z-[9999] rounded-none border border-border bg-popover text-popover-foreground outline-none shadow-lg",
                dropdownDirection === 'up' ? "translate-y-[-4px]" : "translate-y-[4px]"
              )}
            >
              <div
                className="max-h-60 overflow-y-auto p-1 scrollbar-thin divide-y divide-border/30"
                role="listbox"
              >
                {filteredOptions.length > 0 ? (
                  // Grouped option rendering
                  filteredOptions.some((o) => o.group) ? (
                    (() => {
                      const grouped: Record<string, Option[]> = {}
                      filteredOptions.forEach((opt) => {
                        const g = opt.group || 'Other'
                        if (!grouped[g]) grouped[g] = []
                        grouped[g].push(opt)
                      })
                      
                      return Object.entries(grouped).map(([groupName, groupOptions]) => (
                        <div key={groupName} className="py-1">
                          <div className="px-3 py-1 text-xs font-extrabold text-muted-foreground/80 bg-muted/20 select-none tracking-wider rounded-sm mb-1 uppercase">
                            {formatFieldLabel(groupName, lang)}
                          </div>
                          <div className="space-y-0.5 px-1">
                            {groupOptions.map((opt) => {
                              const idx = filteredOptions.findIndex((o) => o.value === opt.value)
                              const isSelected = multiple && Array.isArray(value)
                                ? value.includes(opt.value)
                                : opt.value === value
                              const isFocused = idx === focusedIndex
                              
                              return (
                                <div
                                  key={opt.value}
                                  role="option"
                                  aria-selected={isSelected}
                                  onMouseDown={(e) => { e.preventDefault(); handleSelect(opt.value); }}
                                  onMouseEnter={() => setFocusedIndex(idx)}
                                  className={cn(
                                    'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 px-3 text-sm outline-none transition-colors justify-between pl-6',
                                    isFocused && 'bg-muted text-foreground font-medium',
                                    isSelected && 'bg-muted/80 text-foreground font-semibold'
                                  )}
                                >
                                  <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="whitespace-normal break-words">{formatFieldLabel(opt.label, lang)}</span>
                                      {opt.type === 'array' && (
                                        <span className="text-[9px] font-bold text-red-500 border border-red-500/30 bg-red-500/10 px-1 py-0.2 rounded uppercase shrink-0">
                                          {lang === 'ar' ? 'سطر / لاين' : 'Line'}
                                        </span>
                                      )}
                                    </div>
                                    {opt.desc && (
                                      <span className="text-xs text-muted-foreground/75 mt-0.5 whitespace-normal break-words max-w-md">
                                        {opt.desc}
                                      </span>
                                    )}
                                  </div>
                                    {isSelected && (
                                      <Check className="h-4 w-4 shrink-0 text-foreground ml-2" />
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))
                      })()
                    ) : (
                      // Flat option rendering
                      <div className="space-y-0.5 p-1">
                        {filteredOptions.map((opt, idx) => {
                          const isSelected = multiple && Array.isArray(value)
                            ? value.includes(opt.value)
                            : opt.value === value
                          const isFocused = idx === focusedIndex
                          
                          return (
                            <div
                              key={opt.value}
                              role="option"
                              aria-selected={isSelected}
                              onMouseDown={(e) => { e.preventDefault(); handleSelect(opt.value); }}
                              onMouseEnter={() => setFocusedIndex(idx)}
                              className={cn(
                                'relative flex cursor-pointer select-none items-center rounded-sm py-2 px-3 text-sm outline-none transition-colors justify-between',
                                isFocused && 'bg-muted text-foreground font-medium',
                                isSelected && 'bg-muted/80 text-foreground font-semibold'
                            )}
                          >
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="whitespace-normal break-words">{formatFieldLabel(opt.label, lang)}</span>
                                {opt.type === 'array' && (
                                  <span className="text-[9px] font-bold text-red-500 border border-red-500/30 bg-red-500/10 px-1 py-0.2 rounded uppercase shrink-0">
                                    {lang === 'ar' ? 'سطر / لاين' : 'Line'}
                                  </span>
                                )}
                              </div>
                              {opt.desc && (
                                <span className="text-xs text-muted-foreground/75 mt-0.5 whitespace-normal break-words max-w-md">
                                  {opt.desc}
                                </span>
                              )}
                            </div>
                            
                            {isSelected && (
                              <Check className="h-4 w-4 shrink-0 text-foreground ml-2" />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                ) : (
                  <div className="py-6 text-center text-sm text-muted-foreground italic">
                    {lang === 'ar' ? 'لم يتم العثور على نتائج' : 'No matches found'}
                  </div>
                )}
                {totalMatches > filteredOptions.length && (
                  <div className="py-2 text-center text-[11px] text-muted-foreground font-medium border-t border-border/50">
                    {lang === 'ar'
                      ? `عرض ${filteredOptions.length} من ${totalMatches} — اكتب للبحث وتضييق النتائج`
                      : `Showing ${filteredOptions.length} of ${totalMatches} — type to narrow down`}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        portalTarget
      )}
    </div>
  )
}
