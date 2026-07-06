import crypto from 'crypto'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-super-secret-key-32-chars-long!!' // Must be 32 bytes/chars
const IV_LENGTH = 16 // For AES, this is always 16

if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  console.error(
    '[Crypto] ENCRYPTION_KEY is not set in production — falling back to an INSECURE default key. Set ENCRYPTION_KEY immediately.'
  )
}

export function encrypt(text: string): string {
  if (!text) return ''
  try {
    // Ensure key is exactly 32 bytes
    const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    let encrypted = cipher.update(text)
    encrypted = Buffer.concat([encrypted, cipher.final()])
    return iv.toString('hex') + ':' + encrypted.toString('hex')
  } catch (error) {
    // SECURITY: never silently store the plaintext credential on failure
    console.error('Encryption failed:', error)
    throw new Error('Failed to encrypt sensitive value')
  }
}

export function decrypt(text: string): string {
  if (!text) return ''
  try {
    const textParts = text.split(':')
    const ivHex = textParts.shift()
    if (!ivHex) return text
    const iv = Buffer.from(ivHex, 'hex')
    const encryptedText = Buffer.from(textParts.join(':'), 'hex')
    const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest()
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
    let decrypted = decipher.update(encryptedText)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    return decrypted.toString()
  } catch (error) {
    console.error('Decryption failed, returning raw text:', error)
    // Fallback to raw text if it was stored unencrypted initially
    return text
  }
}
