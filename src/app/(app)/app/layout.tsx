import type { Metadata } from 'next'
import { headers, cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getLayoutUserInfo } from '@/app/actions/layout-info'
import { getMyActiveSubscription } from '@/app/actions/subscription-actions'
import { getCurrentUserPermissions, checkPendingInvitations } from '@/app/actions/workspace-members'
import { hasAnyWorkspace } from '@/app/actions/workspaces'
import MobileNav from '@/components/mobile-nav'
import SidebarNav, { type NavSection } from '@/components/sidebar-nav'
import SubscriptionBanner from '@/components/subscription/SubscriptionBanner'
import { Logo } from '@/components/ui/logo'
import UserMenu from '@/components/user-menu'
import { getActiveUserId, getActiveWorkspaceId } from '@/lib/auth'
import { resolveLanguage, translations } from '@/lib/translations'

export const metadata: Metadata = {
  title: 'لوحة التحكم',
  description: 'إدارة ربط زد وأودو من مكان واحد',
}

async function ensureWorkspaceAccess() {
  const userId = await getActiveUserId()
  if (!userId) return

  const pathname = (await headers()).get('x-pathname') || ''
  if (pathname === '/app/settings/workspace') return

  const activeId = await getActiveWorkspaceId()
  if (activeId) {
    return
  }

  const res = await hasAnyWorkspace()
  if (res.success && !res.hasWorkspace) {
    redirect('/app/settings/workspace')
  }

  if (res.hasWorkspace) {
    redirect('/app/settings/workspace')
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    await ensureWorkspaceAccess()
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err && String((err as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw err
    }
    console.error("Failed to verify workspace access:", err)
  }

  const cookieStore = await cookies()
  const lang = resolveLanguage(cookieStore.get('lang')?.value)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) => translations[lang][key] || translations['ar'][key]

  const [layoutInfo, permissionsData, subscriptionAccess] = await Promise.all([
    getLayoutUserInfo(),
    getCurrentUserPermissions(),
    getMyActiveSubscription(),
  ])

  const { isOwner, permissions } = permissionsData
  const userId = await getActiveUserId()

  if (userId && layoutInfo.email) {
    // بلا وسائط: الدالة تقرأ صاحب الجلسة من Clerk بنفسها (وإلا استطاع أي
    // متصل تمرير بريد غيره والتحاق بمساحة عميل آخر).
    checkPendingInvitations().catch((err: unknown) =>
      console.error('[App Layout] Failed to check pending invitations:', err)
    )
  }

  const permissionMap: Record<string, string> = {
    '/app/dashboard': 'dashboard',
    '/app/connect-store': 'connect-store',
    '/app/connect-odoo': 'connect-odoo',
    '/app/mapping-center': 'mapping-center',
    '/app/mapping-center/custom': 'mapping-center',
    '/app/mapping-center/add-field': 'mapping-center',
    '/app/mapping-center/categories': 'mapping-center',
    '/app/queue': 'mapping-center',
    '/app/logs': 'mapping-center',
    '/app/initial-transfer': 'transfers',
    '/app/tickets': 'tickets',
    '/app/settings': 'settings',
    '/app/settings/notifications': 'settings-notifications',
    '/app/settings/team': 'settings-team',
    '/app/settings/billing': 'settings-billing',
  }

  const currentPath = (await headers()).get('x-pathname') || ''
  // A detail page under /app/logs/<id> is not an exact key in the map (the id
  // is a UUID), so resolve it to the same permission as the list page.
  const permissionKey = permissionMap[currentPath]
    ?? (currentPath.startsWith('/app/logs/') ? 'mapping-center' : undefined)
  const isPageRestricted = !isOwner
    && currentPath !== '/app/settings/workspace'
    && (permissionKey && !permissions.includes(permissionKey))

  // Workspace access gate (2026-10-19): a workspace whose 7-day free trial has
  // run out — or that the backend has already archived (expired subscription) —
  // is closed, so the client app is replaced by a "closed" notice. Admins are
  // exempt (they manage billing and troubleshoot, mostly via /admin, and the
  // strip still warns them), and the whole /app/settings subtree stays reachable
  // so the user can manage billing or create/switch to another workspace.
  const workspaceClosed =
    !layoutInfo.isAdmin &&
    !currentPath.startsWith('/app/settings') &&
    subscriptionAccess.success === true &&
    (subscriptionAccess.workspaceArchived ||
      subscriptionAccess.trial?.isExpired === true ||
      // An expired subscription closes the app immediately, even before the
      // best-effort `archived_at` write lands (the strip already says the
      // workspace is archived). Registering/extending a subscription reopens it.
      subscriptionAccess.subscription?.isExpired === true)

  if (
    !isOwner &&
    currentPath === '/app/settings' &&
    !permissions.includes('settings')
  ) {
    redirect('/app/settings/workspace')
  }

  const displayName = layoutInfo.name || layoutInfo.email || t('user.defaultName')

  function hasPageAccess(href: string): boolean {
    if (isOwner) return true
    if (href === '/app/settings') return true
    const permKey = permissionMap[href]
    return permKey ? permissions.includes(permKey) : false
  }

  const rawSections: NavSection[] = [
    {
      label: lang === 'ar' ? 'الرئيسية' : 'Home',
      items: [
        { href: '/app/dashboard', icon: 'dashboard', label: t('nav.dashboard') },
      ]
    },
    {
      label: lang === 'ar' ? 'الربط' : 'Connections',
      items: [
        { href: '/app/connect-store', icon: 'store', label: t('nav.connectZid') },
        { href: '/app/connect-odoo', icon: 'database', label: t('nav.connectOdoo') },
      ]
    },
    {
      label: lang === 'ar' ? 'المزامنة' : 'Sync',
      items: [
        { href: '/app/mapping-center', icon: 'mapping', label: t('nav.fieldMapping') },
        { href: '/app/queue', icon: 'order', label: t('nav.queue') },
        { href: '/app/logs', icon: 'logs', label: t('nav.logs') },
        { href: '/app/initial-transfer', icon: 'transfer', label: t('nav.initialTransfer') },
      ]
    },
    {
      label: lang === 'ar' ? 'الدعم' : 'Support',
      items: [
        { href: '/app/tickets', icon: 'ticket', label: t('nav.tickets') },
      ]
    },
    {
      label: lang === 'ar' ? 'الإعدادات' : 'Settings',
      items: [
        { href: '/app/settings', icon: 'settings', label: t('nav.settings') },
      ]
    },
  ]

  const navSections: NavSection[] = rawSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasPageAccess(item.href)),
    }))
    .filter((section) => section.items.length > 0)

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
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground font-sans" dir={dir}>
      {/* Fixed top alert strip — sits above the sidebar and the page content.
          The page (main) scrolls underneath it. Rendered for everyone,
          including admins, and not dismissible (product decision 2026-10-19). */}
      <SubscriptionBanner />
      <div className="flex flex-1 min-h-0 relative">
        <aside className={`w-[200px] shrink-0 ${dir === 'rtl' ? 'border-l' : 'border-r'} border-border bg-sidebar hidden md:flex flex-col select-none h-full overflow-visible z-40`}>
          <div className="p-4 pb-2 pt-5 flex items-center">
            <Link href="/app/dashboard" className="flex items-center" aria-label="ErpLink Dashboard">
              <Logo variant="horizontal" size="md" priority />
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav sections={navSections} />
          </div>
          <div className="p-4 mt-auto border-t border-border bg-secondary/10 flex flex-col overflow-visible">
            <UserMenu displayName={displayName} adminLabel={t('user.adminAccount')} />
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto">
          <MobileNav sections={navSections} dir={dir} />
          <div className="p-6 md:p-8 max-w-7xl mx-auto">
            {workspaceClosed ? (
              <div className="flex items-center justify-center h-full min-h-[60vh]">
                <div className="text-center max-w-md">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                    <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold mb-2">
                    {lang === 'ar' ? 'مساحة العمل مغلقة' : 'Workspace closed'}
                  </h2>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {lang === 'ar'
                      ? 'انتهت فترة التجربة المجانية (7 أيام) ولم يتم تسجيل اشتراك، لذلك تم إغلاق مساحة العمل. تواصل مع الدعم للاشتراك وإعادة التفعيل، أو أنشئ مساحة عمل جديدة لتبدأ تجربة مجانية جديدة لمدة 7 أيام.'
                      : 'The 7-day free trial has ended and no subscription was registered, so this workspace has been closed. Contact support to subscribe and reactivate it, or create a new workspace to start a fresh 7-day free trial.'}
                  </p>
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <Link
                      href="/contact"
                      className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
                    >
                      {lang === 'ar' ? 'تواصل مع الدعم' : 'Contact support'}
                    </Link>
                    <Link
                      href="/app/settings/workspace"
                      className="inline-flex items-center rounded-lg border border-border px-4 py-2 text-xs font-bold hover:bg-muted"
                    >
                      {lang === 'ar' ? 'تبديل أو إنشاء مساحة عمل' : 'Switch or create workspace'}
                    </Link>
                  </div>
                </div>
              </div>
            ) : isPageRestricted ? (
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
