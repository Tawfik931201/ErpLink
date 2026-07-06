import { auth, currentUser } from '@clerk/nextjs/server'
import { Layers } from 'lucide-react'
import type { Metadata } from 'next'
import { headers, cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getWorkspaces } from '@/app/actions/workspaces'
import SidebarNav from '@/components/sidebar-nav'
import UserMenu from '@/components/user-menu'
import { Language, translations } from '@/lib/translations'

export const metadata: Metadata = {
  title: 'لوحة التحكم',
  description: 'إدارة ربط زد وأودو من مكان واحد',
}

async function ensureWorkspaceAccess() {
  const { userId } = await auth()
  if (!userId) return

  const res = await getWorkspaces()
  if (res.success) {
    const workspacesCount = res.workspaces?.length ?? 0
    if (workspacesCount === 0) {
      const pathname = headers().get('x-pathname') || ''
      if (pathname !== '/dashboard/settings/workspace') {
        redirect('/dashboard/settings/workspace')
      }
    }
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  try {
    await ensureWorkspaceAccess()
  } catch (err) {
    console.error("Failed to verify workspace access:", err)
  }

  let user = null
  try {
    user = await currentUser()
  } catch (err) {
    console.error("Failed to fetch Clerk user:", err)
  }
  
  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  const displayName = user 
    ? (user.firstName || user.lastName ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : (user.username || user.emailAddresses[0]?.emailAddress))
    : t('user.defaultName')

  const navSections = [
    {
      items: [
        { href: '/dashboard', icon: 'dashboard', label: t('nav.dashboard') },
      ]
    },
    {
      items: [
        { href: '/dashboard/connect-zid', icon: 'store', label: t('nav.connectZid') },
        { href: '/dashboard/connect-odoo', icon: 'database', label: t('nav.connectOdoo') },
        { href: '/dashboard/field-mapping', icon: 'mapping', label: t('nav.fieldMapping') },
        { href: '/dashboard/initial-transfer', icon: 'transfer', label: t('nav.initialTransfer') },
      ]
    },
    {
      items: [
        { href: '/dashboard/settings', icon: 'settings', label: t('nav.settings') },
      ]
    }
  ]

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans" dir={dir}>

      {/* ── Body Layout with Fixed Sidebar ─────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        <aside className={`w-[200px] shrink-0 ${dir === 'rtl' ? 'border-l' : 'border-r'} border-border bg-sidebar hidden md:flex flex-col select-none sticky top-0 h-screen overflow-visible z-40`}>
          {/* Logo inside sidebar top */}
          <div className="p-4 pb-2 pt-5 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0089FF] text-white shadow-sm shrink-0">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[18px] w-[18px]">
                <path d="M6 6H18V9H9V11H17V14H9V16H18V19H6V6Z" fill="currentColor" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white leading-none">ERP Link</span>
          </div>

          {/* Nav links */}
          <div className="flex-1 overflow-y-auto">
            <SidebarNav sections={navSections} />
          </div>

          {/* User Menu popover container at sidebar bottom */}
          <div className="p-4 mt-auto border-t border-border bg-secondary/10 flex flex-col overflow-visible">
            <UserMenu displayName={displayName} adminLabel={t('user.adminAccount')} />
          </div>
        </aside>

        {/* ── Main Content ─────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 md:p-8 max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
