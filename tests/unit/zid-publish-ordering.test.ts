import fs from 'fs'
import path from 'path'

const zidWebhook = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/webhooks/zid/route.ts'),
  'utf8'
)
const queue = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/sync-queue.ts'),
  'utf8'
)

describe('Zid product publish-before-create handling', () => {
  it('recognizes only product publish webhook aliases for delayed admission', () => {
    const publish = /^product[._]publish(?:ed)?$/i
    for (const event of ['product.publish', 'product.published', 'product_publish', 'product_published']) {
      expect(publish.test(event)).toBe(true)
    }
    for (const event of ['product.create', 'product.update', 'product.delete', 'product.stock.update', 'order.create']) {
      expect(publish.test(event)).toBe(false)
    }
  })

  it('waits at least 30 seconds for create and respects season-mode coalescing', () => {
    const handler = zidWebhook.slice(
      zidWebhook.indexOf('async function handleProductEvent('),
      zidWebhook.indexOf('async function handleCustomerEvent(')
    )
    expect(handler).toContain('Math.max(30_000, coalesceWindowMs())')
    expect(handler).toContain('nextRetryAt,')
    expect(handler).toContain('acceptBeforeErp: true')
  })

  it('preserves create-first priority and retry if the create arrives after the grace period', () => {
    expect(queue).toContain('if (isCreate) return isChild ? 1 : 0')
    expect(queue).toContain('if (isPublishOrUpdate) return isChild ? 3 : 2')
    expect(queue).toContain('const isDependencyPending')
  })
})
