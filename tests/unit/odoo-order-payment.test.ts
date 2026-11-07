import {
  createOdooPayment,
  extractPaymentAmount,
  extractPaymentDate,
  isOrderPaid,
  matchPaymentJournal,
  reconcilePaymentWithInvoice,
  reconcilePendingPaymentsForOrder,
  syncOrderPayment,
} from '@/lib/odoo/order-payment'

import { resolveEntityLinkId, upsertEntityLink } from '../../src/lib/entity-links'
import { getEffectiveStandardMappingSettings } from '../../src/lib/mapping-settings'

jest.mock('../../src/lib/entity-links', () => ({
  resolveEntityLinkId: jest.fn(async () => null),
  upsertEntityLink: jest.fn(async () => true),
}))
jest.mock('../../src/lib/mapping-settings', () => ({
  getEffectiveStandardMappingSettings: jest.fn(async () => null),
}))

describe('order-payment helper logic', () => {
  describe('isOrderPaid', () => {
    it('returns true when payment_status is paid', () => {
      expect(isOrderPaid({ payment_status: 'paid' })).toBe(true)
      expect(isOrderPaid({ payment_status: 'PAID' })).toBe(true)
      expect(isOrderPaid({ payment_status: 'مدفوع' })).toBe(true)
    })

    it('returns true when nested payment.status is paid or completed', () => {
      expect(isOrderPaid({ payment: { status: 'paid' } })).toBe(true)
      expect(isOrderPaid({ payment: { status: 'completed' } })).toBe(true)
      expect(isOrderPaid({ payment: { status: 'captured' } })).toBe(true)
    })

    it('returns true when financial_status is paid', () => {
      expect(isOrderPaid({ financial_status: 'paid' })).toBe(true)
    })

    it('returns true when top-level order_status is paid', () => {
      expect(isOrderPaid({ order_status: 'paid' })).toBe(true)
    })

    it('returns false for pending or unconfirmed payments', () => {
      expect(isOrderPaid({ payment_status: 'pending' })).toBe(false)
      expect(isOrderPaid({ payment_status: 'unpaid' })).toBe(false)
      expect(isOrderPaid({ payment_status: 'authorized_pending' })).toBe(false)
      expect(isOrderPaid({})).toBe(false)
      expect(isOrderPaid(null)).toBe(false)
    })
  })

  describe('extractPaymentAmount', () => {
    it('extracts amount from order_total', () => {
      expect(extractPaymentAmount({ order_total: '250.75' })).toBe(250.75)
      expect(extractPaymentAmount({ order_total: 199 })).toBe(199)
    })

    it('extracts amount from total_price or grand_total', () => {
      expect(extractPaymentAmount({ total_price: '150.00' })).toBe(150)
      expect(extractPaymentAmount({ grand_total: '320.50' })).toBe(320.5)
    })

    it('cleans currency symbols from string amounts', () => {
      expect(extractPaymentAmount({ order_total: 'SAR 500.25' })).toBe(500.25)
    })

    it('returns 0 for missing or negative amounts', () => {
      expect(extractPaymentAmount({})).toBe(0)
      expect(extractPaymentAmount({ order_total: 0 })).toBe(0)
      expect(extractPaymentAmount(null)).toBe(0)
    })
  })

  describe('extractPaymentDate', () => {
    it('extracts and formats date to YYYY-MM-DD from ISO string', () => {
      expect(extractPaymentDate({ payment: { paid_at: '2026-10-25T14:30:00Z' } })).toBe('2026-10-25')
      expect(extractPaymentDate({ paid_at: '2026-08-15T08:12:00.000Z' })).toBe('2026-08-15')
    })

    it('falls back to created_at if paid_at is absent', () => {
      expect(extractPaymentDate({ created_at: '2026-05-10T12:00:00Z' })).toBe('2026-05-10')
    })

    it('returns today date if no date in payload', () => {
      const today = new Date().toISOString().slice(0, 10)
      expect(extractPaymentDate({})).toBe(today)
    })
  })

  describe('matchPaymentJournal', () => {
    const mappings = [
      { zid_payment_method: 'zid_cod', odoo_journal_id: '7' },
      { zid_payment_method: 'credit_card', odoo_journal_id: '8' },
      { zid_payment_method: 'apple_pay', odoo_journal_id: '9' },
      { zid_payment_method: 'tamara', odoo_journal_id: '10' },
    ]

    it('matches normalized keys like zid_cod -> cod', () => {
      const payload = {
        payment_method: { code: 'zid_cod', title: 'الدفع عند الاستلام' },
      }
      expect(matchPaymentJournal(mappings, payload)).toBe(7)
    })

    it('matches Apple Pay regardless of formatting', () => {
      const payload = {
        payment_method: { code: 'apple_pay', title: 'Apple Pay' },
      }
      expect(matchPaymentJournal(mappings, payload)).toBe(9)
    })

    it('matches direct string payment method code', () => {
      const payload = {
        payment_method: 'tamara',
      }
      expect(matchPaymentJournal(mappings, payload)).toBe(10)
    })

    it('returns null if no mapping matches', () => {
      const payload = {
        payment_method: { code: 'unknown_gateway', title: 'Other' },
      }
      expect(matchPaymentJournal(mappings, payload)).toBeNull()
    })
  })
})

describe('createOdooPayment and version handling', () => {
  it.each([14, 15, 16, 17, 18])('uses the actual reference field on Odoo %s', async major => {
    const client: any = {
      getMajorVersion: async () => major,
      searchRead: async () => [],
      create: jest.fn(async () => 101),
      execute: async () => true,
    }
    await createOdooPayment(client, { partnerId: 12, amount: 250, journalId: 8, ref: 'Zid Order #999' })
    const values = client.create.mock.calls[0][1]
    expect(values[major >= 18 ? 'memo' : 'ref']).toBe('Zid Order #999')
    expect(values).not.toHaveProperty(major >= 18 ? 'ref' : 'memo')
  })
  it('uses payment_method_line_id on Odoo 15-20', async () => {
    const executedMethods: string[] = []
    let createdPayload: any = null

    const mockClient: any = {
      getMajorVersion: async () => 17,
      searchRead: async (model: string, _domain: any) => {
        if (model === 'account.payment.method.line') {
          return [{ id: 45, name: 'Manual Inbound' }]
        }
        return []
      },
      create: async (_model: string, vals: any) => {
        createdPayload = vals
        return 101
      },
      execute: async (model: string, method: string) => {
        executedMethods.push(`${model}.${method}`)
        return true
      },
    }

    const paymentId = await createOdooPayment(mockClient, {
      partnerId: 12,
      amount: 250,
      journalId: 8,
      date: '2026-10-25',
      ref: 'Zid Order #999',
      currencyId: 1,
    })

    expect(paymentId).toBe(101)
    expect(createdPayload.payment_type).toBe('inbound')
    expect(createdPayload.partner_type).toBe('customer')
    expect(createdPayload.partner_id).toBe(12)
    expect(createdPayload.amount).toBe(250)
    expect(createdPayload.journal_id).toBe(8)
    expect(createdPayload.payment_method_line_id).toBe(45)
    expect(createdPayload.currency_id).toBe(1)
    expect(executedMethods).toContain('account.payment.action_post')
  })

  it('uses payment_method_id on Odoo 14', async () => {
    let createdPayload: any = null

    const mockClient: any = {
      getMajorVersion: async () => 14,
      searchRead: async (model: string) => {
        if (model === 'account.payment.method') {
          return [{ id: 3, name: 'Manual' }]
        }
        return []
      },
      create: async (_model: string, vals: any) => {
        createdPayload = vals
        return 102
      },
      execute: async () => true,
    }

    const paymentId = await createOdooPayment(mockClient, {
      partnerId: 15,
      amount: 180,
      journalId: 5,
      date: '2026-10-25',
      ref: 'Zid Order #1000',
    })

    expect(paymentId).toBe(102)
    expect(createdPayload.payment_method_id).toBe(3)
    expect(createdPayload.payment_method_line_id).toBeUndefined()
  })
})

describe('reconcilePaymentWithInvoice', () => {
  it.each(['missing', 'read_error'])('does not guess a journal-entry id when the payment move is %s', async scenario => {
    const client: any = {
      searchRead: jest.fn(async (model: string) => {
        if (model === 'account.move') return [{ id: 201, state: 'posted', move_type: 'out_invoice' }]
        if (model === 'account.payment' && scenario === 'read_error') throw new Error('RPC failed')
        return []
      }),
      execute: jest.fn(),
    }
    expect(await reconcilePaymentWithInvoice(client, 101, 201)).toBe(false)
    expect(client.searchRead.mock.calls.some(([model]: [string]) => model === 'account.move.line')).toBe(false)
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('does not attempt reconciliation between different accounts', async () => {
    const client: any = {
      searchRead: async (model: string, domain: any[]) => {
        if (model === 'account.move') return [{ id: 201, state: 'posted', move_type: 'out_invoice' }]
        if (model === 'account.payment') return [{ id: 101, move_id: [301, 'Payment'] }]
        const moveId = domain.find(term => term[0] === 'move_id')?.[2]
        return [{ id: moveId === 201 ? 501 : 601, account_id: [moveId === 201 ? 10 : 11, 'Account'] }]
      },
      execute: jest.fn(),
    }
    expect(await reconcilePaymentWithInvoice(client, 101, 201)).toBe(false)
    expect(client.execute).not.toHaveBeenCalled()
  })
  it('calls account.move.line.reconcile on matching move lines', async () => {
    const executedReconciles: any[] = []

    const mockClient: any = {
      searchRead: async (model: string, domain: any) => {
        if (model === 'account.move') {
          return [{ id: 201, state: 'posted', move_type: 'out_invoice' }]
        }
        if (model === 'account.payment') {
          return [{ id: 101, move_id: [301, 'BNK1/2026/001'] }]
        }
        if (model === 'account.move.line') {
          // Check domain for move_id
          const moveIdTerm = domain.find((d: any) => d[0] === 'move_id')
          const moveId = moveIdTerm?.[2]
          if (moveId === 201) {
            // Invoice line: debit > 0
            return [{ id: 501, account_id: [10, 'Receivable'], debit: 250, credit: 0, reconciled: false }]
          }
          if (moveId === 301) {
            // Payment line: credit > 0
            return [{ id: 601, account_id: [10, 'Receivable'], debit: 0, credit: 250, reconciled: false }]
          }
        }
        return []
      },
      execute: async (model: string, method: string, args: any) => {
        if (model === 'account.move.line' && method === 'reconcile') {
          executedReconciles.push(args)
        }
        return true
      },
    }

    const ok = await reconcilePaymentWithInvoice(mockClient, 101, 201)
    expect(ok).toBe(true)
    expect(executedReconciles).toHaveLength(1)
    expect(executedReconciles[0]).toEqual([[501, 601]])
  })

  it('defers reconciliation if invoice is still in draft state', async () => {
    const mockClient: any = {
      searchRead: async (model: string) => {
        if (model === 'account.move') {
          return [{ id: 202, state: 'draft', move_type: 'out_invoice' }]
        }
        return []
      },
    }

    const ok = await reconcilePaymentWithInvoice(mockClient, 101, 202)
    expect(ok).toBe(false)
  })
})

describe('syncOrderPayment and reconcilePendingPaymentsForOrder', () => {
  it.each(['posted', 'in_process', 'paid'])('recovers a committed %s payment after the XML-RPC None fault without repeating action_post', async committedState => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'bank_transfer', odoo_journal_id: '14' }] },
    } as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    let state = 'draft'
    const client: any = {
      searchRead: jest.fn(async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [1, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        : [{ id: 101, state, company_id: [1, 'Company'] }]),
      create: jest.fn(),
      execute: jest.fn(async () => { state = committedState; throw new Error('cannot marshal None unless allow_none is enabled') }),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'bank_transfer' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result).toEqual({ paymentId: 101, reconciled: false })
    expect(client.execute).toHaveBeenCalledTimes(1)
    expect(client.execute).toHaveBeenCalledWith('account.payment', 'action_post', [[101]])
    expect(client.searchRead.mock.calls.filter(([model]: [string]) => model === 'account.payment')).toHaveLength(2)
    expect(client.create).not.toHaveBeenCalled()
  })

  it.each(['wrong_company', 'read_failure', 'draft'])('preserves the posting fault when readback is %s', async readback => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'bank_transfer', odoo_journal_id: '14' }] },
    } as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    let postingAttempted = false
    const client: any = {
      searchRead: jest.fn(async (model: string) => {
        if (model === 'sale.order') return [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [1, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        if (postingAttempted && readback === 'read_failure') throw new Error('read failed')
        return [{ id: 101, state: postingAttempted && readback === 'wrong_company' ? 'in_process' : 'draft', company_id: [postingAttempted && readback === 'wrong_company' ? 2 : 1, 'Company'] }]
      }),
      create: jest.fn(),
      execute: jest.fn(async () => { postingAttempted = true; throw new Error('original posting fault') }),
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await syncOrderPayment({
        client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'bank_transfer' },
        workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
      })
      expect(result.errorReason).toBe('original posting fault')
      expect(client.execute).toHaveBeenCalledTimes(1)
      expect(client.create).not.toHaveBeenCalled()
    } finally { errorSpy.mockRestore() }
  })

  it('rechecks company ownership after a normal successful posting response', async () => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'bank_transfer', odoo_journal_id: '14' }] },
    } as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    let posted = false
    const client: any = {
      searchRead: jest.fn(async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [1, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        : [{ id: 101, state: posted ? 'posted' : 'draft', company_id: [posted ? 2 : 1, 'Company'] }]),
      create: jest.fn(), execute: jest.fn(async () => { posted = true; return true }),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'bank_transfer' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result.errorReason).toBe('linked_payment_company_mismatch')
    expect(client.execute).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unpaid', 250, true],
    ['partial', 50, true],
    ['paid', 0, false],
    ['in_payment', 0, false],
  ])('reports missing payment journal entry for posted %s invoices without falsely failing settled replays', async (paymentState, residual, shouldFail) => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'bank_transfer', odoo_journal_id: '14' }] },
    } as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    const client: any = {
      getMajorVersion: async () => 19,
      searchRead: jest.fn(async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [1, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [201] }]
        : model === 'account.payment' ? [{ id: 101, state: 'in_process', company_id: [1, 'Company'], move_id: false }]
        : model === 'account.move' ? [{ id: 201, state: 'posted', move_type: 'out_invoice', payment_state: paymentState, amount_residual: residual }] : []),
      create: jest.fn(), execute: jest.fn(),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'bank_transfer' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result.paymentId).toBe(101)
    if (shouldFail) {
      expect(result.errorReason).toBe('payment_invoice_reconciliation_failed')
      expect(result.reconciled).toBe(false)
    } else {
      expect(result.errorReason).toBeUndefined()
      expect(result.reconciled).toBe(true)
    }
    expect(client.create).not.toHaveBeenCalled()
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('allows an in-process prepayment before any invoice exists', async () => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'bank_transfer', odoo_journal_id: '14' }] },
    } as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    const client: any = {
      searchRead: jest.fn(async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [1, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        : [{ id: 101, state: 'in_process', company_id: [1, 'Company'], move_id: false }]),
      create: jest.fn(), execute: jest.fn(),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'bank_transfer' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result).toEqual({ paymentId: 101, reconciled: false })
    expect(client.create).not.toHaveBeenCalled()
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('does not let a settled invoice conceal another unpaid invoice', async () => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'bank_transfer', odoo_journal_id: '14' }] },
    } as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    const client: any = {
      searchRead: jest.fn(),
      create: jest.fn(), execute: jest.fn(),
    }
    // Single-record invoice reads must not accidentally inspect its settled sibling.
    client.searchRead.mockImplementation(async (model: string, domain: unknown[][]) => {
      if (model === 'sale.order') return [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [1, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [201, 202] }]
      if (model === 'account.payment') return [{ id: 101, state: 'in_process', company_id: [1, 'Company'], move_id: false }]
      if (model === 'account.move') {
        const rows = [{ id: 201, state: 'posted', move_type: 'out_invoice', payment_state: 'paid', amount_residual: 0 }, { id: 202, state: 'posted', move_type: 'out_invoice', payment_state: 'partial', amount_residual: 50 }]
        const single = domain.find(term => term[0] === 'id' && term[1] === '=')
        return single ? rows.filter(row => row.id === single[2]) : rows
      }
      return []
    })
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'bank_transfer' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result).toMatchObject({ paymentId: 101, reconciled: true, errorReason: 'payment_invoice_reconciliation_failed' })
    expect(client.create).not.toHaveBeenCalled()
  })

  it('accepts an invoice settled concurrently after the reconciliation attempt', async () => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'bank_transfer', odoo_journal_id: '14' }] },
    } as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    let invoiceReads = 0
    const client: any = {
      searchRead: jest.fn(async (model: string) => {
        if (model === 'sale.order') return [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [1, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [201] }]
        if (model === 'account.payment') return [{ id: 101, state: 'in_process', company_id: [1, 'Company'], move_id: false }]
        if (model === 'account.move') {
          invoiceReads++
          return [{ id: 201, state: 'posted', move_type: 'out_invoice', payment_state: invoiceReads >= 3 ? 'paid' : 'not_paid', amount_residual: invoiceReads >= 3 ? 0 : 250 }]
        }
        return []
      }),
      create: jest.fn(), execute: jest.fn(),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'bank_transfer' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result).toEqual({ paymentId: 101, reconciled: true })
    expect(invoiceReads).toBe(3)
    expect(client.create).not.toHaveBeenCalled()
  })

  it('persists a new draft before posting and retries the same id after a posting failure', async () => {
    const settings = { order: { payment_journal_mappings: [{ zid_payment_method: 'zid_cod', odoo_journal_id: '8' }] } }
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce(settings as any).mockResolvedValueOnce(settings as any)
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(null).mockResolvedValueOnce(101)
    let state = 'draft'
    let failPost = true
    const client: any = {
      getMajorVersion: async () => 17,
      searchRead: async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [7, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        : model === 'account.journal' ? [{ id: 8 }]
        : model === 'account.payment' ? [{ id: 101, state, company_id: [7, 'Company'] }] : [],
      create: jest.fn(async () => 101),
      execute: jest.fn(async () => {
        const linkOrder = jest.mocked(upsertEntityLink).mock.invocationCallOrder.at(-1)!
        expect(linkOrder).toBeLessThan(client.execute.mock.invocationCallOrder.at(-1))
        if (failPost) throw new Error('Payment posting failed')
        state = 'posted'
        return true
      }),
    }
    const params = {
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'zid_cod' },
      workspaceId: 'ws-123', platform: 'zid' as const, storeId: 'store-1', zidEntityId: 'ord-999',
    }
    const failed = await syncOrderPayment(params)
    expect(failed.errorReason).toBe('Payment posting failed')
    expect(failed.reconciled).toBeUndefined()
    failPost = false
    const replay = await syncOrderPayment(params)
    expect(replay).toMatchObject({ paymentId: 101, reconciled: false })
    expect(replay.errorReason).toBeUndefined()
    expect(client.create).toHaveBeenCalledTimes(1)
  })

  it('reports failed link persistence before posting a newly created payment', async () => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'zid_cod', odoo_journal_id: '8' }] },
    } as any)
    jest.mocked(upsertEntityLink).mockResolvedValueOnce(false)
    const client: any = {
      getMajorVersion: async () => 17,
      searchRead: async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [7, 'Company'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        : model === 'account.journal' ? [{ id: 8 }] : [],
      create: jest.fn(async () => 101), execute: jest.fn(),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'zid_cod' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result).toMatchObject({ paymentId: 101, errorReason: 'payment_link_persistence_failed' })
    expect(client.execute).not.toHaveBeenCalled()
  })

  it('refuses a payment journal outside the order company before any write', async () => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'zid_cod', odoo_journal_id: '8' }] },
    } as any)
    const client: any = {
      searchRead: jest.fn(async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [7, 'Company B'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        : []),
      create: jest.fn(), execute: jest.fn(),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'zid_cod' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result.skippedReason).toBe('invalid_payment_journal_for_order_company')
    expect(client.searchRead).toHaveBeenCalledWith('account.journal', [
      ['id', '=', 8], ['company_id', '=', 7], ['type', 'in', ['bank', 'cash']],
    ], ['id'], 1)
    expect(client.create).not.toHaveBeenCalled()
    expect(client.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['AED', 255],
    ['SAR', 250],
  ])('uses the paid total in the Odoo order currency when source is %s', async (sourceCurrency, expectedAmount) => {
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'zid_cod', odoo_journal_id: '8' }] },
    } as any)
    const client: any = {
      getMajorVersion: async () => 17,
      searchRead: async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [7, 'Company B'], currency_id: [1, 'SAR'], amount_total: 255, invoice_ids: [] }]
        : model === 'account.journal' ? [{ id: 8 }]
        : model === 'account.payment' ? [{ id: 101, state: 'posted', company_id: [7, 'Company B'] }] : [],
      create: jest.fn(async () => 101),
      execute: jest.fn(async () => true),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55,
      zidData: { payment_status: 'paid', order_total: 250, currency_code: sourceCurrency, payment_method: 'zid_cod' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    expect(result.paymentId).toBe(101)
    expect(client.create).toHaveBeenCalledWith('account.payment', expect.objectContaining({ amount: expectedAmount, currency_id: 1, company_id: 7 }))
  })

  it.each([7, 8])('only retries a linked draft payment when company %s matches the order', async paymentCompanyId => {
    jest.mocked(resolveEntityLinkId).mockResolvedValueOnce(101)
    jest.mocked(getEffectiveStandardMappingSettings).mockResolvedValueOnce({
      order: { payment_journal_mappings: [{ zid_payment_method: 'zid_cod', odoo_journal_id: '8' }] },
    } as any)
    let state = 'draft'
    const client: any = {
      searchRead: async (model: string) => model === 'sale.order'
        ? [{ id: 55, name: 'S0055', partner_id: [12, 'Customer'], company_id: [7, 'Company B'], currency_id: [1, 'SAR'], invoice_ids: [] }]
        : [{ id: 101, state, company_id: [paymentCompanyId, 'Payment company'] }],
      create: jest.fn(),
      execute: jest.fn(async () => { state = 'posted'; return true }),
    }
    const result = await syncOrderPayment({
      client, saleOrderId: 55, zidData: { payment_status: 'paid', order_total: 250, payment_method: 'zid_cod' },
      workspaceId: 'ws-123', platform: 'zid', storeId: 'store-1', zidEntityId: 'ord-999',
    })
    if (paymentCompanyId === 7) {
      expect(result.paymentId).toBe(101)
      expect(client.execute).toHaveBeenCalledWith('account.payment', 'action_post', [[101]])
    } else {
      expect(result.skippedReason).toBe('linked_payment_company_mismatch')
      expect(client.execute).not.toHaveBeenCalled()
    }
    expect(client.create).not.toHaveBeenCalled()
  })
  it('skips syncOrderPayment if order is unpaid', async () => {
    const mockClient: any = {}
    const res = await syncOrderPayment({
      client: mockClient,
      saleOrderId: 55,
      zidData: { payment_status: 'pending' },
      workspaceId: 'ws-123',
      platform: 'zid',
      storeId: 'store-1',
      zidEntityId: 'ord-999',
    })
    expect(res.skippedReason).toBe('order_not_paid')
  })

  it('handles reconcilePendingPaymentsForOrder gracefully when no payment exists', async () => {
    const mockClient: any = {
      searchRead: jest.fn(async () => [{ id: 999, ref: 'Zid Order #ord-nonexistent' }]),
    }
    const res = await reconcilePendingPaymentsForOrder({
      client: mockClient,
      saleOrderId: 55,
      invoiceId: 77,
      workspaceId: 'ws-123',
      platform: 'zid',
      storeId: 'store-1',
      zidEntityId: 'ord-nonexistent',
    })
    expect(res).toBe(false)
    expect(mockClient.searchRead).not.toHaveBeenCalled()
  })
})
