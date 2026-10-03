/**
 * Pins the Odoo → store trust rule in src/app/api/webhooks/odoo/route.ts.
 *
 * `ODOO_WEBHOOK_SECRET` is one shared secret that every customer's Odoo knows,
 * so a caller holding it is not necessarily the tenant that owns the record
 * being pushed. The rule the endpoint must keep:
 *
 *   read() returned the record → the record is the only source of truth, for
 *   field values AND for the removal signal.
 *   read() returned empty        → the record is genuinely gone; that is the
 *   deletion flow, and the body is all that is left.
 *   read() threw                 → nothing is verified, so the job fails and
 *   retries rather than trusting the body.
 *
 * These are source-level assertions. The function is a private helper inside a
 * 1100-line route that reaches for the Supabase client, Odoo XML-RPC, three
 * store clients and the sync queue, so there is no way to execute it in
 * isolation; what is pinned here is that the rule stays written down, because
 * a well-commented vulnerability is still a vulnerability once someone edits
 * the code below.
 */

import fs from 'fs'
import path from 'path'

const ROUTE_PATH = path.join(process.cwd(), 'src/app/api/webhooks/odoo/route.ts')

describe('the Odoo webhook body is a trigger, never a source of values', () => {
  const source = fs.readFileSync(ROUTE_PATH, 'utf8')

  it('reads the record from Odoo before deciding anything', () => {
    // The read must happen unconditionally, not behind `if (hasActualFields)`.
    expect(source).toMatch(/odooClient\.read<any>\(model, \[odooRecordId\], erpFields\)/)
    expect(source).not.toMatch(/if \(hasActualFields\)\s*\{\s*\n\s*odooRecord = payloadData/)
  })

  it('fails the job when the read throws instead of falling back to the body', () => {
    expect(source).toMatch(/if \(readError\) \{/)
    expect(source).toMatch(/return FAIL\(`Could not read \$\{model\}#\$\{odooRecordId\} from Odoo/)
    // The dangerous phrasing must not come back.
    expect(source).not.toMatch(/read\(\) failed, falling back to webhook body/)
  })

  it('records whether the record actually came from Odoo', () => {
    expect(source).toMatch(/let recordFromOdoo = false/)
    expect(source).toMatch(/odooRecord = odooRecords\[0\]\s*\n\s*recordFromOdoo = true/)
  })

  it('uses the body only on the "record is gone" branch', () => {
    expect(source).toMatch(/else if \(hasActualFields\) \{\s*\n(?:[^\n]*\n)*?\s*odooRecord = payloadData as Record<string, any>/)
  })
})

describe('the removal signal cannot be forged by the body', () => {
  const source = fs.readFileSync(ROUTE_PATH, 'utf8')

  it('gates the body on recordFromOdoo inside hasRemovalSignal', () => {
    // The whole point: a caller must not be able to archive a product that
    // Odoo just reported as active.
    expect(source).toMatch(
      /if \(!recordFromOdoo && hasActualFields\) sources\.push\(payloadData\)/
    )
  })

  it('always consults the Odoo record itself', () => {
    expect(source).toMatch(/const sources: Array<Record<string, any> \| undefined> = \[record\]/)
  })

  it('passes the flag through from the decision point', () => {
    expect(source).toMatch(
      /hasRemovalSignal\(payloadData, odooRecord, model, recordFromOdoo\)/
    )
  })
})

describe('the ingress secret is compared in constant time', () => {
  const source = fs.readFileSync(ROUTE_PATH, 'utf8')

  it('never compares the secret with ===', () => {
    expect(source).not.toMatch(/provided\s*!==\s*odooSecret/)
    expect(source).not.toMatch(/process\.env\.ODOO_WEBHOOK_SECRET/)
  })

  it('routes the comparison through the shared helper', () => {
    // The route itself no longer touches the secret: `authorizeOdooWebhook`
    // classifies the delivery, and that helper is what calls `secretMatches`.
    expect(source).toContain("from '@/lib/odoo/webhook-secret'")
    expect(source).toContain('authorizeOdooWebhook')

    const helper = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/odoo/webhook-secret.ts'),
      'utf8'
    )
    expect(helper).toContain("from '@/lib/webhook-secret'")
    expect(helper).toMatch(/secretMatches\(value, secret\)/)
    expect(helper).not.toMatch(/function\s+secretMatches/)
  })
})
