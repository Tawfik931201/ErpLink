import { cookies } from 'next/headers'
import { DollarSign } from 'lucide-react'

import { getActiveUserId, isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import AddCommissionForm from './AddCommissionForm'

export default async function AdminCommissionsPage() {
  const userId = await getActiveUserId()
  if (!userId || !isAdmin(userId)) return <div>Unauthorized</div>

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language

  // Load active partners for the dropdown
  const { data: partners } = await supabase
    .from('partner_profiles')
    .select('id, display_name, tier, commission_rate')
    .eq('status', 'active')
    .order('display_name')

  // Load recent commissions
  const { data: commissions } = await supabase
    .from('partner_commissions')
    .select('id, partner_id, client_user_id, gross_amount, commission_amount, commission_rate, note, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="p-6 md:p-10" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-foreground">
            {lang === 'ar' ? 'العمولات' : 'Commissions'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {lang === 'ar' ? 'إضافة وإدارة عمولات الشركاء' : 'Manage partner commissions'}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AddCommissionForm partners={partners ?? []} lang={lang} />

          <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
            <h2 className="font-bold text-sm">
              {lang === 'ar' ? 'آخر العمولات' : 'Recent Commissions'}
            </h2>
            {(!commissions || commissions.length === 0) ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-auto">
                {commissions.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/20 p-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">Partner {c.partner_id.slice(0, 8)}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{c.note || '—'}</p>
                    </div>
                    <span className="font-mono text-sm font-bold text-emerald-600">
                      +${Number(c.commission_amount).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
