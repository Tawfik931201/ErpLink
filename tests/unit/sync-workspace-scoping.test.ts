/**
 * Regression tests for cross-workspace scoping of the webhook sync path
 * (root cause of the 2026-10-18 "Salla categories ignore my settings" report).
 *
 * `processWebhookEvent` used to query `field_mappings` by store/merchant id
 * ALONE, so a stale row in workspace A carrying workspace B's store id matched
 * workspace B's deliveries. `processFixedMappingFallback` then borrowed
 * `existingMappings[0].workspace_id` + its `erp_connection_id`, i.e. workspace
 * A's `standard_mapping_settings`, A's ERP connection and A's custom mappings
 * ran against B's store — B's own saved settings were never read. Zid looked
 * unaffected only because no stale row happened to match its store.
 *
 * These pins keep three rules in place:
 *   1. the field_mappings query is scoped to the delivery workspace,
 *   2. the preset path prefers the delivery workspace over any borrowed row,
 *   3. both call sites pass that workspace through.
 * Each rule has a self-check proving the detector fails on the old code shape.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8')
}

const webhook = readSrc('lib', 'sync', 'webhook.ts')
const mappings = readSrc('lib', 'sync', 'mappings.ts')

function queryBlock(source: string): string {
  const from = source.indexOf('Find all field_mappings matching')
  const to = source.indexOf('Filter in memory by action')
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

function isQueryScoped(source: string): boolean {
  return /if \(resolvedWorkspaceId\) mappingQuery = mappingQuery\.eq\('workspace_id', resolvedWorkspaceId\)/.test(
    source
  )
}

function presetFnBody(source: string): string {
  const from = source.indexOf('async function processFixedMappingFallback')
  const to = source.indexOf('Check Standard Mapping settings')
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return source.slice(from, to)
}

function prefersDeliveryWorkspace(body: string): boolean {
  const delivery = body.indexOf('if (deliveryWorkspaceId)')
  const borrow = body.indexOf('existingMappings[0]')
  return delivery > -1 && borrow > -1 && delivery < borrow
}

describe('field_mappings query is scoped to the delivery workspace', () => {
  const block = queryBlock(webhook)

  it('gates a workspace_id filter on resolvedWorkspaceId', () => {
    expect(isQueryScoped(block)).toBe(true)
  })

  it('still matches on store_id/merchant_id (the scoping narrows, not replaces)', () => {
    expect(block).toContain(".or('store_id.eq.' + storeIdStr + ',merchant_id.eq.' + storeIdStr)")
  })

  it('keeps the component-sync field_mappings query scoped too', () => {
    const scoped = mappings.match(/from\('field_mappings'\)[\s\S]{0,240}?eq\('workspace_id', workspaceId\)/g) || []
    expect(scoped.length).toBeGreaterThanOrEqual(1)
  })

  it('self-check: the detector rejects the old unscoped query shape', () => {
    const oldShape = [
      "Find all field_mappings matching this store + event",
      "const { data: mappingRows, error: mappingErr } = await supabaseAdmin",
      ".from('field_mappings')",
      ".select('*')",
      ".or('store_id.eq.' + storeIdStr + ',merchant_id.eq.' + storeIdStr)",
      "if (!isProduct) {",
    ].join('\n')
    expect(isQueryScoped(oldShape)).toBe(false)
  })
})

describe('preset path prefers the delivery workspace', () => {
  const body = presetFnBody(mappings)

  it('accepts a deliveryWorkspaceId parameter', () => {
    expect(body).toContain('deliveryWorkspaceId?: string | null')
  })

  it('resolves the delivery workspace BEFORE borrowing from existingMappings[0]', () => {
    expect(prefersDeliveryWorkspace(body)).toBe(true)
  })

  it('borrows the ERP connection only from a mapping in the SAME workspace', () => {
    expect(body).toContain('m.workspace_id === deliveryWorkspaceId')
    expect(body).toContain('sameWsMapping?.erp_connection_id ?? null')
  })

  it('self-check: the detector rejects the old borrow-everything shape', () => {
    const oldShape = [
      'async function processFixedMappingFallback(',
      '  existingMappings: FieldMappingRow[] | null',
      '): Promise<SyncEngineResult[\'records\'][number] | null> {',
      '  if (existingMappings && existingMappings.length > 0) {',
      '    workspaceId = anyMapping.workspace_id',
    ].join('\n')
    expect(prefersDeliveryWorkspace(oldShape)).toBe(false)
  })
})

describe('call sites pass the delivery workspace', () => {
  it('both invocations end with a workspace argument', () => {
    const calls = [...(webhook + mappings).matchAll(/(?<!function )processFixedMappingFallback\(\s*([\s\S]*?)\)/g)]
    expect(calls.length).toBe(2)
    for (const call of calls) {
      const args = call[1].trim()
      expect(args.endsWith('resolvedWorkspaceId') || args.endsWith('workspaceId')).toBe(true)
    }
  })

  it('self-check: the detector flags a call that omits the workspace', () => {
    const omitted = "processFixedMappingFallback(\n  presetKey, event, storeIdStr, data, platform, mappingRows as FieldMappingRow[] | null\n)"
    const args = /(?<!function )processFixedMappingFallback\(\s*([\s\S]*?)\)/.exec(omitted)?.[1]?.trim() ?? ''
    expect(args.endsWith('resolvedWorkspaceId') || args.endsWith('workspaceId')).toBe(false)
  })
})
