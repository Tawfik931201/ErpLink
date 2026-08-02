import { cookies } from 'next/headers'
import { Link2 } from 'lucide-react'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import WorkspaceLinksClient from './WorkspaceLinksClient'

export default async function AdminWorkspaceLinksPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) return <div>Unauthorized</div>

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, partner_id, partner_status, user_id, created_at')
    .not('partner_id', 'is', null)
    .order('created_at', { ascending: false })

  const pendingLinks = workspaces?.filter((w) => w.partner_status === 'pending') ?? []
  const reviewedLinks = workspaces?.filter((w) => w.partner_status !== 'pending') ?? []

  return (
    <div className="p-6 md:p-10" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-foreground">
            {lang === 'ar' ? 'روابط الشركاء — مساحات العمل' : 'Partner Workspace Links'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {lang === 'ar'
              ? ` ${pendingLinks.length} رابط بانتظار المراجعة`
              : `${pendingLinks.length} link(s) pending review`}
          </p>
        </div>

        <WorkspaceLinksClient
          workspaces={workspaces ?? []}
          pendingLinks={pendingLinks}
          reviewedLinks={reviewedLinks}
          lang={lang}
        />
      </div>
    </div>
  )
}
