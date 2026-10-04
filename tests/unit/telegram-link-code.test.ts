import {
  extractLinkCode,
  isValidLinkCodeFormat,
  looksLikeLinkAttempt,
} from '@/lib/telegram/link-code'

describe('the Telegram link-code parser', () => {
  it('reads the code out of the canonical /start command', () => {
    // This is the exact shape the UI tells the customer to send.
    expect(extractLinkCode('/start 8WRVXQ')).toBe('8WRVXQ')
    expect(looksLikeLinkAttempt('/start 8WRVXQ')).toBe(true)
  })

  it('tolerates the ways a person actually types it', () => {
    expect(extractLinkCode('/start 8WRVXQ hello')).toBe('8WRVXQ')
    expect(extractLinkCode('/start@MyErpBot 8WRVXQ')).toBe('8WRVXQ')
    expect(extractLinkCode('8WRVXQ')).toBe('8WRVXQ')
    expect(extractLinkCode('abc 8wrvxq')).toBe('8WRVXQ')
    expect(extractLinkCode('  /start   8WRVXQ  ')).toBe('8WRVXQ')
  })

  it('reports no code when there is none', () => {
    expect(extractLinkCode('/start')).toBeNull()
    expect(extractLinkCode('مرحبا')).toBeNull()
    expect(extractLinkCode('')).toBeNull()
  })

  it('still treats a bare /start as a link attempt, so the bot can help', () => {
    // Otherwise the chat sees complete silence, which is the least useful
    // possible answer when someone is trying to connect.
    expect(looksLikeLinkAttempt('/start')).toBe(true)
    expect(looksLikeLinkAttempt('hello there')).toBe(false)
  })

  it('rejects codes that the generator can never produce', () => {
    // The generator's alphabet omits I, O, 0 and 1, so anything containing them
    // is not one of our codes. Accepting it would only cause a pointless
    // database lookup and a wrong "invalid code" reply.
    expect(isValidLinkCodeFormat('8WRVXQ')).toBe(true)
    expect(isValidLinkCodeFormat('IO0O1I')).toBe(false)
    expect(isValidLinkCodeFormat('8WRVX')).toBe(false)
    expect(isValidLinkCodeFormat('8WRVXQQ')).toBe(false)
    expect(extractLinkCode('/start IO0O1I')).toBeNull()
  })
})