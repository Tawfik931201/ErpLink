/**
 * توحيد هوية المتجر في زد (store identity).
 *
 * الويب هوك المُسجَّل في زد يحمل في الـURL معرف المالك (merchant_id)، بينما
 * جسم معظم الأحداث يحمل معرف المتجر (store_id) أو لا يحمل شيئاً — فعند غيابه
 * يسقط المسار على معرّف الـURL. التعامل مع القيمتين كهويتين مختلفتين سجّل
 * أصولاً مختلفة لنفس المتجر (sync_logs بـ store_id=متجر بينما مفتاح البحث
 * عن السجل عند حذف/تحديث لاحق بالـ merchant)، فردّ "No matching record".
 * هذه الوحدة تحلّ أي قيمة عبر صف `merchant_tokens` (store_id أولاً ثم
 * merchant_id — نفس قاعدة resolveZidTokenRow) وتعيد الـ store_id الحقيقي.
 */
import { supabase } from '@/lib/supabase'
import { ttlCache } from '@/lib/ttl-cache'

export async function normalizeZidStoreId(storeId: number): Promise<number> {
  if (!Number.isInteger(storeId) || storeId <= 0) return storeId
  const storeStr = String(storeId)
  try {
    const row = await ttlCache.get(
      `zid:store-normalize:${storeStr}`,
      60_000,
      async () => {
        const byStore = await supabase
          .from('merchant_tokens')
          .select('store_id')
          .eq('store_id', storeStr)
          .maybeSingle()
        if (byStore.error) throw byStore.error
        if (byStore.data) return byStore.data as unknown as Record<string, unknown>
        const byMerchant = await supabase
          .from('merchant_tokens')
          .select('store_id')
          .eq('merchant_id', storeStr)
          .maybeSingle()
        if (byMerchant.error) throw byMerchant.error
        return (byMerchant.data as unknown as Record<string, unknown>) ?? null
      }
    )
    const normalized = Number((row as { store_id?: unknown } | null)?.store_id)
    return Number.isInteger(normalized) && normalized > 0 ? normalized : storeId
  } catch {
    // لا صف ربط ولا خطأ استعلام — أعِد ما جاء؛ الاستقبال يتعامل مع الهوية
    // غير المعروفة بمسارها المعتاد (يتيم أو مستأجر غير موجود).
    return storeId
  }
}
