import type { OdooClient } from '@/lib/odoo-client'
import { buildOrderLineItems } from '@/lib/sync-engine'
import type { FieldMappingRow } from '@/lib/sync-types'
import { resolveOrderVatTax } from '@/lib/zid/order-helpers'

describe('resolveOrderVatTax helper', () => {
  it('returns null when enableVat is false', () => {
    const res = resolveOrderVatTax({ shipping_address: { country: 'SA' } }, {
      enableVat: false,
      vatSaudiTaxId: 5,
    })
    expect(res.taxId).toBeNull()
    expect(res.appliedCountryCode).toBeNull()
  })

  it('resolves specific country tax when destination matches rule', () => {
    const res = resolveOrderVatTax(
      { shipping_address: { country: 'AE' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'AE', tax_id: 8 },
          { country_code: 'OTHER', tax_id: 1 },
        ],
      }
    )
    expect(res.taxId).toBe(8)
    expect(res.appliedCountryCode).toBe('AE')
    expect(res.destinationCountryCode).toBe('AE')
  })

  it('resolves Saudi Arabia tax when destination is Saudi Arabia', () => {
    const res = resolveOrderVatTax(
      { shipping_address: { country: 'Saudi Arabia' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'OTHER', tax_id: 1 },
        ],
      }
    )
    expect(res.taxId).toBe(5)
    expect(res.appliedCountryCode).toBe('SA')
    expect(res.destinationCountryCode).toBe('SA')
  })

  it('resolves fallback "OTHER" tax when destination country is unlisted in rules', () => {
    const res = resolveOrderVatTax(
      { shipping_address: { country: 'KW' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'AE', tax_id: 8 },
          { country_code: 'OTHER', tax_id: 3 },
        ],
      }
    )
    expect(res.taxId).toBe(3)
    expect(res.appliedCountryCode).toBe('OTHER')
    expect(res.destinationCountryCode).toBe('KW')
  })

  it('returns null when destination country is unlisted and NO fallback rule is provided', () => {
    const res = resolveOrderVatTax(
      { shipping_address: { country: 'US' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'AE', tax_id: 8 },
        ],
      }
    )
    // No match, so taxId is null (order sent without tax field so Odoo applies default)
    expect(res.taxId).toBeNull()
    expect(res.appliedCountryCode).toBeNull()
    expect(res.destinationCountryCode).toBe('US')
  })

  it('returns null when matching rule has no tax_id selected', () => {
    const res = resolveOrderVatTax(
      { shipping_address: { country: 'AE' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'AE', tax_id: '' }, // not chosen
          { country_code: 'OTHER', tax_id: 3 },
        ],
      }
    )
    expect(res.taxId).toBeNull()
    expect(res.appliedCountryCode).toBe('AE')
  })

  it('falls back to legacy vatSaudiTaxId and vatNonSaudiTaxId when vatCountryRules is empty', () => {
    const saudiRes = resolveOrderVatTax(
      { shipping_address: { country: 'SA' } },
      {
        enableVat: true,
        vatSaudiTaxId: 5,
        vatNonSaudiTaxId: 2,
      }
    )
    expect(saudiRes.taxId).toBe(5)
    expect(saudiRes.appliedCountryCode).toBe('SA')

    const nonSaudiRes = resolveOrderVatTax(
      { shipping_address: { country: 'EG' } },
      {
        enableVat: true,
        vatSaudiTaxId: 5,
        vatNonSaudiTaxId: 2,
      }
    )
    expect(nonSaudiRes.taxId).toBe(2)
    expect(nonSaudiRes.appliedCountryCode).toBe('OTHER')
  })

  it('skips resolving tax when event is a status update or non-creation event', () => {
    const res = resolveOrderVatTax(
      { shipping_address: { country: 'AE' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'AE', tax_id: 8 },
        ],
        event: 'order.status.update',
      }
    )
    expect(res.taxId).toBeNull()
    expect(res.appliedCountryCode).toBeNull()

    const res2 = resolveOrderVatTax(
      { shipping_address: { country: 'AE' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'AE', tax_id: 8 },
        ],
        event: 'order.updated',
      }
    )
    expect(res2.taxId).toBeNull()
  })

  it('resolves tax when event is order.create or order.created', () => {
    const res = resolveOrderVatTax(
      { shipping_address: { country: 'AE' } },
      {
        enableVat: true,
        vatCountryRules: [
          { country_code: 'SA', tax_id: 5 },
          { country_code: 'AE', tax_id: 8 },
        ],
        event: 'order.create',
      }
    )
    expect(res.taxId).toBe(8)
    expect(res.appliedCountryCode).toBe('AE')
  })
})

describe('buildOrderLineItems with Country VAT Rules', () => {
  const baseMapping: FieldMappingRow = {
    id: 'map-vat-1',
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
      searchRead: jest.fn().mockResolvedValue([{ id: 42, default_code: 'SKU-1' }]),
    } as unknown as OdooClient
  }

  it('attaches country-specific tax when order destination matches rule', async () => {
    const client = createMockClient()
    const payload = {
      id: 2001,
      products: [{ id: 101, sku: 'SKU-1', name: 'Item', quantity: 1, price: 100 }],
      shipping_address: { country: 'AE' },
    }
    const stdSettings = {
      enable_vat: true,
      vat_country_rules: [
        { country_code: 'SA', tax_id: 5 },
        { country_code: 'AE', tax_id: 12 },
        { country_code: 'OTHER', tax_id: 1 },
      ],
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
    expect(lines[0].tax_ids).toEqual([[6, 0, [12]]])
  })

  it('attaches "OTHER" tax when order destination is unlisted but fallback rule exists', async () => {
    const client = createMockClient()
    const payload = {
      id: 2002,
      products: [{ id: 101, sku: 'SKU-1', name: 'Item', quantity: 1, price: 100 }],
      shipping_address: { country: 'KW' }, // Kuwait (not in SA/AE rules)
    }
    const stdSettings = {
      enable_vat: true,
      vat_country_rules: [
        { country_code: 'SA', tax_id: 5 },
        { country_code: 'AE', tax_id: 12 },
        { country_code: 'OTHER', tax_id: 99 },
      ],
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
    expect(lines[0].tax_ids).toEqual([[6, 0, [99]]])
  })

  it('omits tax_ids completely when no tax is matched or chosen (so Odoo applies default tax)', async () => {
    const client = createMockClient()
    const payload = {
      id: 2003,
      products: [{ id: 101, sku: 'SKU-1', name: 'Item', quantity: 1, price: 100 }],
      shipping_address: { country: 'US' }, // unlisted, no OTHER rule
    }
    const stdSettings = {
      enable_vat: true,
      vat_country_rules: [
        { country_code: 'SA', tax_id: 5 },
        { country_code: 'AE', tax_id: 12 },
        // No 'OTHER' rule
      ],
      add_shipping_as_line: true,
      shipping_product_id: 70,
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

    expect(lines.length).toBeGreaterThanOrEqual(1)
    // Product line MUST NOT have tax_ids or tax_id field!
    expect(lines[0].tax_ids).toBeUndefined()
    expect(lines[0].tax_id).toBeUndefined()

    // Shipping line MUST NOT have tax_ids either!
    const shippingLine = lines.find(l => l.name === 'Shipping (شحن)')
    if (shippingLine) {
      expect(shippingLine.tax_ids).toBeUndefined()
      expect(shippingLine.tax_id).toBeUndefined()
    }
  })

  it('omits tax_ids completely when enable_vat is false', async () => {
    const client = createMockClient()
    const payload = {
      id: 2004,
      products: [{ id: 101, sku: 'SKU-1', name: 'Item', quantity: 1, price: 100 }],
      shipping_address: { country: 'SA' },
    }
    const stdSettings = {
      enable_vat: false,
      vat_country_rules: [
        { country_code: 'SA', tax_id: 5 },
      ],
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
    expect(lines[0].tax_ids).toBeUndefined()
    expect(lines[0].tax_id).toBeUndefined()
  })
})
