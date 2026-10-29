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
      searchRead: async () => [],
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
  })
})
