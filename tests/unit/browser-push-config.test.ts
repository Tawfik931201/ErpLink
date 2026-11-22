import { createECDH } from 'node:crypto'
import { pushConfigurationIssue, pushConfigured } from '@/lib/browser-push'

const original = {
  publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
  privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
  contact: process.env.WEB_PUSH_CONTACT,
  subject: process.env.WEB_PUSH_SUBJECT,
}
function setPair() {
  const pair = createECDH('prime256v1')
  pair.generateKeys()
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = pair.getPublicKey(undefined, 'uncompressed').toString('base64url')
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = pair.getPrivateKey().toString('base64url')
  process.env.WEB_PUSH_CONTACT = 'mailto:notifications@example.com'
  delete process.env.WEB_PUSH_SUBJECT
}
afterAll(() => {
  if (original.publicKey === undefined) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY
  else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = original.publicKey
  if (original.privateKey === undefined) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY
  else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = original.privateKey
  if (original.contact === undefined) delete process.env.WEB_PUSH_CONTACT
  else process.env.WEB_PUSH_CONTACT = original.contact
  if (original.subject === undefined) delete process.env.WEB_PUSH_SUBJECT
  else process.env.WEB_PUSH_SUBJECT = original.subject
})

describe('VAPID configuration validation', () => {
  beforeEach(setPair)

  it('accepts a valid matching P-256 key pair and mailto contact', () => {
    expect(pushConfigurationIssue()).toBeNull()
    expect(pushConfigured()).toBe(true)
  })

  it('rejects a public key that does not match the private key', () => {
    const other = createECDH('prime256v1')
    other.generateKeys()
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = other.getPublicKey(undefined, 'uncompressed').toString('base64url')
    expect(pushConfigurationIssue()).toMatch(/does not match/)
    expect(pushConfigured()).toBe(false)
  })

  it('rejects a compressed or malformed public key', () => {
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = Buffer.alloc(33, 7).toString('base64url')
    expect(pushConfigurationIssue()).toMatch(/65-byte uncompressed/)
  })

  it('rejects invalid private key length', () => {
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = Buffer.alloc(16, 7).toString('base64url')
    expect(pushConfigurationIssue()).toMatch(/32-byte/)
  })

  it('accepts WEB_PUSH_SUBJECT as a backward-compatible contact alias', () => {
    delete process.env.WEB_PUSH_CONTACT
    process.env.WEB_PUSH_SUBJECT = 'mailto:notifications@example.com'
    expect(pushConfigurationIssue()).toBeNull()
  })
})
