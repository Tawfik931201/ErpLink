import type { OdooClient } from '@/lib/odoo-client'
import { buildOrderLineItems } from '@/lib/sync-engine'
import type { FieldMappingRow } from '@/lib/sync-types'
import { resolveEffectiveTaxRate, resolveOrderCountryCode } from '@/lib/zid/order-helpers'

import { supabase } from '../mocks/supabase'

// sync-runtime constructs a separate admin client, outside the supabase.ts
// alias mapper. Shipping carrier fallback must use fixtures here too.
jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

describe('buildOrderLineItems — Tax-inclusive vs Tax-exclusive pricing across ALL line types', () => {
  beforeEach(() => supabase.reset())

  const baseMapping: FieldMappingRow = {
    id: 'map-1',
    workspace_id: '00000000-0000-0000-0000-000000000001',
    erp_connection_id: 'conn-1',
    merchant_id: 'merchant-1',
    store_id: 'store-1',
    action: 'order.create',
    odoo_model: 'sale.order',
    name: 'Order Mapping',
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
      execute: jest.fn().mockImplementation(async (model: string, method: string, _args: unknown[]) => {
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

  it('applies pre-tax extraction to ALL rows: shipping, COD fee, and fixed discount lines', async () => {
    const client = createMockClient()
    const fullOrderPayload = {
      id: 1003,
      products: [
        {
          id: 503,
          sku: 'SKU-115',
          name: 'منتج',
          quantity: 1,
          price: 115, // 115 SAR inclusive -> 100 SAR pre-tax
          net_sale_price: 92, // 92 SAR inclusive -> 80 SAR pre-tax (20 SAR discount pre-tax)
        },
      ],
      shipping: {
        cost: 23, // 23 SAR inclusive -> 20 SAR pre-tax
      },
      payment_method: {
        code: 'zid_cod',
        title: 'الدفع عند الاستلام',
      },
      shipping_address: { country: { code: 'SA' } },
    }

    const stdSettings = {
      enable_vat: true,
      vat_saudi_tax_id: 5,
      prices_include_tax: true,
      tax_rate_percent: 15,
      // Shipping
      add_shipping_as_line: true,
      shipping_product_id: 10,
      // Fixed discount line
      add_discount_as_line: true,
      discount_mode: 'fixed',
      discount_product_id: 20,
      // COD fee
      add_cod_as_line: true,
      cod_product_id: 30,
      cod_amount: 11.5, // 11.5 SAR inclusive -> 10 SAR pre-tax
    }

    const lines = await buildOrderLineItems(
      client,
      baseMapping,
      fullOrderPayload,
      new Map(),
      {},
      'zid',
      stdSettings,
      'store-1'
    )

    // Expected lines:
    // 1. Product line: price_unit = 100 (115 / 1.15)
    // 2. Shipping line: price_unit = 20 (23 / 1.15)
    // 3. Discount line: price_unit = -20 (-23 / 1.15)
    // 4. COD fee line: price_unit = 10 (11.5 / 1.15)
    expect(lines).toHaveLength(4)

    const productLine = lines.find((l) => l.product_id === 42)
    expect(productLine).toBeDefined()
    expect(productLine?.price_unit).toBe(100)
    expect(productLine?.tax_ids).toEqual([[6, 0, [5]]])

    const shippingLine = lines.find((l) => l.product_id === 10)
    expect(shippingLine).toBeDefined()
    expect(shippingLine?.name).toBe('Shipping (شحن)')
    expect(shippingLine?.price_unit).toBe(20)
    expect(shippingLine?.tax_ids).toEqual([[6, 0, [5]]])

    const discountLine = lines.find((l) => l.product_id === 20)
    expect(discountLine).toBeDefined()
    expect(discountLine?.name).toBe('Discount (خصم)')
    expect(discountLine?.price_unit).toBe(-20)
    expect(discountLine?.tax_ids).toEqual([[6, 0, [5]]])

    const codLine = lines.find((l) => l.product_id === 30)
    expect(codLine).toBeDefined()
    expect(codLine?.name).toBe('Cash on Delivery (الدفع عند الاستلام)')
    expect(codLine?.price_unit).toBe(10)
    expect(codLine?.tax_ids).toEqual([[6, 0, [5]]])

    // resolvePath('shipping.title') currently falls back to the shipping
    // object; preserve that lookup while proving it stays on the DB mock.
    expect(supabase.calls).toContainEqual(expect.objectContaining({
      table: 'shipping_method_mappings',
      op: 'select',
      filters: expect.arrayContaining([
        ['workspace_id', baseMapping.workspace_id],
        ['source_method_name', '[object Object]'],
        ['platform', 'zid'],
      ]),
    }))
  })

  describe('Country-specific tax rate table and export order handling', () => {
    it('Case 5: Egypt order with configured 14% tax rate divides by 1.14', async () => {
      const client = createMockClient() as unknown as OdooClient
      const egyptOrderPayload = {
        products: [{ sku: 'SKU-EG', price: 114, sale_price: 114, quantity: 1 }],
        shipping_address: { country: 'Egypt', city: 'Cairo' },
      }

      const stdSettings = {
        prices_include_tax: true,
        tax_rates_by_country: [
          { country_code: 'SA', country_name: 'السعودية', tax_rate: 15 },
          { country_code: 'EG', country_name: 'مصر', tax_rate: 14 },
        ],
      }

      const lines = await buildOrderLineItems(
        client,
        baseMapping,
        egyptOrderPayload,
        new Map(),
        {},
        'zid',
        stdSettings,
        'store-1'
      )

      expect(lines).toHaveLength(1)
      // 114 / 1.14 = 100
      expect(lines[0].price_unit).toBe(100)
    })

    it('Case 6: Export order (e.g. US / Germany) not in tax table defaults to 0% and does NOT divide price', async () => {
      const client = createMockClient() as unknown as OdooClient
      const exportOrderPayload = {
        products: [{ sku: 'SKU-EXP', price: 115, sale_price: 115, quantity: 1 }],
        shipping_address: { country: 'US', city: 'New York' },
      }

      const stdSettings = {
        prices_include_tax: true,
        tax_rates_by_country: [
          { country_code: 'SA', country_name: 'السعودية', tax_rate: 15 },
          { country_code: 'EG', country_name: 'مصر', tax_rate: 14 },
        ],
      }

      const lines = await buildOrderLineItems(
        client,
        baseMapping,
        exportOrderPayload,
        new Map(),
        {},
        'zid',
        stdSettings,
        'store-1'
      )

      expect(lines).toHaveLength(1)
      // US is not in tax table -> tax rate is 0 -> 115 / (1 + 0) = 115 verbatim!
      expect(lines[0].price_unit).toBe(115)
      // Because tax rate is 0%, tax_ids must be cleared to avoid Odoo defaulting to 15% VAT
      expect(lines[0].tax_ids).toEqual([[6, 0, []]])
    })

    it('Case 7: Export / UAE order when VAT is enabled with Saudi-only tax leaves tax_ids undefined on create so Odoo applies Fiscal Position', async () => {
      const client = createMockClient() as unknown as OdooClient
      const uaeOrderPayload = {
        products: [{ sku: 'SKU-UAE', price: 200, sale_price: 200, quantity: 1 }],
        shipping_address: { country: 'United Arab Emirates', city: 'Dubai' },
      }

      const stdSettings = {
        enable_vat: true,
        vat_saudi_tax_id: 5,
        prices_include_tax: false,
      }

      const lines = await buildOrderLineItems(
        client,
        baseMapping,
        uaeOrderPayload,
        new Map(),
        {},
        'zid',
        stdSettings,
        'store-1'
      )

      expect(lines).toHaveLength(1)
      expect(lines[0].price_unit).toBe(200)
      // tax_ids is undefined on build, allowing Odoo ORM to apply partner Fiscal Position
      expect(lines[0].tax_ids).toBeUndefined()
    })

    it('resolveOrderCountryCode detects various country payloads accurately', () => {
      expect(resolveOrderCountryCode({ shipping_address: { country: 'SA' } })).toBe('SA')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'Saudi Arabia' } })).toBe('SA')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'المملكة العربية السعودية' } })).toBe('SA')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'EG' } })).toBe('EG')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'Egypt' } })).toBe('EG')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'مصر' } })).toBe('EG')
      expect(resolveOrderCountryCode({ shipping_address: { city: 'Cairo' } })).toBe('EG')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'AE' } })).toBe('AE')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'United Arab Emirates' } })).toBe('AE')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'الامارات' } })).toBe('AE')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'KW' } })).toBe('KW')
      expect(resolveOrderCountryCode({ shipping_address: { country: 'US' } })).toBe('US')
    })

    it('resolveEffectiveTaxRate respects configured country table and export rules', () => {
      const countryRules = [
        { country_code: 'SA', tax_rate: 15 },
        { country_code: 'EG', tax_rate: 14 },
      ]

      // 1. SA order -> 15%
      const saResult = resolveEffectiveTaxRate(
        { shipping_address: { country: 'SA' } },
        { pricesIncludeTax: true, countryTaxRates: countryRules }
      )
      expect(saResult.taxRate).toBe(15)
      expect(saResult.matchedCountryCode).toBe('SA')

      // 2. EG order -> 14%
      const egResult = resolveEffectiveTaxRate(
        { shipping_address: { country: 'EG' } },
        { pricesIncludeTax: true, countryTaxRates: countryRules }
      )
      expect(egResult.taxRate).toBe(14)
      expect(egResult.matchedCountryCode).toBe('EG')

      // 3. Unlisted export order -> 0%
      const expResult = resolveEffectiveTaxRate(
        { shipping_address: { country: 'US' } },
        { pricesIncludeTax: true, countryTaxRates: countryRules }
      )
      expect(expResult.taxRate).toBe(0)
      expect(expResult.matchedCountryCode).toBeNull()

      // 4. When pricesIncludeTax is disabled -> 0%
      const disabledResult = resolveEffectiveTaxRate(
        { shipping_address: { country: 'SA' } },
        { pricesIncludeTax: false, countryTaxRates: countryRules }
      )
      expect(disabledResult.taxRate).toBe(0)
    })
  })
})
