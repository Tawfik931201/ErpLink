import { supabase } from '@/lib/supabase'
import { formatDistanceToNow } from 'date-fns'
import { arSA, enUS } from 'date-fns/locale'

interface Props {
  partnerId: string
  lang: string
}

export default async function ClientInvitationCard({ partnerId, lang }: Props) {
  const isAr = lang === 'ar'
  const locale = isAr ? arSA : enUS

  const { data: recent } = await supabase
    .from('partner_onboarding_invitations')
    .select('id, client_name, email, status, created_at')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(5)

  if (!recent || recent.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        {isAr ? 'لا يوجد عملاء حتى الآن' : 'No clients yet'}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {recent.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/20 p-3"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{inv.client_name}</p>
            <p className="text-[10px] text-muted-foreground">{inv.email}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                inv.status === 'accepted' || inv.status === 'linked'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : inv.status === 'sent'
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'bg-muted border-border text-muted-foreground'
              }`}
            >
              {inv.status}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(inv.created_at), { addSuffix: true, locale })}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
