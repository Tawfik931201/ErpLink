/**
 * Tests for the shared constant-time secret comparison.
 *
 * Two Odoo routes each carried their own private copy of this function. They
 * now share one implementation in src/lib/webhook-secret.ts, and this suite
 * pins the behaviour both routes depend on.
 */

import fs from 'fs'
import path from 'path'

import { secretMatches } from '@/lib/webhook-secret'

const SECRET = 'a-shared-odoo-webhook-secret'

describe('secretMatches', () => {
  it('accepts the exact secret', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true)
  })

  it('rejects a different secret of the same length', () => {
    const wrong = 'b' + SECRET.slice(1)
    expect(wrong).toHaveLength(SECRET.length)
    expect(secretMatches(wrong, SECRET)).toBe(false)
  })

  it('rejects a secret differing only in the last byte', () => {
    const wrong = SECRET.slice(0, -1) + (SECRET.endsWith('t') ? 'x' : 't')
    expect(secretMatches(wrong, SECRET)).toBe(false)
  })

  it('rejects a truncated secret without throwing', () => {
    // crypto.timingSafeEqual throws on a length mismatch, so the length guard
    // has to come first or every short guess would be a 500 instead of a 401.
    expect(() => secretMatches(SECRET.slice(0, 5), SECRET)).not.toThrow()
    expect(secretMatches(SECRET.slice(0, 5), SECRET)).toBe(false)
  })

  it('rejects a longer secret without throwing', () => {
    expect(secretMatches(SECRET + 'x', SECRET)).toBe(false)
  })

  it('rejects empty input on both sides', () => {
    expect(secretMatches('', SECRET)).toBe(false)
    expect(secretMatches(SECRET, '')).toBe(false)
  })

  it('treats two empty strings as a match', () => {
    // Both sides empty means the deployment has no secret configured; the
    // routes guard that separately, so this stays a plain equality result.
    expect(secretMatches('', '')).toBe(true)
  })

  it('compares by bytes, not characters', () => {
    // A multi-byte secret must still work: Buffer.from is applied to both
    // sides, so a JS string-length shortcut would not match this.
    const arabic = 'سر-الويب-هوك-الخاص'
    expect(secretMatches(arabic, arabic)).toBe(true)
    expect(secretMatches(arabic, arabic + 'ا')).toBe(false)
  })

  it('handles a base64-shaped secret', () => {
    // Invented value, deliberately NOT the key that used to be hardcoded in
    // crypto.ts — that one is retired and must not reappear anywhere.
    const b64 = 'aGVsbG8td2ViaG9vay1zZWNyZXQtdmFsdWUtaGVyZQ=='
    expect(secretMatches(b64, b64)).toBe(true)
    expect(secretMatches(b64.slice(0, -1), b64)).toBe(false)
  })
})

describe('there is exactly one implementation', () => {
  const route = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

  it('the Odoo routes import it instead of redefining it', () => {
    for (const p of ['src/app/api/webhooks/odoo/route.ts', 'src/app/api/webhooks/odoo/stock/route.ts']) {
      const source = route(p)
      expect(source).toContain("from '@/lib/webhook-secret'")
      // A leftover local copy would mean the two routes could drift apart.
      expect(source).not.toMatch(/function\s+secretMatches/)
    }
  })

  it('no route compares a secret with a plain ===', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('route.ts')) {
          const source = fs.readFileSync(full, 'utf8')
          if (/(secret|token|signature)\s*===|\.secret\s*!==/.test(source)) {
            offenders.push(path.relative(process.cwd(), full))
          }
        }
      }
    }
    walk(path.join(process.cwd(), 'src/app/api'))
    expect(offenders).toEqual([])
  })
})

