/**
 * Pins the queue record read path (`/app/queue/<id>`) added when the record page
 * gained the full payload.
 *
 * Three things must stay true, and each has a self-check below that proves the
 * pin actually fails when the rule is reverted:
 *
 *   1. The record is read by id from the right table, always scoped to the
 *      caller's workspace, and orphans additionally scoped to that workspace's
 *      store ids — an id alone must never be a key to another tenant's data.
 *   2. The record read carries `payload` (the whole point: identify which order,
 *      which product, which customer).
 *   3. The client opens the record through that action instead of walking the
 *      paginated list — the scan version could only see the first pages and
 *      never had the payload for queue/dead rows.
 */

import fs from 'fs'
import path from 'path'

import {
  hasQueuePayload,
  queueItemKindFromNextRetry,
  queueItemLookupOrder,
} from '@/lib/queue-item'

const ACTION_PATH = path.join(process.cwd(), 'src/app/actions/queue-dashboard.ts')
const DETAIL_PATH = path.join(
  process.cwd(),
  'src/app/(app)/app/queue/[id]/queue-detail-client.tsx'
)
const UI_PATH = path.join(process.cwd(), 'src/app/(app)/app/queue/queue-ui.tsx')

const FROZEN = '2999-12-31T23:59:59.000Z'

/** Comments are prose, not a read — strip them before asserting on source. */
function readSource(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The body of one exported action, so a pin cannot be satisfied by another. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`)
  if (start === -1) return ''
  const rest = source.slice(start + 1)
  const next = rest.search(/\nexport async function /)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('queue item kind', () => {
  it('treats a missing next_retry_at as frozen (retries exhausted)', () => {
    expect(queueItemKindFromNextRetry(null, FROZEN)).toBe('frozen')
    expect(queueItemKindFromNextRetry(undefined, FROZEN)).toBe('frozen')
    expect(queueItemKindFromNextRetry('', FROZEN)).toBe('frozen')
  })

  it('treats the sentinel as frozen, not as a date far in the future', () => {
    expect(queueItemKindFromNextRetry(FROZEN, FROZEN)).toBe('frozen')
  })

  it('treats a real due date as pending', () => {
    expect(queueItemKindFromNextRetry('2026-11-02T10:00:00.000Z', FROZEN)).toBe('pending')
  })
})

describe('queue item lookup order', () => {
  it('starts with the hinted table', () => {
    expect(queueItemLookupOrder('dead')[0]).toBe('dead')
    expect(queueItemLookupOrder('orphans')[0]).toBe('inbox')
    expect(queueItemLookupOrder('pending')[0]).toBe('queue')
    expect(queueItemLookupOrder('frozen')[0]).toBe('queue')
  })

  it('still tries every source, so a row is never unreachable', () => {
    for (const hint of [undefined, null, 'dead', 'orphans', 'pending', 'frozen', 'nonsense']) {
      const order = queueItemLookupOrder(hint)
      expect([...order].sort()).toEqual(['dead', 'inbox', 'queue'])
    }
  })

  it('ignores an unknown hint', () => {
    expect(queueItemLookupOrder('nonsense')).toEqual(['queue', 'dead', 'inbox'])
  })
})

describe('hasQueuePayload', () => {
  it('rejects what cannot be displayed', () => {
    expect(hasQueuePayload(null)).toBe(false)
    expect(hasQueuePayload(undefined)).toBe(false)
    expect(hasQueuePayload({})).toBe(false)
    expect(hasQueuePayload('   ')).toBe(false)
    expect(hasQueuePayload([])).toBe(false)
  })

  it('accepts real data', () => {
    expect(hasQueuePayload({ order: { id: 1 } })).toBe(true)
    expect(hasQueuePayload([{ id: 1 }])).toBe(true)
    expect(hasQueuePayload('{"a":1}')).toBe(true)
  })
})

describe('the record action reads by id, scoped, with payload', () => {
  const action = readSource(ACTION_PATH)
  const body = fnBody(action, 'getQueueItemById')

  it('exists as its own action', () => {
    expect(body.length).toBeGreaterThan(0)
  })

  it('reads all three tables', () => {
    expect(body).toMatch(/from\('sync_queue'\)/)
    expect(body).toMatch(/from\('sync_queue_dead'\)/)
    expect(body).toMatch(/from\('webhook_inbox'\)/)
  })

  it('selects the payload it is meant to show', () => {
    expect(body).toMatch(/select\(\s*'id,platform,event,store_id,payload,retry_count/)
    expect(body).toMatch(/select\(\s*'id,original_id,platform,event,store_id,payload/)
  })

  it('scopes both workspace-owned tables by workspace_id', () => {
    const scoped = body.match(/\.eq\('workspace_id', workspaceId\)/g) ?? []
    expect(scoped.length).toBeGreaterThanOrEqual(2)
  })

  it('scopes the receipt lookup by the workspace store ids', () => {
    // `webhook_inbox` has no workspace_id to filter on; the store ids are the
    // only thing that makes the id belong to this tenant.
    expect(body).toMatch(/\.in\('store_id', \[\.\.\.storeIds\]\)/)
  })

  it('refuses to read receipts at all when the workspace has no store', () => {
    expect(body).toMatch(/if \(storeIds\.size === 0\) continue/)
  })

  it('derives pending vs frozen from next_retry_at, not from the hint', () => {
    expect(body).toMatch(/queueItemKindFromNextRetry\(/)
  })
})

describe('the record page uses that action, not a list scan', () => {
  const client = readSource(DETAIL_PATH)

  it('calls getQueueItemById', () => {
    expect(client).toMatch(/getQueueItemById/)
  })

  it('no longer walks the paginated list', () => {
    expect(client).not.toMatch(/SCAN_PAGE/)
    expect(client).not.toMatch(/getQueueItems/)
    expect(client).not.toMatch(/getDeadItems/)
    expect(client).not.toMatch(/getOrphanItems\s*\(/)
  })

  it('renders the shared payload viewer', () => {
    expect(client).toMatch(/import \{ PayloadViewer \} from '\.\.\/\.\.\/logs\/payload-viewer'/)
    expect(client).toMatch(/<PayloadViewer[\s\S]*?payload=\{payload\}/)
  })
})

describe('one definition of the queue vocabulary', () => {
  const ui = readSource(UI_PATH)

  it('re-exports the kinds from the plain module instead of redeclaring them', () => {
    expect(ui).toMatch(/from '@\/lib\/queue-item'/)
    expect(ui).not.toMatch(/export type QueueKind = /)
    expect(ui).not.toMatch(/export const QUEUE_KINDS: QueueKind\[\] = /)
  })
})

describe('self-check: the pins actually detect a reverted rule', () => {
  const action = readSource(ACTION_PATH)

  it('detects the store scoping being dropped from the receipt lookup', () => {
    const body = fnBody(action, 'getQueueItemById')
    const tampered = body.replace(/\.in\('store_id', \[\.\.\.storeIds\]\)/, '')
    const guard = (src: string) => /\.in\('store_id', \[\.\.\.storeIds\]\)/.test(src)
    expect(guard(body)).toBe(true)
    expect(guard(tampered)).toBe(false)
  })

  it('detects the payload being dropped from the record select', () => {
    const body = fnBody(action, 'getQueueItemById')
    const tampered = body.replace(
      "'id,platform,event,store_id,payload,retry_count",
      "'id,platform,event,store_id,retry_count"
    )
    const guard = (src: string) => /select\(\s*'id,platform,event,store_id,payload/.test(src)
    expect(guard(body)).toBe(true)
    expect(guard(tampered)).toBe(false)
  })

  it('detects the workspace scoping being dropped', () => {
    const body = fnBody(action, 'getQueueItemById')
    const tampered = body.replace(/\.eq\('workspace_id', workspaceId\)/g, '')
    const guard = (src: string) => (src.match(/\.eq\('workspace_id', workspaceId\)/g) ?? []).length >= 2
    expect(guard(body)).toBe(true)
    expect(guard(tampered)).toBe(false)
  })

  it('does not let another action satisfy the record pins', () => {
    // `getQueueItems` also reads sync_queue and also selects payload, so a pin
    // that searched the whole file would pass even if the record action were
    // deleted. The extractor must isolate the function.
    const isolated = fnBody(action, 'getQueueItems')
    expect(isolated).toMatch(/from\('sync_queue'\)/)
    expect(isolated).not.toMatch(/from\('webhook_inbox'\)/)
  })
})
