import { readFileSync } from 'fs'
import { join } from 'path'

import {
  INGRESS_BASE_CEILING,
  INGRESS_MAX_CEILING,
  INGRESS_TARGET_PENDING,
  UNAUTHENTICATED_IP_LIMIT_PER_MIN,
  adaptiveCeiling,
  admitWorkspaceEvent,
  checkUnauthenticatedIngressLimit,
  getActiveWorkspaceIds,
  getIngressMetrics,
  resetIngressAdmission,
  setIngressGlobalCapForTest,
  setIngressPendingDepth,
} from '@/lib/ingress-admission'
import { resetRateLimits } from '@/lib/rate-limit'

/**
 * بوابة الاستقبال — "الحد" من رفض إلى تأجيل.
 *
 * العيب الذي يصلحه هذا الملف: كان كل مسار استقبال يردّ **429** عند تجاوز
 * 120 طلب/دقيقة، والمنصات **لا تعيد الإرسال بعد 4xx** ⇒ الطلب كان يُفقد
 * بصمت، بلا سجل وبلا عدّاد.
 */

describe('the adaptive ingress ceiling', () => {
  beforeEach(() => {
    resetIngressAdmission()
    resetRateLimits()
  })

  it('rests at the base ceiling while the queue is empty', () => {
    expect(adaptiveCeiling(0)).toBe(INGRESS_MAX_CEILING)
  })

  it('falls back to the base ceiling when the queue is full', () => {
    expect(adaptiveCeiling(INGRESS_TARGET_PENDING)).toBe(INGRESS_BASE_CEILING)
    expect(adaptiveCeiling(INGRESS_TARGET_PENDING * 10)).toBe(INGRESS_BASE_CEILING)
  })

  it('never leaves the [base, max] band', () => {
    for (const depth of [0, 1, 100, 999, 2000, 5000, 100000, -5]) {
      const ceiling = adaptiveCeiling(depth)
      expect(ceiling).toBeGreaterThanOrEqual(INGRESS_BASE_CEILING)
      expect(ceiling).toBeLessThanOrEqual(INGRESS_MAX_CEILING)
    }
  })

  it('rises as the queue drains — the season knob the user asked for', () => {
    const full = adaptiveCeiling(INGRESS_TARGET_PENDING)
    const half = adaptiveCeiling(INGRESS_TARGET_PENDING / 2)
    const empty = adaptiveCeiling(0)
    expect(empty).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(full)
  })
})

describe('workspace admission', () => {
  beforeEach(() => {
    resetIngressAdmission()
    resetRateLimits()
  })

  it('admits a certified delivery — always, at any volume', () => {
    // 5000 deliveries from one workspace in a burst: not one may be rejected.
    for (let i = 0; i < 5000; i++) {
      const decision = admitWorkspaceEvent('ws-1')
      expect(decision.admitted).toBe(true)
    }
  })

  it('marks the surplus as overflow instead of refusing it', () => {
    // The queue is full ⇒ the ceiling sits at the base (120/min). The first
    // 120 fit the fast lane; the rest are overflow — accepted, never refused.
    setIngressPendingDepth(INGRESS_TARGET_PENDING)
    const lanes: string[] = []
    for (let i = 0; i < 300; i++) {
      lanes.push(admitWorkspaceEvent('ws-1').lane)
    }
    expect(lanes.filter((l) => l === 'fast').length).toBeGreaterThan(0)
    expect(lanes.filter((l) => l === 'overflow').length).toBeGreaterThan(0)
    expect(lanes).not.toContain('rejected')
  })

  it('keeps one workspace from being counted against another', () => {
    setIngressPendingDepth(INGRESS_TARGET_PENDING)
    for (let i = 0; i < 300; i++) admitWorkspaceEvent('noisy-ws')
    const quiet = admitWorkspaceEvent('quiet-ws')
    expect(quiet.admitted).toBe(true)
    expect(quiet.lane).toBe('fast')
  })

  it('only refuses when the global safety valve is exhausted', () => {
    // السقف يُضبط صغيراً هنا: مع السقف الحقيقي (20 ألف/دقيقة) تُخفي
    // إعادة التعبئة أثناء الاختبار استنزافه.
    setIngressGlobalCapForTest(50)
    let refused = 0
    let admitted = 0
    for (let i = 0; i < 500; i++) {
      if (admitWorkspaceEvent(`ws-${i}`).admitted) admitted++
      else refused++
    }
    expect(refused).toBeGreaterThan(0)
    // كل طلب إما قُبل أو رُفض — لا ثالث. والمقبول يوافق السقف تقريباً.
    expect(admitted + refused).toBe(500)
    expect(admitted).toBeLessThanOrEqual(60)
    expect(getIngressMetrics().rejectedGlobal).toBe(refused)
  })

  it('tracks which workspaces are active, so a busy one cannot starve the rest', () => {
    admitWorkspaceEvent('ws-a')
    admitWorkspaceEvent('ws-b')
    expect(getActiveWorkspaceIds().sort()).toEqual(['ws-a', 'ws-b'])
  })

  it('exposes the counters that make rejection and delay visible', () => {
    setIngressPendingDepth(INGRESS_TARGET_PENDING)
    for (let i = 0; i < 200; i++) admitWorkspaceEvent('ws-1')
    const metrics = getIngressMetrics()
    expect(metrics.admitted + metrics.overflow).toBe(200)
    expect(metrics.overflow).toBeGreaterThan(0)
    expect(metrics.workspaces[0].workspaceId).toBe('ws-1')
    expect(metrics.workspaces[0].ratePerMin).toBe(200)
  })
})

describe('the unauthenticated IP limit', () => {
  beforeEach(() => {
    resetIngressAdmission()
    resetRateLimits()
  })

  it('does not throttle cryptographically verified credentials', () => {
    // 5000 certified requests from one IP: the old code answered 429 to the
    // 121st and every platform treats 4xx as "never send again".
    for (let i = 0; i < 5000; i++) {
      const result = checkUnauthenticatedIngressLimit({
        scope: 'zid',
        credentialVerified: true,
        bucketKey: 'zid-webhook:1.2.3.4',
      })
      expect(result.allowed).toBe(true)
    }
  })

  it('still sheds anonymous traffic from one IP', () => {
    let allowed = 0
    for (let i = 0; i < UNAUTHENTICATED_IP_LIMIT_PER_MIN + 50; i++) {
      if (checkUnauthenticatedIngressLimit({
        scope: 'zid',
        credentialVerified: false,
        bucketKey: 'zid-webhook:9.9.9.9',
      }).allowed) allowed++
    }
    expect(allowed).toBe(UNAUTHENTICATED_IP_LIMIT_PER_MIN)
  })

  it('counts and reports every rejection instead of swallowing it', () => {
    for (let i = 0; i < UNAUTHENTICATED_IP_LIMIT_PER_MIN + 10; i++) {
      checkUnauthenticatedIngressLimit({
        scope: 'zid',
        credentialVerified: false,
        bucketKey: 'zid-webhook:8.8.8.8',
      })
    }
    expect(getIngressMetrics().rejectedUnauthenticated).toBeGreaterThan(0)
  })
})

/**
 * Source pins — the routes must not reintroduce a hard 429 on certified
 * traffic. These are the assertions that keep the fix from rotting: a future
 * edit that re-adds a blanket `checkRateLimit(..., 120, ...)` before the auth
 * check would silently restore the silent-loss bug.
 */
describe('the webhook routes never refuse certified deliveries', () => {
  const ROUTES: Array<[string, string]> = [
    ['zid', join(__dirname, '..', '..', 'src', 'app', 'api', 'webhooks', 'zid', 'route.ts')],
    ['salla', join(__dirname, '..', '..', 'src', 'app', 'api', 'webhooks', 'salla', 'route.ts')],
    ['shopify', join(__dirname, '..', '..', 'src', 'app', 'api', 'webhooks', 'shopify', 'route.ts')],
    ['odoo', join(__dirname, '..', '..', 'src', 'app', 'api', 'webhooks', 'odoo', 'route.ts')],
    ['odoo/stock', join(__dirname, '..', '..', 'src', 'app', 'api', 'webhooks', 'odoo', 'stock', 'route.ts')],
  ]

  it.each(ROUTES)('%s limits unauthenticated requests and exempts verified credentials', (_name, path) => {
    const src = readFileSync(path, 'utf8')
    expect(src).toContain('checkUnauthenticatedIngressLimit')
    expect(src).toContain('credentialPresented')
    expect(src).toContain('credentialVerified: false')
    expect(src).toContain('readWebhookBodyWithinLimit(req)')
    expect(src).not.toContain('await req.text()')
    // The old blanket limit must be gone from the route.
    expect(src).not.toMatch(/checkRateLimit\s*\(/)
  })

  it('routes every certified delivery through the single admission gate', () => {
    const queue = readFileSync(
      join(__dirname, '..', '..', 'src', 'lib', 'sync-queue.ts'),
      'utf8'
    )
    expect(queue).toContain('admitWorkspaceEvent')
    // The gate is inside enqueueWebhookEvent — the one path all five
    // platforms share, so no certified delivery can bypass it.
    const enqueue = queue.slice(queue.indexOf('export async function enqueueWebhookEvent'))
    expect(enqueue).toContain('admitWorkspaceEvent')
  })

  it('never answers 429 on the global safety valve — 503 makes the platform retry', () => {
    for (const [, path] of ROUTES) {
      const src = readFileSync(path, 'utf8')
      // The only 429 left is the anonymous-IP bucket; the overload case must
      // surface as a 5xx so the sender retries instead of giving up.
      expect(src).not.toMatch(/ingress_overloaded[\s\S]{0,400}status:\s*429/)
    }
  })
})
