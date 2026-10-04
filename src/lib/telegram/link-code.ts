/**
 * Parsing rules for the Telegram `/start <code>` chat-link handshake.
 *
 * Pure on purpose: the poller that uses it talks to Supabase and to the
 * Telegram API, so this rule is kept in a module with no imports at all and
 * pinned by `tests/unit/telegram-link-code.test.ts`. That test is the only
 * cheap way to prove a *correct* code is still recognised — when the chat
 * refuses to link, this function is the first thing to suspect.
 */

/** Codes are 6 characters from an unambiguous alphabet (no I, O, 0, 1). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

const CODE_PATTERN = /\b[A-Z0-9]{6}\b/i

/** `/start`, with or without an `@botname` suffix. */
const START_COMMAND = /^\/start(@\w+)?\s*/i

export function isValidLinkCodeFormat(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return false
  return true
}

/**
 * The link code in an incoming message, or `null` when there is none.
 *
 * Deliberately lenient about everything except the code itself, because a
 * person typing into a chat bot will get the shape wrong in predictable ways:
 *
 *   `/start 8WRVXQ`        the canonical form
 *   `/start@MyBot 8WRVXQ`  targeted command, e.g. from a group
 *   `/start 8WRVXQ hello`  extra words after it
 *   `8WRVXQ`               sent on its own, which the bot also accepts
 *   `abc 8wrvxq`           lower case
 */
export function extractLinkCode(text: string): string | null {
  const cleaned = text.replace(START_COMMAND, '').trim()
  const match = cleaned.match(CODE_PATTERN)
  if (!match) return null

  const code = match[0].toUpperCase()
  return isValidLinkCodeFormat(code) ? code : null
}

/**
 * Whether a message is worth treating as a link attempt at all. A plain
 * `/start` with no code still is: the bot answers it with usage instructions
 * instead of staying silent.
 */
export function looksLikeLinkAttempt(text: string): boolean {
  return /^\/start/i.test(text) || CODE_PATTERN.test(text)
}