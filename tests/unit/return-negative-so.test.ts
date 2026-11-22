import {
  createNegativeSaleOrder,
  readSaleOrder,
  type OriginalSaleOrder,
  type OdooReturnLine,
} from '@/lib/returns/odoo'

describe('Negative Sale Order Replication and Standard Mapping', () => {
  it('replicates all header fields and line fields (taxes, analytics, discounts, uom) from original order', async () => {
    const createdPayloads: any[] = []
    const mockClient: any = {
      getMajorVersion: jest.fn().mockResolvedValue(19),
      execute: jest.fn().mockResolvedValue({ tax_ids: { type: 'many2many' } }),
      create: jest.fn().mockImplementation(async (model: string, vals: any) => {
        createdPayloads.push({ model, vals })
        return 999
      }),
    }

    const original: OriginalSaleOrder = {
      id: 101,
      name: 'SO-101',
      state: 'sale',
      partnerId: 55,
      partnerInvoiceId: 56,
      partnerShippingId: 57,
      pricelistId: 2,
      companyId: 1,
      warehouseId: 3,
      fiscalPositionId: 4,
      paymentTermId: 5,
      teamId: 6,
      userId: 7,
      analyticAccountId: 8,
      invoiceIds: [201],
      lines: [
        {
          id: 501,
          productId: 10,
          productName: 'Product A',
          orderedQty: 2,
          deliveredQty: 2,
          priceUnit: 150,
          discount: 10,
          productUomId: 1,
          taxIds: [15],
          analyticDistribution: { '12': 60, '14': 40 },
        },
      ],
    }

    const returnLines: OdooReturnLine[] = [
      {
        productId: 10,
        name: 'Product A',
        quantity: 1,
        priceUnit: 150,
        discount: 10,
        productUomId: 1,
        taxIds: [15],
        analyticDistribution: { '12': 60, '14': 40 },
      },
    ]

    const result = await createNegativeSaleOrder(
      mockClient,
      original,
      returnLines,
      'Customer return'
    )

    expect(result).toBe(999)
    expect(createdPayloads).toHaveLength(1)
    const so = createdPayloads[0].vals

    // Header assertions
    expect(so.partner_id).toBe(55)
    expect(so.partner_invoice_id).toBe(56)
    expect(so.partner_shipping_id).toBe(57)
    expect(so.pricelist_id).toBe(2)
    expect(so.company_id).toBe(1)
    expect(so.warehouse_id).toBe(3)
    expect(so.fiscal_position_id).toBe(4)
    expect(so.payment_term_id).toBe(5)
    expect(so.team_id).toBe(6)
    expect(so.user_id).toBe(7)
    expect(so.analytic_account_id).toBe(8)
    expect(so.origin).toBe('SO-101')
    expect(so.client_order_ref).toBe('RET:SO-101')

    // Line assertions (Odoo 19: tax_ids, analytic_distribution, negative qty)
    expect(so.order_line).toHaveLength(1)
    const lineCommand = so.order_line[0]
    expect(lineCommand[0]).toBe(0)
    expect(lineCommand[1]).toBe(0)
    const lineVals = lineCommand[2]
    expect(lineVals.product_id).toBe(10)
    expect(lineVals.product_uom_qty).toBe(-1)
    expect(lineVals.price_unit).toBe(150)
    expect(lineVals.discount).toBe(10)
    expect(lineVals.product_uom_id ?? lineVals.product_uom).toBe(1)
    expect(lineVals.tax_ids).toEqual([[6, 0, [15]]])
    expect(lineVals.analytic_distribution).toEqual({ '12': 60, '14': 40 })
  })

  it('falls back to Standard Mapping analytic rules and default taxes when original line lacks them', async () => {
    const createdPayloads: any[] = []
    const mockClient: any = {
      getMajorVersion: jest.fn().mockResolvedValue(17),
      execute: jest.fn().mockResolvedValue({ tax_id: { type: 'many2many' } }),
      create: jest.fn().mockImplementation(async (model: string, vals: any) => {
        createdPayloads.push({ model, vals })
        return 888
      }),
    }

    const original: OriginalSaleOrder = {
      id: 102,
      name: 'SO-102',
      state: 'sale',
      partnerId: 40,
      pricelistId: 1,
      companyId: 1,
      warehouseId: 2,
      invoiceIds: [],
      lines: [],
    }

    const returnLines: OdooReturnLine[] = [
      {
        productId: 20,
        name: 'Product B',
        quantity: 2,
        priceUnit: 200,
        taxIds: [], // missing taxes
      },
    ]

    const orderStdSettings = {
      order: {
        default_tax_id: 15,
        analytic: {
          enabled: true,
          rules: [
            {
              condition: 'all',
              source_value: '',
              source_label: '',
              odoo_analytic_account_id: 99,
              percentage: 100,
            },
          ],
        },
      },
    }

    const result = await createNegativeSaleOrder(
      mockClient,
      original,
      returnLines,
      'Return without previous analytics',
      {
        orderStdSettings,
        payload: { payment_method: 'credit_card' },
        platform: 'zid',
      }
    )

    expect(result).toBe(888)
    const lineVals = createdPayloads[0].vals.order_line[0][2]
    expect(lineVals.product_uom_qty).toBe(-2)
    // In Odoo 17, taxes are tax_id, and analytic_distribution is supported
    expect(lineVals.tax_id).toEqual([[6, 0, [15]]])
    expect(lineVals.analytic_distribution).toEqual({ '99': 100 })
  })

  it('readSaleOrder handles older Odoo (tax_id, analytic_account_id) resiliently', async () => {
    const mockClient: any = {
      getMajorVersion: jest.fn().mockResolvedValue(15),
      execute: jest.fn().mockResolvedValue({ tax_id: { type: 'many2many' } }),
      searchRead: jest.fn().mockImplementation(async (model: string, _domain: any, _fields: string[]) => {
        if (model === 'sale.order') {
          return [
            {
              id: 77,
              name: 'SO-077',
              state: 'sale',
              partner_id: [10, 'Test Customer'],
              pricelist_id: [1, 'Public Pricelist'],
              company_id: [1, 'My Company'],
              warehouse_id: [1, 'Main Warehouse'],
              invoice_ids: [],
              order_line: [701],
            },
          ]
        }
        if (model === 'sale.order.line') {
          return [
            {
              id: 701,
              product_id: [50, 'Widget'],
              name: 'Widget',
              product_uom_qty: 3,
              qty_delivered: 3,
              price_unit: 100,
              discount: 5,
              product_uom: [1, 'Units'],
              tax_id: [15],
              analytic_account_id: [88, 'Marketing'],
            },
          ]
        }
        return []
      }),
    }

    const order = await readSaleOrder(mockClient, 77)
    expect(order).not.toBeNull()
    expect(order?.id).toBe(77)
    expect(order?.lines).toHaveLength(1)
    const line = order!.lines[0]
    expect(line.productId).toBe(50)
    expect(line.orderedQty).toBe(3)
    expect(line.priceUnit).toBe(100)
    expect(line.discount).toBe(5)
    expect(line.taxIds).toEqual([15])
    expect(line.analyticAccountId).toBe(88)
  })
})
