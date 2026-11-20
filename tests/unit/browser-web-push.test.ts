import { createECDH, randomBytes } from 'node:crypto'
import { isAllowedPushEndpoint, sendBrowserPush } from '@/lib/browser-web-push'

describe('browser web push', () => {
  const originalFetch = global.fetch
  const old = {
    pub: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    priv: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    subject: process.env.WEB_PUSH_SUBJECT,
  }
  beforeEach(() => {
    const vapid = createECDH('prime256v1')
    vapid.generateKeys()
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapid.getPublicKey().toString('base64url')
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapid.getPrivateKey().toString('base64url')
    process.env.WEB_PUSH_SUBJECT = 'mailto:notify@example.com'
  })
  afterEach(() => { global.fetch = originalFetch })
  afterAll(() => {
    if (old.pub === undefined) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY
    else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = old.pub
    if (old.priv === undefined) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY
    else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = old.priv
    if (old.subject === undefined) delete process.env.WEB_PUSH_SUBJECT
    else process.env.WEB_PUSH_SUBJECT = old.subject
  })
  test('rejects attacker-controlled push destinations', async () => {
    expect(isAllowedPushEndpoint('http://localhost:3000/private')).toBe(false)
    expect(isAllowedPushEndpoint('https://127.0.0.1/private')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.test')).toBe(false)
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/demo')).toBe(true)
    await expect(sendBrowserPush({
      endpoint: 'https://127.0.0.1/secret',
      p256dh: '', auth_secret: '',
    }, { title: 'test' })).rejects.toThrow('Untrusted push endpoint')
  })
  test('sends VAPID JWT and RFC8291 encrypted payload', async () => {
    const recipient = createECDH('prime256v1')
    recipient.generateKeys()
    const fetchMock = jest.fn().mockResolvedValue(new Response('', { status: 201 }))
    global.fetch = fetchMock as typeof fetch
    const status = await sendBrowserPush({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      p256dh: recipient.getPublicKey().toString('base64url'),
      auth_secret: randomBytes(16).toString('base64url'),
    }, { title: 'Order received', body: 'S123' })
    expect(status).toBe('sent')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url.origin).toBe('https://fcm.googleapis.com')
    expect(init.headers.Authorization).toContain('vapid t=')
    expect(init.headers['Content-Encoding']).toBe('aes128gcm')
    const data = Buffer.from(init.body)
    expect(data.readUInt32BE(16)).toBe(4096)
    expect(data[20]).toBe(65)
    expect(data.length).toBeGreaterThan(16 + 4 + 1 + 65 + 16)
  })
})
