import { buildOdooValues, getSaleOrderSelectionKeys } from '@/lib/sync-engine'
import type { OdooFieldMeta } from '@/lib/sync-types'

/**
 * Odoo's XML-RPC to_datetime is strict ('YYYY-MM-DD HH:MM:SS'). Salla sends
 * `date.date` with microseconds ("2022-06-26 12:21:45.000000"), which killed
 * every Salla sale.order.create with
 * "ValueError: unconverted data remains: .000000". buildOdooValues now
 * extracts the Odoo-compatible prefix for datetime/date fields; clean values
 * pass through untouched so Zid/Shopify flows are unaffected.
 *
 * Second pin: the order custom-status injection writes the platform status
 * into a Selection field, and Odoo validates selection values — an unmapped
 * status (e.g. Salla "in_progress") would fail the whole order write.
 * getSaleOrderSelectionKeys lets both injection sites skip unknown values.
 */

const client = {} as any

const fieldMetaOf = (names: Array<[string, string]>): Map<string, OdooFieldMeta> =>
  new Map(names.map(([name, ttype]) => [name, { name, ttype, relation: '' }]))

describe('buildOdooValues — datetime normalization (Salla microseconds)', () => {
  it('strips microseconds from a Salla date.date value', async () => {
    const values = await buildOdooValues(
      client,
      [{ id: 'm1', erpField: 'date_order', zidField: 'date.date' }],
      { date: { date: '2022-06-26 12:21:45.000000' } },
      fieldMetaOf([['date_order', 'datetime']])
    )
    expect(values.date_order).toBe('2022-06-26 12:21:45')
  })

  it('leaves an already-clean Odoo datetime untouched', async () => {
    const values = await buildOdooValues(
      client,
      [{ id: 'm1', erpField: 'date_order', zidField: 'date.date' }],
      { date: { date: '2022-06-26 12:21:45' } },
      fieldMetaOf([['date_order', 'datetime']])
    )
    expect(values.date_order).toBe('2022-06-26 12:21:45')
  })

  it('accepts ISO T-separator and pads missing seconds', async () => {
    const values = await buildOdooValues(
      client,
      [{ id: 'm1', erpField: 'date_order', zidField: 'created_at' }],
      { created_at: '2022-06-26T12:21.000Z' },
      fieldMetaOf([['date_order', 'datetime']])
    )
    expect(values.date_order).toBe('2022-06-26 12:21:00')
  })

  it('reduces to the date part for date fields', async () => {
    const values = await buildOdooValues(
      client,
      [{ id: 'm1', erpField: 'x_date', zidField: 'date.date' }],
      { date: { date: '2022-06-26 12:21:45.000000' } },
      fieldMetaOf([['x_date', 'date']])
    )
    expect(values.x_date).toBe('2022-06-26')
  })

  it('does not touch non-datetime fields', async () => {
    const values = await buildOdooValues(
      client,
      [{ id: 'm1', erpField: 'client_order_ref', zidField: 'id' }],
      { id: '1068420718.5' },
      fieldMetaOf([['client_order_ref', 'char']])
    )
    expect(values.client_order_ref).toBe('1068420718.5')
  })
})

describe('getSaleOrderSelectionKeys', () => {
  const fakeClient = (selection?: string) => ({
    execute: async () => (selection ? [{ selection }] : []),
  }) as any

  it('parses the python-literal selection keys', async () => {
    const keys = await getSaleOrderSelectionKeys(
      fakeClient("[('under_review', 'بإنتظار المراجعة'), ('completed', 'تم التنفيذ')]"),
      'ws-dt-1',
      'x_salla_order_status'
    )
    expect(keys).toEqual(new Set(['under_review', 'completed']))
  })

  it('returns null when the field has no selection (fail-open)', async () => {
    await expect(
      getSaleOrderSelectionKeys(fakeClient(undefined), 'ws-dt-2', 'x_char_field')
    ).resolves.toBeNull()
  })

  it('returns null when Odoo is unreachable (fail-open)', async () => {
    const throwing = { execute: async () => { throw new Error('down') } } as any
    await expect(
      getSaleOrderSelectionKeys(throwing, 'ws-dt-3', 'x_salla_order_status')
    ).resolves.toBeNull()
  })
})
