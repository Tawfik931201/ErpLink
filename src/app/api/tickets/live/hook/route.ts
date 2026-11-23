import { timingSafeEqual } from 'node:crypto'
import { type NextRequest } from 'next/server'

import { centralSupportCall } from '@/lib/central-odoo-archive'
import { publishTicketLiveEvent } from '@/lib/ticket-live-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stored only in the central Odoo system-parameters store. Never expose the
// Odoo API key, support message bodies, or attachment contents in webhook URLs.
const SECRET_KEY = 'erplink.support.live_webhook_secret'
const TICKET_MODEL = 'x_erplink_support_ticket'
const MAX_WEBHOOK_BYTES = 4096

function sameSecret(received: string, expected: string): boolean {
  if (!received || !expected || received.length > 256) return false
  const first = Buffer.from(received)
  const second = Buffer.from(expected)
  return first.length === second.length && timingSafeEqual(first, second)
}

/** Odoo Studio's 'Send Webhook Notification' action sends only the ticket ID. */
export async function POST(request: NextRequest) {
  const supplied = request.nextUrl.searchParams.get('token') || ''
  if (!supplied) return new Response('Unauthorized', { status: 401 })
  // Refuse oversize payloads before parsing JSON.
  const claimedLength = Number(request.headers.get('content-length') || 0)
  if (!Number.isFinite(claimedLength) || claimedLength > MAX_WEBHOOK_BYTES) {
    return new Response('Invalid webhook', { status: 413 })
  }

  try {
    const entries = await centralSupportCall<Array<{ value: string }>>(
      'ir.config_parameter', 'search_read',
      [[['key', '=', SECRET_KEY]]], { fields: ['value'], limit: 1 },
    )
    if (!sameSecret(supplied, entries[0]?.value || '')) {
      return new Response('Unauthorized', { status: 401 })
    }
    const body = await request.text()
    if (body.length > MAX_WEBHOOK_BYTES) return new Response('Invalid webhook', { status: 413 })
    const payload: unknown = JSON.parse(body)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return new Response('Invalid webhook', { status: 400 })
    }
    const event = payload as Record<string, unknown>
    if (event._model !== undefined && event._model !== TICKET_MODEL) {
      return new Response('Invalid model', { status: 400 })
    }
    const rawId = event._id ?? event.id
    const ticketId = typeof rawId === 'number' || typeof rawId === 'string' ? Number(rawId) : NaN
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) {
      return new Response('Invalid ticket', { status: 400 })
    }
    // Only a cache-invalidating hint; a subscriber MUST fetch messages from
    // Odoo through its own authenticated, ticket-ownership-checked action.
    publishTicketLiveEvent(ticketId)
    return new Response(null, { status: 204 })
  } catch {
    // Fail closed if Odoo is unavailable, token lookup fails, or payload is invalid.
    return new Response('Webhook unavailable', { status: 503 })
  }
}
