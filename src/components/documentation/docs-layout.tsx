'use client'

import { Menu, X, Search } from 'lucide-react'
import React, { useState, useEffect } from 'react'

import type { Language } from '@/lib/translations'

import { DocsSearch } from './docs-search'
import { DocsSidebar } from './docs-sidebar'


export function DocsLayout({
  children,
  lang,
}: {
  children: React.ReactNode
  lang: Language
}) {
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const isAr = lang === 'ar'

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Search Modal */}
      <DocsSearch
        lang={lang}
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
      />

      {/* Mobile Top Sub-bar */}
      <div className="lg:hidden border-b border-border bg-card/60 backdrop-blur-md px-4 py-2.5 flex items-center justify-between sticky top-14 z-30">
        <button
          type="button"
          onClick={() => setIsMobileMenuOpen(true)}
          className="flex items-center gap-2 text-xs font-semibold text-foreground p-1.5 rounded-md hover:bg-muted/50"
          aria-label={isAr ? 'فتح قائمة التوثيق' : 'Open documentation menu'}
        >
          <Menu className="h-4 w-4" />
          <span>{isAr ? 'فهرس التوثيق' : 'Documentation Menu'}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsSearchOpen(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground p-1.5 rounded-md hover:bg-muted/50"
          aria-label={isAr ? 'بحث' : 'Search'}
        >
          <Search className="h-4 w-4" />
          <span>{isAr ? 'بحث' : 'Search'}</span>
        </button>
      </div>

      {/* Mobile Drawer Sheet */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm lg:hidden animate-in fade-in-0 duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileMenuOpen(false)
          }}
        >
          <div className="fixed inset-y-0 start-0 w-4/5 max-w-xs bg-card border-e border-border shadow-2xl flex flex-col z-50">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <span className="text-xs font-bold text-foreground">
                {isAr ? 'مركز التوثيق والدليل' : 'Documentation Center'}
              </span>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground"
                aria-label={isAr ? 'إغلاق القائمة' : 'Close menu'}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <DocsSidebar
                lang={lang}
                onOpenSearch={() => {
                  setIsMobileMenuOpen(false)
                  setIsSearchOpen(true)
                }}
                isMobileDrawer={true}
                onCloseMobile={() => setIsMobileMenuOpen(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="max-w-7xl mx-auto w-full flex-1 flex">
        {/* Desktop Sticky Sidebar */}
        <div className="hidden lg:block shrink-0">
          <DocsSidebar
            lang={lang}
            onOpenSearch={() => setIsSearchOpen(true)}
          />
        </div>

        {/* Article & Content Area */}
        <div className="flex-1 min-w-0 px-4 sm:px-8 lg:px-12 py-8">
          {children}
        </div>
      </div>
    </div>
  )
}
