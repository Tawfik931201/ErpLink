import type { Metadata } from 'next'
import { headers, cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getLayoutUserInfo } from '@/app/actions/layout-info'
import { getCurrentUserPermissions, checkPendingInvitations } from '@/app/actions/workspace-members'
import { hasAnyWorkspace } from '@/app/actions/workspaces'
import MobileNav from '@/components/mobile-nav'
import SidebarNav, { type NavSection } from '@/components/sidebar-nav'
import SubscriptionBanner from '@/components/subscription/SubscriptionBanner'
import UserMenu from '@/components/user-menu'
import { getActiveUserId, getActiveWorkspaceId } from '@/lib/auth'
import { translations } from '@/lib/translations'
import type { Language } from '@/lib/translations'

export const metadata: Metadata = {
  title: 'لوحة التحكم',
  description: 'إدارة ربط زد وأودو من مكان واحد',
}

async function ensureWorkspaceAccess() {
  const userId = await getActiveUserId()
  if (!userId) return

  const pathname = headers().get('x-pathname') || ''
  if (pathname === '/dashboard/settings/workspace') return

  // Check active workspace first to skip existence check in 99% of requests
  const activeId = await getActiveWorkspaceId()
  if (activeId) {
    return
  }

  // Lightweight existence check — getWorkspaces() previously ran heavy joined
  // queries (merchant tokens + ERP connections) on every single page navigation
  // just to know whether the user has at least one workspace.
  const res = await hasAnyWorkspace()
  if (res.success && !res.hasWorkspace) {
    redirect('/dashboard/settings/workspace')
  }

  // User has workspaces (owner or member) but none marked as active —
  // send them to the workspace settings page to pick one.
  if (res.hasWorkspace) {
    redirect('/dashboard/settings/workspace')
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  try {
    await ensureWorkspaceAccess()
  } catch (err) {
    // redirect() works by throwing a special error — it must never be swallowed
    if (err && typeof err === 'object' && 'digest' in err && String((err as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw err
    }
    console.error("Failed to verify workspace access:", err)
  }

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  // Run layout info and permissions check in parallel
  const [layoutInfo, permissionsData] = await Promise.all([
    getLayoutUserInfo(),
    getCurrentUserPermissions()
  ])

  const { isOwner, permissions } = permissionsData
  const userId = await getActiveUserId()

  // Auto-accept any pending workspace invitations for this user (background)
  if (userId && layoutInfo.email) {
    checkPendingInvitations(userId, layoutInfo.email).catch((err: unknown) =>
      console.error('[Dashboard] Failed to check pending invitations:', err)
    )
  }

  const permissionMap: Record<string, string> = {
    '/dashboard': 'dashboard',
    '/dashboard/setup': 'dashboard',
    '/dashboard/connect-store': 'connect-store',
    '/dashboard/connect-odoo': 'connect-odoo',
    '/dashboard/mapping-center': 'mapping-center',
    '/dashboard/mapping-center/orders': 'mapping-center',
    '/dashboard/initial-transfer': 'transfers',
    '/dashboard/tickets': 'tickets',
    '/dashboard/settings': 'settings',
    '/dashboard/settings/notifications': 'settings-notifications',
    '/dashboard/settings/team': 'settings-team',
  }

  // Check current page permission (without redirect) — a member who lacks
  // access sees a "no permission" message inside the layout instead.
  const currentPath = headers().get('x-pathname') || ''
  const isPageRestricted = !isOwner
    && currentPath !== '/dashboard/settings/workspace'
    && (permissionMap[currentPath] && !permissions.includes(permissionMap[currentPath]))

  // Special case: main settings page redirects to workspace when the member
  // has no "settings" permission, because workspace is always accessible.
  if (
    !isOwner &&
    currentPath === '/dashboard/settings' &&
    !permissions.includes('settings')
  ) {
    redirect('/dashboard/settings/workspace')
  }

  const displayName = layoutInfo.name || layoutInfo.email || t('user.defaultName')

  function hasPageAccess(href: string): boolean {
    if (isOwner) return true
    if (href === '/dashboard/settings') return true // settings link always visible (workspace is always accessible)
    const permKey = permissionMap[href]
    return permKey ? permissions.includes(permKey) : false
  }

  // P0 IA: 5 clear groups — Home, Connections, Sync, Support, Settings.
  // All 9 pages are kept (no route/API change); advanced tools live under "Sync".
  // NOTE: no dead `/dashboard/integrations` or `/dashboard/workspace` links exist
  // in this nav; the canonical workspace page is `/dashboard/settings/workspace`.
  const rawSections: NavSection[] = [
    {
      label: lang === 'ar' ? 'الرئيسية' : 'Home',
      items: [
        { href: '/dashboard', icon: 'dashboard', label: t('nav.dashboard') },
        { href: '/dashboard/setup', icon: 'setup', label: t('nav.setup') },
      ]
    },
    {
      label: lang === 'ar' ? 'الربط' : 'Connections',
      items: [
        { href: '/dashboard/connect-store', icon: 'store', label: t('nav.connectZid') },
        { href: '/dashboard/connect-odoo', icon: 'database', label: t('nav.connectOdoo') },
      ]
    },
    {
      label: lang === 'ar' ? 'المزامنة' : 'Sync',
      items: [
        { href: '/dashboard/mapping-center', icon: 'mapping', label: t('nav.fieldMapping') },
        { href: '/dashboard/mapping-center/orders', icon: 'order', label: t('nav.orderDashboard') },
        { href: '/dashboard/initial-transfer', icon: 'transfer', label: t('nav.initialTransfer') },
      ]
    },
    {
      label: lang === 'ar' ? 'الدعم' : 'Support',
      items: [
        { href: '/dashboard/tickets', icon: 'ticket', label: t('nav.tickets') },
      ]
    },
    {
      label: lang === 'ar' ? 'الإعدادات' : 'Settings',
      items: [
        { href: '/dashboard/settings', icon: 'settings', label: t('nav.settings') },
      ]
    },
  ]

  // Filter nav sections based on permissions
  const navSections: NavSection[] = rawSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasPageAccess(item.href)),
    }))
    .filter((section) => section.items.length > 0)

  // Admin section: shown only to admin users
  if (layoutInfo.isAdmin) {
    navSections.push({
      items: [
        { href: '/admin', icon: 'admin', label: lang === 'ar' ? 'الإحصائيات' : 'Stats' },
        { href: '/admin/clients', icon: 'users', label: lang === 'ar' ? 'العملاء' : 'Clients' },
        { href: '/admin/subscriptions', icon: 'card', label: lang === 'ar' ? 'الاشتراكات' : 'Subscriptions' },
      ],
    })
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans" dir={dir}>

      {/* ── Body Layout with Fixed Sidebar ─────────────────── */}
      <div className="flex flex-1 min-h-0 relative">

        <aside className={`w-[200px] shrink-0 ${dir === 'rtl' ? 'border-l' : 'border-r'} border-border bg-sidebar hidden md:flex flex-col select-none sticky top-0 h-screen overflow-visible z-40`}>
          {/* Logo inside sidebar top */}
          <div className="p-4 pb-2 pt-5 flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-gradient-to-br from-[#0066FF] to-[#0052CC] text-white shrink-0">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-[16px] w-[16px]">
                <path d="M6 6H18V9H9V11H17V14H9V16H18V19H6V6Z" fill="currentColor" />
              </svg>
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground leading-none">ERP Link</span>
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
          <MobileNav sections={navSections} dir={dir} />
          <div className="p-6 md:p-8 max-w-7xl mx-auto">
            <SubscriptionBanner />
            {isPageRestricted ? (
              <div className="flex items-center justify-center h-full min-h-[60vh]">
                <div className="text-center max-w-md">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold mb-2">{lang === 'ar' ? 'ليس لديك صلاحية' : 'No Permission'}</h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {lang === 'ar'
                      ? 'لا تملك صلاحية الوصول إلى هذه الصفحة. يمكنك التنقل إلى الصفحات المتاحة لك من القائمة الجانبية.'
                      : 'You do not have permission to view this page. Navigate to available pages from the sidebar.'}
                  </p>
                </div>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
