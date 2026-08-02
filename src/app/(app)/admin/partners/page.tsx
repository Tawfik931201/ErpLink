import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'

import { isAdmin } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import { PARTNER_TIERS, tierLabel } from '@/lib/partner-tiers'
import { cn } from '@/lib/utils'
import InstallSchemaButton from '@/components/admin/InstallSchemaButton'
import AdminPartnersClient from './AdminPartnersClient'

export const metadata = { title: 'Partners — Admin' }

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
}

async function loadData() {
  const { data: raw, error } = await supabase
    .from('partner_profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return { profiles: null, error: error.message }

  return { profiles: raw as DbProfileRaw[], error: null as string | null }
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
      <div className={cn('min-h-screen bg-background p-6 md:p-10')} dir={dir}>
        <div className="max-w-6xl mx-auto space-y-8">
          <div>
            <h1 className="text-2xl font-black text-foreground">{t('admin.partners.title')}</h1>
            <p className="text-muted-foreground text-sm mt-1">{t('admin.partners.subtitle')}</p>
          </div>
          <InstallSchemaButton />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background" dir={dir}>
      <AdminPartnersClient
        profiles={profiles ?? []}
        error={error}
        lang={lang}
      />
    </div>
  )
}
