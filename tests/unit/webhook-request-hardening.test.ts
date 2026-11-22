import fs from 'node:fs'
import path from 'node:path'

import { readWebhookBodyWithinLimit, WebhookBodyTooLargeError } from '@/lib/webhook-body-reader'
import { MAX_WEBHOOK_BODY_BYTES } from '@/lib/webhook-strict'
import { rateLimitKeyFromHeaders } from '@/lib/rate-limit'

const encoder = new TextEncoder()

function requestWithChunks(chunks: Uint8Array[], declaredLength?: string): Pick<Request, 'headers' | 'body'> {
  const queue = [...chunks]
  return {
    headers: new Headers(declaredLength === undefined ? undefined : { 'content-length': declaredLength }),
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (queue.length) controller.enqueue(queue.shift()!)
        else controller.close()
      },
    }) as unknown as Request['body'],
  }
}

describe('webhook body streaming memory boundary', () => {
  it('accepts a legitimate signed-request body without altering text', async () => {
    const raw = '{"name":"منتج تجريبي","id":"42"}'
    const bytes = encoder.encode(raw)
    await expect(readWebhookBodyWithinLimit(requestWithChunks([bytes], String(bytes.byteLength)))).resolves.toBe(raw)
  })

  it('rejects oversized declared Content-Length before the body is read', async () => {
    const request = requestWithChunks([encoder.encode('safe')], String(MAX_WEBHOOK_BODY_BYTES + 1))
    await expect(readWebhookBodyWithinLimit(request)).rejects.toBeInstanceOf(WebhookBodyTooLargeError)
  })

  it('rejects an unannounced oversized streaming upload', async () => {
    const chunks = [new Uint8Array(600_000), new Uint8Array(600_000)]
    await expect(readWebhookBodyWithinLimit(requestWithChunks(chunks))).rejects.toMatchObject({ status: 413 })
  })

  it('rejects a Content-Length that falsely claims fewer bytes', async () => {
    const chunks = [new Uint8Array(MAX_WEBHOOK_BODY_BYTES), new Uint8Array(1)]
    await expect(readWebhookBodyWithinLimit(requestWithChunks(chunks, '1'))).rejects.toMatchObject({ status: 413 })
  })

  it('accepts exactly the maximum number of bytes', async () => {
    const raw = new Uint8Array(MAX_WEBHOOK_BODY_BYTES).fill(97)
    const result = await readWebhookBodyWithinLimit(requestWithChunks([raw]))
    expect(Buffer.byteLength(result)).toBe(MAX_WEBHOOK_BODY_BYTES)
  })

  it('accepts an empty webhook body', async () => {
    await expect(readWebhookBodyWithinLimit({ headers: new Headers(), body: null })).resolves.toBe('')
  })
})

describe('untrusted client IP headers cannot spoof rate-limit buckets', () => {
  const originalHeader = process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER
  afterEach(() => {
    if (originalHeader === undefined) delete process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER
    else process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER = originalHeader
  })

  const headers = (values: Record<string, string>) =>
    (name: string): string | null => values[name] ?? null

  it('does not trust any forwarded IP header by default', () => {
    delete process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER
    expect(rateLimitKeyFromHeaders(headers({
      'x-forwarded-for': '203.0.113.42',
      'x-real-ip': '198.51.100.5',
    }), 'webhook')).toBe('webhook:unidentified')
  })

  it('rejects unrecognized proxy header configuration', () => {
    process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER = 'authorization'
    expect(rateLimitKeyFromHeaders(headers({ authorization: '8.8.8.8' }), 'webhook')).toBe('webhook:unidentified')
  })

  it('only uses a trusted proxy header after explicit opt-in', () => {
    process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER = 'x-real-ip'
    expect(rateLimitKeyFromHeaders(headers({ 'x-real-ip': '8.8.8.8' }), 'webhook')).toBe('webhook:8.8.8.8')
    expect(rateLimitKeyFromHeaders(headers({ 'x-real-ip': 'garbage' }), 'webhook')).toBe('webhook:unidentified')
  })

  it('ignores the spoofable first element in a sanitized forwarded chain', () => {
    process.env.WEBHOOK_TRUSTED_PROXY_IP_HEADER = 'x-forwarded-for'
    expect(rateLimitKeyFromHeaders(headers({ 'x-forwarded-for': '1.1.1.1, 8.8.8.8' }), 'webhook'))
      .toBe('webhook:8.8.8.8')
  })
})

describe('all five webhook endpoints enforce the same limit', () => {
  it.each(['zid', 'salla', 'shopify', 'odoo', 'odoo/stock'])('%s uses a byte-bound stream', platform => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/api/webhooks', platform, 'route.ts'), 'utf8')
    expect(source).toContain('readWebhookBodyWithinLimit(req)')
    expect(source).toContain('WebhookBodyTooLargeError')
    expect(source).toContain('credentialVerified: false')
    expect(source).not.toContain('await req.text()')
  })
})
