/**
 * Dependency-free RFC 8291 (aes128gcm) + VAPID sender.
 * No notification history stored server-side; call from durable inbox scanner.
 * Environment: WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY,
 * WEB_PUSH_SUBJECT (mailto:admin@example.com or https://...)
 */
import {
  createECDH, createPrivateKey, createCipheriv, createHash, hkdfSync, randomBytes, sign,
} from 'node:crypto'

export interface PushTarget {
  endpoint: string
  p256dh: string
  auth_secret: string
}

const b64url = (buf: Buffer | Uint8Array): string =>
  Buffer.from(buf).toString('base64url')

function permittedEndpoint(endpoint: string): URL | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname.toLowerCase()
    // Push gateway allowlist prevents arbitrary HTTP requests/SSRF.
    if (!['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(host)
      && !host.endsWith('.push.apple.com')) return null
    return url
  } catch {
    return null
  }
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  return permittedEndpoint(endpoint) !== null
}

function vapidAuthorization(origin: string): string {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY
  const subject = process.env.WEB_PUSH_SUBJECT
  if (!publicKey || !privateKey || !subject) throw new Error('Web Push VAPID environment is missing')
  const pub = Buffer.from(publicKey, 'base64url')
  const priv = Buffer.from(privateKey, 'base64url')
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) throw new Error('Invalid VAPID key format')
  const jwk = {
    kty: 'EC' as const, crv: 'P-256' as const,
    x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)),
    d: b64url(priv),
  }
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(Buffer.from(JSON.stringify({
    aud: origin, exp: Math.floor(Date.now() / 1000) + 60 * 60,
    sub: subject,
  })))
  const body = `${header}.${claims}`
  const signature = sign('sha256', Buffer.from(body), {
    key: createPrivateKey({ key: jwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  })
  return `vapid t=${body}.${b64url(signature)}, k=${publicKey}`
}

function encryptPayload(target: PushTarget, payload: Record<string, unknown>): Buffer {
  const clientPub = Buffer.from(target.p256dh, 'base64url')
  const auth = Buffer.from(target.auth_secret, 'base64url')
  if (clientPub.length !== 65 || clientPub[0] !== 4 || auth.length !== 16) {
    throw new Error('Invalid browser push subscription keys')
  }
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const serverPub = ecdh.getPublicKey(undefined, 'uncompressed')
  const shared = ecdh.computeSecret(clientPub)
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, serverPub])
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32))
  const salt = randomBytes(16)
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])])
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  const rs = Buffer.alloc(4)
  rs.writeUInt32BE(4096, 0)
  return Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub, encrypted])
}

/** Returns 'gone' for stale subscriptions, 'sent' on provider acceptance, otherwise throws. */
export async function sendBrowserPush(
  target: PushTarget, payload: Record<string, unknown>
): Promise<'sent' | 'gone'> {
  const url = permittedEndpoint(target.endpoint)
  if (!url) throw new Error('Untrusted push endpoint')
  const body = encryptPayload(target, payload)
  if (body.length > 4096) throw new Error('Web Push payload exceeds 4096 bytes')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(url.origin),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    })
    if (response.status === 404 || response.status === 410) return 'gone'
    if (!response.ok) throw new Error(`Push gateway HTTP ${response.status}`)
    return 'sent'
  } finally {
    clearTimeout(timeout)
  }
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY &&
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY &&
    process.env.WEB_PUSH_SUBJECT
  )
}
