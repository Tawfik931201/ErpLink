'use client'

import React, { useState, useRef, useEffect } from 'react'
import { useClerk, useUser } from '@clerk/nextjs'
import { useTheme } from 'next-themes'
import { useLanguage } from '@/components/language-provider'
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
import { cn } from '@/lib/utils'
import { updateUserSettings } from '@/app/actions/settings'
import { getWorkspaces, setActiveWorkspace } from '@/app/actions/workspaces'

export default function UserMenu({ 
  displayName, 
  adminLabel 
}: { 
  displayName: string
  adminLabel: string 
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false)
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [activeWSId, setActiveWSId] = useState<string | null>(null)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  
  const { openUserProfile, signOut } = useClerk()
  const { user } = useUser()
  const { theme, setTheme } = useTheme()
  const { lang, setLang } = useLanguage()

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
    setLang(nextLang)
    await updateUserSettings(nextLang, theme || 'light')
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
    openUserProfile()
  }

  const handleSignOutClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    signOut()
  }

  const activeWorkspaceName = workspaces.find(w => w.id === activeWSId)?.name || (lang === 'ar' ? 'بيئة العمل' : 'Workspace')

  return (
    <div className="relative w-full select-none" ref={menuRef}>
      {/* Floating Menu Popover */}
      {isOpen && (
        <div className={cn(
          "absolute bottom-full mb-2 left-0 right-0 z-50 bg-card border border-border rounded-xl shadow-lg p-1.5 flex flex-col gap-1 animate-in fade-in-50 slide-in-from-bottom-2 duration-200"
        )}>
          {/* Option 1: Profile Details */}
          <button
            onClick={handleProfileClick}
            className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-bold text-foreground hover:bg-secondary/60 transition-all text-start"
          >
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>{lang === 'ar' ? 'الملف الشخصي' : 'My Profile'}</span>
          </button>

          {/* Option 2: Quick Language Switcher */}
          <button
            onClick={handleLanguageToggle}
            className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-xs font-bold text-foreground hover:bg-secondary/60 transition-all"
          >
            <div className="flex items-center gap-2.5 text-start">
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{lang === 'ar' ? 'اللغة' : 'Language'}</span>
            </div>
            <span className="text-[10px] font-extrabold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded uppercase">
              {lang === 'ar' ? 'en' : 'ar'}
            </span>
          </button>

          {/* Option 3: Quick Theme Switcher */}
          <button
            onClick={handleThemeToggle}
            className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-xs font-bold text-foreground hover:bg-secondary/60 transition-all"
          >
            <div className="flex items-center gap-2.5 text-start">
              {theme === 'dark' ? (
                <Moon className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <Sun className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <span>{lang === 'ar' ? 'المظهر' : 'Appearance'}</span>
            </div>
            <span className="text-[10px] font-extrabold bg-secondary text-muted-foreground border border-border px-2 py-0.5 rounded">
              {theme === 'dark' 
                ? (lang === 'ar' ? 'مضيء' : 'Light') 
                : (lang === 'ar' ? 'داكن' : 'Dark')}
            </span>
          </button>

          {/* Option 4: Workspace Selector (Collapsible) */}
          <div className="flex flex-col">
            <button
              onClick={(e) => { e.stopPropagation(); setIsWorkspaceOpen(!isWorkspaceOpen) }}
              className="flex items-center justify-between w-full rounded-lg px-3 py-2 text-xs font-bold text-foreground hover:bg-secondary/60 transition-all"
            >
              <div className="flex items-center gap-2.5 text-start min-w-0">
                <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate">{lang === 'ar' ? 'مساحة العمل' : 'Workspace'}</span>
              </div>
              <div className="flex items-center gap-1 min-w-0 text-muted-foreground font-bold">
                <span className="text-[10px] truncate max-w-[70px]">{activeWorkspaceName}</span>
                <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-200", isWorkspaceOpen && "rotate-180")} />
              </div>
            </button>

            {isWorkspaceOpen && (
              <div className="flex flex-col gap-0.5 pl-4 pr-4 py-1 mt-0.5 border-l border-r border-border/40 bg-secondary/15 rounded-lg max-h-40 overflow-y-auto">
                {workspaces.map((ws) => {
                  const isActive = ws.id === activeWSId
                  const isSwitching = switchingId === ws.id
                  return (
                    <button
                      key={ws.id}
                      onClick={(e) => handleWorkspaceSwitch(e, ws.id)}
                      className={cn(
                        "flex items-center justify-between w-full rounded-md px-2 py-1.5 text-[10px] font-bold transition-all text-start",
                        isActive
                          ? "bg-card text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                      )}
                    >
                      <span className="truncate pr-2 pl-2">{ws.name}</span>
                      {isSwitching ? (
                        <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                      ) : isActive ? (
                        <Check className="h-3 w-3 text-primary shrink-0" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <hr className="border-border/60 my-1" />

          {/* Option 5: Sign Out */}
          <button
            onClick={handleSignOutClick}
            className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 transition-all text-start"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span>{lang === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}</span>
          </button>
        </div>
      )}

      {/* Main Trigger Card */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between gap-2.5 w-full bg-card p-2 rounded-lg border border-border shadow-sm hover:border-border/80 hover:bg-secondary/20 transition-all duration-300 outline-none select-none text-start"
      >
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[10px] font-bold text-foreground/90 truncate leading-none">
            {user?.fullName || displayName}
          </span>
          <span className="text-[8px] text-muted-foreground font-bold mt-1.5 truncate leading-none">
            {user?.primaryEmailAddress?.emailAddress || adminLabel}
          </span>
        </div>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>
    </div>
  )
}
