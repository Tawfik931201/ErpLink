import { selectQueueClaimWave, productFamilyKey } from '@/lib/queue-claim-planner'

const job = (id: string, workspace_id = 'workspace-1', event = 'product.update') => ({
  id, workspace_id, platform: 'zid', store_id: '3172448',
  event, payload: { id },
})

describe('queue claim wave fencing', () => {
  it('does not lease more jobs than the same workspace can start', () => {
    const ten = Array.from({ length: 10 }, (_, i) => job(String(i)))
    const first = selectQueueClaimWave(ten, 10, 3)
    expect(first.selected).toHaveLength(3)
    expect(first.remaining).toHaveLength(7)
    expect(first.selected.map(x => x.id)).toEqual(['0', '1', '2'])
    expect(selectQueueClaimWave(first.remaining, 10, 3).selected).toHaveLength(3)
  })

  it('keeps full concurrency when independent tenants are active', () => {
    const jobs = Array.from({ length: 10 }, (_, i) => job(String(i), 'workspace-' + i))
    expect(selectQueueClaimWave(jobs, 10, 3).selected).toHaveLength(10)
  })

  it('does not claim concurrent events from the same product family', () => {
    const jobs = [
      job('same', 'ws-a', 'product.create'),
      job('same', 'ws-a', 'product.update'),
      job('different', 'ws-a', 'product.publish'),
      job('same', 'ws-b', 'product.publish'),
    ]
    const selected = selectQueueClaimWave(jobs, 10, 3)
    expect(selected.selected).toHaveLength(3)
    expect(selected.remaining.map(x => x.event)).toEqual(['product.update'])
  })

  it('uses parent id to serialize variants with their product', () => {
    const parent = job('parent')
    const variant = {
      ...job('variant'),
      payload: { id: 'variant', parent_id: 'parent' },
    }
    expect(productFamilyKey(variant)).toBe(productFamilyKey(parent))
    const wave = selectQueueClaimWave([parent, variant], 10, 3)
    expect(wave.selected).toHaveLength(1)
    expect(wave.remaining).toHaveLength(1)
  })

  it('does not unnecessarily serialize unrelated orders', () => {
    const orders = Array.from({ length: 3 }, (_, i) => job('order-' + i, 'ws-a', 'order.updated'))
    expect(selectQueueClaimWave(orders, 10, 3).selected).toHaveLength(3)
  })
})
