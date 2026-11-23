import { timingSafeEqual } from 'node:crypto'
import { type NextRequest } from 'next/server'

import { centralSupportCall } from '@/lib/central-odoo-archive'
import { publishTicketLiveEvent } from '@/lib/ticket-live-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TICKET_MODEL = 'x_erplink_support_ticket'
const MAX_WEBHOOK_BYTES = 4096

async function boundedBody(request: NextRequest): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Empty webhook')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_WEBHOOK_BYTES) throw new Error('Webhook payload too large')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(bytes)
  } finally {
    reader.releaseLock()
  }
}

function sameSourceId(received: string, expected: string): boolean {
  if (!received || !expected || received.length > 200 || expected.length > 200) return false
  // Per-ticket source UUIDs are random, private server-side Odoo record fields.
  // No shared API key or publicly exposed auth token in webhook URLs.
  const first = Buffer.from(received)
  const second = Buffer.from(expected)
  return first.length === second.length && timingSafeEqual(first, second)
}

/** Webhook from Odoo Studio. Contains only ticket id + private x_source_uuid. */
export async function POST(request: NextRequest) {
  const claimedLength = Number(request.headers.get('content-length') || 0)
  if (!Number.isFinite(claimedLength) || claimedLength > MAX_WEBHOOK_BYTES) {
    return new Response('Invalid webhook', { status: 413 })
  }
  try {
    const body = await boundedBody(request)
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
    const sourceId = event.x_source_uuid
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0 ||
        typeof sourceId !== 'string' || sourceId.length > 200 ||
        !/^(app-ticket|public-contact):[0-9a-f-]{36}$/i.test(sourceId)) {
      return new Response('Invalid ticket event', { status: 400 })
    }
    // Authenticate the event against the immutable per-ticket UUID already in
    // central Odoo; never accept ticket IDs alone as authorization.
    const rows = await centralSupportCall<Array<{ x_source_uuid: string | false }>>(
      TICKET_MODEL, 'search_read', [[['id', '=', ticketId]]],
      { fields: ['x_source_uuid'], limit: 1 },
    )
    if (!sameSourceId(sourceId, rows[0]?.x_source_uuid || '')) {
      return new Response('Unauthorized', { status: 401 })
    }
    // Invalidation only. Browser must fetch via its own ticket-scoped session.
    publishTicketLiveEvent(ticketId)
    return new Response(null, { status: 204 })
  } catch {
    // Fail closed on invalid payloads or Odoo connectivity problems.
    return new Response('Webhook unavailable', { status: 503 })
  }
}
