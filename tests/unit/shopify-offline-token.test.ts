/** @jest-environment node */
import { decrypt } from '../../src/lib/crypto'
import { getShopifyAccessToken, shopifyTokenFields } from '../../src/lib/shopify/offline-token'
import { supabase } from '../mocks/supabase'

const shop = 'test-store.myshopify.com'
const grant = {
  access_token: 'access', refresh_token: 'refresh', expires_in: 3600, refresh_token_expires_in: 7776000,
}

afterEach(() => {
  jest.restoreAllMocks()
  supabase.reset()
})

it('saves both expiry times and encrypts the refresh credential', () => {
  const fields = shopifyTokenFields(grant, 0)
  expect(Date.parse(fields.expires_at)).toBe(3600000)
  expect(Date.parse(fields.refresh_token_expires_at)).toBe(7776000000)
  expect(fields.refresh_token).not.toBe(grant.refresh_token)
  expect(decrypt(fields.refresh_token)).toBe(grant.refresh_token)
  expect(() => shopifyTokenFields({ access_token: 'legacy' })).toThrow()
})

it('rotates an expired pair once for concurrent callers and guards the database write', async () => {
  const previous = shopifyTokenFields(grant, 0)
  supabase.addMock('shopify_tokens', [{ shop_domain: shop, ...previous }])
  const fetcher = jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ ...grant, access_token: 'new' }))
  expect(await Promise.all([getShopifyAccessToken(shop), getShopifyAccessToken(shop)])).toEqual(['new', 'new'])
  expect(fetcher).toHaveBeenCalledTimes(1)
  const options = fetcher.mock.calls[0][1]
  expect(JSON.parse(String(options?.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'refresh' })
  expect(supabase.calls.find(call => call.op === 'update')?.filters).toEqual([
    ['shop_domain', shop], ['expires_at', previous.expires_at],
  ])
})

it('reuses an unexpired access token without calling Shopify', async () => {
  supabase.addMock('shopify_tokens', [{ shop_domain: shop, ...shopifyTokenFields(grant) }])
  const fetcher = jest.spyOn(global, 'fetch')
  expect(await getShopifyAccessToken(shop)).toBe('access')
  expect(fetcher).not.toHaveBeenCalled()
})
