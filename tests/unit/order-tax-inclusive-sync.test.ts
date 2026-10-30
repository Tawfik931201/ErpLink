import type { OdooClient } from '@/lib/odoo-client'
import { buildOrderLineItems } from '@/lib/sync-engine'
import type { FieldMappingRow } from '@/lib/sync-types'

describe('buildOrderLineItems — Tax-inclusive vs Tax-exclusive pricing', () => {
  const baseMapping: FieldMappingRow = {
    id: 'map-1',
    workspace_id: '00000000-0000-0000-0000-000000000001',
    store_type: 'zid',
    entity_type: 'orders',
    odoo_model: 'sale.order',
    name: 'Order Mapping',
    is_active: true,
    mappings: {
      'sale.order.line': [
        { id: 'f1', erpField: 'product_id', zidField: 'sku' },
      ],
    },
  }

  // Mock Odoo client
  const createMockClient = () => {
    return {
      url: 'https://odoo.test',
      db: 'testdb',
      execute: jest.fn().mockImplementation(async (model: string, method: string, args: any[]) => {
        if (model === 'ir.model.fields' && method === 'search_read') {
          return [
            { name: 'product_id', ttype: 'many2one', relation: 'product.product' },
            { name: 'tax_ids', ttype: 'many2many', relation: 'account.tax' },
            { name: 'price_unit', ttype: 'monetary' },
            { name: 'product_uom_qty', ttype: 'float' },
            { name: 'discount', ttype: 'float' },
          ]
        }
        if (model === 'product.product' && (method === 'search' || method === 'search_read')) {
          return [42]
        }
        return []
      }),
      searchRead: jest.fn().mockResolvedValue([{ id: 42, default_code: 'SKU-115' }]),
    } as unknown as OdooClient
  }

  const zidOrderPayload = {
    id: 1001,
    products: [
      {
        id: 501,
        sku: 'SKU-115',
        name: 'منتج تجريبي بسعر شامل للضريبة',
        quantity: 1,
        price: 115,
      },
    ],
    shipping_address: {
      country: {
        code: 'SA',
        name: 'Saudi Arabia',
      },
    },
  }

  it('Case 1: Without setting (prices_include_tax = false) — sends 115 SAR to Odoo verbatim', async () => {
    const client = createMockClient()
    const stdSettings = {
      enable_vat: true,
      vat_saudi_tax_id: 5,
      prices_include_tax: false,
      tax_rate_percent: 15,
    }

    const lines = await buildOrderLineItems(
      client,
      baseMapping,
      zidOrderPayload,
      new Map(),
      {},
      'zid',
      stdSettings,
      'store-1'
    )

    expect(lines).toHaveLength(1)
    expect(lines[0].product_id).toBe(42)
    // When prices_include_tax is false, 115 SAR is recorded as price_unit
    expect(lines[0].price_unit).toBe(115)
    // Odoo 15% tax is attached
    expect(lines[0].tax_ids).toEqual([[6, 0, [5]]])
  })

  it('Case 2: With setting enabled (prices_include_tax = true, tax_rate_percent = 15) — calculates 100 SAR before tax for Odoo', async () => {
    const client = createMockClient()
    const stdSettings = {
      enable_vat: true,
      vat_saudi_tax_id: 5,
      prices_include_tax: true,
      tax_rate_percent: 15,
    }

    const lines = await buildOrderLineItems(
      client,
      baseMapping,
      zidOrderPayload,
      new Map(),
      {},
      'zid',
      stdSettings,
      'store-1'
    )

    expect(lines).toHaveLength(1)
    expect(lines[0].product_id).toBe(42)
    // When prices_include_tax is true with 15% VAT:
    // 115 / 1.15 = 100 SAR
    expect(lines[0].price_unit).toBe(100)
    // Odoo 15% tax is attached
    expect(lines[0].tax_ids).toEqual([[6, 0, [5]]])
  })

  it('handles multiple quantities and items with tax-inclusive discount calculation', async () => {
    const client = createMockClient()
    const multiItemPayload = {
      id: 1002,
      products: [
        {
          id: 502,
          sku: 'SKU-115',
          name: 'منتج مع خصم',
          quantity: 2,
          price: 230, // 230 SAR for unit price before discount
          net_sale_price: 115, // 115 SAR sale price
        },
      ],
      shipping_address: { country: { code: 'SA' } },
    }

    const stdSettings = {
      enable_vat: true,
      vat_saudi_tax_id: 5,
      prices_include_tax: true,
      tax_rate_percent: 15,
      add_discount_as_line: true,
      discount_mode: 'percent',
    }

    const lines = await buildOrderLineItems(
      client,
      baseMapping,
      multiItemPayload,
      new Map(),
      {},
      'zid',
      stdSettings,
      'store-1'
    )

    expect(lines).toHaveLength(1)
    // 230 / 1.15 = 200 SAR pre-tax
    expect(lines[0].price_unit).toBe(200)
    // 50% discount ((200 - 100) / 200 = 50%)
    expect(lines[0].discount).toBe(50)
    expect(lines[0].tax_ids).toEqual([[6, 0, [5]]])
  })
})
