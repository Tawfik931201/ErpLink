import { createHash } from 'crypto'

import type { NextRequest } from 'next/server'

import { encrypt } from './crypto'
import { supabase } from './supabase'
import { MAX_WEBHOOK_BODY_BYTES } from './webhook-strict'

/** Final acknowledgement fence, including lifecycle/disabled/unknown branches.
 * Bodies may contain OAuth tokens, so the recoverable copy is encrypted and no
 * headers or URL query credentials are persisted. This is not executable work. */
export async function withDurableWebhookResponse(
  platform: string,
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  const reader = request.clone().body?.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  if (reader) {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > MAX_WEBHOOK_BODY_BYTES) {
        void reader.cancel().catch(() => {})
        return Response.json({ error: 'Webhook body too large' }, { status: 413 })
      }
      chunks.push(part.value)
    }
  }
  const rawBody = Buffer.concat(chunks).toString('utf8')
  const response = await handler(request)
  if ((response.status < 200 || response.status >= 300) && response.status < 500) return response
  try {
    const { error } = await supabase.from('webhook_acceptances').insert({
      platform, response_status: response.status,
      payload_ciphertext: encrypt(rawBody),
      payload_hash: createHash('sha256').update(rawBody).digest('hex'),
    })
    if (!error) return response
  } catch { /* No acknowledgement when the recovery copy failed. */ }
  return Response.json({ error: 'durable_acceptance_failed' }, { status: 503 })
}
