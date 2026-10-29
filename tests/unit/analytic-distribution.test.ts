import {
  normalizeAnalyticRules,
  normalizePaymentKey,
  parseAnalyticConfig,
  paymentKeysFromOrder,
  resolveAnalyticDistribution,
  toOdooAnalyticFields,
  type AnalyticRule,
} from '@/lib/odoo/analytic-distribution'

/**
 * Analytic distribution is money allocation: the percentages Odoo receives on
 * each sale.order.line must add up to exactly 100. These tests pin the merge
 * rule (`all` rules always stack with matching specific rules), the
 * normalisation (relative weights, largest remainder) and the <17 fallback.
 *
 * Source under test: src/lib/odoo/analytic-distribution.ts
 */

function rule(partial: Partial<AnalyticRule>): AnalyticRule {
  return {
    condition: 'all',
    source_value: '',
    source_label: '',
    odoo_analytic_account_id: 1,
    percentage: 100,
    ...partial,
  }
}

describe('normalizeAnalyticRules', () => {
  it('keeps valid rows and defaults a missing percentage to 100', () => {
    const rules = normalizeAnalyticRules([
      { condition: 'all', odoo_analytic_account_id: 7, percentage: 50 },
      { condition: 'warehouse', source_value: 'loc-1', odoo_analytic_account_id: 8 },
    ])
    expect(rules).toHaveLength(2)
    expect(rules[0]).toMatchObject({ condition: 'all', source_value: '', percentage: 50 })
    expect(rules[1]).toMatchObject({ condition: 'warehouse', source_value: 'loc-1', percentage: 100 })
  })

  it('drops invalid conditions, accounts, values and percentages', () => {
    const rules = normalizeAnalyticRules([
      { condition: 'region', odoo_analytic_account_id: 1 },
      { condition: 'all' },
      { condition: 'all', odoo_analytic_account_id: 0 },
      { condition: 'all', odoo_analytic_account_id: 1.5 },
      { condition: 'warehouse', odoo_analytic_account_id: 2 },
      { condition: 'payment', source_value: '', odoo_analytic_account_id: 3 },
      { condition: 'all', odoo_analytic_account_id: 4, percentage: 0 },
      { condition: 'all', odoo_analytic_account_id: 5, percentage: -5 },
      null,
      'x',
    ])
    expect(rules).toEqual([])
  })

  it('caps a percentage above 100 and normalizes payment keys', () => {
    const rules = normalizeAnalyticRules([
      { condition: 'all', odoo_analytic_account_id: 1, percentage: 250 },
      { condition: 'payment', source_value: 'ZID_COD', odoo_analytic_account_id: 2, percentage: 100 },
    ])
    expect(rules[0].percentage).toBe(100)
    expect(rules[1].source_value).toBe('cod')
    expect(rules[1].source_label).toBe('ZID_COD')
  })

  it('falls back to the label when a specific row has no source_value', () => {
    const rules = normalizeAnalyticRules([
      { condition: 'warehouse', source_label: 'Riyadh', odoo_analytic_account_id: 3 },
    ])
    expect(rules[0].source_value).toBe('Riyadh')
  })

  it('parses the persisted envelope and fails closed', () => {
    expect(parseAnalyticConfig(null)).toEqual({ enabled: false, rules: [] })
    expect(parseAnalyticConfig({ rules: [] })).toEqual({ enabled: false, rules: [] })
    expect(parseAnalyticConfig({ enabled: true, rules: [{ condition: 'all', odoo_analytic_account_id: 9 }] }))
      .toEqual({ enabled: true, rules: [rule({ odoo_analytic_account_id: 9 })] })
  })
})

describe('normalizePaymentKey', () => {
  it('collapses case, spaces, dashes and the platform prefix', () => {
    expect(normalizePaymentKey('Zid_COD')).toBe('cod')
    expect(normalizePaymentKey('salla-credit-card')).toBe('creditcard')
    expect(normalizePaymentKey('  Apple Pay ')).toBe('applepay')
    expect(normalizePaymentKey('الدفع عند الاستلام')).toBe('الدفععندالاستلام')
    expect(normalizePaymentKey(null)).toBe('')
  })

  it('does not strip a platform word that is part of the name', () => {
    expect(normalizePaymentKey('zidcod')).toBe('zidcod')
  })
})

describe('paymentKeysFromOrder', () => {
  it('collects code, title and gateway from a Zid payload', () => {
    const keys = paymentKeysFromOrder({
      payment_method: { code: 'zid_cod', title: 'الدفع عند الاستلام' },
      payment_gateway: { title: 'Cash' },
    })
    expect(keys).toEqual(expect.arrayContaining(['cod', 'الدفععندالاستلام', 'cash']))
  })

  it('collects a Salla slug and split-payment entries', () => {
    const keys = paymentKeysFromOrder({
      payment_method: 'credit_card',
      payment_methods: [{ payment_method: 'bank' }, { payment_method: 'credit_card' }],
    })
    expect(keys).toEqual(expect.arrayContaining(['creditcard', 'bank']))
    expect(keys.filter(k => k === 'creditcard')).toHaveLength(1)
  })

  it('returns nothing for a missing payload', () => {
    expect(paymentKeysFromOrder(null)).toEqual([])
  })
})

describe('resolveAnalyticDistribution', () => {
  const enabled = (rules: AnalyticRule[]) => ({ enabled: true, rules })

  it('returns nothing when disabled or empty', () => {
    expect(resolveAnalyticDistribution({ config: { enabled: false, rules: [rule({})] } })).toEqual([])
    expect(resolveAnalyticDistribution({ config: enabled([]) })).toEqual([])
    expect(resolveAnalyticDistribution({ config: null })).toEqual([])
  })

  it('uses the unified rule when no specific rule matches', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([rule({ odoo_analytic_account_id: 10 })]),
      locationId: 'loc-1',
      paymentKeys: ['cod'],
    })
    expect(distribution).toEqual([{ accountId: 10, percentage: 100 }])
  })

  it('prefers matching specific rule over general fallback rule (does not stack all)', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([
        rule({ odoo_analytic_account_id: 10 }),
        rule({ condition: 'warehouse', source_value: 'loc-1', odoo_analytic_account_id: 20 }),
      ]),
      locationId: 'loc-1',
    })
    expect(distribution).toEqual([
      { accountId: 20, percentage: 100 },
    ])
  })

  it('matches warehouse and payment rules together without stacking fallback all', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([
        rule({ condition: 'warehouse', source_value: 'loc-1', odoo_analytic_account_id: 20 }),
        rule({ condition: 'payment', source_value: 'cod', odoo_analytic_account_id: 30 }),
        rule({ odoo_analytic_account_id: 10 }),
      ]),
      locationId: 'loc-1',
      paymentKeys: ['cod'],
    })
    expect(distribution.map(e => e.accountId)).toEqual([20, 30])
    expect(distribution.map(e => e.percentage)).toEqual([100, 100])
  })

  it('sums multiple rules that point at the same account', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([
        rule({ condition: 'warehouse', source_value: 'loc-1', odoo_analytic_account_id: 20, percentage: 50 }),
        rule({ condition: 'payment', source_value: 'cod', odoo_analytic_account_id: 20, percentage: 50 }),
      ]),
      locationId: 'loc-1',
      paymentKeys: ['cod'],
    })
    expect(distribution).toEqual([{ accountId: 20, percentage: 100 }])
  })

  it('matches a warehouse by name case-insensitively', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([rule({ condition: 'warehouse', source_value: 'Riyadh', odoo_analytic_account_id: 5 })]),
      locationName: '  riyadh ',
    })
    expect(distribution).toEqual([{ accountId: 5, percentage: 100 }])
  })

  it('does not match a warehouse by a different location', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([rule({ condition: 'warehouse', source_value: 'Jeddah', odoo_analytic_account_id: 5 })]),
      locationId: 'loc-1',
      locationName: 'Riyadh',
    })
    expect(distribution).toEqual([])
  })

  it('preserves three equal weights without re-normalising (sends 100 verbatim to each)', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([
        rule({ condition: 'payment', source_value: 'a', odoo_analytic_account_id: 1 }),
        rule({ condition: 'payment', source_value: 'b', odoo_analytic_account_id: 2 }),
        rule({ condition: 'payment', source_value: 'c', odoo_analytic_account_id: 3 }),
      ]),
      paymentKeys: ['a', 'b', 'c'],
    })
    expect(distribution.map(e => e.percentage)).toEqual([100, 100, 100])
  })

  it('respects uneven weights and keeps each verbatim', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([
        rule({ condition: 'payment', source_value: 'a', odoo_analytic_account_id: 1, percentage: 70 }),
        rule({ condition: 'payment', source_value: 'b', odoo_analytic_account_id: 2, percentage: 30 }),
      ]),
      paymentKeys: ['a', 'b'],
    })
    expect(distribution).toEqual([
      { accountId: 1, percentage: 70 },
      { accountId: 2, percentage: 30 },
    ])
  })

  it('preserves configured percentages verbatim (no re-normalise to 100)', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([
        rule({ condition: 'warehouse', source_value: 'loc-1', odoo_analytic_account_id: 20, percentage: 100 }),
        rule({ condition: 'payment', source_value: 'cod', odoo_analytic_account_id: 30, percentage: 100 }),
      ]),
      locationId: 'loc-1',
      paymentKeys: ['cod'],
    })
    expect(distribution).toEqual([
      { accountId: 20, percentage: 100 },
      { accountId: 30, percentage: 100 },
    ])
  })

  it('preserves fallback rule percentage verbatim when no specific rule matches', () => {
    const distribution = resolveAnalyticDistribution({
      config: enabled([
        rule({ condition: 'all', odoo_analytic_account_id: 10, percentage: 50 }),
        rule({ condition: 'warehouse', source_value: 'loc-1', odoo_analytic_account_id: 20, percentage: 100 }),
      ]),
      locationId: 'loc-other',
    })
    expect(distribution).toEqual([
      { accountId: 10, percentage: 50 },
    ])
  })
})

describe('toOdooAnalyticFields', () => {
  const distribution = [
    { accountId: 12, percentage: 60 },
    { accountId: 15, percentage: 40 },
  ]

  it('writes analytic_distribution with string account keys on 17+', () => {
    expect(toOdooAnalyticFields(distribution, true, true)).toEqual({
      analytic_distribution: { '12': 60, '15': 40 },
    })
  })

  it('falls back to a single analytic_account_id on older Odoo', () => {
    expect(toOdooAnalyticFields(distribution, false, true)).toEqual({ analytic_account_id: 12 })
  })

  it('writes nothing when the model has neither field', () => {
    expect(toOdooAnalyticFields(distribution, false, false)).toEqual({})
  })

  it('writes nothing for an empty distribution', () => {
    expect(toOdooAnalyticFields([], true, true)).toEqual({})
  })
})
