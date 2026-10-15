/**
 * Pins why a Salla category synced to Odoo without its Parent Category
 * (reported 2026-10-06), and the three pieces that fix it.
 *
 * Two causes, both in src/lib/sync-engine.ts:
 *
 *   1. The hardcoded `salla_category` preset mapped `name` only — unlike
 *      `zid_category`, which has carried `parent_id` since it was written. The
 *      fallback path therefore never sent a parent at all.
 *   2. The special product.category parent resolution (fetch the parent from
 *      the store API, then match-or-create it in Odoo) was gated on
 *      `platform === 'zid'`. A Salla `parent_id` is a bare numeric Salla ID,
 *      so Case 1/2/3 in resolveSingleRelationId all miss it and the field is
 *      skipped — indistinguishable from "synced fine, parent empty".
 *
 * A third guard: a category payload can be fat (>4 keys, so no thin-payload
 * enrichment) and still omit `parent_id`. Size alone then passes a parentless
 * payload through. `missingParentId` forces the fetch in that case.
 *
 * Source-level assertions, same reasoning as odoo-webhook-trust.test.ts: the
 * resolution lives inside a 7000-line module that reaches for Supabase, Odoo
 * XML-RPC and three store clients, so it cannot run in isolation. Each pin was
 * checked to actually fail when its fix is reverted.
 */

import fs from 'fs'
import path from 'path'

const ENGINE_PATH = path.join(process.cwd(), 'src/lib/sync-engine.ts')
const source = fs.readFileSync(ENGINE_PATH, 'utf8')

/** Slice of source containing the salla_category preset row. */
function sallaPresetBlock(): string {
  const start = source.indexOf("'salla_category'")
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf("'shopify_category'", start)
  expect(end).toBeGreaterThan(-1)
  return source.slice(start, end)
}

describe('the salla_category preset maps the parent', () => {
  it('sends parent_id, the way zid_category always has', () => {
    const block = sallaPresetBlock()
    expect(block).toMatch(/odoo_field:\s*'parent_id'/)
    // Must read the Salla key, not a Zid-only spelling.
    expect(block).toMatch(/platform_field:\s*'parent_id \|\| parent\.id \|\| parent_category_id'/)
  })

  it('still maps the name', () => {
    expect(sallaPresetBlock()).toMatch(/odoo_field:\s*'name'/)
  })
})

describe('parent resolution is not Zid-only any more', () => {
  it('accepts salla in the product.category special branch', () => {
    // Reverting to `platform === 'zid'` alone drops the whole Salla path.
    expect(source).toMatch(
      /if \(relation === 'product\.category' && \(platform === 'zid' \|\| platform === 'salla'\) && platformId && workspaceId\)/
    )
  })

  it('looks the Salla parent up in salla_tokens, not merchant_tokens', () => {
    const branchStart = source.indexOf(
      "if (relation === 'product.category' && (platform === 'zid' || platform === 'salla')"
    )
    expect(branchStart).toBeGreaterThan(-1)
    const branch = source.slice(branchStart, branchStart + 4500)
    // The Salla arm must fetch the parent category from Salla's own API…
    expect(branch).toMatch(/getSallaCategory\(/)
    // …using the merchant bound to this workspace, exactly as the webhook
    // route resolves it (merchant_id ↔ workspace_id).
    expect(branch).toMatch(/\.from\('salla_tokens'\)/)
    expect(branch).toMatch(/\.eq\('workspace_id', workspaceId\)/)
    // The Zid arm must survive untouched beside it.
    expect(branch).toMatch(/\.from\('merchant_tokens'\)/)
    expect(branch).toMatch(/ZidAPI\.categories\.get/)
  })

  it('records the resolved parent so the next child hits Case 0', () => {
    // Without this sync_logs row, resolveSingleRelationId's Case 0 cannot
    // resolve a later sibling and refetches Salla every time.
    expect(source).toMatch(/zid_entity_id:\s*String\(platformId\),\s*\n\s*odoo_model:\s*'product\.category',/)
  })
})

describe('a parentless category payload is completed before mapping', () => {
  it('forces enrichment when parent_id is absent, regardless of size', () => {
    expect(source).toMatch(/const missingParentId =/)
    expect(source).toMatch(
      /if \(missingOrderItems \|\| missingParentId \|\| isThin\) \{/
    )
  })
})
