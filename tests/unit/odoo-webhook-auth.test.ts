/**
 * The Odoo ingress secret, the two receivers' policy, and the source pins that
 * keep the failure mode that killed Odoo → store sync from coming back.
 *
 * Context worth knowing before changing anything here: the destination URL is
 * written into each customer's Odoo database by `src/lib/odoo-webhook.ts`, so an
 * action registered without a secret cannot be fixed by configuration — only by
 * re-registering it. That is what `POST /api/admin/odoo-webhooks/refresh` is for.
 */

import fs from 'fs'
import path from 'path'

import type * as WebhookSecretModule from '@/lib/odoo/webhook-secret'

const MODULE_PATH = path.join(process.cwd(), 'src/lib/odoo/webhook-secret.ts')
const MODULE_ALIAS = '@/lib/odoo/webhook-secret'

/** `process.env` is typed read-only in places, so the tests cast once, here. */
function setEnv(name: string, value: string | undefined) {
  const env = process.env as unknown as Record<string, string | undefined>
  if (value === undefined) delete env[name]
  else env[name] = value
}

function loadModule(env: Record<string, string | undefined>) {
  let mod: typeof WebhookSecretModule
  const previous = process.env.ENCRYPTION_KEY
  const previousNodeEnv = process.env.NODE_ENV
  for (const [name, value] of Object.entries(env)) setEnv(name, value)
  jest.resetModules()
  jest.isolateModules(() => {
    mod = require(MODULE_PATH)
  })
  return {
    mod: mod!,
    restore: () => {
      setEnv('ENCRYPTION_KEY', previous)
      setEnv('NODE_ENV', previousNodeEnv)
    },
  }
}

const KEY = 'a-32-byte-test-key-for-hkdf-deriv'
const WORKSPACE = '11111111-2222-3333-4444-555555555555'
const MAPPING = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('the secret is derived per scope from ENCRYPTION_KEY', () => {
  it('is not derivable without a key', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: undefined })
    try {
      expect(mod.deriveOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE))).toBeNull()
      expect(mod.deriveOdooWebhookSecret(mod.odooRecordSecretScope(MAPPING))).toBeNull()
    } finally {
      restore()
    }
  })

  it('is deterministic, so a URL registered once keeps verifying', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const first = mod.deriveOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE))
      const second = mod.deriveOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE))
      expect(first).toBeTruthy()
      expect(first).toBe(second)
    } finally {
      restore()
    }
  })

  it('differs per workspace, so one tenant cannot forge another', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const a = mod.deriveOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE))
      const b = mod.deriveOdooWebhookSecret(
        mod.odooStockSecretScope('99999999-2222-3333-4444-555555555555')
      )
      expect(a).not.toBe(b)
    } finally {
      restore()
    }
  })

  it('differs between the stock and record receivers for the same id', () => {
    // The scope is prefixed per receiver, so a secret captured from one URL
    // cannot be replayed against the other endpoint.
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const stock = mod.deriveOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE))
      const record = mod.deriveOdooWebhookSecret(mod.odooRecordSecretScope(WORKSPACE))
      expect(stock).not.toBe(record)
    } finally {
      restore()
    }
  })

  it('changes with the key, so a rotated key invalidates every action', () => {
    const first = loadModule({ ENCRYPTION_KEY: KEY })
    const stock = first.mod.deriveOdooWebhookSecret(first.mod.odooStockSecretScope(WORKSPACE))
    first.restore()
    const second = loadModule({ ENCRYPTION_KEY: 'a-completely-different-key-value-x' })
    const rotated = second.mod.deriveOdooWebhookSecret(second.mod.odooStockSecretScope(WORKSPACE))
    second.restore()
    expect(stock).not.toBe(rotated)
  })

  it('never returns the key itself, nor anything derived from it reversibly', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const secret = mod.deriveOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE))!
      expect(secret).not.toContain(KEY)
      expect(secret).toHaveLength(64)
    } finally {
      restore()
    }
  })

  it('refuses a scope with no scope prefix', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      expect(mod.deriveOdooWebhookSecret('')).toBeNull()
      expect(mod.deriveOdooWebhookSecret(WORKSPACE)).toBeNull()
    } finally {
      restore()
    }
  })
})

describe('withOdooWebhookSecret', () => {
  it('appends the secret to the path that was registered', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const path_ = `/api/webhooks/odoo/stock?workspace_id=${WORKSPACE}`
      const expected = mod.deriveOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE))!
      expect(mod.withOdooWebhookSecret(path_, mod.odooStockSecretScope(WORKSPACE))).toBe(
        `${path_}&secret=${expected}`
      )
    } finally {
      restore()
    }
  })

  it('uses ? when the path has no query yet', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const scope = mod.odooRecordSecretScope(MAPPING)
      const expected = mod.deriveOdooWebhookSecret(scope)!
      expect(mod.withOdooWebhookSecret('/api/webhooks/odoo', scope)).toBe(
        `/api/webhooks/odoo?secret=${expected}`
      )
    } finally {
      restore()
    }
  })

  it('returns the path untouched when no secret can be derived', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: undefined })
    try {
      const path_ = '/api/webhooks/odoo/stock?workspace_id=x'
      expect(mod.withOdooWebhookSecret(path_, mod.odooStockSecretScope('x'))).toBe(path_)
    } finally {
      restore()
    }
  })
})

describe('classification of an inbound delivery', () => {
  it('accepts the exact secret', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const scope = mod.odooStockSecretScope(WORKSPACE)
      const secret = mod.deriveOdooWebhookSecret(scope)!
      expect(mod.verifyOdooWebhookSecret(scope, secret)).toEqual({ status: 'ok' })
    } finally {
      restore()
    }
  })

  it('rejects a wrong secret of the same length', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const scope = mod.odooStockSecretScope(WORKSPACE)
      const secret = mod.deriveOdooWebhookSecret(scope)!
      const wrong = 'f' + secret.slice(1)
      expect(wrong).toHaveLength(secret.length)
      expect(mod.verifyOdooWebhookSecret(scope, wrong)).toEqual({ status: 'invalid' })
    } finally {
      restore()
    }
  })

  it("rejects another workspace's secret — the cross-tenant case", () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const other = mod.deriveOdooWebhookSecret(
        mod.odooStockSecretScope('99999999-2222-3333-4444-555555555555')
      )!
      expect(mod.verifyOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE), other)).toEqual({
        status: 'invalid',
      })
    } finally {
      restore()
    }
  })

  it('calls an empty secret `legacy`, never `ok`', () => {
    // That distinction is the whole migration: an action registered before the
    // secret existed sends nothing at all.
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      const scope = mod.odooStockSecretScope(WORKSPACE)
      expect(mod.verifyOdooWebhookSecret(scope, '')).toEqual({ status: 'legacy' })
      expect(mod.verifyOdooWebhookSecret(scope, '   ')).toEqual({ status: 'legacy' })
      expect(mod.verifyOdooWebhookSecret(scope, null)).toEqual({ status: 'legacy' })
    } finally {
      restore()
    }
  })

  it('is `unconfigured` when no key exists at all', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: undefined })
    try {
      expect(mod.verifyOdooWebhookSecret(mod.odooStockSecretScope(WORKSPACE), '')).toEqual({
        status: 'unconfigured',
      })
    } finally {
      restore()
    }
  })
})

describe('the ingress policy both routes share', () => {
  it('turns `invalid` into a 401', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY, NODE_ENV: 'production' })
    try {
      const decision = mod.decideOdooWebhookAuth({ status: 'invalid' }, mod.odooStockSecretScope(WORKSPACE))
      expect(decision).toEqual({
        action: 'reject',
        status: 401,
        error: 'Unauthorized: Invalid or missing Odoo webhook secret',
      })
    } finally {
      restore()
    }
  })

  it('turns `unconfigured` into a 500 in production', () => {
    // Loaded with a key so `crypto.ts` does not refuse to import; the decision
    // under test is the one a production process makes when nothing is derivable.
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY, NODE_ENV: 'production' })
    try {
      const decision = mod.decideOdooWebhookAuth(
        { status: 'unconfigured' },
        mod.odooStockSecretScope(WORKSPACE)
      )
      expect(decision.action).toBe('reject')
      expect(decision.action === 'reject' && decision.status).toBe(500)
    } finally {
      restore()
    }
  })

  it('allows `unconfigured` outside production — the only place skipping is safe', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY, NODE_ENV: 'development' })
    try {
      // The classification travels with an allow decision: the receiver's
      // record-gone branch must be able to distinguish authenticated
      // deletions from legacy ones (deletion-only for `ok`).
      expect(mod.decideOdooWebhookAuth({ status: 'unconfigured' }, 'stock:x')).toEqual({
        action: 'allow',
        status: 'unconfigured',
      })
    } finally {
      restore()
    }
  })

  it('allows `legacy` and counts it, so the window is observable', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY, NODE_ENV: 'production' })
    try {
      const scope = mod.odooStockSecretScope('44444444-4444-4444-4444-444444444444')
      expect(mod.decideOdooWebhookAuth({ status: 'legacy' }, scope)).toEqual({
        action: 'allow',
        status: 'legacy',
      })
      expect(mod.legacyOdooDeliveryCounts()[scope]).toBeGreaterThanOrEqual(1)
    } finally {
      restore()
    }
  })
})

describe('the caller secret is read from the places Odoo can put it', () => {
  it('prefers the Bearer token, then the header, then the query string', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY })
    try {
      expect(mod.extractOdooProvidedSecret({ authorization: 'Bearer from-bearer' })).toBe('from-bearer')
      expect(mod.extractOdooProvidedSecret({ authorization: 'Bearer  padded ' })).toBe('padded')
      expect(mod.extractOdooProvidedSecret({ headerSecret: 'from-header' })).toBe('from-header')
      expect(mod.extractOdooProvidedSecret({ querySecret: 'from-query' })).toBe('from-query')
      expect(mod.extractOdooProvidedSecret({ token: 'from-token' })).toBe('from-token')
      expect(mod.extractOdooProvidedSecret({ authorization: 'Bearer a', headerSecret: 'b', querySecret: 'c' })).toBe('a')
      expect(mod.extractOdooProvidedSecret({})).toBe('')
    } finally {
      restore()
    }
  })

  it('authorizeOdooWebhook ends in `ok` for a correctly signed delivery', () => {
    const { mod, restore } = loadModule({ ENCRYPTION_KEY: KEY, NODE_ENV: 'production' })
    try {
      const scope = mod.odooStockSecretScope(WORKSPACE)
      const secret = mod.deriveOdooWebhookSecret(scope)!
      expect(mod.authorizeOdooWebhook({ scope, querySecret: secret })).toEqual({
        action: 'allow',
        status: 'ok',
      })
      expect(mod.authorizeOdooWebhook({ scope, querySecret: 'nope' }).action).toBe('reject')
    } finally {
      restore()
    }
  })
})

describe('the registration and the receivers stay in sync', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

  it('scopes a new stock registration by both workspace and ERP resource', () => {
    const source = read('src/lib/odoo-webhook.ts')
    expect(source).toContain('withOdooWebhookSecret')
    expect(source).toContain('secretScope: odooStockSecretScope(workspaceId, resource)')
    expect(source).toContain('&resource=${resource}')
    const receiver = read('src/app/api/webhooks/odoo/stock/route.ts')
    expect(receiver).toContain('scope: odooStockSecretScope(workspaceId, resource)')
    expect(receiver).toContain("resource !== odooStockWebhookResource(erpConn.url, erpConn.db_name ?? '')")
    expect(receiver).toContain('binding?.switched_at')
    // The record receiver is the default scope, derived from the mapping id the
    // URL already carries.
    expect(source).toContain('odooRecordSecretScope(fieldMappingId)')
    // Every registered URL, stock and record alike, is built by the helper —
    // concatenating a raw path is the regression that started this.
    expect(source).toContain('const webhookUrl = `${appUrl}${withOdooWebhookSecret(basePath, scope)}`')
  })

  it('both receivers verify through the shared policy, before any database work', () => {
    for (const p of ['src/app/api/webhooks/odoo/route.ts', 'src/app/api/webhooks/odoo/stock/route.ts']) {
      const source = read(p)
      expect(source).toContain(`from '${MODULE_ALIAS}'`)
      expect(source).toContain('authorizeOdooWebhook')
      // Reading the old shared-secret env var is what produced the 500 in
      // production. Mentioning it in a comment is fine; reading it is not.
      expect(source).not.toContain('process.env.ODOO_WEBHOOK_SECRET')
      // Verification must precede the first query, or an unauthenticated caller
      // gets an existence oracle for free.
      const authIndex = source.indexOf('authorizeOdooWebhook({')
      const firstQuery = source.indexOf('.select(')
      expect(authIndex).toBeGreaterThan(-1)
      expect(firstQuery).toBeGreaterThan(-1)
      expect(authIndex).toBeLessThan(firstQuery)
    }
  })

  it('the refresh route is admin-gated and refuses to run without a derivable secret', () => {
    const source = read('src/app/api/admin/odoo-webhooks/refresh/route.ts')
    expect(source).toContain('isAdmin(userId)')
    expect(source).toContain("status: 403")
    expect(source).toContain('deriveOdooWebhookSecret(odooStockSecretScope(')
    // Create before delete: an Odoo action that vanished and could not be
    // re-created is a silent, permanent loss of that tenant's push sync.
    const registerIndex = source.indexOf('await registerOdooStockWebhook(config, workspaceId)')
    const unregisterIndex = source.indexOf('await unregisterOdooStockWebhook(config,')
    expect(registerIndex).toBeGreaterThan(-1)
    expect(unregisterIndex).toBeGreaterThan(registerIndex)
  })
})
