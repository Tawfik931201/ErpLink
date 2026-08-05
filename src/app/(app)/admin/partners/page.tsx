import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import InstallSchemaButton from '@/components/admin/InstallSchemaButton'
import { isAdmin } from '@/lib/auth'
import { calculateRelease } from '@/lib/commission-calculator'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'

import AdminPartnersClient from './AdminPartnersClient'

export const metadata = { title: 'Partners — Admin' }

interface DbPartnerProfile {
  id: string
  user_id: string
  display_name: string
  status: string
  tier: string
  commission_rate: number | string
  rejection_reason?: string | null
  approved_at?: string | null
  created_at: string
}

interface DbProfileRaw {
  id: string
  user_id: string
  display_name: string
  status: string
  tier: string
  commission_rate: number | string
  rejection_reason?: string | null
  approved_at?: string | null
  created_at: string
  totalEarnings: number
  totalPending: number
  eligibleToWithdraw: number
}

async function loadData() {
  const { data: raw, error } = await supabase
    .from('partner_profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return { profiles: null, error: error.message }

  const profiles = raw as DbPartnerProfile[]
  if (profiles.length === 0) return { profiles: [], error: null }

  const partnerIds = profiles.map((p) => p.id)

  // Fetch approved commissions for these partners
  const { data: commissions, error: commErr } = await supabase
    .from('partner_commissions')
    .select('partner_id, commission_amount, period_start, period_end')
    .in('partner_id', partnerIds)
    .eq('status', 'approved')

  if (commErr) return { profiles: null, error: commErr.message }

  // Fetch payouts for these partners
  const { data: payouts, error: payErr } = await supabase
    .from('payout_requests')
    .select('partner_id, amount, status')
    .in('partner_id', partnerIds)

  if (payErr) return { profiles: null, error: payErr.message }

  const now = new Date()

  const profilesWithStats: DbProfileRaw[] = profiles.map((p) => {
    const partnerComms = (commissions ?? []).filter((c) => c.partner_id === p.id)
    const partnerPayouts = (payouts ?? []).filter((pay) => pay.partner_id === p.id)

    // Total Profit (Earnings)
    const totalEarnings = partnerComms.reduce((sum, c) => sum + Number(c.commission_amount), 0)

    // Total Paid Payouts
    const totalPaid = partnerPayouts
      .filter((pay) => pay.status === 'paid')
      .reduce((sum, pay) => sum + Number(pay.amount), 0)

    // Total Pending Payouts (pending, under_review, approved)
    const totalPending = partnerPayouts
      .filter((pay) => ['pending', 'under_review', 'approved'].includes(pay.status))
      .reduce((sum, pay) => sum + Number(pay.amount), 0)

    // Total Released Commissions up to today
    let totalReleased = 0
    for (const comm of partnerComms) {
      const { releasedAmount } = calculateRelease(
        comm.commission_amount,
        comm.period_start,
        comm.period_end,
        now
      )
      totalReleased += releasedAmount
    }

    // Eligible to withdraw = totalReleased - totalPaid - totalPending
    const eligibleToWithdraw = Math.max(0, Math.round((totalReleased - totalPaid - totalPending) * 100) / 100)

    return {
      ...p,
      totalEarnings,
      totalPending,
      eligibleToWithdraw,
    }
  })

  return { profiles: profilesWithStats, error: null as string | null }
}

export default async function AdminPartnersPage() {
  const { userId } = await auth()
  if (!isAdmin(userId)) redirect('/dashboard')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (k: keyof typeof translations['ar']) =>
    translations[lang][k] || translations['ar'][k]

  const { profiles, error } = await loadData()

  const schemaMissing = !!(error && /schema cache|relation.*does not exist/i.test(error))

  if (schemaMissing) {
    return (
      <div dir={dir}>
        <div className="max-w-6xl mx-auto space-y-4">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">{t('admin.partners.title')}</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{t('admin.partners.subtitle')}</p>
          </div>
          <InstallSchemaButton />
        </div>
      </div>
    )
  }

  return (
    <AdminPartnersClient
      profiles={profiles ?? []}
      error={error}
      lang={lang}
    />
  )
}
