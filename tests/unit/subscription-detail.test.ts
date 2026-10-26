import { readFileSync } from 'fs'
import path from 'path'

/**
 * The admin subscriptions panel is an Odoo-style list plus one page per
 * subscription at `/admin/subscriptions/<id>`.
 *
 * Two rules make that split real, and both are easy to undo by accident:
 *
 * 1. The list stays cheap — it reads the workspace/user/subscription columns it
 *    prints and nothing else. The payment ledger and the workspace's other
 *    subscriptions belong to the record page.
 * 2. The record page is reachable by id — the row navigates to a URL that
 *    contains the subscription id, and a row with no subscription (`id === ''`)
 *    must not navigate at all, because there is nothing to open.
 *
 * These are source pins, not behaviour tests: the action needs Clerk and
 * Supabase to run. Each was checked to fail when the rule is reverted.
 */

const root = path.resolve(__dirname, '../..')
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8')

const actions = read('src', 'app', 'actions', 'subscription-actions.ts')
const listClient = read('src', 'app', '(app)', 'admin', 'subscriptions', 'AdminSubscriptionsClient.tsx')
const detailClient = read(
  'src',
  'app',
  '(app)',
  'admin',
  'subscriptions',
  '[id]',
  'subscription-detail-client.tsx',
)
const detailPage = read('src', 'app', '(app)', 'admin', 'subscriptions', '[id]', 'page.tsx')
const sharedUi = read('src', 'app', '(app)', 'admin', 'subscriptions', 'subscription-ui.ts')

/** The detail action only: starts after its JSDoc so comments cannot satisfy a pin. */
const detailFn = actions.slice(
  actions.indexOf('export async function getSubscriptionDetail'),
  actions.indexOf('export async function searchUsersByEmail'),
)

/** The list action only — no payments query may sneak back in here. */
const listFn = actions.slice(
  actions.indexOf('export async function getAllSubscriptions'),
  actions.indexOf('// ──────────────────────── Admin: one subscription record'),
)

describe('the record page is admin-only and reaches no query before it checks', () => {
  it('found the detail action', () => {
    expect(detailFn.length).toBeGreaterThan(500)
    expect(detailFn).toContain('export async function getSubscriptionDetail')
  })

  it('requires admin before the first database read', () => {
    const guardAt = detailFn.indexOf('await requireAdmin()')
    const firstQueryAt = detailFn.indexOf('.from(')
    expect(guardAt).toBeGreaterThan(-1)
    expect(firstQueryAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(firstQueryAt)
  })

  it('rejects a non-uuid before it can reach Postgres', () => {
    const shapeAt = detailFn.indexOf('!SUBSCRIPTION_UUID_RE.test(subscriptionId)')
    const firstQueryAt = detailFn.indexOf('.from(')
    expect(shapeAt).toBeGreaterThan(-1)
    expect(shapeAt).toBeLessThan(firstQueryAt)
    expect(detailFn).toContain("error: 'not_found'")
  })

  it('never selects users.phone, which is missing in some environments', () => {
    // Selecting it takes the whole record read down with
    // `column users.phone does not exist`.
    expect(detailFn).not.toContain('phone')
    expect(detailFn).toContain(
      "supabase.from('users').select('id, name, email').eq('id', sub.user_id).maybeSingle()",
    )
  })
})

describe('the record page is the only reader of the payments ledger', () => {
  it('reads payments scoped to this subscription', () => {
    expect(detailFn).toContain(".from('subscription_payments')")
    expect(detailFn).toContain(".eq('subscription_id', subscriptionId)")
  })

  it('does not read payments for the list', () => {
    expect(listFn.length).toBeGreaterThan(500)
    expect(listFn).not.toContain('subscription_payments')
  })

  it('lists the workspace subscriptions without repeating the open one', () => {
    expect(detailFn).toContain('.filter((row) => row.id !== subscriptionId)')
  })

  it('re-derives expiry per row instead of trusting a stored flag', () => {
    expect(detailFn).toContain('daysRemaining: daysUntilExpiry(row.end_date)')
    expect(detailFn).toContain('isExpired: isSubscriptionExpired(sub)')
  })
})

describe('the list opens a record by id, and only when there is one', () => {
  it('navigates to the id-scoped URL', () => {
    expect(listClient).toContain('router.push(`/admin/subscriptions/${row.id}`)')
  })

  it('a row with no subscription opens the register modal', () => {
    const openRecord = listClient.slice(listClient.indexOf('const openRecord ='))
    expect(openRecord.slice(0, 200)).toContain('if (!row.id) {')
    expect(openRecord.slice(0, 200)).toContain('openRegisterFor(row)')
  })

  it('has a per-row action menu that never navigates as a side effect', () => {
    expect(listClient).toContain('function RowActions(')
    expect(listClient).toContain("aria-haspopup=\"menu\"")
    expect(listClient).toContain('event.stopPropagation()')
    expect(listClient).toContain("isAr ? 'إجراءات' : 'Actions'")
  })

  it('keeps registering available where extending makes no sense', () => {
    expect(listClient).toContain('const needsRegister =')
    expect(listClient).toContain("isAr ? 'تسجيل اشتراك' : 'Register'")
  })
})

describe('the record page rejects a bad id and re-reads on every visit', () => {
  it('is dynamic, because every action on it writes', () => {
    expect(detailPage).toContain("export const dynamic = 'force-dynamic'")
  })

  it('guards the route with the admin check', () => {
    expect(detailPage).toContain('if (!userId || !isAdmin(userId)) redirect')
  })

  it('renders a not-found state instead of throwing', () => {
    expect(detailPage).toContain('if (!result.success || !result.detail)')
    expect(detailPage).toContain("'Subscription not found'")
  })

  it('prints the id in the breadcrumb, so the URL segment is visible', () => {
    expect(detailClient).toContain('{sub.id.slice(0, 8)}')
  })
})

describe('labels and money format are shared, so list and record cannot disagree', () => {
  it('the shared module owns the three helpers', () => {
    expect(sharedUi).toContain('export function formatSubDate(')
    expect(sharedUi).toContain('export function formatSubDateTime(')
    expect(sharedUi).toContain('export function formatMoney(')
    expect(sharedUi).toContain('export function subscriptionStateMeta(')
  })

  it('both surfaces import them instead of defining their own', () => {
    expect(listClient).toContain("from './subscription-ui'")
    expect(detailClient).toContain("from '../subscription-ui'")
    expect(listClient).not.toContain('const MONTHS_AR')
    expect(detailClient).not.toContain('const MONTHS_AR')
  })
})

describe('the ordering assertions are not vacuous', () => {
  it('detects a guard placed after the query', () => {
    const wrong = "const { data } = await supabase.from('subscriptions').select('*')\nawait requireAdmin()"
    expect(wrong.indexOf('await requireAdmin()')).toBeGreaterThan(wrong.indexOf('.from('))
  })

  it('detects the removed phone column', () => {
    const bad = "supabase.from('users').select('id, name, email, phone')"
    expect(bad).toContain('phone')
    expect(detailFn).not.toContain('phone')
  })
})
