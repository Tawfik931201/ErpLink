import { ErpNextClient } from '../../src/lib/erpnext-engine'
import { clearOdooClientCaches, OdooClient } from '../../src/lib/odoo-client'

jest.mock('../../src/lib/sync-runtime', () => ({ logSync: jest.fn() }))
jest.mock('../../src/lib/auth', () => ({ checkImpersonationWriteBlock: jest.fn() }))
jest.mock('xmlrpc', () => {
  const create = (options: { host: string }) => ({
    methodCall: (method: string, params: unknown[], cb: (error: null, value: unknown) => void) => {
      Promise.resolve().then(() => cb(null, method === 'authenticate' ? 7 : { host: options.host, params }))
    },
  })
  return { createClient: create, createSecureClient: create }
})

describe('ERP clients under interleaved async calls (mock transport)', () => {
  beforeEach(() => jest.spyOn(console, 'info').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  it.each([100, 1000])('keeps Odoo A/B and ERPNext C credentials separate for %i calls', async count => {
    clearOdooClientCaches()
    const originalFetch = global.fetch
    global.fetch = jest.fn(async (url, init) => ({
      ok: true,
      json: async () => ({ data: { name: JSON.stringify({ url, auth: (init?.headers as Record<string, string>).Authorization }) } }),
    })) as unknown as typeof fetch
    try {
      const a = new OdooClient({ url: 'https://a.invalid', db: 'db-a', username: 'user-a', apiKey: 'key-a' })
      const b = new OdooClient({ url: 'https://b.invalid', db: 'db-b', username: 'user-b', apiKey: 'key-b' })
      const c = new ErpNextClient({ url: 'https://c.invalid', username: 'api-c', apiKey: 'secret-c' })
      const results = await Promise.all(Array.from({ length: count }, async (_, i) => {
        if (i % 3 === 2) {
          const result = JSON.parse(await c.create('Customer', { name: `entity-${i}` }))
          expect(result).toEqual({ url: 'https://c.invalid/api/resource/Customer', auth: 'token api-c:secret-c' })
        } else {
          const client = i % 3 === 0 ? a : b
          const suffix = i % 3 === 0 ? 'a' : 'b'
          const result = await client.execute<{ host: string; params: unknown[] }>('res.partner', 'create', [{ name: `entity-${i}` }])
          expect(result.host).toBe(`${suffix}.invalid`)
          expect(result.params.slice(0, 3)).toEqual([`db-${suffix}`, 7, `key-${suffix}`])
        }
        return i
      }))
      expect(results).toHaveLength(count)
    } finally {
      global.fetch = originalFetch
    }
  })
})
