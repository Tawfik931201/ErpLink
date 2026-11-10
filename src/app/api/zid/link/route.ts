import { auth } from '@clerk/nextjs/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { type NextRequest, NextResponse } from 'next/server'

import { getAppBaseUrl } from '@/lib/app-url'
import { finishZidConnection, ZID_CONNECT_PATH, ZID_PENDING_COOKIE } from '@/lib/zid/oauth-pending'

/** Explicit confirmation; GETs and sign-in redirects never attach a store. */
export async function POST(request: NextRequest) {
  const base = getAppBaseUrl(request)
  if (request.headers.get('origin') !== new URL(base).origin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const handle = request.cookies.get(ZID_PENDING_COOKIE)?.value
  const form = await request.formData().catch(() => null)
  const workspaceId = form?.get('workspace_id')
  if (!handle || typeof workspaceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    return NextResponse.json({ error: 'invalid_connection' }, { status: 400 })
  }
  let merchantId: string
  try {
    // The transaction rechecks ownership, prevents cross-workspace replacement,
    // writes credentials and consumes the pending grant atomically.
    merchantId = await finishZidConnection(handle, userId, workspaceId)
  } catch {
    // Keep the cookie/grant on save failure so confirmation can be retried.
    return NextResponse.redirect(new URL(`${ZID_CONNECT_PATH}?error=connection_not_saved`, base), 303)
  }
  let failed = false
  try {
    const { ZID_CORE_EVENTS, registerZidWebhook } = await import('@/lib/zid/webhooks')
    const registrations = await Promise.allSettled(ZID_CORE_EVENTS.map(key => registerZidWebhook(merchantId, key)))
    failed = registrations.some(result => result.status === 'rejected' || !result.value.success)
  } catch { failed = true }
  try {
    revalidateTag('zid-token')
    revalidatePath('/app/connect-store')
    revalidatePath('/app/dashboard')
  } catch { /* Cache invalidation must not turn a committed connection into an apparent failure. */ }
  const target = failed ? '/app/connect-store?success=zid_connected&error=webhook_registration_failed'
    : '/app/connect-odoo?success=zid_connected'
  const response = NextResponse.redirect(new URL(target, base), 303)
  response.cookies.delete(ZID_PENDING_COOKIE)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
