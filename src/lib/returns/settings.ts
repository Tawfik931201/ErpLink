import {
  DEFAULT_RETURN_SETTINGS,
  type ReturnFallback,
  type ReturnMode,
  type ReturnSettings,
} from './detect'

const MODES: ReturnMode[] = ['nothing', 'negative_so', 'stock_return_credit_note']
const FALLBACKS: ReturnFallback[] = ['skip', 'negative_so']

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Normalise `standard_mapping_settings.order.returns`.
 *
 * Every default is deliberately inert: a workspace that never opened the
 * returns controls must keep behaving exactly as it did before this feature
 * existed, so an unreadable/absent config resolves to `mode: 'nothing'`.
 */
export function normalizeReturnSettings(raw: unknown): ReturnSettings {
  const value = toRecord(raw)
  const mode = MODES.includes(value.mode as ReturnMode)
    ? (value.mode as ReturnMode)
    : DEFAULT_RETURN_SETTINGS.mode
  const fallback = FALLBACKS.includes(value.fallback_when_missing as ReturnFallback)
    ? (value.fallback_when_missing as ReturnFallback)
    : DEFAULT_RETURN_SETTINGS.fallback_when_missing
  const journalId = Number(value.credit_note_journal_id)
  const reasonType = value.reason_type === 'custom' ? 'custom' : 'store_reason'
  return {
    mode,
    create_credit_note:
      typeof value.create_credit_note === 'boolean'
        ? value.create_credit_note
        : DEFAULT_RETURN_SETTINGS.create_credit_note,
    credit_note_journal_id:
      Number.isInteger(journalId) && journalId > 0 ? journalId : null,
    fallback_when_missing: fallback,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 200) : '',
    reason_type: reasonType,
  }
}

export function isReturnModeEnabled(settings: ReturnSettings): boolean {
  return settings.mode !== 'nothing'
}
