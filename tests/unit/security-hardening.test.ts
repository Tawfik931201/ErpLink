import fs from 'fs'
import path from 'path'

import { isPublicIpAddress, resolvePublicDestination } from '@/lib/security/safe-external-fetch'
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

describe('production defaults for webhooks', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalStrict = process.env.STRICT_WEBHOOK_AUTH

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalStrict === undefined) delete process.env.STRICT_WEBHOOK_AUTH
    else process.env.STRICT_WEBHOOK_AUTH = originalStrict
  })

  it('rejects unsigned legacy webhooks by default in production', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.STRICT_WEBHOOK_AUTH
    expect(isStrictWebhookAuth()).toBe(true)
  })

  it('allows a deliberate temporary migration override', () => {
    process.env.NODE_ENV = 'production'
    process.env.STRICT_WEBHOOK_AUTH = 'false'
    expect(isStrictWebhookAuth()).toBe(false)
  })

  it('keeps development behavior for test integrations', () => {
    process.env.NODE_ENV = 'test'
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
