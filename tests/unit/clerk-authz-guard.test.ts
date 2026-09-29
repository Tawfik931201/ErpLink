import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Reachability guard for CVE-2026-42349 / GHSA-w24r-5266-9c3c
 * (Clerk authorization bypass, CVSS 7.6 High, fixed in
 * @clerk/clerk-react 5.61.6 / @clerk/shared 3.47.5 / @clerk/backend 2.33.3).
 *
 * The advisory is a *call-shape* vulnerability, not an "any app using Clerk"
 * vulnerability. Exactly two shapes are vulnerable:
 *
 *   1. `has()` / `auth.protect()` that combine two authorization dimensions:
 *      a `reverification` check with any of role/permission/feature/plan, or a
 *      billing check (feature/plan) with a role/permission check.
 *
 *   2. A second bypass in @clerk/nextjs: `auth.protect()` silently discards the
 *      authorization params whenever the SAME argument object also contains
 *      `unauthenticatedUrl`, `unauthorizedUrl` or `token`.
 *
 * The advisory states plainly that `clerkMiddleware`, `auth()`, session state
 * and token verification are all unaffected, and that single-condition checks
 * "continue to fail closed as expected".
 *
 * This app currently uses none of the vulnerable shapes, so it is NOT
 * exploitable. That is a *conclusion about current source*, and it is exactly
 * the kind of conclusion that rots silently: someone later adds an org/plan gate
 * and the app becomes exploitable with no other signal.
 *
 * So this test pins the conclusion. It scans the real source tree and fails if a
 * vulnerable shape ever appears. It is a static scan rather than a runtime test
 * on purpose: the vulnerable API is absent, so there is nothing to call.
 *
 * Source scanned: src/**\/*.{ts,tsx}
 */

const SRC_DIR = join(__dirname, '..', '..', 'src')

/** Params that express an authorization decision in Clerk. */
const AUTHORIZATION_KEYS = ['role', 'permission', 'feature', 'plan', 'reverification'] as const

/** Presence of any of these is what made `protect()` drop the params above. */
const URL_KEYS = ['unauthenticatedUrl', 'unauthorizedUrl', 'token'] as const

/**
 * Dimensions the advisory names for shape 1. `organization`/`orgId` are
 * included because the advisory title is "combining organization, billing, or
 * reverification checks".
 */
const COMBINABLE_KEYS = [...AUTHORIZATION_KEYS, 'organization', 'orgId'] as const

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * Collapses source to one line so a multi-line object literal is matched by a
 * single-line regex. Block comments go first; line comments are left alone
 * (harmless, since we only ever replace whitespace and never delete newlines,
 * so a `//` cannot swallow the code after it).
 */
function normalize(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
}

/** The object literal at the start of a snippet, or '' if there is none. */
function body(snippet: string): string {
  const at = snippet.indexOf('{')
  return at === -1 ? '' : snippet.slice(at)
}

/** Trims a match window to the end of the call, so failures read cleanly. */
function window(flat: string, from: number): string {
  const raw = flat.slice(from, from + 200)
  const close = raw.search(/\)\s*[;,)]/)
  return close === -1 ? raw : raw.slice(0, close + 1)
}

const hasKey = (text: string, key: string) => new RegExp(`\\b${key}\\s*:`).test(text)

/** Shape 1: two or more authorization dimensions in one `has()`/`protect()`. */
function isCombinedDimensions(snippet: string): boolean {
  const inner = body(snippet)
  return COMBINABLE_KEYS.filter((key) => hasKey(inner, key)).length >= 2
}

/** Shape 2: an authorization param sharing an object with a URL/token param. */
function isParamsDiscarded(snippet: string): boolean {
  const inner = body(snippet)
  const hasAuthz = AUTHORIZATION_KEYS.some((key) => hasKey(inner, key))
  const hasUrl = URL_KEYS.some((key) => hasKey(inner, key))
  return hasAuthz && hasUrl
}

/** `has({` call sites. `Set`/`Map`/`Headers` use `has(key)` and never match. */
function scanHas(flat: string): string[] {
  return Array.from(flat.matchAll(/\bhas\(\s*\{/g), (m) => window(flat, m.index))
}

/** `protect({` call sites. */
function scanProtectObject(flat: string): string[] {
  return Array.from(flat.matchAll(/\.protect\(\s*\{/g), (m) => window(flat, m.index))
}

/** Every `.protect(` call site, as the raw text following the open paren. */
function scanProtectArgs(flat: string): string[] {
  return Array.from(flat.matchAll(/\.protect\(/g), (m) =>
    flat.slice(m.index + '.protect('.length).trimStart(),
  )
}

interface Hit {
  file: string
  snippet: string
}

function scanAll(files: string[], pick: (flat: string) => string[]): Hit[] {
  return files.flatMap((file) => {
    const flat = normalize(readFileSync(file, 'utf8'))
    return pick(flat).map((snippet) => ({ file, snippet }))
  })
}

const files = collectSourceFiles(SRC_DIR)
const rel = (file: string) => file.replace(/\\/g, '/').split('/src/')[1] ?? file
const report = (hits: Hit[]) => hits.map(({ file, snippet }) => `${rel(file)} :: ${snippet}`)

describe(`CVE-2026-42349 reachability guard (${files.length} source files)`, () => {
  it('finds a source tree to scan', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  describe('shape 1: combined authorization dimensions', () => {
    it('has no `has({...})` / `protect({...})` combining two dimensions', () => {
      const offenders = [
        ...scanAll(files, scanHas).filter(({ snippet }) => isCombinedDimensions(snippet)),
        ...scanAll(files, scanProtectObject).filter(({ snippet }) => isCombinedDimensions(snippet)),
      ]
      expect(report(offenders)).toEqual([])
    })
  })

  describe('shape 2: protect() params discarded alongside a URL param', () => {
    it('has no `protect({...})` mixing an authorization param with a URL/token param', () => {
      const offenders = scanAll(files, scanProtectObject).filter(({ snippet }) => isParamsDiscarded(snippet))
      expect(report(offenders)).toEqual([])
    })
  })

  describe('pinned current state', () => {
    it('calls `.protect()` only with no arguments', () => {
      // An argument-less `protect()` has no params to discard, so it cannot hit
      // shape 2. A single-condition `protect({ permission })` IS safe per the
      // advisory, but it fails here on purpose: adding one means an
      // authorization gate now exists, and that deserves a human decision
      // against the advisory rather than a silent merge.
      const all = scanAll(files, scanProtectArgs)
      const withArgs = all.filter(({ snippet }) => !snippet.startsWith(')'))

      expect({
        total: all.length,
        withArguments: report(withArgs),
      }).toEqual({ total: 1, withArguments: [] })
    })

    it('keeps that single protect() call in middleware.ts', () => {
      // Stops the guard from being satisfied by deleting the protection.
      const all = scanAll(files, scanProtectArgs)
      expect(all).toHaveLength(1)
      expect(rel(all[0].file)).toBe('middleware.ts')
    })

    it('does not import the deprecated getAuth() helper', () => {
      // getAuth() is the pre-v5 predicate API; its return shape is not covered
      // by the advisory analysis above, so it must not come back.
      expect(files.filter((file) => readFileSync(file, 'utf8').includes('getAuth(')).map(rel)).toEqual([])
    })
  })

  describe('scanner self-check', () => {
    // A guard that cannot detect the pattern is worse than no guard, so the
    // matcher is asserted against the advisory's own examples. These use the
    // same scan/is* functions as the real scan above.
    it('detects shape 1 in the advisory examples', () => {
      const examples = [
        "const canAct = has({ role: 'org:admin', reverification: 'strict' })",
        "const canAct = has({ permission: 'org:admin', feature: 'premium' })",
        "await auth.protect({ permission: 'org:settings:delete', reverification: 'strict' })",
      ]
      for (const code of examples) {
        const hits = [...scanHas(normalize(code)), ...scanProtectObject(normalize(code))]
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.some(isCombinedDimensions)).toBe(true)
      }
    })

    it('detects shape 2 in the advisory example', () => {
      const code = "await auth.protect({ permission: 'org:settings:delete', unauthorizedUrl: '/x' })"
      const hits = scanProtectObject(normalize(code))
      expect(hits).toHaveLength(1)
      expect(hits.some(isParamsDiscarded)).toBe(true)
    })

    it('does not flag the shapes the advisory calls safe', () => {
      const safe = [
        "const seen = new Set(); if (seen.has(key)) return",
        "if (req.headers.has('next-action')) return",
        "if (groupedBots.has(bot.id)) bots.delete(bot.id)",
        // "Single-condition checks are not affected"
        "await auth.protect({ permission: 'org:settings:delete' })",
        "has({ reverification: 'strict' })",
        // The sequential workaround the advisory recommends.
        "await auth.protect({ reverification: 'strict' })",
        "await auth.protect({ permission: 'org:X' })",
      ]
      for (const code of safe) {
        const flat = normalize(code)
        expect(scanHas(flat).filter(isCombinedDimensions)).toEqual([])
        expect(scanProtectObject(flat).filter(isCombinedDimensions)).toEqual([])
        expect(scanProtectObject(flat).filter(isParamsDiscarded)).toEqual([])
      }
    })

    it('sees through comments and multi-line object literals', () => {
      // Both are how a real vulnerable call would be formatted by prettier.
      const multi = `
        /* audit: needs review */
        await auth.protect({
          permission: 'org:admin',
          feature: 'premium',
        })
      `
      const hits = scanProtectObject(normalize(multi))
      expect(hits).toHaveLength(1)
      expect(hits.some(isCombinedDimensions)).toBe(true)
    })

    it('treats an argument-less protect() as safe', () => {
      expect(scanProtectArgs(normalize('await auth().protect()'))).toEqual([')'])
    })
  })
})
