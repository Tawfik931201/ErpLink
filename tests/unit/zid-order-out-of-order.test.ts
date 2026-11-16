import { readFileSync } from 'fs'
import path from 'path'

/**
 * Unit tests for handling out-of-order Zid order events:
 * specifically when `order.status.update` arrives before `order.create`.
 */

const root = path.resolve(__dirname, '../..')
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8')

describe('Zid out-of-order order webhooks', () => {
  const engine = read('src', 'lib', 'odoo', 'execute-operation.ts')
  const zidOrders = read('src', 'lib', 'zid', 'orders.ts')
  const workflow = read('src', 'lib', 'odoo', 'order-workflow.ts')
  const queue = read('src', 'lib', 'sync-queue.ts')

  describe('Sync Engine live status priority and upsert', () => {
    it('prioritizes live API order status over stale webhook payload on order.create enrichment', () => {
      // Must preserve orderData.order_status if liveStatus is present
      expect(zidOrders).toContain('const liveStatus = orderData.order_status || orderData.status || orderData.display_status')
      expect(zidOrders).toContain('order_status: orderData.order_status')
    })

    it('handles missing sale.order updates without stealing another queued create', () => {
      expect(engine).toContain("if (existingId === null && odooModel === 'sale.order' && odooOperation === 'update'")
      expect(engine).toContain('Pending creates remain owned by the fenced queue worker')
      expect(engine).not.toContain(".delete().eq('id', matchCreate.id)")
      expect(engine).not.toContain('await processWebhookEvent(\n          matchCreate.event')
      expect(engine).toContain("auto-creating order with available items")
    })

    it('reschedules non-existent sale.order updates as failed instead of dropping as skipped', () => {
      expect(engine).toContain("isOrderUpdate ? 'failed' : 'skipped'")
      expect(engine).toContain("not yet found in Odoo for status update; rescheduled to retry")
    })

    it('guards against custom status downgrade when a late draft/new event arrives', () => {
      expect(workflow).toContain("Skipping custom status downgrade to")
      expect(workflow).toContain("zidStatus === 'new' || zidStatus === 'draft'")
    })
  })

  describe('Sync Queue dependency ordering and fast retry', () => {
    it('prioritizes order.create before order.status.update for the same order entity in batching', () => {
      expect(queue).toContain('isOrderCreateEvent')
      expect(queue).toContain("aIsCreate && !bIsCreate")
    })

    it('bypasses circuit breaker on order-pending rescheduling and applies fast 12-15s retry', () => {
      expect(queue).toContain("const isOrderPending = typeof errorMessage === 'string' && (/not yet found in Odoo for status update/i).test(errorMessage)")
      expect(queue).toContain("if (!isOrderPending) {")
      expect(queue).toContain("const backoffMinutes = isOrderPending ? 0.2 : computeBackoffMinutes")
    })
  })
})
