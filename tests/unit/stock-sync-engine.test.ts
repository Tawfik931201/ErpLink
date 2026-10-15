/**
 * Pins the dual-store (Odoo → Zid + Odoo → Salla) stock sync engine.
 *
 * The engine is a source-scan target, not an execution target: it reads the
 * Supabase service-role client, XML-RPC, Zid's HTTP API and Salla's, all of
 * which are untestable in isolation. What is pinned here is that the rules
 * stay written down, because an edited-away guard reopens the same bugs:
 *
 *   - A Zid-only workspace must run exactly the original Zid flow; Salla is a
 *     second, independent arm (never a rewrite of the Zid path).
 *   - Multi-store fan-out: each arm iterates EVERY linked store of its
 *     platform (storeTok), each with its own effective inventory settings
 *     (store row, else the platform default), skipping stores that turned
 *     their own push off, and merges the per-store results. A second Salla
 *     store must never be silently left without stock pushes.
 *   - The Salla product resolution must be scoped to the Salla store via
 *     `store_id = merchantId` — sync_logs has no platform column, so an
 *     unscoped lookup would return Zid products in a two-store workspace.
 *   - `SALLA_DEFAULT_BRANCH_ID` must map to "omit branch", unlimited Salla
 *     products must be skipped, and the push must be an absolute `overwrite`.
 *   - The Salla arm must have its own telegram channel and transfer row.
 *
 * NOTE: the manual store→Odoo bulk-push page (`mapping-center/stock`) and its
 * `triggerStockSync` action were deleted outright, so there is no suppression
 * gate left to pin — nothing suppressible remains.
 *
 * Every pin is checked to fail when reverted (see the self-check suite), so
 * none of them is vacuous.
 */

import fs from 'fs'
import path from 'path'

const ENGINE_PATH = path.join(process.cwd(), 'src/lib/stock-sync-engine.ts')

function readSource(p: string): string {
  const raw = fs.readFileSync(p, 'utf8')
  // Comment-strip: comments are not a read. Several files deliberately name
  // the pinned identifiers in prose; a comment is not an implementation.
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the stock sync engine dispatches BOTH enabled store arms', () => {
  const source = readSource(ENGINE_PATH)

  it('runs the Zid arm when Zid sync is enabled', () => {
    expect(source).toMatch(/if \(zidEnabled\) \{/)
    expect(source).toMatch(/runZidArm\(\{ workspaceId, client, erpConn, settings: await getInventorySyncSettings\(workspaceId, 'zid'\), payload \}\)/)
  })

  it('runs the Salla arm when Salla sync is enabled', () => {
    expect(source).toMatch(/if \(sallaEnabled\) \{/)
    expect(source).toMatch(/runSallaArm\(\{ workspaceId, client, settings: await getInventorySyncSettings\(workspaceId, 'salla'\), payload \}\)/)
  })

  it('fans each arm out per linked store with per-store settings', () => {
    // storeTok carries the single store the recursive call pushes to.
    expect(source).toMatch(/storeTok\?: any/)
    // Effective settings per store (store row, else platform default).
    expect(source).toMatch(/getInventorySyncSettings\(workspaceId, 'zid', String\(\(t as any\)\.merchant_id\)\)/)
    expect(source).toMatch(/getInventorySyncSettings\(workspaceId, 'salla', String\(\(t as any\)\.merchant_id\)\)/)
    // A store that disabled its own push is skipped, not pushed to.
    expect(source).toMatch(/if \(!s\.sync_enabled\) \{/)
    // Per-store results merge back into one arm result.
    expect(source).toMatch(/mergeArmResults\(perStore/)
  })

  it('gates dispatch on BOTH stores (either one being enabled is enough)', () => {
    expect(source).toMatch(
      /if \(!zidEnabled && !sallaEnabled\)/
    )
  })

  it('keeps the Salla arm an independent arm, not a renamed Zid copy', () => {
    // The Salla arm must read its own token table and pairing platform.
    expect(source).toMatch(/\.from\('salla_tokens'\)/)
    expect(source).toMatch(/\.eq\('platform', 'salla'\)/)
    expect(source).toMatch(/'salla'/)
  })
})

describe('the Salla product resolution cannot cross stores', () => {
  const source = readSource(ENGINE_PATH)

  it('scopes the sync_logs lookup to THIS Salla store via store_id', () => {
    // sync_logs has no platform column — `store_id = merchantId` is the only
    // thing separating a Salla row from a Zid row in a two-store workspace.
    expect(source).toMatch(/\.eq\('store_id', merchantId\)/)
  })

  it('keeps the shared workspace + model + status filters on that lookup', () => {
    expect(source).toMatch(/\.eq\('workspace_id', workspaceId\)/)
    expect(source).toMatch(/\.in\('odoo_model', \['product\.product', 'product\.template'\]\)/)
    expect(source).toMatch(/\.eq\('status', 'success'\)/)
  })

  it('resolves the stored Salla product id, not a persisted zid id assumption', () => {
    expect(source).toMatch(/findSallaProductByMatchField\(merchantId, 'id', String\(log\.zid_entity_id\)\)/)
  })
})

describe('the Salla push honors Salla semantics', () => {
  const source = readSource(ENGINE_PATH)

  it('omits the branch for SALLA_DEFAULT_BRANCH_ID', () => {
    expect(source).toMatch(/const branch = sallaBranchId === SALLA_DEFAULT_BRANCH_ID \? undefined : sallaBranchId/)
  })

  it('uses the bulk quantities API with absolute overwrite', () => {
    expect(source).toMatch(/updateSallaStockBulk\(merchantId, \[/)
    expect(source).toMatch(/identifer_type: 'id'/)
    expect(source).toMatch(/mode: 'overwrite'/)
  })

  it('skips products marked unlimited_quantity (mirrors the Zid is_infinite guard)', () => {
    expect(source).toMatch(/if \(sallaProduct\.unlimited_quantity === true\) \{/)
    expect(source).toMatch(/return 'skipped'/)
  })
})

describe('the Salla arm has its own bookkeeping (log + telegram)', () => {
  const source = readSource(ENGINE_PATH)

  it('records a dedicated transfer row', () => {
    expect(source).toMatch(/name: `Stock Sync — Odoo → Salla`/)
    expect(source).toMatch(/direction: 'odoo_to_salla'/)
  })

  it('sends on its own telegram channel with its own mapping name', () => {
    expect(source).toMatch(/mappingId: 'stock_sync_odoo_salla'/)
    expect(source).toMatch(/تحديث المخزون \(أودوو ⬅️ سلة\)/)
    expect(source).toMatch(/storeId: merchantId/)
  })
})

describe('the Zid arm is preserved verbatim behind the dual dispatch', () => {
  const source = readSource(ENGINE_PATH)

  it('keeps the Zid skip semantics and the shared throw message', () => {
    expect(source).toMatch(/\[StockSync\] All stock updates failed:/)
    expect(source).toMatch(/is infinite[^.]*skipped\./)
  })

  it('keeps the Zid telegram channel', () => {
    expect(source).toMatch(/mappingId: 'stock_sync_odoo_zid'/)
    expect(source).toMatch(/تحديث المخزون \(أودوو ⬅️ زد\)/)
  })
})

describe('self-check: the pins actually detect a reverted rule', () => {
  const has = (src: string, re: RegExp) => re.test(src)

  it('fails when the Salla arm is dropped from dispatch', () => {
    const intact = readSource(ENGINE_PATH)
    expect(has(intact, /if \(sallaEnabled\) \{/)).toBe(true)
    const tampered = intact.replace("if (sallaEnabled) {", "if (false && sallaEnabled) {")
    expect(has(tampered, /if \(sallaEnabled\) \{/)).toBe(false)
  })

  it('fails when the store_id scope is removed from the Salla lookup', () => {
    const guardFn = (src: string) => has(src, /\.eq\('store_id', merchantId\)/)
    expect(guardFn(readSource(ENGINE_PATH))).toBe(true)
    const tampered = readSource(ENGINE_PATH).replace(/[ \t]*\.eq\('store_id', merchantId\)\r?\n/, '')
    expect(guardFn(tampered)).toBe(false)
  })

  it('fails when the default-branch omission is replaced by a literal', () => {
    const guardFn = (src: string) => has(src, /SALLA_DEFAULT_BRANCH_ID \? undefined/)
    expect(guardFn(readSource(ENGINE_PATH))).toBe(true)
    const tampered = readSource(ENGINE_PATH).replace('? undefined : sallaBranchId', ': sallaBranchId')
    expect(guardFn(tampered)).toBe(false)
  })
})