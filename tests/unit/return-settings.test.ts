import { DEFAULT_RETURN_SETTINGS } from '@/lib/returns/detect'
import { isReturnModeEnabled, normalizeReturnSettings } from '@/lib/returns/settings'

describe('normalizeReturnSettings', () => {
  it('is inert when nothing is configured - existing workspaces must not change', () => {
    expect(normalizeReturnSettings(undefined)).toEqual(DEFAULT_RETURN_SETTINGS)
    expect(normalizeReturnSettings(null)).toEqual(DEFAULT_RETURN_SETTINGS)
    expect(normalizeReturnSettings({})).toEqual(DEFAULT_RETURN_SETTINGS)
    expect(normalizeReturnSettings('garbage')).toEqual(DEFAULT_RETURN_SETTINGS)
    expect(normalizeReturnSettings([])).toEqual(DEFAULT_RETURN_SETTINGS)
  })

  it('rejects an unknown mode instead of guessing one', () => {
    expect(normalizeReturnSettings({ mode: 'refund_everything' }).mode).toBe('nothing')
    expect(normalizeReturnSettings({ mode: 'negative_so' }).mode).toBe('negative_so')
    expect(normalizeReturnSettings({ mode: 'stock_return_credit_note' }).mode).toBe(
      'stock_return_credit_note'
    )
  })

  it('keeps a valid journal id and nulls anything unusable', () => {
    expect(normalizeReturnSettings({ credit_note_journal_id: 7 }).credit_note_journal_id).toBe(7)
    expect(normalizeReturnSettings({ credit_note_journal_id: '7' }).credit_note_journal_id).toBe(7)
    expect(normalizeReturnSettings({ credit_note_journal_id: 0 }).credit_note_journal_id).toBeNull()
    expect(normalizeReturnSettings({ credit_note_journal_id: -3 }).credit_note_journal_id).toBeNull()
    expect(normalizeReturnSettings({ credit_note_journal_id: 1.5 }).credit_note_journal_id).toBeNull()
    expect(normalizeReturnSettings({ credit_note_journal_id: 'x' }).credit_note_journal_id).toBeNull()
  })

  it('defaults the credit note to on and only honours an explicit boolean', () => {
    expect(normalizeReturnSettings({}).create_credit_note).toBe(true)
    expect(normalizeReturnSettings({ create_credit_note: 'false' }).create_credit_note).toBe(true)
    expect(normalizeReturnSettings({ create_credit_note: false }).create_credit_note).toBe(false)
  })

  it('falls back to skip when the fallback is not one of the two supported values', () => {
    expect(normalizeReturnSettings({ fallback_when_missing: 'negative_so' }).fallback_when_missing).toBe(
      'negative_so'
    )
    expect(normalizeReturnSettings({ fallback_when_missing: 'create_invoice' }).fallback_when_missing).toBe(
      'skip'
    )
  })

  it('caps the reason at 200 characters and ignores non-strings', () => {
    expect(normalizeReturnSettings({ reason: 'x'.repeat(500) }).reason).toHaveLength(200)
    expect(normalizeReturnSettings({ reason: 42 }).reason).toBe('')
  })
})

describe('isReturnModeEnabled', () => {
  it('is false only for the nothing mode', () => {
    expect(isReturnModeEnabled(DEFAULT_RETURN_SETTINGS)).toBe(false)
    expect(isReturnModeEnabled({ ...DEFAULT_RETURN_SETTINGS, mode: 'negative_so' })).toBe(true)
    expect(
      isReturnModeEnabled({ ...DEFAULT_RETURN_SETTINGS, mode: 'stock_return_credit_note' })
    ).toBe(true)
  })
})
