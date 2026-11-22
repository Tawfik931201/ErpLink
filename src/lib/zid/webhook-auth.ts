import crypto from 'crypto'

import { hkdfHex } from '@/lib/crypto'
import { secretMatches } from '@/lib/webhook-secret'

/**
 * Inbound authentication for Zid webhooks.
 *
 * ── Why this file exists (do not "simplify" it back to an HMAC) ────────────
 *
 * Zid sends **no signature**. The previous implementation verified an
 * `X-Zid-Signature` HMAC-SHA256 header, which Zid never sends, and the
 * registration call passed a `secret` field that is not part of Zid's webhook
 * schema (docs.zid.sa/create-a-webhook lists exactly: `event`, `target_url`,
 * `original_id`, `conditions`, `username`, `password`). Both halves were
 * fiction, so no delivery could ever authenticate.
 *
 * Zid's one documented inbound mechanism is **HTTP Basic**: if `username` and
 * `password` are supplied when the webhook is created, Zid sends
 * `Authorization: Basic base64(username:password)` with every delivery
 * ("This allows partners to verify that the webhook request is coming from
 * Zid"). Those credentials are stored **per webhook at creation time**, so a
 * webhook created before this mechanism existed keeps delivering unsigned —
 * every store must be re-registered (see `POST /api/admin/zid-webhooks/refresh`).
 *
 * ── Why the credential is derived, not configured ───────────────────────────
 *
 * `ZID_WEBHOOK_SECRET` was never set in production, which turned every
 * delivery into a hard 500 (commit 0919a08). Rather than require another env
 * var, the credential is derived from `ENCRYPTION_KEY` — already guaranteed in
 * production because `src/lib/crypto.ts` refuses to boot without it. What is
 * handed to Zid is an HKDF output, not the key itself, and no secret is ever
 * committed to the repository.
 *
 * Operational consequence: rotating `ENCRYPTION_KEY` invalidates the
 * credential, so webhooks must be re-registered afterwards — the same
 * operational note as `ENCRYPTION_LEGACY_KEYS`, different key.
 */

/** Not a secret — Zid only needs a username; the password is the secret half. */
const WEBHOOK_AUTH_USERNAME = 'zid'

/** Domain separator: a different `info` yields an unrelated password. */
const HKDF_INFO = 'zid-webhook-basic-auth:v1'
const DERIVED_PASSWORD_BYTES = 32

export interface ZidWebhookCredential {
  username: string
  password: string
  /** Full header value Zid sends: `Basic <base64(username:password)>`. */
  headerValue: string
  /** base64 payload only, for comparison against a scheme-less header. */
  encoded: string
}

const MERCHANT_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/

/**
 * Per-merchant credentials are distinct across workspaces / stores. Keeping
 * the legacy v1 derivation (when merchantId is omitted) lets operators migrate
 * existing registrations under an explicit temporary compatibility toggle.
 */
function derivePassword(merchantId?: string): string | null {
  if (merchantId !== undefined) {
    if (!MERCHANT_ID_RE.test(merchantId)) return null
    return hkdfHex('zid-webhook-basic-auth:merchant:v2', [merchantId], DERIVED_PASSWORD_BYTES)
  }
  return hkdfHex(HKDF_INFO, [], DERIVED_PASSWORD_BYTES)
}

/**
 * The credential to register with Zid, or `null` when nothing can be derived
 * (`ENCRYPTION_KEY` unset — development only; production refuses to boot).
 */
export function getZidWebhookCredential(merchantId?: string): ZidWebhookCredential | null {
  const password = derivePassword(merchantId)
  if (!password) return null

  const username = WEBHOOK_AUTH_USERNAME
  const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64')

  return { username, password, headerValue: `Basic ${encoded}`, encoded }
}

export type ZidWebhookAuthResult =
  /** Authorization header present and matches the derived credential. */
  | { status: 'ok' }
  /** Header present but wrong → 401. */
  | { status: 'invalid' }
  /** No Authorization header at all: a webhook created before Basic Auth existed. */
  | { status: 'legacy' }
  /** No credential derivable (no `ENCRYPTION_KEY`) — dev only. */
  | { status: 'unconfigured' }

/**
 * Classify an inbound `Authorization` header. Constant-time via
 * `secretMatches`; never logs or returns the credential itself.
 */
export function verifyZidWebhookAuthorization(
  authorizationHeader: string | null | undefined,
  merchantId?: string
): ZidWebhookAuthResult {
  // The ingress route supplies the exact merchant id from its registered URL.
  // An empty string must NOT silently downgrade to the shared legacy secret.
  const credential = getZidWebhookCredential(merchantId)
  const provided = (authorizationHeader ?? '').trim()

  if (!provided) return credential ? { status: 'legacy' } : { status: 'unconfigured' }
  if (!credential) return process.env.ENCRYPTION_KEY ? { status: 'invalid' } : { status: 'unconfigured' }

  const scheme = /^basic\s+(.+)$/i.exec(provided)
  const candidates = scheme ? [provided, scheme[1].trim()] : [provided]
  for (const candidate of candidates) {
    if (secretMatches(candidate, credential.headerValue)) return { status: 'ok' }
    if (secretMatches(candidate, credential.encoded)) return { status: 'ok' }
  }

  // Explicit, short-lived migration escape hatch ONLY. Default rejects
  // cross-store replay of the old application-wide Basic credential.
  if (merchantId !== undefined && process.env.ZID_ACCEPT_LEGACY_GLOBAL_BASIC_AUTH === 'true') {
    const legacy = getZidWebhookCredential()
    if (legacy && candidates.some(candidate =>
      secretMatches(candidate, legacy.headerValue) || secretMatches(candidate, legacy.encoded)
    )) return { status: 'ok' }
  }

  return { status: 'invalid' }
}

/**
 * A stable, non-reversible tag for the active credential, safe to log so an
 * operator can tell which credential a delivery was checked against.
 */
export function zidWebhookCredentialFingerprint(merchantId?: string): string {
  const credential = getZidWebhookCredential(merchantId)
  if (!credential) return 'none'
  return crypto.createHash('sha256').update(credential.encoded).digest('hex').slice(0, 12)
}