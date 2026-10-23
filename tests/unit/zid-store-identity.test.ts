/**
 * توحيد هوية المتجر في زد (src/lib/zid/store-identity.ts).
 *
 * الخلفية (bug حي، 2026-10-22): الويب هوك المُسجَّل في زد يحمل في الـURL
 * `store_id=<merchant_id>` بينما جسم معظم الأحداث يحمل معرف المتجر الحقيقي.
 * صفوف النجاح آنذاك كانت تُسجّل sync_logs بمعرف المتجر (3172448)، بينما
 * حدث بلا store_id في جسمه (product.delete) يسقط على معرف المالك
 * (3236165) — فحقّ البحث عن السجل القديم `.eq('store_id',
 * mapping.merchant_id)` لم يجد شيئاً فردّ "No matching product.template
 * record found in Odoo for delete" رغم أن المنتج مُزامَن قبلاً بنفس
 * المعرف الجيد.
 *
 * المُثبَّت هنا:
 *   - merchant_id يُحلّ إلى store_id الحقيقي عبر merchant_tokens
 *     (store_id أولاً ثم merchant_id — نفس قاعدة resolveZidTokenRow).
 *   - store_id الصحيح يمرّ عبر استعلام واحد فقط (لا هبوط على merchant).
 *   - قيمة غير معروفة تعود كما هي باستعلامين (فشل هادئ، لا استثناء).
 *   - قيمة غير صالحة (0، سالب، عشري) تعود كما هي بلا أي استعلام.
 *   - المسار يستدعي التوحيد فعلاً قبل أي استخدام لهوية المتجر.
 */

import fs from 'fs'
import path from 'path'

import { normalizeZidStoreId } from '@/lib/zid/store-identity'

import { supabase } from '../mocks/supabase'

function readStripped(relativePath: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

type Row = Record<string, unknown> | null

/**
 * بناء وهمي يتحكم ببيانات maybeSingle بالترتيب: [byStore, byMerchant].
 * يسجّل في `supabase.calls` بنفس شكل الـmock الرسمي لأن الاختبار يعتمد
 * على قراءة الاستعلامات من `calls`.
 */
function fakeQueryBuilder(
  table: string,
  results: [Row, Row?]
) {
  let read = 0
  const nextRow = (): Row => {
    const row: Row = results[read] ?? null
    read += 1
    return row
  }
  const builder = {
    select: (...args: unknown[]) => {
      supabase.calls.push({ table, op: 'select', args, filters: [] } as never)
      return builder
    },
    eq: (column: string, value: unknown) => {
      const last = supabase.calls[supabase.calls.length - 1] as unknown as { filters: Array<[string, unknown]> } | undefined
      last?.filters.push([column, value])
      return builder
    },
    maybeSingle: async () => ({ data: nextRow(), error: null }),
  }
  return builder
}

const readCalls = (table: string): Array<{ filters: Array<[string, unknown]> }> =>
  (supabase.calls as unknown as Array<{ table: string; op: string; filters: Array<[string, unknown]> }>)
    .filter((c) => c.table === table && c.op === 'select')

beforeEach(() => {
  supabase.reset()
  jest.clearAllMocks()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('normalizeZidStoreId resolves both identity forms to the real store', () => {
  it('a delivery carrying the merchant id is resolved to the real store_id', async () => {
    const spy = jest
      .spyOn(supabase, 'from')
      .mockReturnValue(fakeQueryBuilder('merchant_tokens', [{ store_id: 444001 }]) as never)
    await expect(normalizeZidStoreId(555001)).resolves.toBe(444001)
    expect(spy).toHaveBeenCalledWith('merchant_tokens')
  })

  it('a delivery carrying the real store_id passes a single store-first lookup', async () => {
    jest
      .spyOn(supabase, 'from')
      .mockReturnValue(fakeQueryBuilder('merchant_tokens', [{ store_id: 444002 }]) as never)
    await expect(normalizeZidStoreId(444002)).resolves.toBe(444002)
    const selects = readCalls('merchant_tokens')
    expect(selects.length).toBe(1)
    const filters = new Map(selects[0].filters)
    expect(filters.get('store_id')).toBe('444002')
  })

  it('a value that is neither store nor merchant stays unchanged (two lookups, no throw)', async () => {
    jest
      .spyOn(supabase, 'from')
      .mockReturnValue(fakeQueryBuilder('merchant_tokens', [null, null]) as never)
    await expect(normalizeZidStoreId(999999)).resolves.toBe(999999)
    expect(readCalls('merchant_tokens').length).toBe(2)
  })

  it('a query failure degrades to the input value instead of rejecting', async () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: null, error: { message: 'boom' } }),
    }
    jest.spyOn(supabase, 'from').mockReturnValue(builder as never)
    await expect(normalizeZidStoreId(788001)).resolves.toBe(788001)
  })
})

describe('invalid ids never touch the database', () => {
  it.each([0, -1, NaN, 3.5])('returns %s untouched', async (bad) => {
    await expect(normalizeZidStoreId(bad as number)).resolves.toBe(bad)
    expect(supabase.calls.length).toBe(0)
  })
})

describe('route wiring pins (fail if the identity unification is removed)', () => {
  const route = readStripped('src/app/api/webhooks/zid/route.ts')

  it('the webhook route normalizes the store id before any other use', () => {
    expect(route).toContain('await normalizeZidStoreId(store_id)')
  })

  it('the route imports the unifier — not an inline copy', () => {
    expect(route).toContain("normalizeZidStoreId } from '@/lib/zid/store-identity'")
  })

  it('the unifier is the single normalization — no second inline merchant rewrite in the route', () => {
    // لو ظهرت إعادة كتابة ثانية لاحقاً فستعود المقارنة الهشة بين معرفين
    // لنفس المتجر في أماكن متفرقة (نفس الجذر السابق). سطر الاستيراد لا يحوي
    // أقواساً، فمطابقة `الاسم(` تعني استدعاءً فعلياً.
    const occurrences = (route.match(/normalizeZidStoreId\(/g) || []).length
    expect(occurrences).toBe(1)
  })
})
