import { NextRequest } from 'next/server'

import { withDurableWebhookResponse } from '../../src/lib/durable-webhook-response'
import { supabase } from '../mocks/supabase'

jest.mock('../../src/lib/crypto', () => ({ encrypt: (body: string) => `encrypted:${body.length}` }))

const request = (body = '{"id":1,"access_token":"test-secret"}') => new NextRequest('https://fixture.invalid/webhook?secret=do-not-store', {
  method: 'POST', body, headers: { authorization: 'do-not-store' },
})

describe('all webhook acknowledgement branches have a recoverable copy', () => {
  beforeEach(() => supabase.reset())

  it.each([200, 202, 500])('persists encrypted body on %i without header/query credentials', async status => {
    const response = await withDurableWebhookResponse('zid', request(), async () => Response.json({ reason: 'unknown_event' }, { status }))
    expect(response.status).toBe(status)
    const write = supabase.calls.find(call => call.table === 'webhook_acceptances')
    expect(write?.args[0]).toMatchObject({ payload_ciphertext: 'encrypted:37', response_status: status })
    expect(JSON.stringify(write?.args)).not.toContain('test-secret')
    expect(JSON.stringify(write?.args)).not.toContain('do-not-store')
  })

  it('returns retryable failure if durable acceptance storage fails', async () => {
    supabase.setMockResponder(() => ({ error: { message: 'DB offline' }, data: null }))
    expect((await withDurableWebhookResponse('salla', request(), async () => Response.json({ received: true }))).status).toBe(503)
  })

  it('does not persist rejected authentication or oversized traffic', async () => {
    expect((await withDurableWebhookResponse('zid', request(), async () => new Response(null, { status: 401 }))).status).toBe(401)
    const handler = jest.fn()
    expect((await withDurableWebhookResponse('zid', request('a'.repeat(1_000_001)), handler)).status).toBe(413)
    expect(handler).not.toHaveBeenCalled()
    expect(supabase.calls).toHaveLength(0)
  })

  it('preserves the raw body the verifier reads and waits for storage', async () => {
    let commit: (result: unknown) => void = () => {}
    const pendingCommit = new Promise(resolve => { commit = resolve })
    supabase.setMockResponder(() => pendingCommit)
    let finished = false
    const pending = withDurableWebhookResponse('salla', request(), async req => {
      expect(await req.text()).toContain('test-secret')
      return Response.json({ received: true })
    }).then(value => { finished = true; return value })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(finished).toBe(false)
    commit({ error: null, data: null })
    expect((await pending).status).toBe(200)
  })
})
