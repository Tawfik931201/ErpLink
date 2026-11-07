import fs from 'fs'
import path from 'path'

import type * as WebhookAuthModuleType from '@/lib/zid/webhook-auth'

const ROUTE_PATH = path.join(process.cwd(), 'src/app/api/webhooks/zid/route.ts')
const WEBHOOKS_PATH = path.join(process.cwd(), 'src/lib/zid/webhooks.ts')

type WebhookAuthModule = typeof WebhookAuthModuleType

const AUTH_MODULE = '../../src/lib/zid/webhook-auth'

const TEST_KEY = 'test-encryption-key-not-a-real-secret'

it('registers manager customer edits as a core event', () => {
  const source = fs.readFileSync(WEBHOOKS_PATH, 'utf8')
  const core = source.match(/export const ZID_CORE_EVENTS = \[([\s\S]*?)\]/)?.[1] || ''
  expect(core).toContain("'customer_merchant_update'")
  expect(source).toContain("customer_merchant_update: 'customer.merchant.update'")
})

/**
 * Regression tests for src/lib/zid/webhook-auth.ts.
 *
 * Zid signs nothing. The endpoint used to verify an `X-Zid-Signature` HMAC that
 * Zid never sends, and registration used to send a `secret` field that is not in
 * Zid's webhook schema — so with `ZID_WEBHOOK_SECRET` unset in production every
 * delivery became a hard 500 (commit 0919a08), and setting it would only have
 * traded the 500 for a 401. Zid's one documented inbound mechanism is HTTP Basic,
 * stored on the webhook row at creation time, so what is pinned here is:
 *
 *   1. the credential is derived deterministically from `ENCRYPTION_KEY`
 *      (already guaranteed in production) instead of a new env var,
 *   2. the comparison is constant-time and rejects anything else,
 *   3. the endpoint classifies a missing header as `legacy`, never as `ok`,
 *   4. an unauthenticated `app.uninstalled` is refused — it is the one
 *      irreversible thing a webhook can do, and store_id is in the URL,
 *   5. registration sends `username`/`password`, not `secret`.
 */
function loadAuth(env: Record<string, string | undefined>) {
  let mod: WebhookAuthModule
  const previous = process.env.ENCRYPTION_KEY
  // `Object.assign` would coerce `undefined` into the string "undefined", which
  // is a perfectly valid key — the absence case has to be a real delete.
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  jest.resetModules()
  jest.isolateModules(() => {
    mod = require(AUTH_MODULE)
  })
  return {
    mod: mod!,
    restore: () => {
      if (previous === undefined) delete process.env.ENCRYPTION_KEY
      else process.env.ENCRYPTION_KEY = previous
    },
  }
}

describe('the webhook credential is derived from ENCRYPTION_KEY', () => {
  it('is not derivable without a key', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: undefined })
    try {
      expect(mod.getZidWebhookCredential()).toBeNull()
    } finally {
      restore()
    }
  })

  it('is deterministic for the same key and different for another key', () => {
    const first = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    const firstHeader = first.mod.getZidWebhookCredential()?.headerValue
    first.restore()

    const again = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    const againHeader = again.mod.getZidWebhookCredential()?.headerValue
    again.restore()

    const other = loadAuth({ ENCRYPTION_KEY: `${TEST_KEY}-rotated` })
    const otherHeader = other.mod.getZidWebhookCredential()?.headerValue
    other.restore()

    expect(firstHeader).toBe(againHeader)
    expect(firstHeader).not.toBe(otherHeader)
  })

  it('is the Basic header Zid sends, and never exposes the key itself', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      const credential = mod.getZidWebhookCredential()!
      expect(credential.headerValue).toBe(`Basic ${credential.encoded}`)
      // Zid builds this from `username:password`, so the encoding must round-trip.
      expect(Buffer.from(credential.encoded, 'base64').toString('utf8')).toBe(
        `${credential.username}:${credential.password}`
      )
      // The derived password must not be the key, or the rotation story above is a lie.
      expect(credential.password).not.toBe(TEST_KEY)
      expect(credential.headerValue).not.toContain(TEST_KEY)
    } finally {
      restore()
    }
  })

  it('fingerprint is stable, short, and not the credential', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      const credential = mod.getZidWebhookCredential()!
      const fingerprint = mod.zidWebhookCredentialFingerprint()
      expect(fingerprint).toHaveLength(12)
      expect(fingerprint).toBe(mod.zidWebhookCredentialFingerprint())
      expect(fingerprint).not.toBe(credential.encoded)
      expect(credential.encoded).not.toContain(fingerprint)
    } finally {
      restore()
    }
  })
})

describe('inbound Authorization header classification', () => {
  it('accepts the exact header Zid sends', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      const { headerValue } = mod.getZidWebhookCredential()!
      expect(mod.verifyZidWebhookAuthorization(headerValue)).toEqual({ status: 'ok' })
    } finally {
      restore()
    }
  })

  it('accepts the scheme-less and lower-case-scheme forms', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      const { encoded } = mod.getZidWebhookCredential()!
      expect(mod.verifyZidWebhookAuthorization(encoded)).toEqual({ status: 'ok' })
      expect(mod.verifyZidWebhookAuthorization(`basic ${encoded}`)).toEqual({ status: 'ok' })
    } finally {
      restore()
    }
  })

  it('rejects a wrong credential — including one of the same length', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      const { encoded } = mod.getZidWebhookCredential()!
      const sameLength = Buffer.from('zid:' + '0'.repeat(64), 'utf8').toString('base64')
      expect(sameLength).toHaveLength(encoded.length)

      expect(mod.verifyZidWebhookAuthorization('Basic ' + sameLength)).toEqual({ status: 'invalid' })
      expect(mod.verifyZidWebhookAuthorization('Bearer something')).toEqual({ status: 'invalid' })
      expect(mod.verifyZidWebhookAuthorization(encoded.slice(0, -1))).toEqual({ status: 'invalid' })
    } finally {
      restore()
    }
  })

  it('calls a missing header `legacy`, never `ok` — that distinction is the whole migration', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: TEST_KEY })
    try {
      expect(mod.verifyZidWebhookAuthorization(null)).toEqual({ status: 'legacy' })
      expect(mod.verifyZidWebhookAuthorization(undefined)).toEqual({ status: 'legacy' })
      expect(mod.verifyZidWebhookAuthorization('   ')).toEqual({ status: 'legacy' })
    } finally {
      restore()
    }
  })

  it('calls it `unconfigured` when no credential can be derived at all', () => {
    const { mod, restore } = loadAuth({ ENCRYPTION_KEY: undefined })
    try {
      expect(mod.verifyZidWebhookAuthorization(null)).toEqual({ status: 'unconfigured' })
      // A header with no credential to compare against must not pass either.
      expect(mod.verifyZidWebhookAuthorization('Basic anything')).toEqual({ status: 'unconfigured' })
    } finally {
      restore()
    }
  })
})

describe('the endpoint keeps the documented mechanism only', () => {
  const route = fs.readFileSync(ROUTE_PATH, 'utf8')
  const webhooks = fs.readFileSync(WEBHOOKS_PATH, 'utf8')

  it('has no HMAC signature path left — Zid never sent one', () => {
    expect(route).not.toMatch(/x-zid-signature/i)
    expect(route).not.toMatch(/createHmac/)
    expect(route).not.toMatch(/verifyZidSignature/)
    expect(route).not.toMatch(/ZID_WEBHOOK_SECRET/)
  })

  it('verifies the Authorization header through the shared helper', () => {
    expect(route).toMatch(/verifyZidWebhookAuthorization\(headersList\.get\('authorization'\)\)/)
  })

  it('answers 401 to a wrong credential', () => {
    expect(route).toMatch(/authResult\.status === 'invalid'[\s\S]{0,400}status: 401/)
  })

  it('refuses an unauthenticated app.uninstalled instead of deleting tokens', () => {
    expect(route).toMatch(
      /if \(isUninstallEvent\(event\)\) \{[\s\S]{0,600}if \(isUnauthenticated\) \{[\s\S]{0,400}unauthenticated_uninstall/
    )
    // The destructive branch must remain for authenticated callers.
    expect(route).toMatch(/unregisterAllZidWebhooks\(merchantId\)/)
  })

  it('logs the credential fingerprint rather than the credential', () => {
    expect(route).toMatch(/credential: zidWebhookCredentialFingerprint\(\)/)
    expect(route).not.toMatch(/console\.(log|warn|error|info)\([^)]*getZidWebhookCredential\(/)
  })

  it('registers username/password, and never the unsupported `secret` field', () => {
    expect(webhooks).toMatch(/body\.username = credential\.username/)
    expect(webhooks).toMatch(/body\.password = credential\.password/)
    expect(webhooks).not.toMatch(/body\.secret/)
    expect(webhooks).not.toMatch(/ZID_WEBHOOK_SECRET/)
  })
})

describe('the re-registration path exists and is admin-only', () => {
  const refresh = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/admin/zid-webhooks/refresh/route.ts'),
    'utf8'
  )

  it('requires a signed-in admin', () => {
    expect(refresh).toMatch(/const \{ userId \} = await auth\(\)/)
    expect(refresh).toMatch(/if \(!userId \|\| !isAdmin\(userId\)\)/)
  })

  it('refuses to touch webhooks when no credential is derivable', () => {
    // Deleting first and re-creating without a credential would replace working
    // subscriptions with ones that can never authenticate.
    const guardAt = refresh.indexOf('if (!getZidWebhookCredential())')
    const firstRemoval = refresh.indexOf('unregisterAllZidWebhooks(merchantId)')
    expect(guardAt).toBeGreaterThan(-1)
    expect(firstRemoval).toBeGreaterThan(guardAt)
  })

  it('deletes and re-creates per store, sequentially', () => {
    expect(refresh).toMatch(/await unregisterAllZidWebhooks\(merchantId\)/)
    expect(refresh).toMatch(/await syncWebhooksWithSettings\(merchantId, resolveSettings/)
  })
})
