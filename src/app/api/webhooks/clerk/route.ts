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

import { checkUnauthenticatedIngressLimit } from '@/lib/ingress-admission'
import { rateLimitKeyFromHeaders } from '@/lib/rate-limit'
import { supabase } from '@/lib/supabase'
import { readWebhookBodyWithinLimit, WebhookBodyTooLargeError } from '@/lib/webhook-body-reader'

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
  // Embedded identities are provisioned with their existing store workspace by
  // registerEmbeddedAccess. A default workspace here would escape that scope.
  if (typeof data.external_id === 'string' && data.external_id.startsWith('zid-embedded:') &&
      data.private_metadata?.zidEmbedded === true) return
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
  const secret = process.env.CLERK_WEBHOOK_SECRET ?? ''
  // No secret: fail closed in production *before* an upload is read.
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CLERK_WEBHOOK_SECRET not configured' }, { status: 500 })
  }

  const svixId = req.headers.get('svix-id') ?? ''
  const svixTimestamp = req.headers.get('svix-timestamp') ?? ''
  const svixSignature = req.headers.get('svix-signature') ?? ''
  const bucketKey = rateLimitKeyFromHeaders(n => req.headers.get(n), 'clerk-webhook')
  const limitInvalid = () => checkUnauthenticatedIngressLimit({
    scope: 'clerk', credentialVerified: false, bucketKey,
  }).allowed

  if (secret) {
    // Reject obviously unauthenticated requests without allocating body bytes.
    if (!svixId || !svixTimestamp || !svixSignature ||
        svixId.length > 200 || svixTimestamp.length > 30 || svixSignature.length > 2048) {
      if (!limitInvalid()) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
      return NextResponse.json({ error: 'Missing or invalid signature headers' }, { status: 401 })
    }
    // A valid signature cannot make an expired/future message fresh.
    const timestampMs = /^\d{1,15}$/.test(svixTimestamp) ? Number(svixTimestamp) * 1000 : NaN
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      if (!limitInvalid()) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
      return NextResponse.json({ error: 'Timestamp outside acceptable window' }, { status: 401 })
    }
  }

  let rawBody: string
  try {
    rawBody = await readWebhookBodyWithinLimit(req)
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    return NextResponse.json({ error: 'Unable to read webhook body' }, { status: 400 })
  }

  if (secret) {
    if (!verifyClerkSignature(secret, svixId, svixTimestamp, rawBody, svixSignature)) {
      if (!limitInvalid()) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  } else {
    console.warn('[clerk-webhook] CLERK_WEBHOOK_SECRET is not set — accepting unverified (dev only)')
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
