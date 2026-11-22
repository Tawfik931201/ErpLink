import { createECDH, createHmac, createPrivateKey, randomBytes, createCipheriv, sign } from 'node:crypto'

type Subscription = { endpoint: string; p256dh: string; auth: string }
const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url')
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, size: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest()
  let result = Buffer.alloc(0)
  let previous = Buffer.alloc(0)
  for (let i = 1; result.length < size; i++) {
    previous = createHmac('sha256', prk).update(Buffer.concat([previous, info, Buffer.from([i])])).digest()
    result = Buffer.concat([result, previous])
  }
  return result.subarray(0, size)
}
/** Accept either the original production variable or the documented alias.
 * The public VAPID key must still match the private key; never expose the private key.
 */
export function pushContact(): string {
  return process.env.WEB_PUSH_CONTACT || process.env.WEB_PUSH_SUBJECT || ''
}
/**
 * Validate the complete VAPID identity before exposing the public key to browsers.
 * A merely-present but malformed/mismatched key pair can cause opaque Push API errors.
 */
export function pushConfigurationIssue(): string | null {
  const publicText = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || ''
  const privateText = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || ''
  const contact = pushContact()
  if (!publicText || !privateText || !contact) {
    return 'Missing WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, or WEB_PUSH_CONTACT/WEB_PUSH_SUBJECT.'
  }
  if (!/^[A-Za-z0-9_-]+$/.test(publicText) || !/^[A-Za-z0-9_-]+$/.test(privateText)) {
    return 'VAPID keys must be unpadded base64url strings.'
  }
  const publicKey = Buffer.from(publicText, 'base64url')
  const privateKey = Buffer.from(privateText, 'base64url')
  if (publicKey.length !== 65 || publicKey[0] !== 4) {
    return 'WEB_PUSH_VAPID_PUBLIC_KEY must decode to a 65-byte uncompressed P-256 public key.'
  }
  if (privateKey.length !== 32) {
    return 'WEB_PUSH_VAPID_PRIVATE_KEY must decode to a 32-byte P-256 private key.'
  }
  if (!contact.startsWith('mailto:') && !contact.startsWith('https://')) {
    return 'WEB_PUSH_CONTACT/WEB_PUSH_SUBJECT must be a mailto: or https:// contact URI.'
  }
  try {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(privateKey)
    if (!ecdh.getPublicKey(undefined, 'uncompressed').equals(publicKey)) {
      return 'WEB_PUSH_VAPID_PUBLIC_KEY does not match WEB_PUSH_VAPID_PRIVATE_KEY.'
    }
  } catch {
    return 'VAPID key pair is not a valid P-256 key pair.'
  }
  return null
}
export function pushConfigured(): boolean {
  return pushConfigurationIssue() === null
}
function encryption(subscription: Subscription, message: string): Buffer {
  const ua = Buffer.from(subscription.p256dh, 'base64url')
  const auth = Buffer.from(subscription.auth, 'base64url')
  if (ua.length !== 65 || auth.length < 16) throw new Error('Invalid browser push key')
  const server = createECDH('prime256v1')
  server.generateKeys()
  const as = server.getPublicKey()
  const secret = server.computeSecret(ua)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ua, as])
  const ikm = hkdf(auth, secret, info, 32)
  const salt = randomBytes(16)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(message), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(4096)
  return Buffer.concat([salt, recordSize, Buffer.from([as.length]), as, ciphertext])
}
export async function sendBrowserPush(subscription: Subscription, payload: { title: string; body: string; href: string; tag: string }): Promise<{ gone: boolean }> {
  if (!pushConfigured()) throw new Error('Browser push VAPID is not configured')
  const url = new URL(subscription.endpoint)
  if (url.protocol !== 'https:' || !['443', ''].includes(url.port) || subscription.endpoint.length > 2048) throw new Error('Invalid push endpoint')
  const publicKey = Buffer.from(process.env.WEB_PUSH_VAPID_PUBLIC_KEY!, 'base64url')
  const privateKey = Buffer.from(process.env.WEB_PUSH_VAPID_PRIVATE_KEY!, 'base64url')
  if (publicKey.length !== 65 || privateKey.length !== 32) throw new Error('Invalid VAPID key length')
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64(publicKey.subarray(1, 33)), y: b64(publicKey.subarray(33)), d: b64(privateKey) }, format: 'jwk' })
  const header = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const data = b64(JSON.stringify({ aud: url.origin, exp: Math.floor(Date.now()/1000) + 3600, sub: pushContact() }))
  const signingInput = header + '.' + data
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  const body = encryption(subscription, JSON.stringify(payload))
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'vapid t=' + signingInput + '.' + b64(signature) + ', k=' + process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
      TTL: '3600',
      Urgency: 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(8000),
  })
  if (response.status === 404 || response.status === 410) return { gone: true }
  if (!response.ok) throw new Error('Push gateway status ' + response.status)
  return { gone: false }
}
