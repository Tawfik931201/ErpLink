import { type NextRequest } from 'next/server'

import { publishVerifiedTicketWebhook } from '@/lib/ticket-live-events'

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
  } finally { reader.releaseLock() }
}

/** Odoo Studio: POST only ticket ID and existing private x_source_uuid. */
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

    // Only an authenticated browser stream can create a channel and retain its
    // Odoo source UUID. A forged event cannot wake a different customer's chat.
    // No Odoo RPC, database query, Supabase, or sensitive data in this endpoint.
    publishVerifiedTicketWebhook(ticketId, sourceId)
    return new Response(null, { status: 204 })
  } catch {
    return new Response('Invalid webhook', { status: 400 })
  }
}
