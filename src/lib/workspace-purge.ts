/**
 * Workspace purge — حذف كل ما يخص مساحة عمل عند حذفها (P-إضافية للموسم).
 *
 * المشكلة: `deleteWorkspace` كان يحذف صف المساحة فقط معتمداً على FK، لكن
 * جداول كاملة بلا FK أصلاً (sync_logs وfield_mappings وerp_connections
 * أُنشئت يدوياً خارج الترحيلات)، و`webhook_inbox` بـ ON DELETE SET NULL —
 * أي أن حذف مساحة كان يترك سجلاتها وطوابيرها وتوكناتها تسبح يتيمة في القاعدة
 * للأبد. هذه الدالة تحذف كل شيء صراحة قبل حذف الصف، فتعمل مع أي تعريف FK.
 *
 * يُستثنى عمداً:
 * - `audit_logs`: بلا عمود workspace (دفتر أمني append-only — إبقاؤه هو
 *   الممارسة الصحيحة، ولا يمكن نسبته لمساحة بدقة).
 * - `sync_reconcile_state`: نطاقات عامة لا تخص مساحة.
 * - `user_settings`: مفتاحها المستخدم لا المساحة.
 */

import { supabase } from './supabase'

export interface WorkspacePurgeReport {
  counts: Record<string, number>
  errors: Record<string, string>
  unregistered: Array<{ platform: string; store: string; ok: boolean }>
}

/** جداول بمفتاح workspace_id — الترتيب: الأكثر حركة أولاً. */
const WORKSPACE_TABLES = [
  'sync_queue',
  'webhook_inbox',
  'sync_queue_dead',
  'sync_logs',
  'data_transfers',
  'custom_odoo_fields',
  'field_mappings',
  'fixed_mappings',
  'product_mappings',
  'category_mappings',
  'payment_method_mappings',
  'order_status_mappings',
  'shipping_method_mappings',
  'tax_mappings',
  'warehouse_mappings',
  'currency_mappings',
  'payment_term_mappings',
  'pricelist_mappings',
  'fixed_mapping_settings',
  'fixed_mapping_rules',
  'standard_mapping_settings',
  // الاشتراكات: مدفوعاتها تتتابع عبر ON DELETE CASCADE، والحذف الصريح هنا
  // يغطي القواعد التي أُنشئت بلا FK.
  'subscriptions',
  'merchant_tokens',
  'salla_tokens',
  'shopify_tokens',
  'erp_connections',
  'telegram_bot_codes',
  'telegram_bot_chats',
  'telegram_bots',
  'workspace_members',
  'workspace_invitations',
] as const

async function deleteFrom(
  table: string,
  workspaceId: string,
  report: WorkspacePurgeReport
): Promise<void> {
  try {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq('workspace_id', workspaceId)
    if (error) {
      report.errors[table] = error.message?.slice(0, 200) ?? 'delete_failed'
      report.counts[table] = 0
    } else {
      report.counts[table] = typeof count === 'number' ? count : 0
    }
  } catch (err) {
    report.errors[table] = err instanceof Error ? err.message.slice(0, 200) : 'delete_failed'
    report.counts[table] = 0
  }
}

export async function purgeWorkspaceData(workspaceId: string): Promise<WorkspacePurgeReport> {
  const report: WorkspacePurgeReport = { counts: {}, errors: {}, unregistered: [] }
  if (!workspaceId) return report

  // 1) معرفات المتاجر أولاً (لازمة لإلغاء webhooks الخارجية وتنظيف المقاييس
  //    قبل حذف صفوف التوكنات).
  let zidStores: string[] = []
  let sallaStores: string[] = []
  let shopifyStores: string[] = []
  try {
    const [zid, salla, shopify] = await Promise.all([
      supabase.from('merchant_tokens').select('merchant_id').eq('workspace_id', workspaceId),
      supabase.from('salla_tokens').select('merchant_id').eq('workspace_id', workspaceId),
      supabase.from('shopify_tokens').select('shop_domain').eq('workspace_id', workspaceId),
    ])
    zidStores = ((zid.data ?? []) as Array<{ merchant_id?: string }>).map((r) => String(r.merchant_id)).filter(Boolean)
    sallaStores = ((salla.data ?? []) as Array<{ merchant_id?: string }>).map((r) => String(r.merchant_id)).filter(Boolean)
    shopifyStores = ((shopify.data ?? []) as Array<{ shop_domain?: string }>).map((r) => String(r.shop_domain)).filter(Boolean)
  } catch {
    // best-effort — الحذف المحلي يكمل حتى لو فشلت القراءة.
  }
  const allStores = [...new Set([...zidStores, ...sallaStores, ...shopifyStores])]

  // 2) إلغاء webhooks المنصات (best-effort — الفشل هنا لا يوقف الحذف المحلي،
  //    لكن يُسجَّل لأن المنصة قد تستمر بالإرسال لنقطة يتيمة).
  try {
    const { unregisterAllZidWebhooks } = await import('@/lib/zid/webhooks')
    const { unregisterSallaWebhooks } = await import('@/lib/salla-client')
    const { unregisterShopifyWebhooks } = await import('@/lib/shopify-client')
    const jobs: Array<Promise<void>> = [
      ...zidStores.map((s) => unregisterAllZidWebhooks(s).then(
        () => { report.unregistered.push({ platform: 'zid', store: s, ok: true }) },
        () => { report.unregistered.push({ platform: 'zid', store: s, ok: false }) }
      )),
      ...sallaStores.map((s) => unregisterSallaWebhooks(s).then(
        () => { report.unregistered.push({ platform: 'salla', store: s, ok: true }) },
        () => { report.unregistered.push({ platform: 'salla', store: s, ok: false }) }
      )),
      ...shopifyStores.map((s) => unregisterShopifyWebhooks(s).then(
        () => { report.unregistered.push({ platform: 'shopify', store: s, ok: true }) },
        () => { report.unregistered.push({ platform: 'shopify', store: s, ok: false }) }
      )),
    ]
    await Promise.allSettled(jobs)
  } catch {
    // best-effort فقط.
  }

  // 3) حذف كل الجداول المرتبطة بالمساحة.
  for (const table of WORKSPACE_TABLES) {
    await deleteFrom(table, workspaceId, report)
  }

  // 4) مقاييس الويب هوك مفتاحها المتجر لا المساحة.
  if (allStores.length > 0) {
    try {
      const { error, count } = await supabase
        .from('webhook_metrics')
        .delete({ count: 'exact' })
        .in('store_id', allStores)
      report.counts['webhook_metrics'] = !error && typeof count === 'number' ? count : 0
      if (error) report.errors['webhook_metrics'] = error.message?.slice(0, 200) ?? 'delete_failed'
    } catch (err) {
      report.errors['webhook_metrics'] = err instanceof Error ? err.message.slice(0, 200) : 'delete_failed'
    }
  }

  // 5) أي مستخدم (مالك أو عضو) يشير لهذه المساحة كنشطة — يُصفَّر (الكود
  //    القديم كان يصلح المستخدم الحاذف فقط).
  try {
    const { error, count } = await supabase
      .from('users')
      .update({ active_workspace_id: null }, { count: 'exact' })
      .eq('active_workspace_id', workspaceId)
    report.counts['users.active_workspace_id_cleared'] = !error && typeof count === 'number' ? count : 0
    if (error) report.errors['users'] = error.message?.slice(0, 200) ?? 'update_failed'
  } catch (err) {
    report.errors['users'] = err instanceof Error ? err.message.slice(0, 200) : 'update_failed'
  }

  // 6) نظافة الذاكرة المحلية.
  try {
    const { clearTelegramCache } = await import('@/lib/telegram-notifier')
    clearTelegramCache(workspaceId)
  } catch {
    // best-effort (TTL قصير على أي حال).
  }
  try {
    const { clearWorkspaceFailureState } = await import('@/lib/sync-queue')
    clearWorkspaceFailureState(workspaceId)
  } catch {
    // best-effort.
  }

  return report
}
