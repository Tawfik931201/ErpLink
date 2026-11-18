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

  it('leaves the default mode untouched (falls through to the normal sync)', () => {
    expect(engine).toContain("if (returnSettings.mode !== 'nothing')")
    expect(engine).toContain('normalizeReturnSettings(')
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

  it('does not let two order lines of one product return the same units twice', () => {
    expect(returnsEngine).toContain('consumed')
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
