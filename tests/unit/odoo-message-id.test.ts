import { normalizeOdooMessageId } from '@/lib/odoo-message-id'

describe('Odoo 20 chatter message ID response normalization', () => {
  it('unwraps Odoo execute_kw message_post result [id]', () => {
    expect(normalizeOdooMessageId([297])).toBe(297)
    const linked = [[normalizeOdooMessageId([297])], { attachment_ids: [[4, 47]] }]
    expect(linked).toEqual([[297], { attachment_ids: [[4, 47]] }])
  })

  it('accepts scalar IDs for other Odoo versions', () => {
    expect(normalizeOdooMessageId(296)).toBe(296)
  })

  it.each([
    [],
    [[297]],
    [297, 298],
    0,
    -1,
    1.5,
    Number.NaN,
    '297',
    { id: 297 },
    null,
  ])('rejects malformed Odoo message_post result %p', value => {
    expect(() => normalizeOdooMessageId(value)).toThrow(
      'Odoo did not return a valid single chatter message ID',
    )
  })
})
