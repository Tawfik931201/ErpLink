import { createHash } from 'crypto'

import { hkdfHex } from '@/lib/crypto'
import { secretMatches } from '@/lib/webhook-secret'
import { isStrictWebhookAuth } from '@/lib/webhook-strict'

/**
 * Inbound authentication for Odoo → store webhooks.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `ODOO_WEBHOOK_SECRET` was never set in production, and both Odoo receivers
 * refuse an unconfigured secret with a 500 (added in ab55dae, 2026-09-28). Every
 * stock movement and every record change coming out of a customer's Odoo has
 * been rejected since — enabling "مزامنة المخزون" in the Mapping Center creates
 * the Automated Action, the action fires, and the request is discarded.
 *
 * Setting the env var alone does **not** fix it, and that is the trap: this app
 * writes the destination URL itself (`src/lib/odoo-webhook.ts`) and it never
 * contained a secret, so no Odoo delivery has ever carried one. Turning the
 * var on turns the 500 into a 401 for every single delivery.
 *
 * ── The scheme ─────────────────────────────────────────────────────────────
 *
 * 1. The **scope** is the identifier the delivery already puts in the URL —
 *    `workspace_id` for `/odoo/stock`, `field_mapping_id` for `/odoo`. Using
 *    the identifier itself as the secret would be worthless (it is printed in
 *    the URL, in Odoo's own records and in our access logs), so it is instead
 *    fed into HKDF as a *scope*: the secret is unreadable without
 *    `ENCRYPTION_KEY`, and it differs per workspace and per mapping. One tenant
 *    cannot forge a delivery for another tenant, and a stock secret cannot be
 *    replayed against the record endpoint.
 * 2. The secret is derived, never configured — no new env var, and
 *    `ENCRYPTION_KEY` is already guaranteed in production because `crypto.ts`
 *    refuses to boot without it.
 * 3. `src/lib/odoo-webhook.ts` appends it to the URL it registers, so **newly**
 *    registered Automated Actions are authenticated with zero per-tenant work.
 *
 * ── The migration window ────────────────────────────────────────────────────
 *
 * Actions registered before this change keep posting to a URL with no secret,
 * and no server-side configuration can add one to them — the URL lives in the
 * customer's Odoo database. A hard 401 would silently kill every tenant's sync
 * until someone re-registered it, which with dozens of tenants is exactly the
 * kind of silent breakage to avoid. So a delivery with **no** secret is
 * classified `legacy`, accepted, counted and logged; a delivery with a **wrong**
 * secret is rejected.
 *
 * That window is safe only because of the read-back rule in
 * `src/app/api/webhooks/odoo/route.ts`: the body is a trigger, never a source
 * of values, and the stock engine re-reads the balance from the tenant's own
 * Odoo. An unauthenticated caller can therefore cause a redundant re-push of a
 * tenant's own real data, but cannot invent a price, a title or a quantity. The
 * one residual is the deletion branch — it needs a valid `field_mapping_id`
 * (an unguessable UUID) and it is logged.
 *
 * Operational consequence: rotating `ENCRYPTION_KEY` invalidates every derived
 * secret, so all actions must be re-registered afterwards — same operational
 * class as `ENCRYPTION_LEGACY_KEYS`.
 */

/** Domain separator — distinct from the Zid Basic credential's. */
const HKDF_PURPOSE = 'odoo-webhook-secret:v1'

/** Scope prefix for the stock receiver, so its secret is useless elsewhere. */
export const ODOO_STOCK_SCOPE_PREFIX = 'stock'
/** Scope prefix for the record receiver. */
export const ODOO_RECORD_SCOPE_PREFIX = 'record'

/** Scope for `/api/webhooks/odoo/stock?workspace_id=…`. */
export function odooStockSecretScope(workspaceId: string, resource?: string | null): string {
  const scope = `${ODOO_STOCK_SCOPE_PREFIX}:${workspaceId}`
  return resource ? `${scope}:${resource}` : scope
}

export function odooStockWebhookResource(url: string, database: string): string {
  return createHash('sha256').update(JSON.stringify([url, database])).digest('hex')
}

/** Scope for `/api/webhooks/odoo?field_mapping_id=…`. */
export function odooRecordSecretScope(fieldMappingId: string): string {
  return `${ODOO_RECORD_SCOPE_PREFIX}:${fieldMappingId}`
}

/**
 * The secret for a scope, or `null` when nothing can be derived (no
 * `ENCRYPTION_KEY` — development only; production refuses to boot without it).
 */
export function deriveOdooWebhookSecret(scope: string): string | null {
  if (!scope || !scope.includes(':')) return null
  return hkdfHex(HKDF_PURPOSE, [scope])
}

/**
 * Appends `&secret=…` to a webhook path so the Automated Action we register in
 * a customer's Odoo authenticates itself. Returns the path unchanged when no
 * secret can be derived — in development that keeps registration working, and
 * the ingress treats the result as `legacy`.
 */
export function withOdooWebhookSecret(webhookPath: string, scope: string): string {
  const secret = deriveOdooWebhookSecret(scope)
  if (!secret) return webhookPath
  const separator = webhookPath.includes('?') ? '&' : '?'
  return `${webhookPath}${separator}secret=${encodeURIComponent(secret)}`
}

export type OdooWebhookAuthResult =
  /** A secret was supplied and matches the one derived for this scope. */
  | { status: 'ok' }
  /** A secret was supplied but is wrong → 401. */
  | { status: 'invalid' }
  /** No secret at all: an Automated Action registered before this change. */
  | { status: 'legacy' }
  /** No secret derivable (no `ENCRYPTION_KEY`) — development only. */
  | { status: 'unconfigured' }

/** Total deliveries accepted without a secret, per process (log-throttle only). */
const legacyCounts = new Map<string, number>()

/**
 * Logs the first three unauthenticated deliveries per scope, then every 50th.
 * Also bumps the durable DB counter — the in-process copy resets on every
 * restart, so the "counter reached zero" signal that decides when the legacy
 * window closes must come from `webhook_legacy_counters`, never from here.
 * Fire-and-forget: a counter failure never affects the delivery.
 */
export function noteLegacyOdooDelivery(scope: string): number {
  const next = (legacyCounts.get(scope) ?? 0) + 1
  legacyCounts.set(scope, next)
  if (next <= 3 || next % 50 === 0) {
    console.warn(
      `[Odoo Webhook] Unauthenticated delivery #${next} for scope ${scope}. ` +
        'Its Automated Action was registered without a secret — re-register it ' +
        '(POST /api/admin/odoo-webhooks/refresh) and the durable counter should reach zero.'
    )
  }
  void import('@/lib/legacy-delivery-counter')
    .then(({ incrementLegacyDelivery }) => incrementLegacyDelivery('odoo', scope))
    .catch(() => {})
  return next
}

/** Test seam: how many unauthenticated deliveries were accepted per scope. */
export function legacyOdooDeliveryCounts(): Record<string, number> {
  return Object.fromEntries(legacyCounts)
}

/**
 * Classify a delivery. Constant-time via `secretMatches`; the secret itself is
 * never logged or returned.
 *
 * `provided` is whatever the caller sent — the query string (`?secret=`), the
 * `x-odoo-secret` header, or a Bearer token. Empty means "legacy".
 *
 * In practice only the query string is reachable: Odoo's Automated Action URL
 * is a plain query string, so `?secret=` is the one shape the app can actually
 * register. The header and Bearer forms exist because they cost nothing and
 * would work for anyone driving the receiver with a real HTTP client.
 */
export function verifyOdooWebhookSecret(
  scope: string,
  provided: string | null | undefined
): OdooWebhookAuthResult {
  const secret = deriveOdooWebhookSecret(scope)
  const value = (provided ?? '').trim()

  if (!value) return secret ? { status: 'legacy' } : { status: 'unconfigured' }
  if (!secret) return { status: 'unconfigured' }

  return secretMatches(value, secret) ? { status: 'ok' } : { status: 'invalid' }
}

/**
 * Pulls the caller's secret out of a request-shaped set of headers/query
 * values. Query string stays supported because that is what already-deployed
 * Automated Actions use; prefer the header when registering new ones.
 */
export function extractOdooProvidedSecret(input: {
  authorization?: string | null
  headerSecret?: string | null
  querySecret?: string | null
  token?: string | null
}): string {
  const bearer = (input.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
  const header = (input.headerSecret ?? '').trim()
  const query = (input.querySecret ?? input.token ?? '').trim()
  return bearer || header || query
}

export type OdooWebhookAuthDecision =
  | { action: 'allow'; status: OdooWebhookAuthResult['status'] }
  | { action: 'reject'; status: 401 | 500; error: string }

/**
 * The single ingress policy for both Odoo receivers, so the two routes cannot
 * drift apart:
 *
 * - `invalid`      → 401. A caller guessed, or a scope was replayed.
 * - `unconfigured` → 500 in production (nothing can ever authenticate), allowed
 *                    in development, which is the one case where skipping
 *                    verification is harmless.
 * - `legacy`       → rejected by default in production. Development and explicit
 *                    temporary migration overrides count and accept legacy
 *                    triggers; re-register actions to close the window.
 */
export function decideOdooWebhookAuth(
  result: OdooWebhookAuthResult,
  scope: string
): OdooWebhookAuthDecision {
  if (result.status === 'invalid') {
    return {
      action: 'reject',
      status: 401,
      error: 'Unauthorized: Invalid or missing Odoo webhook secret',
    }
  }

  // Match Zid/Salla: no unsigned legacy webhooks in production by default.
  // Only an EXPLICIT temporary STRICT_WEBHOOK_AUTH=false can authorize
  // backwards compatibility while re-registering old Odoo Automated Actions.
  // This check must precede ALL untrusted record/stock processing.
  if (result.status === 'legacy') {
    if (isStrictWebhookAuth()) {
      return {
        action: 'reject',
        status: 401,
        error: 'Unauthorized: webhook not re-registered (legacy delivery rejected)',
      }
    }
  }

  if (result.status === 'unconfigured') {
    if (process.env.NODE_ENV !== 'production') return { action: 'allow', status: result.status }
    console.error(
      '[Odoo Webhook] Security Alert: no ingress secret is derivable because ENCRYPTION_KEY is unset.'
    )
    return { action: 'reject', status: 500, error: 'Webhook secret not configured on server' }
  }

  if (result.status === 'legacy') noteLegacyOdooDelivery(scope)
  // التصنيف يصعد مع القرار: فرع "السجل غير موجود" في مسار الاستقبال يمنع
  // الحذف المبني على قيمة من جسم غير مصادق (انظر route.ts runBackgroundSync).
  return { action: 'allow', status: result.status }
}

/** Convenience: pull the caller's secret and apply the policy in one call. */
export function authorizeOdooWebhook(input: {
  scope: string
  authorization?: string | null
  headerSecret?: string | null
  querySecret?: string | null
  token?: string | null
}): OdooWebhookAuthDecision {
  const provided = extractOdooProvidedSecret(input)
  return decideOdooWebhookAuth(verifyOdooWebhookSecret(input.scope, provided), input.scope)
}

/**
 * A stable, non-reversible tag for a scope's active secret, safe to log so an
 * operator can tell which credential a delivery was checked against.
 */
export function odooWebhookSecretFingerprint(scope: string): string {
  const secret = deriveOdooWebhookSecret(scope)
  if (!secret) return 'none'
  return secret.slice(0, 12)
}
