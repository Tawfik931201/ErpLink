/**
 * Strict webhook auth toggle.
 *
 * When `STRICT_WEBHOOK_AUTH=true` (or `1`), deliveries classified as
 * `legacy` (no credential — webhook registered before the derived secret
 * existed) are rejected with 401 instead of accepted+counted.
 *
 * Fail closed by default in production; existing subscriptions must be
 * re-registered with credentials before deployment. Explicitly setting
 * STRICT_WEBHOOK_AUTH=false allows temporary legacy migration only.
 * Development keeps the previous relaxed default for test subscriptions.
 */
export function isStrictWebhookAuth(): boolean {
  const v = (process.env.STRICT_WEBHOOK_AUTH ?? '').trim().toLowerCase()
  if (!v) return process.env.NODE_ENV === 'production'
  return v === 'true' || v === '1' || v === 'yes'
}

/** Max webhook raw-body size accepted before parsing (1 MB). */
export const MAX_WEBHOOK_BODY_BYTES = 1_000_000

export function isWebhookBodyTooLarge(rawBody: string): boolean {
  return Buffer.byteLength(rawBody || '', 'utf8') > MAX_WEBHOOK_BODY_BYTES
}
