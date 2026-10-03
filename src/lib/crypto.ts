import crypto from 'crypto'

const IV_LENGTH = 16 // For AES, this is always 16

/**
 * Ciphertext layout produced by `encrypt()`: `<32 hex IV>:<hex ciphertext>`.
 * AES-256-CBC with a 16-byte IV is always 32 hex characters of IV.
 *
 * Used to tell "encrypted by us" apart from "stored in the clear", so a value
 * that was never encrypted is passed through instead of being mangled.
 */
const CIPHERTEXT_RE = /^[0-9a-f]{32}:[0-9a-f]+$/i

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
if (!ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[Crypto] ENCRYPTION_KEY is required in production. Set ENCRYPTION_KEY immediately — refusing to boot without it.')
  }
  console.warn('[Crypto] ENCRYPTION_KEY is not set — using an ephemeral in-memory key. Data encrypted by this process is unreadable after a restart. This is acceptable only for local development.')
}

/**
 * Dev-only fallback. Deliberately NOT a committed constant: a key in the source
 * is a key in every clone of the repository, and this one guards Odoo admin
 * passwords and Telegram bot tokens. It lives only in this process's memory.
 */
let ephemeralDevKey: string | null = null

function getActiveKey(): string {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY
  if (!ephemeralDevKey) ephemeralDevKey = crypto.randomBytes(32).toString('hex')
  return ephemeralDevKey
}

/**
 * Extra keys accepted for **decryption only**, to read rows written by an older
 * key. Comma-separated, operator-controlled, and not stored in the source.
 * Unset (the default) means no key is tried except `ENCRYPTION_KEY`.
 *
 * Migration: set it to the retired key, re-save the affected credentials so
 * they are re-encrypted with ENCRYPTION_KEY, then unset it.
 */
function getLegacyKeys(): string[] {
  const raw = process.env.ENCRYPTION_LEGACY_KEYS
  if (!raw) return []
  return raw
    .split(',')
    .map(k => k.trim())
    .filter(Boolean)
}

export function encrypt(text: string): string {
  if (!text) return ''
  try {
    const key = crypto.createHash('sha256').update(getActiveKey()).digest()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    let encrypted = cipher.update(text)
    encrypted = Buffer.concat([encrypted, cipher.final()])
    return iv.toString('hex') + ':' + encrypted.toString('hex')
  } catch (error) {
    console.error('Encryption failed:', error)
    throw new Error('Failed to encrypt sensitive value')
  }
}

export function decrypt(text: string): string {
  if (!text) return ''

  // Not our ciphertext shape — the value was never encrypted by this module
  // (legacy plaintext row). Pass it through untouched.
  if (!CIPHERTEXT_RE.test(text)) return text

  const candidates = [process.env.ENCRYPTION_KEY, ...getLegacyKeys()].filter(Boolean) as string[]

  for (const k of candidates) {
    try {
      const textParts = text.split(':')
      const ivHex = textParts.shift()
      if (!ivHex) break
      const iv = Buffer.from(ivHex, 'hex')
      const encryptedText = Buffer.from(textParts.join(':'), 'hex')
      const key = crypto.createHash('sha256').update(k).digest()
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
      let decrypted = decipher.update(encryptedText)
      decrypted = Buffer.concat([decrypted, decipher.final()])
      const result = decrypted.toString('utf8')
      if (result) return result
    } catch {
      // try next key
    }
  }

  // Never fall through to returning the ciphertext: a caller would then use it
  // as an API key, and the failure would be indistinguishable from success.
  throw new Error(
    '[Crypto] Failed to decrypt a stored credential. It was encrypted with a key that is not currently available. ' +
      'If it predates the current ENCRYPTION_KEY, set ENCRYPTION_LEGACY_KEYS to the retired key, re-save this credential to re-encrypt it, then unset ENCRYPTION_LEGACY_KEYS.'
  )
}
