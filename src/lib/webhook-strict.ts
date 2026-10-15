/**
 * Strict webhook auth toggle.
 *
 * When `STRICT_WEBHOOK_AUTH=true` (or `1`), deliveries classified as
 * `legacy` (no credential — webhook registered before the derived secret
 * existed) are rejected with 401 instead of accepted+counted.
 *
 * Default is `false` so existing stores keep syncing while the operator
 * re-registers webhooks (POST /api/admin/*-refresh). Flip it to `true`
 * once the `Unauthenticated delivery #N` counters reach zero.
 *
 * ngrok/testing note: keep it unset (or `false`) while URLs are temporary.
 */
export function isStrictWebhookAuth(): boolean {
  const v = (process.env.STRICT_WEBHOOK_AUTH ?? '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** Max webhook raw-body size accepted before parsing (1 MB). */
export const MAX_WEBHOOK_BODY_BYTES = 1_000_000

export function isWebhookBodyTooLarge(rawBody: string): boolean {
  return Buffer.byteLength(rawBody || '', 'utf8') > MAX_WEBHOOK_BODY_BYTES
}
