import fs from 'fs'
import path from 'path'

import {
  COMMON_RATES_TO_SAR,
  convertCurrencyAmount,
  extractOrderCurrency,
  resolveOrderExchangeRate,
} from '@/lib/odoo/order-currency'
import type { OdooClient } from '@/lib/odoo-client'
import { buildOrderLineItems } from '@/lib/sync-engine'
import type { FieldMappingRow } from '@/lib/sync-types'

// The sync runtime owns a separate admin client outside the Supabase alias mock.
jest.mock('../../src/lib/sync-runtime', () => ({
  supabaseAdmin: jest.requireActual('../mocks/supabase').supabase,
  logSync: jest.fn(),
}))

describe('Multi-Currency Order Sync & Conversion', () => {
  describe('extractOrderCurrency', () => {
    it('extracts currency_code from Zid payload', () => {
      expect(extractOrderCurrency({ currency_code: 'AED' })).toBe('AED')
      expect(extractOrderCurrency({ currency_code: 'usd' })).toBe('USD')
    })

    it('extracts currency from nested amounts or payment', () => {
      expect(extractOrderCurrency({ amounts: { currency: 'EUR' } })).toBe('EUR')
      expect(extractOrderCurrency({ payment: { currency: 'KWD' } })).toBe('KWD')
    })

    it('extracts presentment_currency for shopify platform', () => {
      expect(extractOrderCurrency({ presentment_currency: 'BHD' }, 'shopify')).toBe('BHD')
    })

    it('extracts currency from nested currency object or formatted amount string', () => {
      expect(extractOrderCurrency({ currency: { code: 'AED' } })).toBe('AED')
      expect(extractOrderCurrency({ order_total_string: '183.00 SAR' })).toBe('SAR')
      expect(extractOrderCurrency({ order_total_string: '90.97 AED' })).toBe('AED')
    })

    it('determines currency strictly from order payload and NEVER from shipping address', () => {
      // Order is in SAR even though shipping is to UAE (الإمارات العربية المتحدة)
      const uaeShippingPayload = {
        currency_code: 'SAR',
        order_total_string: '183.00 SAR',
        shipping: {
          address: {
            country: { id: 221, name: 'الإمارات العربية المتحدة' },
            city: { name: 'أبوظبي' },
          },
        },
      }
      expect(extractOrderCurrency(uaeShippingPayload)).toBe('SAR')
      expect(resolveOrderExchangeRate(uaeShippingPayload, 'SAR', 'SAR')).toBe(1.0)
    })

    it('defaults to SAR when no currency is specified', () => {
      expect(extractOrderCurrency({})).toBe('SAR')
      expect(extractOrderCurrency(null as unknown as Record<string, unknown>)).toBe('SAR')
    })
  })

  describe('resolveOrderExchangeRate', () => {
    it('returns 1.0 when source and target currencies match', () => {
      expect(resolveOrderExchangeRate({}, 'SAR', 'SAR')).toBe(1.0)
      expect(resolveOrderExchangeRate({}, 'AED', 'AED')).toBe(1.0)
    })

    it('prefers explicit currency_conversion_rate from Zid payload', () => {
      const payload = { currency_conversion_rate: 1.025 }
      expect(resolveOrderExchangeRate(payload, 'AED', 'SAR')).toBe(1.025)
    })

    it('derives rate from transaction_amount / order_total', () => {
      const payload = {
        transaction_amount: 204.0, // SAR
        order_total: 200.0,        // AED
      }
      expect(resolveOrderExchangeRate(payload, 'AED', 'SAR')).toBe(1.02)
    })

    it('derives rate from Odoo res.currency rate (1 / odooRate)', () => {
      // If 1 SAR = 0.98 AED, then 1 AED = 1 / 0.98 SAR ≈ 1.0204 SAR
      const odooRate = 0.98
      const calculated = resolveOrderExchangeRate({}, 'AED', 'SAR', odooRate)
      expect(calculated).toBeCloseTo(1 / 0.98, 4)
    })

    it('falls back to common rates table for major currencies to SAR', () => {
      expect(resolveOrderExchangeRate({}, 'AED', 'SAR')).toBe(COMMON_RATES_TO_SAR.AED)
      expect(resolveOrderExchangeRate({}, 'USD', 'SAR')).toBe(COMMON_RATES_TO_SAR.USD)
      expect(resolveOrderExchangeRate({}, 'KWD', 'SAR')).toBe(COMMON_RATES_TO_SAR.KWD)
    })
  })

  describe('convertCurrencyAmount', () => {
    it('converts amounts with 2 decimal precision', () => {
      expect(convertCurrencyAmount(200, 1.02)).toBe(204)
      expect(convertCurrencyAmount(100, 3.75)).toBe(375)
      expect(convertCurrencyAmount(15.555, 1.0)).toBe(15.555)
      expect(convertCurrencyAmount(0, 1.02)).toBe(0)
    })
  })

  describe('buildOrderLineItems with currency conversion', () => {
    const baseMapping: FieldMappingRow = {
      id: 'map-curr-1',
      workspace_id: '00000000-0000-0000-0000-000000000001',
      erp_connection_id: 'conn-1',
      merchant_id: 'merchant-1',
      store_id: 'store-1',
      action: 'order.create',
      odoo_model: 'sale.order',
      name: 'Order Currency Mapping',
      mappings: {
        'sale.order.line': [
          { id: 'f1', erpField: 'product_id', zidField: 'sku' },
        ],
      },
    }

    const createMockClient = () => {
      return {
        url: 'https://odoo.test',
        db: 'testdb',
        execute: jest.fn().mockImplementation(async (model: string, method: string) => {
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
            return [99]
          }
          return []
        }),
        searchRead: jest.fn().mockResolvedValue([{ id: 99, default_code: 'PROD-AED' }]),
      } as unknown as OdooClient
    }

    it('Case 1: Currency active in Odoo (conversion rate = 1.0) — keeps 200 AED original price', async () => {
      const client = createMockClient()
      const payload = {
        id: 2001,
        currency_code: 'AED',
        products: [
          {
            id: 101,
            sku: 'PROD-AED',
            name: 'منتج بالدرهم الإماراتي',
            quantity: 1,
            price: 200,
          },
        ],
      }

      const stdSettings = {
        multi_currency_enabled: true,
        _currency_conversion_rate: 1.0,
      }

      const lines = await buildOrderLineItems(
        client,
        baseMapping,
        payload,
        new Map(),
        {},
        'zid',
        stdSettings,
        'store-1'
      )

      expect(lines).toHaveLength(1)
      expect(lines[0].product_id).toBe(99)
      expect(lines[0].price_unit).toBe(200)
    })

    it('Case 2: Currency inactive in Odoo (fallback to SAR with rate 1.02) — converts 200 AED to 204 SAR', async () => {
      const client = createMockClient()
      const payload = {
        id: 2002,
        currency_code: 'AED',
        payment_method: 'cod',
        products: [
          {
            id: 102,
            sku: 'PROD-AED',
            name: 'منتج بالدرهم تم تحويله للريال',
            quantity: 2,
            price: 200, // 200 AED each
          },
        ],
        shipping_cost: 30, // 30 AED shipping
        payment: {
          invoice: [
            { code: 'cod_fee', value: 15 }, // 15 AED COD fee
          ],
        },
      }

      const stdSettings = {
        multi_currency_enabled: true,
        _currency_conversion_rate: 1.02, // 1 AED = 1.02 SAR
        add_shipping_as_line: true,
        shipping_product_id: 88,
        add_cod_as_line: true,
        cod_product_id: 77,
      }

      const lines = await buildOrderLineItems(
        client,
        baseMapping,
        payload,
        new Map(),
        {},
        'zid',
        stdSettings,
        'store-1'
      )

      expect(lines).toHaveLength(3) // 1 product + 1 shipping + 1 COD
      // Product price converted: 200 * 1.02 = 204 SAR
      expect(lines[0].product_id).toBe(99)
      expect(lines[0].price_unit).toBe(204)

      // Shipping line converted: 30 * 1.02 = 30.60 SAR
      const shippingLine = lines.find(l => l.product_id === 88)
      expect(shippingLine).toBeDefined()
      expect(shippingLine?.price_unit).toBe(30.6)

      // COD line converted: 15 * 1.02 = 15.30 SAR
      const codLine = lines.find(l => l.product_id === 77)
      expect(codLine).toBeDefined()
      expect(codLine?.price_unit).toBe(15.3)
    })

    it('does NOT distribute line-level discount of one item to non-discounted items when orderLevelDiscount is 0', async () => {
      const mockClient = {
        execute: jest.fn().mockImplementation((model, method) => {
          if (method === 'fields_get') {
            return Promise.resolve({
              price_unit: { type: 'monetary' },
              product_uom_qty: { type: 'float' },
              discount: { type: 'float' },
              product_id: { type: 'many2one', relation: 'product.product' },
            })
          }
          return Promise.resolve([])
        }),
        searchRead: jest.fn().mockResolvedValue([]),
      } as unknown as OdooClient

      const mapping = {
        id: 'test-map',
        workspace_id: 'ws-1',
        action: 'order.create',
        odoo_model: 'sale.order',
        merchant_id: 'm1',
        store_id: 's1',
        erp_connection_id: null,
        name: 'Order Map',
        mappings: {
          'sale.order.line': [
            { id: '1', erpField: 'product_id', staticValue: '10' },
            { id: '2', erpField: 'price_unit', zidField: 'price' },
            { id: '3', erpField: 'product_uom_qty', zidField: 'quantity' },
          ],
        },
      } as FieldMappingRow

      const zidData = {
        currency_code: 'SAR',
        products: [
          // Item 1: price_before 100, price 90 (10 SAR discount)
          { id: 'p1', sku: 'SKU-1', quantity: 1, price_before: 100, price: 90, net_price: 100, net_sale_price: 90 },
          // Item 2: price 45, no discount
          { id: 'p2', sku: 'SKU-2', quantity: 1, price: 45, net_price: 45, net_sale_price: 45 },
        ],
        // No coupon or order-level discount
        payment: { invoice: [{ code: 'sub_totals', value: 135 }] },
      }

      const stdSettings = {
        add_discount_as_line: true,
        discount_mode: 'percent',
      }

      const lines = await buildOrderLineItems(
        mockClient,
        mapping,
        zidData,
        new Map(),
        {},
        'zid',
        stdSettings
      )

      expect(lines).toHaveLength(2)
      // Item 1 has 10% discount
      expect(lines[0].discount).toBe(10)
      expect(lines[0].price_unit).toBe(100)

      // Item 2 must NOT have any phantom discount!
      expect(lines[1].discount).toBeUndefined()
      expect(lines[1].price_unit).toBe(45)
    })
  })

  describe('Multi-currency pricelist resolution & fallback contract', () => {
    it('pins the Odoo 14-20 requirement that currency_id depends on pricelist_id', () => {
      // In Odoo standard sale.order, currency_id is a computed/related field from pricelist_id.currency_id.
      // Recording a sale order in AED requires a pricelist whose currency is AED.
      const syncEngineSrc = fs.readFileSync(
        path.resolve(__dirname, '../../src/lib/odoo/order-values.ts'),
        'utf8'
      )
      expect(syncEngineSrc).toContain("['currency_id', '=', matchedCurr.id], ['active', '=', true]")
      expect(syncEngineSrc).toContain("product.pricelist")
      expect(syncEngineSrc).toContain("effectiveOdooValues.pricelist_id = matchedPricelistId")
      expect(syncEngineSrc).toContain("Auto-created pricelist")
    })
  })
})
