import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(path.join(process.cwd(), 'src/lib/sync-queue.ts'), 'utf8')
const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261103155209_durable_webhook_execution.sql'), 'utf8')
const inbox = fs.readFileSync(path.join(process.cwd(), 'src/lib/webhook-inbox.ts'), 'utf8')
const leaseRecoverySql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261117174500_queue_lease_recovery.sql'),
  'utf8'
)
const executeOperation = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/odoo/execute-operation.ts'),
  'utf8'
)

// The superseded coalescing/read-then-delete pins are replaced by stronger
// receipt identity and fenced leases. Actual worker execution is covered in
// queue-settlement-execution.test.ts, including 100/1000-job runs.
describe('durable queue race guards', () => {
  it('preserves separate accepted deliveries instead of destructive coalescing', () => {
    expect(source.includes('const toProcess = items')).toBe(true)
    expect(source.includes('coalesceTarget')).toBe(false)
    expect(source.includes('staleIds')).toBe(false)
  })
  it('dispatches and marks a receipt in one transaction', () => {
    const dispatch = sql.slice(sql.indexOf('FUNCTION public.dispatch_webhook_receipt'), sql.indexOf('FUNCTION public.claim_sync_job'))
    expect(dispatch.includes('FOR UPDATE')).toBe(true)
    expect(dispatch.includes('receipt.queue_id IS NOT NULL')).toBe(true)
    expect(dispatch.includes('ON CONFLICT(receipt_id)')).toBe(true)
    expect(dispatch.includes("queue_id=job_id,status='done'")).toBe(true)
    expect(inbox.includes("supabase.rpc('dispatch_webhook_receipt'")).toBe(true)
  })
  it('claims only unleased work even when Send Now bypasses backoff', () => {
    const claim = sql.slice(sql.indexOf('FUNCTION public.claim_sync_job'), sql.indexOf('FUNCTION public.expire_sync_job_leases'))
    const guarded = (s: string) => /q\.lease_token IS NULL AND NOT q\.outcome_unknown/.test(s) && /p_force OR/.test(s)
    expect(guarded(claim)).toBe(true)
    expect(guarded(claim.replace('q.lease_token IS NULL AND NOT q.outcome_unknown', 'true'))).toBe(false)
    expect(source.includes("supabase.rpc('claim_sync_job'")).toBe(true)
  })
  it('fences success, retry and quarantine by claim token', () => {
    const settlement = source.slice(source.indexOf('async function settleSuccessfulItem'), source.indexOf('async function processOneItem'))
    expect((settlement.match(/eq\('lease_token', item.lease_token\)/g) ?? []).length).toBe(2)
    const retry = source.slice(source.indexOf('async function incrementRetry'), source.indexOf('// ─── Cleanup'))
    expect((retry.match(/eq\('lease_token', item.lease_token\)/g) ?? []).length).toBe(3)
    expect(retry.includes('lease_token: null')).toBe(true)
  })
  it('parks expired and uncertain outcomes, never auto-reclaims their remote effects', () => {
    expect(sql.includes('outcome_unknown=true,next_retry_at=NULL')).toBe(true)
    expect(source.includes('await parkUnknownOutcome(item)')).toBe(true)
    expect(source.includes("supabase.rpc('expire_sync_job_leases')")).toBe(true)
  })
  it('retains permanent new receipt identities during pruning', () => {
    expect(inbox.includes(".eq('durable_version', 1)")).toBe(true)
    expect(sql.includes('durable_version=2 AND dedup_key IS NOT NULL')).toBe(true)
  })
  it('archives only unchanged frozen work and excludes uncertain effects', () => {
    const archive = source.slice(source.indexOf('export async function archiveExhaustedSyncJobs'))
    expect((archive.match(/eq\('outcome_unknown', false\)/g) ?? []).length).toBe(2)
    expect((archive.match(/is\('next_retry_at', null\)/g) ?? []).length).toBe(2)
  })
  it('never falls back to an unfenced legacy claim if migration is missing', () => {
    const claim = source.slice(source.indexOf('async function claimQueueItem'), source.indexOf('async function settleSuccessfulItem'))
    expect(claim.includes('return null')).toBe(true)
    expect(claim.includes('.update(')).toBe(false)
  })
  it('serializes parent and child product events within one product family', () => {
    expect(source.includes('const productFamilyId = (item: QueueItem)')).toBe(true)
    expect(source.includes('const runningProductFamilies = new Set<string>()')).toBe(true)
    expect(source.includes('serialProductKey(item)')).toBe(true)
    expect(source.includes('runningProductFamilies.add(productKey)')).toBe(true)
    expect(source.includes('runningProductFamilies.delete(productKey)')).toBe(true)
  })

  it('does not trip the workspace circuit breaker for deterministic business errors', () => {
    expect(source.includes('function isCircuitBreakerFailure(errorMessage?: string)')).toBe(true)
    expect(source.includes('if (isCircuitBreakerFailure(errorMessage))')).toBe(true)
    expect(source.includes('Parent product template')).toBe(false)
    const classifier = source.slice(
      source.indexOf('function isCircuitBreakerFailure'),
      source.indexOf('async function incrementRetry')
    )
    expect(classifier).toMatch(/unknown xml-rpc tag/)
    expect(classifier).toMatch(/502\|503\|504/)
  })

  it('orders product create before publish/update and deletion last', () => {
    const ordering = source.slice(
      source.indexOf('const productDependencyRank'),
      source.indexOf('for (const [, list] of perWorkspace)')
    )
    expect(ordering).toMatch(/if \(isCreate\) return isChild \? 1 : 0/)
    expect(ordering).toMatch(/if \(isPublishOrUpdate\) return isChild \? 3 : 2/)
    expect(ordering).toMatch(/if \(isDelete\) return isChild \? 4 : 5/)
  })

  it('claims queue work in execution-sized waves instead of leasing the whole batch', () => {
    expect(source).toMatch(/for \(let offset = 0; offset < batch\.length; offset \+= CLAIM_CONCURRENCY\)/)
    expect(source).toMatch(/await processClaimedFairly\(claimed\)/)
    expect(source).toMatch(/p_lease_seconds: 60/)
  })

  it('safely requeues expired leases that never started ERP execution', () => {
    expect(leaseRecoverySql).toMatch(/processing_started_at IS NULL/)
    expect(leaseRecoverySql).toMatch(/next_retry_at = now\(\)/)
    expect(leaseRecoverySql).toMatch(/processing_started_at IS NOT NULL/)
    expect(leaseRecoverySql).toMatch(/ERP_OUTCOME_UNKNOWN: active worker lease expired/)
    expect(source).toMatch(/mark_sync_job_started/)
  })


  it('retries product publish/update when product.create has not arrived yet', () => {
    expect(executeOperation).toMatch(/retry after product\.create/)
    expect(executeOperation).toMatch(/const retryMissingProduct = isProductUpdate && productCreateAllowed/)
    expect(source).toMatch(/retry after product\\\.create/)
    expect(source).toMatch(/const isDependencyPending/)
  })
  it('archives deterministic invalid Zid variants but never uncertain ERP effects', () => {
    const helper = source.slice(
      source.indexOf('function isInvalidProductVariantInput'),
      source.indexOf('async function incrementRetry')
    )
    expect(helper).toContain("item.platform === 'zid'")
    expect(helper).toContain('Invalid product variant configuration:')
    expect(helper).toContain('outcome_unknown')
    expect(helper).toContain("from('sync_queue_dead').insert")
    expect(helper).toContain("eq('lease_token', item.lease_token)")
    const retry = source.slice(source.indexOf('async function incrementRetry'))
    expect(retry.indexOf('await parkUnknownOutcome(item)')).toBeLessThan(retry.indexOf('archiveInvalidProductVariant(item'))
  })

})
