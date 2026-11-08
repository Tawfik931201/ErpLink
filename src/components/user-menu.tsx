'use client'

import { useClerk, useUser } from '@clerk/nextjs'
import { 
  User, 
  Globe, 
  Sun, 
  Moon, 
  LogOut, 
  ChevronUp, 
  ChevronDown,
  Briefcase,
  Check,
  Loader2
} from 'lucide-react'
import { useTheme } from 'next-themes'
import React, { useState, useRef, useEffect } from 'react'

import { updateUserSettings } from '@/app/actions/settings'
import { getWorkspaces, setActiveWorkspace } from '@/app/actions/workspaces'
import { useLanguage } from '@/components/language-provider'
import { getClerkAppearance } from '@/lib/clerk-appearance'
import { cn } from '@/lib/utils'

export default function UserMenu({ 
  displayName, 
  adminLabel,
  placement = 'sidebar',
}: { 
  displayName: string
  adminLabel: string 
  placement?: 'sidebar' | 'header'
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [activeWSId, setActiveWSId] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  
  const { openUserProfile, signOut } = useClerk()
  const { user } = useUser()
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { lang, setLang, dir } = useLanguage()

  useEffect(() => {
    setMounted(true)
  }, [])

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setIsWorkspaceOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch workspaces when menu opens
  useEffect(() => {
    if (isOpen) {
      async function fetchWorkspacesList() {
        const res = await getWorkspaces()
        if (res.success && res.workspaces) {
          setWorkspaces(res.workspaces)
          setActiveWSId(res.activeWorkspaceId || null)
        }
      }
      fetchWorkspacesList()
    }
  }, [isOpen])

  const handleLanguageToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextLang = lang === 'ar' ? 'en' : 'ar'
    // Save to DB first — setLang will trigger a full page reload
    await updateUserSettings(nextLang, theme || 'light')
    setLang(nextLang)
  }

  const handleThemeToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(nextTheme)
    await updateUserSettings(lang, nextTheme)
  }

  const handleWorkspaceSwitch = async (e: React.MouseEvent, wsId: string) => {
    e.stopPropagation()
    if (wsId === activeWSId || switchingId) return
    setSwitchingId(wsId)
    const res = await setActiveWorkspace(wsId)
    if (res.success) {
      setActiveWSId(wsId)
      setIsOpen(false)
      setIsWorkspaceOpen(false)
      // Force reload to completely refresh the Server Components layout and tokens
      window.location.reload()
    } else {
      alert(res.error || (lang === 'ar' ? 'فشل في تبديل بيئة العمل' : 'Failed to switch workspace'))
    }
    setSwitchingId(null)
  }

  const handleProfileClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsOpen(false)
    if (user) {
      openUserProfile({ appearance: getClerkAppearance(resolvedTheme === 'dark') })
    }
  }

  const handleSignOutClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    signOut()
  }

  const activeWorkspaceName = workspaces.find(w => w.id === activeWSId)?.name || (lang === 'ar' ? 'بيئة العمل' : 'Workspace')

  return (
    <div className="relative w-full select-none" ref={menuRef}>
      {/* Floating Menu Popover - Side Flyout layout */}
      {isOpen && (
        <div className={cn(
          "absolute z-50 w-56 bg-sidebar border border-border rounded-lg p-1.5 flex flex-col gap-1 animate-in fade-in-50 duration-200",
          placement === 'header' ? 'end-0 top-full mt-2 max-h-[70dvh] overflow-y-auto'
            : cn('bottom-0', dir === 'rtl' ? "right-full mr-6" : "left-full ml-6")
        )}>
          {/* Option 1: Profile Details */}
          {user && (
            <button
              onClick={handleProfileClick}
              className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-medium text-foreground dark:text-[#999999] hover:bg-muted/40 dark:hover:bg-[#424242e0] transition-colors text-start"
            >
              <User className="h-4 w-4 text-muted-foreground dark:text-[#999999] shrink-0" />
              <span className="flex-1">{lang === 'ar' ? 'الملف الشخصي' : 'My Profile'}</span>
            </button>
          )}

          {/* Option 2: Quick Language Switcher */}
          <button
            onClick={handleLanguageToggle}
            className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-xs font-medium text-foreground dark:text-[#999999] hover:bg-muted/40 dark:hover:bg-[#424242e0] transition-colors"
          >
            <div className="flex items-center gap-2.5 text-start">
              <Globe className="h-4 w-4 text-muted-foreground dark:text-[#999999] shrink-0" />
              <span>{lang === 'ar' ? 'اللغة' : 'Language'}</span>
            </div>
            <span className="text-[10px] font-semibold bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded uppercase">
              {lang === 'ar' ? 'en' : 'ar'}
            </span>
          </button>

          {/* Option 3: Quick Theme Switcher */}
          <button
            onClick={handleThemeToggle}
            className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-xs font-medium text-foreground dark:text-[#999999] hover:bg-muted/40 dark:hover:bg-[#424242e0] transition-colors"
          >
            <div className="flex items-center gap-2.5 text-start">
              {theme === 'dark' ? (
                <Moon className="h-4 w-4 text-muted-foreground dark:text-[#999999] shrink-0" />
              ) : (
                <Sun className="h-4 w-4 text-muted-foreground dark:text-[#999999] shrink-0" />
              )}
              <span>{lang === 'ar' ? 'المظهر' : 'Appearance'}</span>
            </div>
            <span className="text-[10px] font-semibold bg-muted text-muted-foreground border border-border px-2 py-0.5 rounded">
              {theme === 'dark'
                ? (lang === 'ar' ? 'مضيء' : 'Light')
                : (lang === 'ar' ? 'داكن' : 'Dark')}
            </span>
          </button>

          {/* Option 4: Workspace Selector (Collapsible flyout to the side) */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setIsWorkspaceOpen(!isWorkspaceOpen) }}
              className={cn(
                "flex items-center justify-between w-full rounded-lg px-3 py-2 text-xs font-medium text-foreground dark:text-[#999999] hover:bg-muted/40 dark:hover:bg-[#424242e0] transition-colors",
                isWorkspaceOpen && "bg-muted/60 dark:bg-[#424242f0]"
              )}
            >
              <div className="flex items-center gap-2.5 text-start min-w-0">
                <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">{lang === 'ar' ? 'مساحة العمل' : 'Workspace'}</span>
              </div>
              <div className="flex items-center gap-1 min-w-0 text-muted-foreground font-bold">
                <span className="text-[10px] truncate max-w-[65px]">{activeWorkspaceName}</span>
                <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200", isWorkspaceOpen ? "rotate-180" : (dir === 'rtl' ? "rotate-90" : "-rotate-90"))} />
              </div>
            </button>

            {isWorkspaceOpen && (
              <div className={cn(
                "z-50 bg-sidebar border border-border rounded-lg p-1.5 flex flex-col gap-0.5 max-h-60 overflow-y-auto animate-in fade-in-50 duration-150",
                placement === 'header' ? 'relative mt-1 w-full'
                  : cn('absolute top-0 w-52', dir === 'rtl' ? "right-full mr-2" : "left-full ml-2")
              )}>
                <div className="px-2 py-1 border-b border-border/40 text-[9px] font-extrabold text-muted-foreground uppercase mb-1">
                  {lang === 'ar' ? 'اختر مساحة العمل' : 'Select Workspace'}
                </div>
                {workspaces.map((ws) => {
                  const isActive = ws.id === activeWSId
                  const isSwitching = switchingId === ws.id
                  return (
                    <button
                      key={ws.id}
                      onClick={(e) => handleWorkspaceSwitch(e, ws.id)}
                      className={cn(
                        "flex items-center justify-between w-full rounded-md px-2 py-1.5 text-[10px] font-bold transition-colors text-start",
                        isActive
                          ? "bg-muted/60 dark:bg-[#424242f0] text-foreground dark:text-[#999999]"
                          : "text-muted-foreground dark:text-[#999999] hover:text-foreground dark:hover:text-[#999999] hover:bg-muted/40 dark:hover:bg-[#424242e0]"
                      )}
                    >
                      <span className="truncate pr-1 pl-1">{ws.name}</span>
                      {isSwitching ? (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                      ) : isActive ? (
                        <Check className="h-3 w-3 text-foreground shrink-0" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <hr className="border-border my-1" />

          {/* Option 5: Sign Out */}
          <button
            onClick={handleSignOutClick}
            className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-medium text-foreground dark:text-[#999999] hover:bg-muted/40 dark:hover:bg-[#424242e0] transition-colors text-start"
          >
            <LogOut className="h-4 w-4 text-muted-foreground dark:text-[#999999] shrink-0" />
            <span>{lang === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}</span>
          </button>
        </div>
      )}

      {/* Main Trigger Card - Completely Redesigned Premium Style */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2.5 w-full p-2 rounded-lg transition-colors duration-150 outline-none select-none text-start",
          isOpen
            ? "bg-muted/60 dark:bg-[#424242f0]"
            : "bg-transparent hover:bg-muted/40 dark:hover:bg-[#424242e0]"
        )}
      >
        {/* User Avatar */}
        {mounted && user?.imageUrl ? (
          <img
            src={user.imageUrl}
            alt="User Avatar"
            className="h-8 w-8 rounded-full border border-border object-cover shrink-0"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background font-extrabold text-xs shrink-0">
            {((mounted && user?.fullName) || displayName || 'U').charAt(0).toUpperCase()}
          </div>
        )}

        {/* Name & Details */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span className="text-[11px] font-semibold text-foreground truncate leading-snug">
            {mounted && user?.fullName ? user.fullName : displayName}
          </span>
          <span className="text-[9px] text-muted-foreground truncate leading-none mt-1">
            {mounted && user?.primaryEmailAddress?.emailAddress ? user.primaryEmailAddress.emailAddress : adminLabel}
          </span>
        </div>

        {/* Chevron status */}
        <div className="text-muted-foreground/60 transition-transform duration-200 shrink-0">
          {dir === 'rtl' ? (
            <ChevronUp className={cn("h-3 w-3 rotate-90 transition-transform duration-200", isOpen && "rotate-[270deg]")} />
          ) : (
            <ChevronUp className={cn("h-3 w-3 -rotate-90 transition-transform duration-200", isOpen && "rotate-90")} />
          )}
        </div>
      </button>
    </div>
  )
}
