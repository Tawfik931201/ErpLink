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

const engine = read('src', 'lib', 'sync-engine.ts')
const zidClient = read('src', 'lib', 'zid-client.ts')
const eventOperation = read('src', 'lib', 'event-operation.ts')

describe('returns are intercepted before any order write', () => {
  const fnStart = engine.indexOf('async function executeOdooOperation(')
  const execPlatform = engine.indexOf('const execPlatform', fnStart)
  const signal = engine.indexOf('isReturnSignal(', execPlatform)
  const process = engine.indexOf('processReturnEvent(', signal)
  const firstWrite = engine.indexOf('await client.create(', execPlatform)

  it('finds the function and the interception', () => {
    expect(fnStart).toBeGreaterThan(-1)
    expect(execPlatform).toBeGreaterThan(fnStart)
    expect(signal).toBeGreaterThan(execPlatform)
    expect(process).toBeGreaterThan(signal)
  })

  it('runs the interception before the first Odoo create in the function', () => {
    expect(firstWrite).toBeGreaterThan(signal)
  })

  it('only intercepts sale.order updates on zid/salla', () => {
    const block = engine.slice(signal - 600, signal + 100)
    expect(block).toContain("odooModel === 'sale.order'")
    expect(block).toContain("odooOperation === 'update'")
    expect(block).toContain("execPlatform === 'zid'")
    expect(block).toContain("execPlatform === 'salla'")
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
  const normalizeAt = engine.indexOf("normalizedEvent.includes('shipment')")
  const mappingQueryAt = engine.indexOf('// 1. Find all field_mappings')

  it('normalises the id after enrichment and before the mapping lookup', () => {
    expect(normalizeAt).toBeGreaterThan(-1)
    expect(mappingQueryAt).toBeGreaterThan(normalizeAt)
  })

  it('does not ask Salla for an order using the shipment id', () => {
    expect(engine).toContain('shipmentEntityId')
    expect(engine).toContain('orderFetchId')
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
