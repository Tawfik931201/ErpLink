'use client'

import { Search, X, FileText, Hash, CornerDownLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import React, { useEffect, useState, useRef } from 'react'

import { searchDocs } from '@/lib/documentation/docs-search-index'
import type { DocSearchRecord } from '@/lib/documentation/docs-types'
import type { Language } from '@/lib/translations'

export function DocsSearch({
  lang,
  isOpen,
  onClose,
}: {
  lang: Language
  isOpen: boolean
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ record: DocSearchRecord; score: number }>>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const isAr = lang === 'ar'

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults([])
      setSelectedIndex(0)
      return
    }
    const res = searchDocs(query, lang, 8)
    setResults(res)
    setSelectedIndex(0)
  }, [query, lang])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
      } else if (e.key === 'Enter') {
        if (results[selectedIndex]) {
          e.preventDefault()
          handleSelect(results[selectedIndex].record)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, results, selectedIndex])

  const handleSelect = (record: DocSearchRecord) => {
    const url = `/docs/${record.slug}${record.anchor ? `#${record.anchor}` : ''}`
    onClose()
    router.push(url)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-background/80 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-label={isAr ? 'البحث في مركز التوثيق' : 'Search Documentation'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Search Input Bar */}
        <div className="flex items-center px-4 border-b border-border bg-muted/20">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAr ? 'ابحث في أدلة التوثيق، الحقول، الربط، الأخطاء...' : 'Search documentation, fields, integrations, logs...'}
            className="w-full py-3.5 px-3 bg-transparent text-xs sm:text-sm text-foreground focus:outline-none placeholder:text-muted-foreground"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 rounded text-muted-foreground hover:text-foreground"
              aria-label={isAr ? 'مسح البحث' : 'Clear search'}
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded border border-border font-mono">
              ESC
            </kbd>
          )}
        </div>

        {/* Results Container */}
        <div className="p-2 overflow-y-auto flex-1">
          {results.length > 0 ? (
            <ul className="space-y-1">
              {results.map(({ record }, idx) => {
                const isSelected = idx === selectedIndex
                return (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(record)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`w-full flex items-start gap-3 p-3 rounded-lg text-start transition-colors ${
                        isSelected
                          ? 'bg-primary/10 text-primary border border-primary/20'
                          : 'hover:bg-muted/50 text-foreground border border-transparent'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {record.anchor ? (
                          <Hash className="h-4 w-4 text-primary" />
                        ) : (
                          <FileText className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {record.categoryTitle[lang]}
                          </span>
                          {record.anchor && (
                            <span className="text-[10px] text-muted-foreground">/ #{record.anchor}</span>
                          )}
                        </div>
                        <p className="text-xs font-bold truncate">
                          {record.heading ? record.heading[lang] : record.title[lang]}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                          {record.content[lang]}
                        </p>
                      </div>
                      {isSelected && (
                        <div className="shrink-0 self-center hidden sm:flex items-center text-[10px] text-muted-foreground gap-1">
                          <CornerDownLeft className="h-3 w-3" />
                        </div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : query.trim().length >= 2 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              <p>{isAr ? 'لم يتم العثور على نتائج مطابقة.' : 'No matching results found.'}</p>
              <p className="mt-1 text-[11px] opacity-75">
                {isAr ? 'جرب البحث بكلمات مختلفة مثل: Zid, Odoo, Mapping, Webhook' : 'Try searching for terms like: Zid, Odoo, Mapping, Webhook'}
              </p>
            </div>
          ) : (
            <div className="py-8 px-4 text-center text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                {isAr ? 'بحث سريع وفوري بدون تأخير' : 'Instant client-side documentation search'}
              </p>
              <p className="text-[11px]">
                {isAr
                  ? 'اكتب عنوان الدليل أو اسم الحقل أو منصة الربط للوصول المباشر.'
                  : 'Type guide titles, field names, or platform settings for instant results.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer Shortcut Helper */}
        <div className="px-4 py-2 border-t border-border bg-muted/30 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{isAr ? 'انتقل بالأسهم واختر بـ Enter' : 'Navigate with arrows, select with Enter'}</span>
          <span className="font-mono text-[10px]">ERP Link Docs</span>
        </div>
      </div>
    </div>
  )
}
