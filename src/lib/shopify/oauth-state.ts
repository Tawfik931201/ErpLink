import crypto from 'crypto'

/**
 * Binds a Shopify OAuth authorization attempt to the signed-in Clerk user,
 * the exact store and the workspace selected before leaving ERP Link.
 *
 * The state sent to Shopify is a random nonce only. The bound identities
 * stay in an HttpOnly, short-lived HMAC-signed cookie.
 */
export const SHOPIFY_OAUTH_COOKIE = 'shopify_oauth_context'
export const SHOPIFY_OAUTH_MAX_AGE_SECONDS = 10 * 60

export interface ShopifyOAuthContext {
  state: string
  shop: string
  userId: string
  workspaceId: string
  expiresAt: number
}

const signatureFor = (encoded: string, secret: string): string =>
  crypto.createHmac('sha256', secret).update(encoded).digest('base64url')

export function createShopifyOAuthContext(
  input: Pick<ShopifyOAuthContext, 'shop' | 'userId' | 'workspaceId'>,
  secret: string,
  now: number = Date.now()
): { state: string; cookie: string } {
  if (!secret || !input.shop || !input.userId || !input.workspaceId) {
    throw new Error('Missing Shopify OAuth binding')
  }
  const context: ShopifyOAuthContext = {
    ...input,
    state: crypto.randomBytes(32).toString('hex'),
    expiresAt: now + SHOPIFY_OAUTH_MAX_AGE_SECONDS * 1000,
  }
  const encoded = Buffer.from(JSON.stringify(context), 'utf8').toString('base64url')
  return { state: context.state, cookie: encoded + '.' + signatureFor(encoded, secret) }
}

export function readShopifyOAuthContext(
  cookie: string | undefined,
  secret: string,
  expected: { state: string; shop: string },
  now: number = Date.now()
): ShopifyOAuthContext | null {
  if (!cookie || !secret || !expected.state || !expected.shop) return null
  const pieces = cookie.split('.')
  if (pieces.length !== 2) return null

  const [encoded, receivedSignature] = pieces
  if (!encoded || !receivedSignature || encoded.length > 4096) return null

  const expectedSignature = signatureFor(encoded, secret)
  const a = Buffer.from(receivedSignature, 'utf8')
  const b = Buffer.from(expectedSignature, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  try {
    const ctx = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ShopifyOAuthContext
    if (
      !ctx ||
      typeof ctx.state !== 'string' ||
      typeof ctx.shop !== 'string' ||
      typeof ctx.userId !== 'string' ||
      typeof ctx.workspaceId !== 'string' ||
      !ctx.userId || !ctx.workspaceId ||
      !Number.isFinite(ctx.expiresAt) ||
      ctx.expiresAt <= now ||
      ctx.expiresAt > now + SHOPIFY_OAUTH_MAX_AGE_SECONDS * 1000
    ) return null
    const providedState = Buffer.from(expected.state, 'utf8')
    const storedState = Buffer.from(ctx.state, 'utf8')
    if (providedState.length !== storedState.length ||
        !crypto.timingSafeEqual(providedState, storedState) ||
        ctx.shop !== expected.shop) return null
    return ctx
  } catch {
    return null
  }
}
