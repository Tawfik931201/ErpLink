import fs from 'fs'
import path from 'path'

import { assertSecureErpTransport, isPublicIpAddress, publicErpDnsLookup, resolvePublicDestination } from '@/lib/security/safe-external-fetch'
import { isStrictWebhookAuth } from '@/lib/webhook-strict'

describe('server-side ERP URL hardening', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.2',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:7f00:1',
    '2001:db8::1',
  ])('blocks internal or special-purpose IP %s', ip => {
    expect(isPublicIpAddress(ip)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'allows globally routable address %s',
    ip => expect(isPublicIpAddress(ip)).toBe(true)
  )

  it.each([
    'http://127.0.0.1:8080',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://localhost:5000/',
    'http://some-service.internal/',
    'file:///etc/passwd',
    'https://admin:pass@example.com/',
  ])('rejects SSRF destination before opening a socket: %s', async url => {
    await expect(resolvePublicDestination(url)).rejects.toThrow()
  })
})

describe('ERP connections cannot bypass the DNS check or send credentials over HTTP', () => {
  const originalNodeEnv = process.env.NODE_ENV
  afterEach(() => Object.assign(process.env, { NODE_ENV: originalNodeEnv }))

  it('rejects HTTP in production but allows HTTPS', () => {
    Object.assign(process.env, { NODE_ENV: 'production' })
    expect(() => assertSecureErpTransport('http://odoo.example.com')).toThrow(/HTTPS/)
    expect(() => assertSecureErpTransport('https://odoo.example.com')).not.toThrow()
    expect(() => assertSecureErpTransport('https://admin:password@odoo.example.com')).toThrow()
  })

  it('refuses a private IP at the XML-RPC socket lookup step', async () => {
    const error = await new Promise<Error | null>((resolve) => {
      publicErpDnsLookup('169.254.169.254', {}, (err) => resolve(err))
    })
    expect(error).toBeInstanceOf(Error)
  })

  it('requires the Odoo XML-RPC agent to pin every new DNS connection', () => {
    const client = fs.readFileSync(path.join(process.cwd(), 'src/lib/odoo-client.ts'), 'utf8')
    expect(client).toContain('lookup: publicErpDnsLookup')
    expect(client).toContain('autoSelectFamily: false')
    expect(client).toContain('assertSecureErpTransport(config.url)')
  })
})

describe('Server Actions do not expose encrypted ERP credentials', () => {
  it('projects the public connection fields for reads AND saves', () => {
    const action = fs.readFileSync(path.join(process.cwd(), 'src/app/actions/odoo.ts'), 'utf8')
    const projection = action.split('function toPublicErpConnection(')[1]?.split('export async function getActiveWorkspaceErpConnection()')[0] || ''
    expect(projection).not.toMatch(/password\s*:/)
    expect(action).toContain('connection: toPublicErpConnection(result.connection)')
    expect(action).toContain('...toPublicErpConnection(result), odoo_version: storedVersion')
  })
})

describe('cron authentication never accepts secrets in URLs', () => {
  it('requires the Authorization Bearer token for reconciliation', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/cron/reconcile/route.ts'), 'utf8')
    expect(route).not.toContain("searchParams.get('key')")
    expect(route).toContain("req.headers.get('authorization')")
    expect(route).toContain("secretMatches(bearer ?? '', cronSecret)")
  })
})

describe('production defaults for webhooks', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalStrict = process.env.STRICT_WEBHOOK_AUTH

  afterEach(() => {
    Object.assign(process.env, { NODE_ENV: originalNodeEnv })
    if (originalStrict === undefined) delete process.env.STRICT_WEBHOOK_AUTH
    else process.env.STRICT_WEBHOOK_AUTH = originalStrict
  })

  it('rejects unsigned legacy webhooks by default in production', () => {
    Object.assign(process.env, { NODE_ENV: 'production' })
    delete process.env.STRICT_WEBHOOK_AUTH
    expect(isStrictWebhookAuth()).toBe(true)
  })

  it('allows a deliberate temporary migration override', () => {
    Object.assign(process.env, { NODE_ENV: 'production' })
    process.env.STRICT_WEBHOOK_AUTH = 'false'
    expect(isStrictWebhookAuth()).toBe(false)
  })

  it('keeps development behavior for test integrations', () => {
    Object.assign(process.env, { NODE_ENV: 'test' })
    delete process.env.STRICT_WEBHOOK_AUTH
    expect(isStrictWebhookAuth()).toBe(false)
  })
})

describe('browser boundary for Salla OAuth credentials', () => {
  it('never selects Salla secrets in the public workspace action', () => {
    const content = fs.readFileSync(path.join(process.cwd(), 'src/app/actions/workspaces.ts'), 'utf8')
    const section = content.split('const getCachedSallaTokens =')[1]?.split('export async function disconnectSallaStore')[0] || ''
    expect(section).not.toMatch(/from\('salla_tokens'\)[\s\S]{0,80}select\('\*'\)/)
    expect(section).not.toContain('access_token')
    expect(section).not.toContain('refresh_token')
  })
})
