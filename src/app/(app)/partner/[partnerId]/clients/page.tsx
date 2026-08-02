import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { UserPlus, Link2 } from 'lucide-react'

import { getActiveUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { translations, type Language } from '@/lib/translations'
import { getPartnerClients } from '@/app/actions/partner-actions'
import InviteClientButton from '@/components/partner/InviteClientButton'

export default async function PartnerClientsPage({
  params,
}: {
  params: { partnerId: string }
}) {
  const userId = await getActiveUserId()
  if (!userId) redirect('/sign-in')

  const cookieStore = cookies()
  const lang = (cookieStore.get('lang')?.value || 'ar') as Language
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const t = (key: keyof typeof translations['ar']) =>
    translations[lang][key] || translations['ar'][key]

  const { clients } = await getPartnerClients(params.partnerId)

  return (
    <div className="space-y-6" dir={dir}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-foreground">
            {lang === 'ar' ? 'العملاء' : 'Clients'}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {lang === 'ar'
              ? `إجمالي ${clients.length} عميل`
              : `${clients.length} client(s) total`}
          </p>
        </div>
        <InviteClientButton partnerId={params.partnerId} lang={lang} />
      </div>

      {clients.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <UserPlus className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {lang === 'ar' ? 'لم تقم بدعوة أي عميل بعد' : "You haven't invited any clients yet"}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground bg-secondary/30">
              <tr>
                <th className="px-5 py-3 text-start">{lang === 'ar' ? 'الاسم' : 'Name'}</th>
                <th className="px-5 py-3 text-start">Email</th>
                <th className="px-5 py-3 text-start">{lang === 'ar' ? 'الحالة' : 'Status'}</th>
                <th className="px-5 py-3 text-start">{lang === 'ar' ? 'المساحة' : 'Workspace'}</th>
                <th className="px-5 py-3 text-start">{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-border/40">
                  <td className="px-5 py-3 font-semibold">{c.client_name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{c.email}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        c.status === 'accepted' || c.status === 'linked'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : c.status === 'sent'
                          ? 'bg-amber-50 border-amber-200 text-amber-700'
                          : 'bg-muted border-border text-muted-foreground'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {c.workspace_id ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Link2 className="h-3 w-3" />
                        {c.workspace_id.slice(0, 8)}...
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[10px] text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString(
                      lang === 'ar' ? 'ar-SA' : 'en-US',
                      { year: 'numeric', month: 'short', day: 'numeric' },
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
