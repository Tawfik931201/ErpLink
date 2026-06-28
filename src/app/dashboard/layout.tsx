import { UserButton } from '@clerk/nextjs'
import { auth } from '@clerk/nextjs/server'
import { LayoutDashboard, Store, Database, Briefcase, GitCompare } from 'lucide-react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getWorkspaces } from '@/app/actions/workspaces'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Manage your Zid and Odoo integrations',
}

async function ensureWorkspaceAccess() {
  const { userId } = await auth()
  if (!userId) return

  const res = await getWorkspaces()
  if (res.success) {
    const workspacesCount = res.workspaces?.length ?? 0
    if (workspacesCount === 0) {
      const pathname = headers().get('x-pathname') || ''
      if (pathname !== '/dashboard/workspace') {
        redirect('/dashboard/workspace')
      }
    }
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await ensureWorkspaceAccess()

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-6">
          <Link href="/" className="gradient-brand-text text-xl font-bold">
            ZidLink
          </Link>
          <div className="flex items-center gap-4">
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>

      {/* Main Content Area with Sidebar */}
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-64 border-r border-border bg-card hidden md:block">
          <nav className="flex flex-col gap-1 p-4 text-sm font-medium text-muted-foreground">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-foreground hover:bg-accent hover:text-foreground transition-all"
            >
              <LayoutDashboard className="h-4 w-4 text-primary" />
              Dashboard
            </Link>
            <Link
              href="/dashboard/connect-zid"
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent hover:text-foreground transition-all"
            >
              <Store className="h-4 w-4 text-zid-500" />
              الربط مع زد
            </Link>
            <Link
              href="/dashboard/connect-odoo"
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent hover:text-foreground transition-all"
            >
              <Database className="h-4 w-4 text-odoo-500" />
              الربط مع أودو
            </Link>
            <Link
              href="/dashboard/workspace"
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent hover:text-foreground transition-all"
            >
              <Briefcase className="h-4 w-4" />
              workspace
            </Link>
            <Link
              href="/dashboard/field-mapping"
              className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent hover:text-foreground transition-all"
            >
              <GitCompare className="h-4 w-4" />
              ربط الحقول
            </Link>
          </nav>
        </aside>

        {/* Dynamic Page Content */}
        <main className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-5xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
