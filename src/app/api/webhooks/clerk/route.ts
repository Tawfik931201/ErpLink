/**
 * POST /api/webhooks/clerk
 *
 * Receives Clerk webhook events (Svix-signed).
 *
 * `user.created`:
 *   - Inserts the new user into the local `users` table.
 *   - If the user signed up through an affiliate invitation (the invitation
 *     `publicMetadata.affiliateWorkspace` is transferred into the user's
 *     `public_metadata`), auto-creates the workspace the affiliate registered
 *     (owner = the client, partner_id = the affiliate) and marks the pending
 *     invite as completed.
 *
 * Security: signatures are verified with the CLERK_WEBHOOK_SECRET.
 * Configure in Clerk Dashboard → Webhooks → add endpoint
 * `https://<your-domain>/api/webhooks/clerk` subscribed to `user.created`.
 */
import crypto from 'crypto'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { supabase } from '@/lib/supabase'

function base64UrlToBuffer(part: string): Buffer {
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64')
}

/**
 * Verify the Svix v1 signature scheme used by Clerk webhooks.
 * message = `${svixId}.${timestamp}.${payload}`
 * signature = base64(HMAC_SHA256(secretBytes, message))
 */
function verifyClerkSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  payload: string,
  signatureHeader: string,
): boolean {
  try {
    const secretBytes = base64UrlToBuffer(secret.replace(/^whsec_/i, ''))
    const message = `${svixId}.${svixTimestamp}.${payload}`
    const expected = crypto
      .createHmac('sha256', secretBytes)
      .update(message)
      .digest('base64')

    const signatures = signatureHeader
      .split(' ')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('v1,'))
      .map((s) => s.slice(3))

    return signatures.some((sig) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

interface AffiliateWorkspaceMetadata {
  partnerId?: string
  workspaceName?: string
}

/** Auto-create the workspace that was registered via an affiliate invitation. */
async function createAffiliateWorkspaceForUser(data: any) {
  const userId = data.id as string | undefined
  if (!userId) return

  const emails: string[] = (data.email_addresses ?? []).map(
    (e: any) => e?.email_address as string,
  )
  const email = emails[0]?.toLowerCase() ?? ''
  const firstName = (data.first_name as string) ?? ''
  const lastName = (data.last_name as string) ?? ''
  const name = `${firstName} ${lastName}`.trim() || email || 'Zid Merchant'

  // 1. Ensure the user exists in the local users table (FK requirement)
  if (email) {
    const { error: userErr } = await supabase.from('users').insert([
      { id: userId, email, name: name || 'Zid Merchant' },
    ])
    if (userErr && userErr.code !== '23505') {
      console.error('[clerk-webhook] Failed to create user:', userErr)
      return
    }
  }

  // 2. Resolve the affiliate link: from user public_metadata (invitation) → DB invite by email
  let partnerId: string | undefined
  let workspaceName: string | undefined

  const meta = (data.public_metadata ?? {}) as Record<string, any>
  const wsMeta = meta.affiliateWorkspace as AffiliateWorkspaceMetadata | undefined
  if (wsMeta?.partnerId && wsMeta?.workspaceName) {
    partnerId = wsMeta.partnerId
    workspaceName = wsMeta.workspaceName
  } else if (email) {
    const { data: invite } = await supabase
      .from('affiliate_client_invites')
      .select('partner_id, workspace_name')
      .eq('email', email)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (invite) {
      partnerId = invite.partner_id
      workspaceName = invite.workspace_name
    }
  }

  if (!partnerId || !workspaceName) {
    console.info(
      `[clerk-webhook] User ${userId} has no pending affiliate workspace (email=${email})`,
    )
    return
  }

  // Verify the partner still exists and is active
  const { data: partner } = await supabase
    .from('partner_profiles')
    .select('id')
    .eq('id', partnerId)
    .eq('status', 'active')
    .maybeSingle()
  if (!partner) {
    console.warn(`[clerk-webhook] Partner ${partnerId} not active — skipping workspace`)
    return
  }

  // 3. Create the workspace (owner = the client, attributed to the affiliate)
  const { data: workspace, error: wsErr } = await supabase
    .from('workspaces')
    .insert([
      {
        user_id: userId,
        name: workspaceName,
        partner_id: partnerId,
        partner_status: 'active',
        partner_linked_at: new Date().toISOString(),
        partner_link_requested_by: data.id,
      },
    ])
    .select('id')
    .single()

  if (wsErr) {
    console.error('[clerk-webhook] Failed to create workspace:', wsErr)
    return
  }

  // 4. Set it as the client's active workspace
  await supabase
    .from('users')
    .update({ active_workspace_id: workspace.id })
    .eq('id', userId)

  // 5. Mark pending invites completed
  if (email) {
    await supabase
      .from('affiliate_client_invites')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('email', email)
      .eq('status', 'pending')
  }

  console.info(
    `[clerk-webhook] Created workspace "${workspaceName}" for ${email} attributed to partner ${partnerId}`,
  )
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const secret = process.env.CLERK_WEBHOOK_SECRET ?? ''

  const svixId = req.headers.get('svix-id') ?? ''
  const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
  const svixSignature = req.headers.get('svix-signature') ?? ''

  if (secret) {
    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 })
    }
    const valid = verifyClerkSignature(secret, svixId, svixTimestamp, rawBody, svixSignature)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'CLERK_WEBHOOK_SECRET not configured' }, { status: 500 })
    }
    console.warn('[clerk-webhook] ⚠️ CLERK_WEBHOOK_SECRET is not set — accepting unverified (dev)')
  }

  let evt: any
  try {
    evt = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = evt.type as string

  try {
    if (eventType === 'user.created') {
      await createAffiliateWorkspaceForUser(evt.data)
    } else {
      console.info(`[clerk-webhook] Ignoring event type: ${eventType}`)
    }
  } catch (err) {
    console.error('[clerk-webhook] handler error:', err)
    // Return 200 so Clerk doesn't retry indefinitely on non-critical issues
  }

  return NextResponse.json({ received: true })
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'Clerk webhook endpoint is ready.' })
}
