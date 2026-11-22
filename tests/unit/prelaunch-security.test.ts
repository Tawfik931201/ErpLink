import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { POST as clerkWebhook } from '@/app/api/webhooks/clerk/route'
import { POST as impersonate } from '@/app/api/admin/impersonate/route'
import { GET as releaseHealth } from '@/app/api/health/live/route'

// These only exercise safe early-rejection branches; never call Clerk or DB.
const fakeRequest = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://erplink.bizsahla.com/api/webhooks/clerk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })

describe('Clerk Svix webhook prelaunch guards', () => {
  const prior = process.env.CLERK_WEBHOOK_SECRET
  const secret = Buffer.from('the-offline-test-svix-secret-32-bytes').toString('base64url')

  beforeEach(() => { process.env.CLERK_WEBHOOK_SECRET = `whsec_${secret}` })
  afterEach(() => {
    if (prior === undefined) delete process.env.CLERK_WEBHOOK_SECRET
    else process.env.CLERK_WEBHOOK_SECRET = prior
  })

  it('rejects unsigned requests without reading the body', async () => {
    const response = await clerkWebhook(fakeRequest('{}') as never)
    expect(response.status).toBe(401)
  })

  it('rejects expired signed requests before reading the body', async () => {
    const response = await clerkWebhook(fakeRequest('{}', {
      'svix-id': 'msg_test', 'svix-timestamp': '1000', 'svix-signature': 'v1,invalid',
    }) as never)
    expect(response.status).toBe(401)
  })

  it('limits a streaming upload to one megabyte before validating the signature', async () => {
    const response = await clerkWebhook(fakeRequest('a'.repeat(1_000_010), {
      'svix-id': 'msg_test',
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,deliberately-invalid',
    }) as never)
    expect(response.status).toBe(413)
  })

  it('accepts a correct Svix signature for an ignored event with no side effects', async () => {
    const body = '{"type":"test.ignored","data":{}}'
    const id = 'msg_offline'
    const timestamp = String(Math.floor(Date.now() / 1000))
    const payload = `${id}.${timestamp}.${body}`
    const sig = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(payload).digest('base64')
    const response = await clerkWebhook(fakeRequest(body, {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${sig}`,
    }) as never)
    expect(response.status).toBe(200)
  })
})

describe('privileged impersonation and deployment probes', () => {
  it('rejects a cross-origin impersonation POST before looking up the session', async () => {
    const response = await impersonate(new Request('https://erplink.bizsahla.com/api/admin/impersonate', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
      body: '{}',
    }) as never)
    expect(response.status).toBe(403)
  })

  it('serves a no-cache, unprivileged release marker without secrets', async () => {
    const response = await releaseHealth()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.json()).toEqual({
      ok: true, release: 'erplink-security-prelaunch-20261123-r1',
    })
  })

  it('pins the auth change for both Odoo webhook receivers', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/odoo/webhook-secret.ts'), 'utf8')
    expect(src).toContain('isStrictWebhookAuth()')
    expect(src).not.toContain("process.env.STRICT_WEBHOOK_AUTH ?? ''")
    expect(src).toContain("result.status === 'legacy'")
  })
})
