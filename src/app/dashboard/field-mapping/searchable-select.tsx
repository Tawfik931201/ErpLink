'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/components/language-provider'
import { formatFieldLabel } from '@/lib/translations'

interface Option {
  value: string
  label: string
  desc?: string
  group?: string
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
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [dropdownDirection, setDropdownDirection] = useState<'down' | 'up'>('down')
  const { lang, dir } = useLanguage()

  const defaultPlaceholder = lang === 'ar' ? 'بحث...' : 'Search...'
  const finalPlaceholder = placeholder || defaultPlaceholder
  
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Calculate dropdown positioning dynamically (upward/downward) based on screen space
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      
      // If there's less than 240px below the input, and more space above, open upwards
      if (spaceBelow < 240 && spaceAbove > spaceBelow) {
        setDropdownDirection('up')
      } else {
        setDropdownDirection('down')
      }
    }
  }, [isOpen])

  // Find currently selected option (only for single select)
  const selectedOption = !multiple && typeof value === 'string' 
    ? options.find((opt) => opt.value === value) 
    : null

  // Filter options based on search query
  const filteredOptions = options.filter((opt) => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) return true
    const cleanLabelStr = formatFieldLabel(opt.label, lang).toLowerCase()
    const cleanGroupStr = opt.group ? formatFieldLabel(opt.group, lang).toLowerCase() : ''
    return (
      cleanLabelStr.includes(query) ||
      opt.value.toLowerCase().includes(query) ||
      (opt.desc && opt.desc.toLowerCase().includes(query)) ||
      cleanGroupStr.includes(query)
    )
  })

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
      return searchQuery
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
          'flex w-full items-center justify-between rounded-md text-sm ring-offset-background transition-all',
          variant === 'cell'
            ? 'border border-transparent bg-transparent hover:bg-muted/30 hover:border-input'
            : 'border border-input bg-background',
          multiple ? 'min-h-[36px] flex-wrap p-1.5 gap-1.5' : 'h-9 pl-3 pr-2',
          isOpen && 'border-[#00878a] ring-1 ring-[#00878a] bg-background',
          disabled && 'cursor-not-allowed opacity-50 bg-muted/40'
        )}
      >
        <div className="flex-1 flex flex-wrap items-center gap-1.5">
          {/* Search Icon */}
          {!multiple && isOpen && <Search className={cn("h-4 w-4 text-muted-foreground shrink-0", dir === 'ar' ? "ml-1.5" : "mr-1.5")} />}
          
          {/* Multi-select Badges */}
          {multiple && Array.isArray(value) && value.map((val) => {
            const opt = options.find((o) => o.value === val)
            if (!opt) return null
            return (
              <span
                key={val}
                className="inline-flex items-center gap-1 bg-[#00878a]/10 text-[#00878a] text-xs font-semibold px-2 py-0.5 rounded-md border border-[#00878a]/20 animate-in zoom-in-95 duration-150"
              >
                {formatFieldLabel(opt.label, lang)}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    const newValues = (value as string[]).filter((v) => v !== val)
                    onChange(newValues)
                  }}
                  className="hover:text-destructive text-muted-foreground/60 transition-colors"
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
            placeholder={multiple && Array.isArray(value) && value.length > 0 ? '' : finalPlaceholder}
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
              className="text-muted-foreground/60 hover:text-foreground p-0.5 rounded animate-in fade-in"
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
            className="text-muted-foreground/60 hover:text-foreground"
          >
            <ChevronsUpDown className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </div>

      {/* Dropdown Popover */}
      <AnimatePresence>
        {isOpen && !disabled && (
          <motion.div
            initial={{ opacity: 0, y: dropdownDirection === 'up' ? -4 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: dropdownDirection === 'up' ? -4 : 4 }}
            transition={{ duration: 0.1 }}
            className={cn(
              "absolute z-[100] w-full rounded-md border border-border bg-popover text-popover-foreground shadow-lg outline-none",
              dropdownDirection === 'up' ? "bottom-full mb-1.5" : "top-full mt-1.5"
            )}
          >
            <div
              ref={listRef}
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
                                onClick={() => handleSelect(opt.value)}
                                onMouseEnter={() => setFocusedIndex(idx)}
                                className={cn(
                                  'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 px-3 text-sm outline-none transition-colors justify-between pl-6',
                                  isFocused && 'bg-muted text-[#00878a] font-medium',
                                  isSelected && 'bg-[#00878a]/10 text-[#00878a] font-semibold'
                                )}
                              >
                                <div className="flex flex-col">
                                  <span className="truncate">{formatFieldLabel(opt.label, lang)}</span>
                                  {opt.desc && (
                                    <span className="text-xs text-muted-foreground/75 mt-0.5 truncate max-w-md">
                                      {opt.desc}
                                    </span>
                                  )}
                                </div>
                                {isSelected && (
                                  <Check className="h-4 w-4 shrink-0 text-[#00878a] ml-2" />
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
                          onClick={() => handleSelect(opt.value)}
                          onMouseEnter={() => setFocusedIndex(idx)}
                          className={cn(
                            'relative flex cursor-pointer select-none items-center rounded-sm py-2 px-3 text-sm outline-none transition-colors justify-between',
                            isFocused && 'bg-muted text-[#00878a] font-medium',
                            isSelected && 'bg-[#00878a]/10 text-[#00878a] font-semibold'
                          )}
                        >
                          <div className="flex flex-col">
                            <span className="truncate">{formatFieldLabel(opt.label, lang)}</span>
                            {opt.desc && (
                              <span className="text-xs text-muted-foreground/75 mt-0.5 truncate max-w-md">
                                {opt.desc}
                              </span>
                            )}
                          </div>
                          
                          {isSelected && (
                            <Check className="h-4 w-4 shrink-0 text-[#00878a] ml-2" />
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
