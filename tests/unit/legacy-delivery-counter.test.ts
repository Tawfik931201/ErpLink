/**
 * Durable legacy-delivery counter — the migration-window closing signal.
 *
 * The "Unauthenticated delivery #N" console counter is per-process: restart
 * and it resets, so the operational decision "every store has been
 * re-registered, the legacy window can close (STRICT_WEBHOOK_AUTH)" needs a
 * durable source of truth. That is `webhook_legacy_counters` + the
 * `increment_legacy_delivery` RPC.
 *
 * Pins:
 *  - the migration exists and declares the SECURITY DEFINER RPC.
 *  - the counter module never blocks a delivery (fire-and-forget).
 *  - every platform's unauthenticated branch actually calls it — odoo via
 *    `noteLegacyOdooDelivery`, salla and zid via `reportLegacyDelivery`.
 *  - the salla/zid wiring is on their normalized platform keys, not on raw
 *    scope strings, so counters aggregate per platform.
 */

import fs from 'fs'
import path from 'path'

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase/migrations/20261016_legacy_delivery_counters.sql'
)
const COUNTER_PATH = path.join(process.cwd(), 'src/lib/legacy-delivery-counter.ts')
const ODOO_SECRET_PATH = path.join(process.cwd(), 'src/lib/odoo/webhook-secret.ts')
const SALLA_ROUTE = path.join(process.cwd(), 'src/app/api/webhooks/salla/route.ts')
const ZID_ROUTE = path.join(process.cwd(), 'src/app/api/webhooks/zid/route.ts')

describe('the durable counter migration exists', () => {
  it('declares the table and the SECURITY DEFINER RPC', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS\s+public\.webhook_legacy_counters/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.increment_legacy_delivery/)
    expect(sql).toMatch(/SECURITY DEFINER/)
  })
})

describe('the counter helper is fire-and-forget', () => {
  const source = fs.readFileSync(COUNTER_PATH, 'utf8')

  it('calls the RPC', () => {
    expect(source).toMatch(/\.rpc\('increment_legacy_delivery'/)
  })

  it('swallows failures so a counter error never fails a delivery', () => {
    expect(source).toMatch(/catch/)
    // No throwing statement inside the fire-and-forget increment helper.
    // Scoped to that function's body — the admin-facing reset helper
    // legitimately throws on invalid input.
    const helper = source.match(
      /export async function incrementLegacyDelivery[\s\S]*?\n\}/
    )
    expect(helper).toBeTruthy()
    expect(helper![0]).not.toMatch(/throw new/)
  })

  it('exposes a read path for the admin status route', () => {
    expect(source).toMatch(/export async function getLegacyDeliveryCounts/)
  })

  it('is wired into the admin legacy-status route', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/admin/webhook-legacy-status/route.ts'),
      'utf8'
    )
    expect(route).toMatch(/from '@\/lib\/legacy-delivery-counter'/)
    expect(route).toMatch(/getLegacyDeliveryCounts\(\)/)
    expect(route).toMatch(/isAdmin\(userId\)/)
  })
})

describe('every unauthenticated branch bumps the durable counter', () => {
  it('odoo: noteLegacyOdooDelivery increments platform "odoo"', () => {
    const source = fs.readFileSync(ODOO_SECRET_PATH, 'utf8')
    expect(source).toMatch(/incrementLegacyDelivery\('odoo', scope\)/)
  })

  it('salla: reportLegacyDelivery increments platform "salla"', () => {
    const source = fs.readFileSync(SALLA_ROUTE, 'utf8')
    expect(source).toMatch(/incrementLegacyDelivery\('salla'/)
  })

  it('zid: reportLegacyDelivery increments platform "zid"', () => {
    const source = fs.readFileSync(ZID_ROUTE, 'utf8')
    expect(source).toMatch(/incrementLegacyDelivery\('zid'/)
  })
})
