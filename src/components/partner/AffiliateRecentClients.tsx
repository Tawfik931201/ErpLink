import { CalendarRange, Users } from 'lucide-react'

import { getAffiliateClients } from '@/app/actions/affiliate-actions'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props {
  partnerId: string
  lang: string
}

/** Recent clients registered by this affiliate, with subscription state. */
export default async function AffiliateRecentClients({ partnerId, lang }: Props) {
  const isAr = lang === 'ar'
  const { clients } = await getAffiliateClients(partnerId)
  const recent = clients.slice(0, 5)

  if (recent.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Users className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          {isAr ? 'لا يوجد عملاء مسجلون حتى الآن' : 'No registered clients yet'}
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/50">
      {recent.map((c) => (
        <div
          key={c.workspace_id}
          className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{c.workspace_name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{c.client_email ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {c.subscription ? (
              <>
                <span className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                  <CalendarRange className="h-3 w-3" />
                  {c.subscription.months_paid} {isAr ? 'شهر' : 'mo'}
                  {Number(c.subscription.amount_paid) > 0 && ` · $${Number(c.subscription.amount_paid).toLocaleString('en-US')}`}
                </span>
                <Badge
                  variant={
                    c.subscription.isExpired
                      ? 'destructive'
                      : c.subscription.daysRemaining <= 7
                        ? 'warning'
                        : 'success'
                  }
                  className={cn('text-[10px] px-2 py-0')}
                >
                  {c.subscription.isExpired
                    ? isAr ? 'منتهٍ' : 'Expired'
                    : c.subscription.daysRemaining <= 7
                      ? isAr
                        ? `ينتهي بعد ${c.subscription.daysRemaining} يوم`
                        : `${c.subscription.daysRemaining}d left`
                      : isAr ? 'اشتراك نشط' : 'Active'}
                </Badge>
              </>
            ) : (
              <Badge variant="secondary" className="text-[10px] px-2 py-0">
                {isAr ? 'بلا اشتراك' : 'No subscription'}
              </Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
