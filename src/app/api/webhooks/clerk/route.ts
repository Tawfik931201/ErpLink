/**
 * POST /api/webhooks/clerk
 *
 * Receives Clerk webhook events (Svix-signed).
 *
 * `user.created`: inserts the new user into the local `users` table.
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

/** Ensure the Clerk user exists in the local users table. */
async function syncUserForUserCreated(data: any) {
  const userId = data.id as string | undefined
  if (!userId) return

  const emails: string[] = (data.email_addresses ?? []).map(
    (e: any) => e?.email_address as string,
  )
  const email = emails[0]?.toLowerCase() ?? ''
  const firstName = (data.first_name as string) ?? ''
  const lastName = (data.last_name as string) ?? ''
  const name = `${firstName} ${lastName}`.trim() || email || 'Merchant'

  if (!email) return

  const { error: userErr } = await supabase.from('users').insert([
    { id: userId, email, name },
  ])
  if (userErr && userErr.code !== '23505') {
    console.error('[clerk-webhook] Failed to create user:', userErr)
  }

  // Automatically create a default workspace named "Default" and activate it for the new user.
  try {
    const { ensureDefaultWorkspace } = await import('@/lib/workspace-defaults')
    await ensureDefaultWorkspace(userId)
  } catch (createErr) {
    console.error('[clerk-webhook] Failed to create default workspace:', createErr)
  }
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
    // Replay protection: reject timestamps older than 5 minutes or in the future
    const timestampMs = parseInt(svixTimestamp, 10) * 1000
    const now = Date.now()
    if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Timestamp outside acceptable window' }, { status: 401 })
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
      await syncUserForUserCreated(evt.data)
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
