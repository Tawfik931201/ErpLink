import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import AdminNavLinks from '@/components/admin-nav-links'
import { Logo } from '@/components/ui/logo'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import { countNewContactMessages } from '@/lib/contact-messages'
import { resolveLanguage } from '@/lib/translations'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) redirect('/app/dashboard')

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  // Unread contact messages drive the nav badge. `countNewContactMessages`
  // swallows its own errors (a missing table returns 0), so a deployment
  // without migration 20261025 still renders the admin panel.
  const newMessages = await countNewContactMessages()

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      {/* Header nav bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-4 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link
              href="/app/dashboard"
              className="flex items-center"
              aria-label="ErpLink Dashboard"
            >
              <Logo variant="horizontal" size="sm" />
            </Link>
            <span className="text-muted-foreground/30">/</span>
            <span className="text-xs sm:text-sm font-bold text-foreground whitespace-nowrap">
              {lang === 'ar' ? 'لوحة الإدارة' : 'Admin Panel'}
            </span>
          </div>
          <AdminNavLinks lang={lang} newMessages={newMessages} />
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-4 sm:p-6 md:p-8">{children}</main>
    </div>
  )
}
