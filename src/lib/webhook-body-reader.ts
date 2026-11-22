/**
 * Receive a webhook body without ever buffering an untrusted payload larger
 * than our ingress limit. Request.text()/json() first allocate the entire body
 * and only THEN allow checking its size, making the 1 MB limit ineffective
 * against memory exhaustion.
 */
import { MAX_WEBHOOK_BODY_BYTES } from './webhook-strict'

export class WebhookBodyTooLargeError extends Error {
  readonly status = 413
  constructor() {
    super(`Payload too large (max ${MAX_WEBHOOK_BODY_BYTES} bytes)`)
    this.name = 'WebhookBodyTooLargeError'
  }
}

/** Read at most MAX_WEBHOOK_BODY_BYTES bytes (not JS characters). */
export async function readWebhookBodyWithinLimit(
  request: Pick<Request, 'headers' | 'body'>,
): Promise<string> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && /^\d+$/.test(contentLength.trim()) &&
      Number(contentLength) > MAX_WEBHOOK_BODY_BYTES) {
    // Cheap rejection before any body bytes are allocated.
    throw new WebhookBodyTooLargeError()
  }

  if (!request.body) return ''
  const reader = request.body.getReader()
  let bytes = 0
  const chunks: Uint8Array[] = []

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_WEBHOOK_BODY_BYTES) {
        // Cancels the stream promptly rather than waiting for an attacker to
        // finish uploading an unbounded chunked-transfer request.
        void reader.cancel().catch(() => {})
        throw new WebhookBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  // The complete body has been bounded *before* decoding; the exact text is
  // preserved for Shopify/Salla HMAC verification against the raw payload.
  return Buffer.concat(chunks, bytes).toString('utf8')
}
