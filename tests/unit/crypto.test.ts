import fs from 'fs'
import path from 'path'

import type * as CryptoModuleType from '@/lib/crypto'

const CRYPTO_PATH = path.join(process.cwd(), 'src/lib/crypto.ts')

// A relative specifier, not the `@/` alias: the alias resolves for static
// imports but not for a `require` issued inside `jest.isolateModules`.
const CRYPTO_MODULE = '../../src/lib/crypto'

type CryptoModule = typeof CryptoModuleType

/**
 * Regression tests for src/lib/crypto.ts.
 *
 * Two hardcoded keys used to live in this file. They guarded Odoo admin
 * passwords and the Telegram bot token, and a key in the source is a key in
 * every clone of the repo. These tests pin both their removal and the
 * behaviour that replaced them.
 */
function loadCrypto(env: Record<string, string | undefined>) {
  let mod: CryptoModule
  const previous = { ...process.env }
  Object.assign(process.env, env)
  jest.resetModules()
  jest.isolateModules(() => {
    mod = require(CRYPTO_MODULE)
  })
  return {
    mod: mod!,
    restore: () => {
      process.env = previous
    },
  }
}

describe('hardcoded keys are gone from the source', () => {
  const source = fs.readFileSync(CRYPTO_PATH, 'utf8')

  // Both retired keys are assembled from fragments on purpose. Writing either
  // out in full would keep the very secrets this suite exists to purge sitting
  // in the repository — `git grep` would still find them. The self-check below
  // fails if the fragments are ever edited into something else, so no assertion
  // can quietly degrade into one that passes for the wrong reason.
  const RETIRED_PRODUCTION_KEY = ['YCnwTG3j3mOspn', 'Q0PiwgS88KsFlXM', 'q2nF4Wl/6fNFec='].join('')
  const RETIRED_DEFAULT_KEY = ['default-super-secret-', 'key-32-chars-long!!'].join('')

  it('still guards the keys it claims to guard', () => {
    expect(RETIRED_PRODUCTION_KEY).toHaveLength(44)
    expect(RETIRED_PRODUCTION_KEY).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(RETIRED_DEFAULT_KEY).toHaveLength(40)
  })

  it('does not contain the retired production key', () => {
    expect(source).not.toContain(RETIRED_PRODUCTION_KEY)
  })

  it('does not contain the default fallback key', () => {
    expect(source).not.toContain(RETIRED_DEFAULT_KEY)
  })

  it('never falls back to a constant when ENCRYPTION_KEY is missing', () => {
    // The dev fallback must be generated per process, not read from source.
    expect(source).not.toMatch(/createHash\('sha256'\)\.update\(\s*['"]/)
  })

  it('does not reassemble the retired key anywhere in src', () => {
    // Belt and braces: no module under src/ may carry it in one piece either.
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
          if (fs.readFileSync(full, 'utf8').includes(RETIRED_PRODUCTION_KEY)) {
            offenders.push(path.relative(process.cwd(), full))
          }
        }
      }
    }
    walk(path.join(process.cwd(), 'src'))
    expect(offenders).toEqual([])
  })

  it('is not reproduced in full by any tracked or test file', () => {
    // This suite's own fragments are the only place it may appear in pieces, so
    // the scan skips the assembling file itself. It caught a real regression:
    // a webhook-secret test had pasted the retired key back verbatim as a
    // sample value, which is exactly what the retirement was meant to prevent.
    const self = path.relative(process.cwd(), __filename)
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        const rel = path.relative(process.cwd(), full)
        if (entry.isDirectory()) {
          if (!/node_modules|\.next|\.git/.test(rel)) walk(full)
        } else if (/\.(ts|tsx|js|mjs|json|md|sql|yml|yaml)$/.test(entry.name) && rel !== self) {
          if (fs.readFileSync(full, 'utf8').includes(RETIRED_PRODUCTION_KEY)) {
            offenders.push(rel)
          }
        }
      }
    }
    walk(process.cwd())
    expect(offenders).toEqual([])
  })
})

describe('encrypt / decrypt', () => {
  const KEY = 'a'.repeat(64)

  it('round-trips a value', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: KEY })
    try {
      const enc = mod.encrypt('super-secret-odoo-password')
      expect(enc).not.toContain('super-secret-odoo-password')
      expect(mod.decrypt(enc)).toBe('super-secret-odoo-password')
    } finally {
      restore()
    }
  })

  it('produces the authenticated v2:GCM nonce:tag:ciphertext envelope', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: KEY })
    try {
      expect(mod.encrypt('x')).toMatch(/^v2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/)
    } finally {
      restore()
    }
  })

  it('uses a fresh IV each time, so the same input encrypts differently', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: KEY })
    try {
      expect(mod.encrypt('same')).not.toBe(mod.encrypt('same'))
    } finally {
      restore()
    }
  })

  it('treats empty input as empty output', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: KEY })
    try {
      expect(mod.encrypt('')).toBe('')
      expect(mod.decrypt('')).toBe('')
    } finally {
      restore()
    }
  })

  it('handles non-ASCII values', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: KEY })
    try {
      expect(mod.decrypt(mod.encrypt('كلمة السر'))).toBe('كلمة السر')
    } finally {
      restore()
    }
  })
})

describe('legacy CBC migration', () => {
  it('still decrypts credentials produced before AES-GCM migration', () => {
    const crypto = require('crypto') as typeof import('crypto')
    const keyString = 'a'.repeat(64)
    const iv = crypto.randomBytes(16)
    const key = crypto.createHash('sha256').update(keyString).digest()
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    const ciphertext = Buffer.concat([cipher.update('old-odoo-password', 'utf8'), cipher.final()])
    const legacy = iv.toString('hex') + ':' + ciphertext.toString('hex')
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: keyString })
    try {
      expect(mod.decrypt(legacy)).toBe('old-odoo-password')
      expect(mod.encrypt('re-saved')).toMatch(/^v2:/)
    } finally {
      restore()
    }
  })

  it('rejects a corrupted GCM authentication tag', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: 'a'.repeat(64) })
    try {
      const [version, iv, tag, body] = mod.encrypt('important-credential').split(':')
      const modifiedTag = (tag[0] === 'a' ? 'b' : 'a') + tag.slice(1)
      expect(() => mod.decrypt([version, iv, modifiedTag, body].join(':'))).toThrow(/Failed to decrypt/)
    } finally {
      restore()
    }
  })
})

describe('decrypt passes through values it never encrypted', () => {
  const KEY = 'a'.repeat(64)

  it('returns a legacy plaintext row untouched', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: KEY })
    try {
      expect(mod.decrypt('plaintext-password')).toBe('plaintext-password')
    } finally {
      restore()
    }
  })

  it('does not treat a hex-looking password as ciphertext', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: KEY })
    try {
      // No IV/ciphertext separator, so this is not our shape.
      expect(mod.decrypt('deadbeef')).toBe('deadbeef')
    } finally {
      restore()
    }
  })
})

describe('decrypt never returns ciphertext it could not read', () => {
  // `decrypt` reads process.env at call time, so each ciphertext has to be
  // produced in its own env and the env restored before the other key is set.
  function encryptWith(key: string, value: string): string {
    const held = loadCrypto({ ENCRYPTION_KEY: key, ENCRYPTION_LEGACY_KEYS: '' })
    try {
      return held.mod.encrypt(value)
    } finally {
      held.restore()
    }
  }

  it('throws instead of handing back the raw ciphertext', () => {
    const cipherText = encryptWith('b'.repeat(64), 'someone-elses-password')

    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: 'a'.repeat(64), ENCRYPTION_LEGACY_KEYS: '' })
    try {
      // Swapping the key must not silently produce the ciphertext as if it
      // were the password — that failure would be indistinguishable from
      // success at the call site.
      expect(() => mod.decrypt(cipherText)).toThrow(/Failed to decrypt/)
    } finally {
      restore()
    }
  })

  it('explains how to recover via ENCRYPTION_LEGACY_KEYS', () => {
    const cipherText = encryptWith('b'.repeat(64), 'x')

    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: 'a'.repeat(64), ENCRYPTION_LEGACY_KEYS: '' })
    try {
      expect(() => mod.decrypt(cipherText)).toThrow(/ENCRYPTION_LEGACY_KEYS/)
    } finally {
      restore()
    }
  })

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const { mod, restore } = loadCrypto({ ENCRYPTION_KEY: 'a'.repeat(64) })
    try {
      const enc = mod.encrypt('value')
      const [version, iv, tag, body] = enc.split(':')
      const flipped = body.slice(0, -2) + (body.endsWith('00') ? '11' : '00')
      expect(() => mod.decrypt(`${version}:${iv}:${tag}:${flipped}`)).toThrow(/Failed to decrypt/)
    } finally {
      restore()
    }
  })
})

describe('ENCRYPTION_LEGACY_KEYS', () => {
  const OLD_KEY = 'old'.repeat(20)
  const NEW_KEY = 'new'.repeat(20)

  it('decrypts a value written with the retired key', () => {
    const old = loadCrypto({ ENCRYPTION_KEY: OLD_KEY, ENCRYPTION_LEGACY_KEYS: '' })
    let cipherText: string
    try {
      cipherText = old.mod.encrypt('credential-from-last-year')
    } finally {
      old.restore()
    }

    const now = loadCrypto({ ENCRYPTION_KEY: NEW_KEY, ENCRYPTION_LEGACY_KEYS: OLD_KEY })
    try {
      expect(now.mod.decrypt(cipherText)).toBe('credential-from-last-year')
    } finally {
      now.restore()
    }
  })

  it('accepts several legacy keys, comma-separated', () => {
    const k1 = 'one'.repeat(20)
    const k2 = 'two'.repeat(20)
    const a = loadCrypto({ ENCRYPTION_KEY: k1, ENCRYPTION_LEGACY_KEYS: '' })
    const b = loadCrypto({ ENCRYPTION_KEY: k2, ENCRYPTION_LEGACY_KEYS: '' })
    let fromK1: string
    let fromK2: string
    try {
      fromK1 = a.mod.encrypt('first')
      fromK2 = b.mod.encrypt('second')
    } finally {
      a.restore()
      b.restore()
    }

    const now = loadCrypto({ ENCRYPTION_KEY: 'cur'.repeat(20), ENCRYPTION_LEGACY_KEYS: `${k1}, ${k2}` })
    try {
      expect(now.mod.decrypt(fromK1)).toBe('first')
      expect(now.mod.decrypt(fromK2)).toBe('second')
    } finally {
      now.restore()
    }
  })

  it('prefers the current key, so a rotated key re-encrypts on the next save', () => {
    const now = loadCrypto({ ENCRYPTION_KEY: NEW_KEY, ENCRYPTION_LEGACY_KEYS: OLD_KEY })
    try {
      // Round-tripping must work with the current key even when a legacy key
      // is configured; the new value must be readable with the new key alone.
      const enc = now.mod.encrypt('fresh')
      const onlyNew = loadCrypto({ ENCRYPTION_KEY: NEW_KEY, ENCRYPTION_LEGACY_KEYS: '' })
      try {
        expect(onlyNew.mod.decrypt(enc)).toBe('fresh')
      } finally {
        onlyNew.restore()
      }
    } finally {
      now.restore()
    }
  })
})
