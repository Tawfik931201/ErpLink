import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  Shield,
  LayoutDashboard,
} from 'lucide-react'
import Link from 'next/link'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import type { Language } from '@/lib/translations'
import { cn } from '@/lib/utils'
import AdminNavLinks from '@/components/admin-nav-links'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="flex min-h-screen bg-background text-foreground" dir={dir}>
      {/* Sidebar */}
      <aside className={cn(
        'w-[220px] shrink-0 border-border bg-card hidden md:flex flex-col sticky top-0 h-screen z-40',
        dir === 'rtl' ? 'border-l' : 'border-r',
      )}>
        {/* Logo */}
        <div className="p-4 pb-2 pt-5 flex items-center gap-2.5 border-b border-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white shadow-sm shrink-0">
            <Shield className="h-[18px] w-[18px]" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground leading-none">
            {lang === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}
          </span>
        </div>

        {/* Back to dashboard */}
        <div className="p-3 border-b border-border/40">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            {lang === 'ar' ? '→ العودة للوحة التحكم' : '← Back to Dashboard'}
          </Link>
        </div>

        {/* Nav links */}
        <AdminNavLinks lang={lang} />

        {/* Footer */}
        <div className="p-4 border-t border-border text-[10px] text-muted-foreground text-center">
          {lang === 'ar' ? 'لوحة إدارة الشركاء' : 'Partner Admin Panel'}
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 border-b border-border bg-card px-4 h-14 flex items-center gap-3">
        <Shield className="h-5 w-5 text-red-600 shrink-0" />
        <span className="text-sm font-bold flex-1">
          {lang === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}
        </span>
        <Link
          href="/dashboard"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {lang === 'ar' ? 'الرئيسية' : 'Home'}
        </Link>
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto md:pt-0 pt-14">
        {children}
      </main>
    </div>
  )
}
