import fs from 'fs'
import path from 'path'

import { SMART_DEFAULT_ORDER_STATUSES } from '../../src/lib/auto-bootstrap'
import {
  DEFAULT_SALLA_ORDER_STATUSES,
  DEFAULT_ZID_ORDER_STATUSES,
  defaultOrderStatusFieldLabel,
  defaultOrderStatusFieldName,
  defaultOrderStatusOptions,
} from '../../src/lib/order-custom-status-constants'

/**
 * Per-platform order-status custom field (Standard Mapping → Orders → 4.5).
 *
 * The section was Zid-hardcoded (title, statuses, x_zid_order_status) on
 * every store tab. Salla tabs now manage x_salla_order_status with Salla's
 * canonical slugs; Zid tabs are untouched.
 *
 * Pinned here:
 *   - the Salla catalogue keys agree with SMART_DEFAULT_ORDER_STATUSES.salla
 *     (a drift writes selection values the engine can never resolve),
 *   - per-platform field-name/label/options helpers,
 *   - source pins proving the UI section and the create/check actions follow
 *     the active store tab instead of assuming Zid.
 */

function readStripped(relativePath: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('status catalogues stay platform-true', () => {
  it('salla catalogue keys match the smart-default salla slugs', () => {
    const smartKeys = Object.keys(SMART_DEFAULT_ORDER_STATUSES.salla).sort()
    const catalogueKeys = DEFAULT_SALLA_ORDER_STATUSES.map((s) => s.key).sort()
    expect(catalogueKeys).toEqual(smartKeys)
  })

  it('zid catalogue is unchanged', () => {
    expect(DEFAULT_ZID_ORDER_STATUSES.map((s) => s.key)).toContain('new')
    expect(DEFAULT_ZID_ORDER_STATUSES.map((s) => s.key)).toContain('indelivery')
  })

  it('exposes per-platform field defaults', () => {
    expect(defaultOrderStatusFieldName('salla')).toBe('x_salla_order_status')
    expect(defaultOrderStatusFieldName('zid')).toBe('x_zid_order_status')
    expect(defaultOrderStatusFieldLabel('salla')).toContain('سلة')
    expect(defaultOrderStatusFieldLabel('zid')).toContain('زد')
    expect(defaultOrderStatusOptions('salla')).toBe(DEFAULT_SALLA_ORDER_STATUSES)
    expect(defaultOrderStatusOptions('zid')).toBe(DEFAULT_ZID_ORDER_STATUSES)
  })
})

describe('status field UI follows the store tab', () => {
  const client = readStripped(
    'src/app/(app)/app/mapping-center/standard-mapping-client.tsx'
  )
  const action = readStripped('src/app/actions/order-custom-status.ts')

  it('section title/description read the active store, not hardcoded زد', () => {
    expect(client).toContain('statusStoreNameAr')
    expect(client).toMatch(/تحديث حالة طلب \$\{statusStoreNameAr\}/)
  })

  it('create passes the tab platform into the action', () => {
    expect(client).toMatch(
      /createZidOrderStatusFieldInOdoo\(orderStatusCustomField \|\| statusFieldDefault, statusPlatform\)/
    )
  })

  it('the action writes the settings row for the given platform', () => {
    expect(action).toMatch(/\.eq\('store_type', platform\)/)
    expect(action).toContain('DEFAULT_SALLA_ORDER_STATUSES')
  })
})
