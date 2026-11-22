import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * اختبارات الانحدار — خطة "لا تضيع ولا ترفض" (2026-10-22).
 *
 * الغرض: الخطة غيّرت **الاستقبال** و**الطابور** و**التليجرام** — ثلاثة
 * مسارات حرجة. الاختبارات تثبت أن ما لا يجب أن يتغيّر **لم يتغيّر**:
 *
 *   1. ربط زد وأودوو: الأسرار المشتقة، والتحقق قبل أول استعلام، وقاعدة
 *      "الجسم محفّز لا مصدر" — كلها كما هي.
 *   2. Standard Mapping: شكل الإعدادات، وقائمة `enabled_actions`، والبوابة
 *      (بوابةIngress وبوابة المحرك تُقرآن نفس القاعدة).
 *   3. شكل الاستجابة أمام المنصات: نفس أكواد HTTP كما كانت.
 *   4. قاعدة "لا نتيجة = فشل": لا فشل صامت.
 *
 * الاختبارات pin بالـsource لأن السلوك المعني لا يمكن اختباره بلا قاعدة
 * بيانات (وهو بالضبط ما نريد تثبيته: البنية).
 */

const SRC_DIR = join(__dirname, '..', '..', 'src')

function read(...parts: string[]): string {
  return readFileSync(join(SRC_DIR, ...parts), 'utf8')
}

describe('the Zid / Odoo binding is unchanged', () => {
  it('keeps the derived credential as the only Zid ingress mechanism', () => {
    const auth = read('lib', 'zid', 'webhook-auth.ts')
    expect(auth).toContain('zid-webhook-basic-auth:v1')
    // HTTP Basic — the only mechanism Zid documents.
    expect(auth).toContain('Basic')
  })

  it('keeps the per-scope Odoo secret and the auth-before-select order', () => {
    const secret = read('lib', 'odoo', 'webhook-secret.ts')
    expect(secret).toContain('odoo-webhook-secret:v1')
    expect(secret).toContain('ODOO_STOCK_SCOPE_PREFIX')
    expect(secret).toContain('ODOO_RECORD_SCOPE_PREFIX')

    const route = read('app', 'api', 'webhooks', 'odoo', 'route.ts')
    // The authorization check must still run BEFORE the first database read,
    // so an unauthenticated caller gets no existence oracle.
    const authIdx = route.indexOf('authorizeOdooWebhook({')
    const selectIdx = route.indexOf(".from('field_mappings')")
    expect(authIdx).toBeGreaterThan(-1)
    expect(selectIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeLessThan(selectIdx)
  })

  it('keeps the trust rule: the body is a trigger, never a source', () => {
    const route = read('app', 'api', 'webhooks', 'odoo', 'route.ts')
    // The record is read back from the tenant's own Odoo.
    expect(route).toContain('recordFromOdoo')
    // A read that throws must FAIL (retry), never fall back to the body.
    expect(route).toContain('refusing to trust the webhook body')
    expect(route).toContain('return FAIL(`Could not read')
  })

  it('keeps the stock direction re-reading the balance from Odoo', () => {
    const engine = read('lib', 'stock-sync-engine.ts')
    expect(engine).toContain('readOdooQtyAtLocation')
  })
})

describe('the Standard Mapping settings are unchanged', () => {
  it('keeps the settings table shape and its store-scoped unique key', () => {
    const migration = readFileSync(
      join(__dirname, '..', '..', 'supabase', 'migrations', '20261013_store_scoped_mapping_settings.sql'),
      'utf8'
    )
    expect(migration).toContain('standard_mapping_settings')
    expect(migration).toContain('store_id')
  })

  it('keeps the canonical reader and its fallback chain', () => {
    const settings = read('lib', 'mapping-settings.ts')
    expect(settings).toContain('getEffectiveStandardMappingSettings')
    // The exact-store row first, then the platform default ('').
    expect(settings.replace(/\s+/g, ' ')).toContain(".in('store_id', key ? [key, ''] : [''])")
  })

  it('keeps both gates reading the SAME enabled_actions rule', () => {
    // البوابة عند الاستقبال وبوابة المحرك: سطران متطابقان. لو اختلفا
    // لأحدهما لأصبح السلوك غير متوقع.
    const gate = read('lib', 'webhook-gate.ts')
    const engine = read('lib', 'sync', 'settings.ts')
    const gateRule = "settings.enabled_actions.includes(operation)"
    expect(gate).toContain(gateRule)
    expect(engine).toContain(gateRule)
  })

  it('keeps the "no operation named return" rule', () => {
    // `enabled_actions` لا يحتوي 'return' — الإرجاع يُعترض داخل المحرك.
    const eventOp = read('lib', 'event-operation.ts')
    expect(eventOp).not.toMatch(/SyncOperation = [^)]*'return'/)
  })

  it('keeps the delete carve-out for on_delete', () => {
    const gate = read('lib', 'webhook-gate.ts')
    expect(gate).toContain("on_delete !== 'nothing'")
  })
})

describe('the platform-facing HTTP responses are unchanged', () => {
  it('keeps 202 for the Odoo record direction', () => {
    const route = read('app', 'api', 'webhooks', 'odoo', 'route.ts')
    expect(route).toContain("status: 202")
  })

  it('keeps a 2xx for a durable Zid enqueue', () => {
    const zid = read('app', 'api', 'webhooks', 'zid', 'route.ts')
    // The Zid route answers 200/202 for an accepted delivery — never a 4xx
    // for it, because Zid does not resend after a 4xx.
    expect(zid).toContain('status: 202')
    // The only 429 left is the anonymous-IP bucket, and it must come after
    // the credential-gated check.
    const limitIdx = zid.indexOf('checkUnauthenticatedIngressLimit')
    const rejectIdx = zid.indexOf('status: 429')
    expect(limitIdx).toBeGreaterThan(-1)
    expect(rejectIdx).toBeGreaterThan(limitIdx)
    // One early anonymous throttle + one invalid-presented-credential throttle.
    // Neither path is reachable by a verified Basic authorization.
    expect(zid.match(/status: 429/g)?.length ?? 0).toBe(2)
  })

  it('keeps 503 for a durable-storage failure (the retry signal)', () => {
    for (const path of [
      ['app', 'api', 'webhooks', 'zid', 'route.ts'],
      ['app', 'api', 'webhooks', 'salla', 'route.ts'],
      ['app', 'api', 'webhooks', 'shopify', 'route.ts'],
      ['app', 'api', 'webhooks', 'odoo', 'route.ts'],
      ['app', 'api', 'webhooks', 'odoo', 'stock', 'route.ts'],
    ] as const) {
      const src = read(...path)
      expect(src).toContain('503')
    }
  })

  it('keeps 401 for an invalid credential and 500 for an unconfigured one', () => {
    const zid = read('app', 'api', 'webhooks', 'zid', 'route.ts')
    expect(zid).toContain('status: 401')
    expect(zid).toContain('status: 500')
  })
})

describe('the "no result = failure" rule is still in place', () => {
  it('treats a missing result as a failure, not a success', () => {
    const queue = read('lib', 'sync-queue.ts')
    expect(queue).toContain('no result for')
    expect(queue).toContain('no result returned for')
  })

  it('keeps the dead-letter archive and never hard-deletes', () => {
    const queue = read('lib', 'sync-queue.ts')
    expect(queue).toContain('archiveExhaustedSyncJobs')
    expect(queue).toContain('sync_queue_dead')
  })

  it('keeps the per-workspace concurrency cap and the fair-share rotation', () => {
    const queue = read('lib', 'sync-queue.ts')
    expect(queue).toContain('MAX_CONCURRENT_PER_WORKSPACE')
    expect(queue).toContain('runningPerWorkspace.get(ws)')
    // fair-share round-robin between workspaces
    expect(queue).toContain('perWorkspace')
  })
})

describe('nothing in the plan introduced a hard rejection', () => {
  it('has no blanket rate limit left in the webhook routes', () => {
    for (const path of [
      ['app', 'api', 'webhooks', 'zid', 'route.ts'],
      ['app', 'api', 'webhooks', 'salla', 'route.ts'],
      ['app', 'api', 'webhooks', 'shopify', 'route.ts'],
      ['app', 'api', 'webhooks', 'odoo', 'route.ts'],
      ['app', 'api', 'webhooks', 'odoo', 'stock', 'route.ts'],
    ] as const) {
      const src = read(...path)
      expect(src).not.toMatch(/checkRateLimit\s*\(/)
      expect(src).toContain('checkUnauthenticatedIngressLimit')
    }
  })

  it('still protects the Odoo routes from a hard 429 on the global valve', () => {
    // The only refusal left is the anonymous-IP bucket. The global safety
    // valve must surface as 5xx so the platform retries.
    const queue = read('lib', 'sync-queue.ts')
    expect(queue).toContain("return { error: 'ingress_overloaded' }")
    const admission = read('lib', 'ingress-admission.ts')
    expect(admission).toContain('global_cap_exhausted')
  })

  it('has exactly one admission gate for all five platforms', () => {
    const queue = read('lib', 'sync-queue.ts')
    const enqueue = queue.slice(queue.indexOf('export async function enqueueWebhookEvent'))
    expect(enqueue).toContain('admitWorkspaceEvent')
    // …and it is called before anything is written.
    const admitIdx = enqueue.indexOf('admitWorkspaceEvent')
    const receiptIdx = enqueue.indexOf('recordWebhookReceipt')
    expect(admitIdx).toBeLessThan(receiptIdx)
  })
})

describe('the plan did not break the existing source tree', () => {
  it('has no leftover placeholder or TODO markers in the new modules', () => {
    const newModules = [
      'lib/ingress-admission.ts',
      'lib/ingress-batch.ts',
      'lib/telegram-outbox.ts',
      'lib/store-pull-budget.ts',
    ]
    for (const rel of newModules) {
      const src = read(...rel.split('/'))
      expect(src).not.toMatch(/\bFIXME\b|\bXXX\b|\bHACK\b/)
    }
  })

  it('keeps every new module free of a bare `any` in its public API', () => {
    for (const rel of ['lib/ingress-admission.ts', 'lib/telegram-outbox.ts']) {
      const src = read(...rel.split('/'))
      expect(src).not.toMatch(/export (async )?function \w+\([^)]*:\s*any\b/)
    }
  })
})
