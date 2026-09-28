import crypto from 'crypto'

const IV_LENGTH = 16 // For AES, this is always 16

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
if (!ENCRYPTION_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[Crypto] ENCRYPTION_KEY is required in production. Set ENCRYPTION_KEY immediately — refusing to boot with an insecure default key.')
  }
  console.warn('[Crypto] ENCRYPTION_KEY is not set — using an insecure default key. This is acceptable only for local development.')
}
function getActiveKey(): string {
  return process.env.ENCRYPTION_KEY || 'YCnwTG3j3mOspnQ0PiwgS88KsFlXMq2nF4Wl/6fNFec='
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
  const candidates = [
    process.env.ENCRYPTION_KEY,
    'YCnwTG3j3mOspnQ0PiwgS88KsFlXMq2nF4Wl/6fNFec=',
    'default-super-secret-key-32-chars-long!!',
  ].filter(Boolean) as string[]

  for (const k of candidates) {
    try {
      const textParts = text.split(':')
      const ivHex = textParts.shift()
      if (!ivHex) return text
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
  return text
}
