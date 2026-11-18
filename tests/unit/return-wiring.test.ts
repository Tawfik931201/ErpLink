import { readFileSync } from 'fs'
import path from 'path'

/**
 * Source pins for the return wiring. Every assertion here was checked to fail
 * when the rule is reverted, so none of them is vacuous:
 *
 *   - the return must be intercepted BEFORE the generic order write, otherwise
 *     a reversal would update the sale order and never touch stock/invoices;
 *   - `mode: 'nothing'` must fall through to the old behaviour, so a workspace
 *     that never configured returns keeps syncing exactly as before;
 *   - `order.shipment.*` must be pointed at the order id, because its `id` is
 *     the shipment id (a real payload: id 1427738113, order 41030566).
 */

const root = path.resolve(__dirname, '../..')
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8')

const engine = read('src', 'lib', 'odoo', 'execute-operation.ts')
const orderPreparation = read('src', 'lib', 'odoo', 'order-values.ts')
const webhook = read('src', 'lib', 'sync', 'webhook.ts')
const shipment = read('src', 'lib', 'salla', 'webhook-data.ts')
const zidClient = read('src', 'lib', 'zid-client.ts')
const eventOperation = read('src', 'lib', 'event-operation.ts')

describe('returns are intercepted before any order write', () => {
  const fnStart = engine.indexOf('async function executeOdooOperation(')
  const execPlatform = engine.indexOf('const execPlatform', fnStart)
  const signal = engine.indexOf('isReturnSignal(', execPlatform)
  const process = engine.indexOf('processReturnEvent(', signal)
  const firstWrite = engine.indexOf('const order = await prepareOdooOrder(', execPlatform)

  it('finds the function and the interception', () => {
    expect(fnStart).toBeGreaterThan(-1)
    expect(execPlatform).toBeGreaterThan(fnStart)
    expect(signal).toBeGreaterThan(execPlatform)
    expect(process).toBeGreaterThan(signal)
  })

  it('runs the interception before order preparation can create a related Odoo record', () => {
    expect(orderPreparation).toContain('await client.create(')
    expect(firstWrite).toBeGreaterThan(process)
  })

  it('only intercepts sale.order updates on zid/salla', () => {
    const block = engine.slice(signal - 600, signal + 100)
    expect(block).toContain("odooModel === 'sale.order'")
    expect(block).toContain("odooOperation === 'update'")
    expect(block).toContain("execPlatform === 'zid'")
    expect(block).toContain("execPlatform === 'salla'")
  })

  it('skips Zid reverse_in_progress before the generic locked-order write path', () => {
    const block = engine.slice(execPlatform, signal)
    expect(block).toContain('isZidReturnStatus(transientReturnStatus, true)')
    expect(block).toContain("status: 'skipped'")
    expect(block).toContain('waiting for the completed reversal event')
  })

  it('explicit nothing bypasses locked-order cancellation and logs a genuine skip', () => {
    const block = engine.slice(signal, firstWrite)
    expect(block).toContain("configuredReturnSettings")
    expect(block).toContain("explicitReturnMode.trim() && returnSettings.mode === 'nothing'")
    expect(block).toContain("returns_disabled_by_standard_mapping")
    expect(block).toContain("status: 'skipped'")
    expect(block).toContain("await logSync({")
    const skipAt = block.indexOf('returns_disabled_by_standard_mapping')
    expect(skipAt).toBeGreaterThan(-1)
    expect(skipAt).toBeLessThan(block.indexOf('processReturnEvent('))
    expect(block).toContain("if (returnSettings.mode !== 'nothing')")
  })

  it('preserves the original status-action behavior for workspaces without a configured mode', () => {
    expect(engine).toContain("const explicitReturnMode = (configuredReturnSettings as any)?.mode")
    expect(engine).toContain("typeof explicitReturnMode === 'string'")
    expect(engine).toContain("if (returnSettings.mode !== 'nothing')")
  })

  it('never overwrites original order link with an Odoo return child ID', () => {
    const returnBlock = engine.slice(signal, firstWrite)
    const runtime = read('src', 'lib', 'sync-runtime.ts')
    expect(returnBlock).toContain('suppressEntityLink: true')
    expect(returnBlock).toContain('odoo_record_id: outcome.odooRecordId ?? null')
    expect(runtime).toContain('!entry.suppressEntityLink')
    expect(runtime).toContain('upsertEntityLink(')
  })

  it('logs the outcome instead of returning an unlogged success', () => {
    const block = engine.slice(signal, firstWrite)
    expect(block).toContain('await logSync({')
    expect(block).toContain('platform: execPlatform')
  })
})

describe('Salla shipment events target the order, not the shipment', () => {
  const normalizeAt = shipment.indexOf('const targetOrderId =')
  const enrichAt = webhook.indexOf('data = await prepareSallaWebhookData(')
  const mappingQueryAt = webhook.indexOf('// 1. Find all field_mappings')

  it('normalises the id after enrichment and before the mapping lookup', () => {
    const orderFetchAt = shipment.indexOf("await enrichSallaOrder(")
    expect(orderFetchAt).toBeGreaterThan(-1)
    expect(normalizeAt).toBeGreaterThan(orderFetchAt)
    expect(shipment.slice(normalizeAt)).toContain("id: targetOrderId")
    expect(enrichAt).toBeGreaterThan(-1)
    expect(mappingQueryAt).toBeGreaterThan(enrichAt)
  })

  it('does not ask Salla for an order using the shipment id', () => {
    expect(shipment).toContain('shipmentEntityId')
    expect(shipment).toContain('const orderFetchId = isShipmentEvent && !shipmentHasOrder ? shipmentEntityId : entityId')
  })
})

describe('Zid remaining quantities follow the documented contract', () => {
  const returnsEngine = read('src', 'lib', 'returns', 'engine.ts')
  const returnsZid = read('src', 'lib', 'returns', 'zid.ts')

  it('deduplicates stock when create_credit_note is disabled instead of relying on out_refund', () => {
    expect(returnsEngine).toContain('readStockReturnLedger(')
    expect(returnsEngine).toContain('input.settings.create_credit_note')
    expect(returnsEngine).toContain('return_no_stock_effect_and_credit_note_disabled')
    expect(returnsEngine).toContain('return_mode_changed_existing_financial_effect_requires_review')
    expect(returnsEngine).toContain('return_stock_without_credit_note_requires_review')
  })

  it('never fakes a missing-original Zid refund from sold order quantity or random matching', () => {
    expect(returnsEngine).toContain("platform === 'zid'")
    expect(returnsEngine).toContain('extractPricedZidReceivedReturnLines(input.payload)')
    expect(returnsEngine).toContain("resolveOrderRelatedRecord(client, supabaseAdmin,")
    expect(returnsEngine).toContain("'customers', source, matchSettings")
    expect(returnsEngine).toContain('return_configured_customer_not_found')
    expect(returnsEngine).toContain("return_configured_product_not_found")
    expect(returnsEngine).toContain('await assertNegativeSaleOrderPersisted(client, Number(created)')
  })

  it('assigns a cumulative return snapshot identity instead of reusing root sale.order effects', () => {
    expect(returnsEngine).toContain("withErpCreateIdentity(effectIdentity")
    expect(returnsEngine).toContain("returnSnapshotSignature(cumulative")
    expect(returnsEngine).toContain("assertNegativeSaleOrderPersisted(client")
    expect(returnsEngine).toContain("withErpCreateIdentity('return-fallback:' + signature")
  })

  it('treats a product missing from view-for-return as fully returned', () => {
    // Documented: the endpoint lists ONLY products that can still come back,
    // so absence means remaining = 0. Treating it as "not returned" makes a
    // full reversal invisible.
    expect(returnsEngine).toContain('absentMeansFullyReturned')
    expect(returnsEngine).toContain('? 0')
  })

  it('refuses to guess when a listed row could not be resolved in Odoo', () => {
    expect(returnsEngine).toContain('unresolved')
    expect(returnsEngine).toContain(': line.orderedQty')
  })

  it('uses capped per-sale-line allocation so duplicate products cannot over-refund', () => {
    expect(returnsEngine).toContain('incrementalReturnLineQuantities(original.lines, targets, ledger)')
    expect(returnsEngine).toContain('isCumulativeFullReturn(regularLines, targets)')
  })

  it('only trusts a response that actually contains a products array', () => {
    expect(returnsZid).toContain('Array.isArray(order.products)')
    expect(returnsZid).toContain('known: false')
  })
})

describe('Odoo return picking compatibility', () => {
  const returnsOdoo = read('src', 'lib', 'returns', 'odoo.ts')

  it('uses the Odoo 20 public stock.picking action_return API', () => {
    expect(returnsOdoo).toContain('if (majorVersion >= 20)')
    expect(returnsOdoo).toContain("'stock.picking', 'action_return'")
    expect(returnsOdoo).toContain("'origin_returned_move_id'")
  })

  it('reuses and confirms Odoo 20 draft return pickings before validation', () => {
    expect(returnsOdoo).toContain("'return_id', '=', pickingId")
    expect(returnsOdoo).toContain('Reusing Odoo 20 draft return picking')
    expect(returnsOdoo).toContain("'action_confirm', [[created]]")
    expect(returnsOdoo).toContain("'action_assign', [[created]]")
    expect(returnsOdoo).toContain("'button_validate', [[created]]")
  })

  it('keeps the legacy return wizard path for Odoo 14-19', () => {
    expect(returnsOdoo).toContain("client.create('stock.return.picking'")
    expect(returnsOdoo).toContain("'action_create_returns'")
  })
})

describe('platform endpoints and operation names', () => {
  it('reads Zid remaining quantities from the documented endpoint', () => {
    expect(zidClient).toContain('/view-for-return')
  })

  it('never polls a reverse-orders list, because Zid publishes none', () => {
    // docs.zid.sa → Reverse Orders publishes Create (POST), Waybill, Reasons,
    // Calculate Totals, Create Refund, Upload Receipt, Update Return Products
    // and View for Return. There is no GET list, so a poll of one would 404.
    expect(zidClient).not.toMatch(/get\(\s*['"`]\/v1\/managers\/store\/reverse-orders/)
    expect(zidClient).not.toContain('/orders/${orderId}/reverse')
  })

  it('never invents a return operation - the gate has no such member', () => {
    expect(eventOperation).not.toMatch(/['"]return['"]\s*:/)
    expect(eventOperation).toContain("'order.shipment.return.created'")
  })
})
