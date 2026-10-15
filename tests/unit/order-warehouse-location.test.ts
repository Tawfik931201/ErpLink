import fs from 'fs'
import path from 'path'

import { extractOrderLocationInfo } from '@/lib/sync-engine'

/**
 * Multi-warehouse order rules keyed by store location (Salla branches).
 *
 * The Orders-tab rules UI showed Zid locations on every store tab, so on a
 * Salla tab the list was empty and no rule could ever match. The UI now
 * serves Salla branches on Salla tabs, and the engine recognises the Salla
 * branch paths (pickup_branch / shipment_branch[0] / shipments[0].ship_from —
 * verified against docs.salla.dev/doc-433804).
 *
 * Pinned here: the Salla extraction plus source pins proving the Orders-tab
 * rules UI is platform-aware (options list, placeholder, loader, refresh).
 */

function readStripped(relativePath: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('extractOrderLocationInfo — Salla branch paths', () => {
  it('reads the Salla pickup_branch object', () => {
    expect(
      extractOrderLocationInfo({
        pickup_branch: { id: 1345871747, name: 'Branch' },
      })
    ).toEqual({ locationId: '1345871747', locationName: 'Branch' })
  })

  it('reads the Salla shipment_branch array', () => {
    expect(
      extractOrderLocationInfo({
        shipment_branch: [{ id: 731280709, name: 'الفرع الرئيسي' }],
      })
    ).toEqual({ locationId: '731280709', locationName: 'الفرع الرئيسي' })
  })

  it('reads shipments[0].ship_from.branch_id', () => {
    expect(
      extractOrderLocationInfo({
        shipments: [{ ship_from: { branch_id: 1790435930, name: 'المستودع الرئيسي' } }],
      })
    ).toEqual({ locationId: '1790435930', locationName: 'المستودع الرئيسي' })
  })

  it('keeps the Zid inventory_address path first', () => {
    expect(
      extractOrderLocationInfo({
        inventory_address: { id: 'zloc-1', name: 'Riyadh store' },
        shipment_branch: [{ id: 731280709, name: 'الفرع الرئيسي' }],
      })
    ).toEqual({ locationId: 'zloc-1', locationName: 'Riyadh store' })
  })

  it('returns empty for payloads without any location', () => {
    expect(extractOrderLocationInfo({ id: 1 })).toEqual({
      locationId: undefined,
      locationName: undefined,
    })
  })
})

describe('orders multi-warehouse rules UI is platform-aware', () => {
  const client = readStripped(
    'src/app/(app)/app/mapping-center/standard-mapping-client.tsx'
  )

  it('builds a Salla branch options list next to the Zid one', () => {
    expect(client).toContain('sallaOrderLocationOptions')
    expect(client).toContain('zidLocationOptions')
  })

  it('serves Salla branches on the Salla tab (options + placeholder)', () => {
    expect(client).toContain('— فرع سلة —')
    expect(client).toMatch(
      /standardStoreTab === 'salla' \? sallaOrderLocationOptions : zidLocationOptions/
    )
  })

  it('loads Salla branches (not Zid locations) for the orders rules on Salla tabs', () => {
    // The [OrderWarehouseRules] tag is unique to the orders-rules loader
    // (the inventory-sync loader uses [InventorySync]) — this fails on the
    // pre-change tree where that loader was Zid-only.
    expect(client).toContain('[OrderWarehouseRules] Failed to load Salla branches:')
  })
})
