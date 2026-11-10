import { currentUser } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { supabase } from '@/lib/supabase'
import { ensureDefaultWorkspace } from '@/lib/workspace-defaults'
import { readPendingZidConnection, ZID_CONNECT_PATH, ZID_PENDING_COOKIE } from '@/lib/zid/oauth-pending'

export const dynamic = 'force-dynamic'
// HTML form POSTs under no-referrer send Origin:null and fail the CSRF guard.
// same-origin preserves Origin internally and still hides referrers externally.
export const metadata = { title: 'ربط متجر زد | ERPlink', robots: { index: false, follow: false }, referrer: 'same-origin' }

export default async function ZidAccountLinkPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  const cookieStore = await cookies()
  const en = cookieStore.get('lang')?.value === 'en'
  let pending = null
  let unavailable = false
  try { pending = await readPendingZidConnection(cookieStore.get(ZID_PENDING_COOKIE)?.value) }
  catch { unavailable = true }
  const user = pending ? await currentUser() : null
  if (user) await ensureDefaultWorkspace(user.id)
  const { data: workspaces, error: workspaceError } = user
    ? await supabase.from('workspaces').select('id,name').eq('user_id', user.id).order('created_at')
    : { data: null, error: null }
  const returnQuery = `?redirect_url=${encodeURIComponent(ZID_CONNECT_PATH)}`
  const message = unavailable ? (en ? 'Connection storage is unavailable. Please retry shortly.' : 'تعذر تحميل الاتصال. أعد المحاولة بعد قليل.')
    : error ? (en ? 'The connection could not be completed. Retry, or authorize again if it expired. A store already linked to another workspace cannot be moved here.'
      : 'لم يكتمل الربط. أعد المحاولة، أو أعد التفويض إذا انتهت صلاحيته. لا يمكن نقل متجر مرتبط بمساحة عمل أخرى من هنا.') : null
  return (
    <main dir={en ? 'ltr' : 'rtl'} className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-lg space-y-6 rounded-xl border bg-card p-8 text-card-foreground">
        <h1 className="text-2xl font-bold">{en ? 'Connect your Zid store' : 'ربط متجر زد'}</h1>
        {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
        {!pending ? <>
          {!unavailable && <p>{en ? 'Start authorization, or authorize again if your connection expired.' : 'ابدأ تفويض زد، أو أعد التفويض إذا انتهت صلاحية الاتصال.'}</p>}
          <Link className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/api/zid/connect">{en ? 'Authorize with Zid' : 'تفويض الربط من زد'}</Link>
          {unavailable && <Link className="block underline" href={ZID_CONNECT_PATH}>{en ? 'Retry' : 'إعادة المحاولة'}</Link>}
        </> : <>
          <p>{en ? 'Zid authorization succeeded. Account linking and Odoo setup are still required.' : 'نجح تفويض زد. يتبقى ربط حساب ERPlink وإكمال إعداد أودوو.'}</p>
          <p className="font-medium">{pending.store_name || (en ? 'Zid store' : 'متجر زد')} <span className="text-muted-foreground">#{pending.store_id}</span></p>
          {!user ? <div className="flex gap-4">
            <Link className="rounded-md bg-primary px-4 py-2 text-primary-foreground" href={`/sign-up${returnQuery}`}>{en ? 'Create account' : 'إنشاء حساب'}</Link>
            <Link className="rounded-md border px-4 py-2" href={`/sign-in${returnQuery}`}>{en ? 'Link existing account' : 'ربط حساب موجود'}</Link>
          </div> : <>
            <p>{en ? 'ERPlink account:' : 'حساب ERPlink:'} {user.primaryEmailAddress?.emailAddress || user.fullName}</p>
            {workspaceError ? <p role="alert">{en ? 'Could not load workspaces. Please reload.' : 'تعذر تحميل مساحات العمل. أعد تحميل الصفحة.'}</p>
              : workspaces?.length ? <form action="/api/zid/link" method="post" className="space-y-4">
                <label className="block" htmlFor="workspace">{en ? 'Workspace to connect' : 'مساحة العمل المراد الربط بها'}</label>
                <select id="workspace" name="workspace_id" className="w-full rounded-md border bg-background p-2" required>
                  {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
                <p className="text-sm text-muted-foreground">{en ? 'Confirm linking this store to this account and workspace, then continue to Odoo setup.' : 'بتأكيد الربط، توافق على ربط هذا المتجر بالحساب ومساحة العمل المختارة، ثم الانتقال لإعداد أودوو.'}</p>
                <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground" type="submit">{en ? 'Confirm and set up Odoo' : 'تأكيد الربط وإعداد أودوو'}</button>
              </form> : <p>{en ? 'Create a workspace in ERPlink, then return here to finish linking.' : 'أنشئ مساحة عمل في ERPlink ثم عد إلى هذه الصفحة لإكمال الربط.'} <Link className="underline" href="/app/settings/workspace">{en ? 'Workspaces' : 'مساحات العمل'}</Link></p>}
          </>}
        </>}
      </section>
    </main>
  )
}
