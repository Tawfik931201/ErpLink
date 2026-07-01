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

  const navItems = [
    { href: '/dashboard', icon: 'dashboard', label: t('nav.dashboard') },
    { href: '/dashboard/connect-zid', icon: 'store', label: t('nav.connectZid') },
    { href: '/dashboard/connect-odoo', icon: 'database', label: t('nav.connectOdoo') },
    { href: '/dashboard/field-mapping', icon: 'mapping', label: t('nav.fieldMapping') },
    { href: '/dashboard/initial-transfer', icon: 'transfer', label: t('nav.initialTransfer') },
    { href: '/dashboard/settings', icon: 'settings', label: t('nav.settings') },
  ]

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans" dir={dir}>

      {/* ── Body Layout with Fixed Sidebar ─────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        <aside className={`w-[200px] shrink-0 ${dir === 'ar' ? 'border-l' : 'border-r'} border-border bg-sidebar hidden md:flex flex-col select-none sticky top-0 h-screen overflow-y-auto`}>
          {/* Logo inside sidebar top */}
          <div className="p-4 pb-3 flex items-center gap-2.5 border-b border-border">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-purple-600 text-white shadow-lg shadow-primary/20 ring-4 ring-primary/5">
              <Layers className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-tight text-foreground leading-none">ERP Link</span>
              <span className="text-[10px] text-muted-foreground font-bold mt-1">Zid & Odoo Sync</span>
            </div>
          </div>


          {/* Nav links */}
          <SidebarNav items={navItems} />

          {/* User Menu popover container at sidebar bottom */}
          <div className="p-4 mt-auto border-t border-border bg-secondary/10 flex flex-col">
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
