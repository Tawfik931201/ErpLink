import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import AdminNavLinks from '@/components/admin-nav-links'
import { Logo } from '@/components/ui/logo'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { resolveLanguage } from '@/lib/translations'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      {/* Header nav bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/app/dashboard"
              className="flex items-center"
              aria-label="ErpLink Dashboard"
            >
              <Logo variant="horizontal" size="sm" />
            </Link>
            <span className="text-muted-foreground/30">/</span>
            <span className="text-sm font-bold text-foreground">
              {lang === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}
            </span>
          </div>
          <AdminNavLinks lang={lang} />
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-6 md:p-8">{children}</main>
    </div>
  )
}
