import crypto from 'crypto'

import { hkdfHex } from '@/lib/crypto'
import { secretMatches } from '@/lib/webhook-secret'

/**
 * Inbound authentication for Salla webhooks.
 *
 * ── Why Salla is not Zid's case, but still needs the fallback ────────────────
 *
 * Unlike Zid (which signs nothing), **Salla genuinely signs**. With
 * `webhook_security_strategy: "signature"` in the Partners Portal, every
 * delivery carries:
 *
 *   - `X-Salla-Security-Strategy: signature`
 *   - `X-Salla-Signature: <hex HMAC-SHA256 of the RAW request body>`
 *
 * verified with the app's webhook signing secret from the Portal. So the native
 * signature is the *preferred* check and this file verifies it first. Salla
 * assigns `signature` by default to every Partner App, so this is the shape our
 * app is actually in.
 *
 * ── The `token` strategy, and a documentation bug ───────────────────────────
 *
 * Salla supports a second strategy, `token`, where the credential is a
 * **static, auto-generated, reproducible token** compared as-is. Its docs
 * contradict themselves about where it arrives: the strategy table and the
 * AsyncAPI spec both say `Authorization`, while one prose paragraph claims a
 * "32 character SHA256 hash of the request body" in `X-Salla-Signature` — which
 * is the Signature section copied with the strategy name swapped, and cannot be
 * right, because a hash of *this* body cannot be a token stored ahead of time.
 * We follow the table and the spec: `Authorization`.
 *
 * This is defence in depth, not an outage fix. Our app is on `signature` by
 * default, so the HMAC path above was already the correct one — had a delivery
 * arrived under `token` we would simply have seen no `X-Salla-Signature` and
 * classified it `legacy`, which is survivable precisely because the body is only
 * a trigger. It is handled explicitly so that classification is `invalid` (401)
 * rather than `legacy` when a token is presented but wrong.
 *
 * **Why the derived header exists anyway.** The host never had
 * `SALLA_WEBHOOK_SECRET` set, and that turned every Salla delivery into a hard
 * 500 (the route returned 500 before parsing anything) — the same outage class
 * Odoo had. The Portal secret is also per-app and rotatable, and there is no
 * guaranteed way to add it to the Hostinger environment. So Salla's
 * `/webhooks/subscribe` accepts a `headers: [{ key, value }]` array per
 * subscription, which we use to attach a credential **derived from
 * `ENCRYPTION_KEY`** — already guaranteed in production because
 * `src/lib/crypto.ts` refuses to boot without it. What Salla stores is the HKDF
 * output; the key itself is never sent and never committed.
 *
 * Consequence: rotating `ENCRYPTION_KEY` invalidates the credential, so
 * subscriptions must be re-registered (POST /api/admin/salla-webhooks/refresh) —
 * the same operational note as `ENCRYPTION_LEGACY_KEYS`.
 *
 * ── The four outcomes ───────────────────────────────────────────────────────
 *
 * `ok`          a native signature verified, or the derived header matched.
 * `invalid`     a credential was presented and it was wrong → 401.
 * `legacy`      no verifiable credential was presented — a subscription created
 *               before the header existed, or a host without the env secret.
 *               Accepted (a hard reject would silently kill every store's sync)
 *               but never trusted for the destructive uninstall branch.
 * `unconfigured` nothing is derivable AND no env secret — development only;
 *               production refuses to boot without `ENCRYPTION_KEY`.
 */

/** The header Salla echoes back on every delivery for a given subscription. */
export const SALLA_DERIVED_HEADER_KEY = 'x-erplink-webhook-secret'

/** Domain separator: a different `info` yields an unrelated credential. */
const HKDF_INFO = 'salla-webhook-header:v1'
const DERIVED_SECRET_BYTES = 32

export interface SallaWebhookCredential {
  headerKey: string
  headerValue: string
}

function deriveSecret(): string | null {
  return hkdfHex(HKDF_INFO, [], DERIVED_SECRET_BYTES)
}

/**
 * The credential to register with Salla, or `null` when nothing can be derived
 * (`ENCRYPTION_KEY` unset — development only).
 *
 * An explicit `webhookSecret` (i.e. `SALLA_WEBHOOK_SECRET`) always wins, so an
 * operator who configures the native secret keeps full control of the header
 * value too.
 */
export function getSallaWebhookCredential(explicitSecret?: string): SallaWebhookCredential | null {
  const secret = explicitSecret?.trim() || deriveSecret()
  if (!secret) return null
  return { headerKey: SALLA_DERIVED_HEADER_KEY, headerValue: secret }
}

/** The Portal/app signing secret used for Salla's native HMAC, if configured. */
export function getSallaSigningSecret(): string {
  return process.env.SALLA_WEBHOOK_SECRET?.trim() || ''
}

/** Constant-time HMAC-SHA256 hex of the raw body — the Portal's algorithm. */
export function computeSallaSignature(rawBody: string, secret: string): string | null {
  if (!rawBody || !secret) return null
  try {
    return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  } catch {
    return null
  }
}

export type SallaWebhookAuthResult =
  | { status: 'ok'; method: 'signature' | 'token' | 'header' }
  | { status: 'invalid'; method: 'signature' | 'token' | 'header' }
  /** No verifiable credential presented — accepted, but counted and guarded. */
  | { status: 'legacy' }
  /** Nothing derivable and no env secret — dev only. */
  | { status: 'unconfigured' }

type HeaderReader = (name: string) => string | null | undefined

/**
 * Classify an inbound Salla delivery. Constant-time via `secretMatches`; never
 * logs or returns the credential itself.
 *
 * Order matters: the derived header is checked **first** because it is the one
 * credential we control end-to-end. A native credential is only attempted when
 * the host actually holds the Portal secret — otherwise a valid-looking
 * signature would be compared against nothing and every delivery would 401.
 *
 * The strategy header is honoured rather than guessed: under `token` the
 * credential is a static value in `Authorization` and must NOT be HMAC'd over
 * the body, so blindly hashing it is what would turn a legitimate token
 * delivery into a 401.
 */
export function verifySallaWebhookAuth(rawBody: string, getHeader: HeaderReader): SallaWebhookAuthResult {
  const providedHeader = (getHeader(SALLA_DERIVED_HEADER_KEY) ?? '').trim()
  const providedSignature = (
    getHeader('x-salla-signature') ??
    getHeader('salla-signature') ??
    ''
  ).trim()
  const providedToken = (
    getHeader('authorization') ??
    getHeader('x-salla-authorization') ??
    ''
  ).trim()
  const strategy = (getHeader('x-salla-security-strategy') ?? '').trim().toLowerCase()

  const credential = getSallaWebhookCredential()
  const signingSecret = getSallaSigningSecret()

  // ── 1. Derived header (the mechanism we control) ──────────────────────────
  if (providedHeader) {
    if (!credential) return { status: 'unconfigured' }
    return secretMatches(providedHeader, credential.headerValue)
      ? { status: 'ok', method: 'header' }
      : { status: 'invalid', method: 'header' }
  }

  // ── 2. The strategy Salla says it used ────────────────────────────────────
  if (strategy === 'token') {
    if (!providedToken) return credential ? { status: 'legacy' } : { status: 'unconfigured' }
    if (!signingSecret) {
      // A token is only verifiable against the Portal value we never received.
      return credential ? { status: 'legacy' } : { status: 'unconfigured' }
    }
    // Static comparison: a token is a reproducible value, not a body hash.
    return secretMatches(providedToken, signingSecret)
      ? { status: 'ok', method: 'token' }
      : { status: 'invalid', method: 'token' }
  }

  if (providedSignature) {
    if (!signingSecret) {
      // A signed delivery on a host with no Portal secret: nothing to verify it
      // against. Treat as legacy (accept + count), never as a hard failure —
      // failing closed here is exactly the outage this file exists to fix.
      return credential ? { status: 'legacy' } : { status: 'unconfigured' }
    }
    const expected = computeSallaSignature(rawBody, signingSecret)
    if (!expected) return { status: 'invalid', method: 'signature' }
    return secretMatches(providedSignature, expected)
      ? { status: 'ok', method: 'signature' }
      : { status: 'invalid', method: 'signature' }
  }

  // ── 3. Nothing presented ──────────────────────────────────────────────────
  return credential ? { status: 'legacy' } : { status: 'unconfigured' }
}

/**
 * A stable, non-reversible tag for the active credential, safe to log so an
 * operator can tell which credential a delivery was checked against.
 */
export function sallaWebhookCredentialFingerprint(): string {
  const credential = getSallaWebhookCredential()
  if (!credential) return 'none'
  return crypto.createHash('sha256').update(credential.headerValue).digest('hex').slice(0, 12)
}

/**
 * تحليل طوابع وقت التسليم من سالا — أرقام epoch بالثواني (الشكل الأكثر
 * شيوعاً في حقول `created_at`/`timestamp` الرقمية)، أو أرقام بالميلي ثانية،
 * أو نصوص ISO. سابقاً كانت `new Date(String(raw))` تُرجع NaN للرقم 1737000000
 * لأن String() من رقم ثوانٍ ليس صيغة تاريخ صالحة، فالمقارنة القديمة كانت
 * تُسقط فحص staleness للأشكال الرقمية. تُرجع NaN عندما لا يمكن التحليل.
 */
export function parseSallaTimestampMs(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw
  }
  const s = String(raw ?? '').trim()
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return n < 1e12 ? n * 1000 : n
  }
  const t = new Date(s).getTime()
  return Number.isFinite(t) ? t : NaN
}
