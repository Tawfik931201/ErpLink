import { prepareShopifyWebhookData } from '../../src/lib/shopify/enrichment'
import { callShopifyGraphQL } from '../../src/lib/shopify-client'

jest.mock('../../src/lib/shopify-client', () => ({
  callShopifyGraphQL: jest.fn(),
}))

const shop = 'fixture.myshopify.com'
const graphQL = jest.mocked(callShopifyGraphQL)

beforeEach(() => graphQL.mockReset())

it.each([
  ['products/update', 'Product', 'product'],
  ['customers/update', 'Customer', 'customer'],
  ['orders/create', 'Order', 'order'],
  ['collections/update', 'Collection', 'collection'],
])('uses the exact GraphQL identity for %s', async (event, type, resource) => {
  graphQL.mockResolvedValue({ [resource]: { metafields: { nodes: [] } } })
  const id = `gid://shopify/${type}/9007199254740993`
  await prepareShopifyWebhookData({ id: Number('9007199254740993'), admin_graphql_api_id: id }, shop, event)
  expect(graphQL).toHaveBeenCalledWith(shop, expect.any(String), { id })
})

it('uses a safe numeric ID if a GraphQL ID is absent', async () => {
  graphQL.mockResolvedValue({ product: { metafields: { nodes: [] } } })
  await prepareShopifyWebhookData({ id: 42 }, shop, 'products/update')
  expect(graphQL).toHaveBeenCalledWith(shop, expect.any(String), { id: 'gid://shopify/Product/42' })
})

it('preserves exact string IDs even beyond the safe integer range', async () => {
  graphQL.mockResolvedValue({ order: { metafields: { nodes: [] } } })
  await prepareShopifyWebhookData({ id: '9007199254740993' }, shop, 'orders/create')
  expect(graphQL).toHaveBeenCalledWith(shop, expect.any(String), { id: 'gid://shopify/Order/9007199254740993' })
})

it.each([
  { id: Number.MAX_SAFE_INTEGER + 1 },
  { id: 'gid://shopify/Order/42' },
  { id: 'not-an-id' },
])('preserves the webhook without querying an invalid product identity', async payload => {
  await expect(prepareShopifyWebhookData(payload, shop, 'products/update')).resolves.toEqual(payload)
  expect(graphQL).not.toHaveBeenCalled()
})
