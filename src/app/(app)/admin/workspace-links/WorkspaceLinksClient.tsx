'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Loader2, Link2 } from 'lucide-react'

import { reviewPartnerWorkspace } from '@/app/actions/partner-admin'
import { cn } from '@/lib/utils'

interface WorkspaceRow {
  id: string
  name: string
  partner_id: string | null
  partner_status: string | null
  user_id: string
  created_at: string
}

interface Props {
  workspaces: WorkspaceRow[]
  pendingLinks: WorkspaceRow[]
  reviewedLinks: WorkspaceRow[]
  lang: string
}

export default function WorkspaceLinksClient({ workspaces, pendingLinks, reviewedLinks, lang }: Props) {
  const router = useRouter()
  const isAr = lang === 'ar'
  const [busyId, setBusyId] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'all'>('pending')

  const list = tab === 'pending' ? pendingLinks : workspaces

  async function handleReview(workspaceId: string, action: 'approve' | 'reject') {
    setBusyId(workspaceId)
    await reviewPartnerWorkspace({ workspaceId, action })
    setBusyId(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 bg-secondary/20 rounded-xl border border-border/40 w-fit" dir="ltr">
        <button
          onClick={() => setTab('pending')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-bold transition-all',
            tab === 'pending' ? 'bg-card shadow-sm text-foreground border border-border' : 'text-muted-foreground',
          )}
        >
          {isAr ? 'قيد المراجعة' : 'Pending'} ({pendingLinks.length})
        </button>
        <button
          onClick={() => setTab('all')}
          className={cn(
            'px-4 py-2 rounded-lg text-xs font-bold transition-all',
            tab === 'all' ? 'bg-card shadow-sm text-foreground border border-border' : 'text-muted-foreground',
          )}
        >
          {isAr ? 'الكل' : 'All'} ({workspaces.length})
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {list.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            <Link2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
            {isAr ? 'لا توجد روابط' : 'No links found'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-5 py-3 text-start">{isAr ? 'المساحة' : 'Workspace'}</th>
                <th className="px-5 py-3 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="px-5 py-3 text-start">Partner ID</th>
                <th className="px-5 py-3 text-start">{isAr ? 'الإجراء' : 'Action'}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id} className="border-t border-border/40">
                  <td className="px-5 py-3 font-semibold">{w.name}</td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border',
                      w.partner_status === 'pending' && 'bg-amber-50 border-amber-200 text-amber-700',
                      w.partner_status === 'active' && 'bg-emerald-50 border-emerald-200 text-emerald-700',
                      w.partner_status === 'rejected' && 'bg-red-50 border-red-200 text-red-700',
                    )}>
                      {w.partner_status || '—'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-[10px] font-mono text-muted-foreground">
                    {w.partner_id?.slice(0, 8) || '—'}...
                  </td>
                  <td className="px-5 py-3">
                    {w.partner_status === 'pending' && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleReview(w.id, 'approve')}
                          disabled={busyId === w.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold hover:bg-emerald-100 transition"
                        >
                          {busyId === w.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          {isAr ? 'موافقة' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleReview(w.id, 'reject')}
                          disabled={busyId === w.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold hover:bg-red-100 transition"
                        >
                          <XCircle className="h-3 w-3" />
                          {isAr ? 'رفض' : 'Reject'}
                        </button>
                      </div>
                    )}
                    {w.partner_status !== 'pending' && (
                      <span className="text-[10px] text-muted-foreground">
                        {w.partner_status === 'active' ? '✓' : '✗'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
