/**
 * Zid App Marketplace Subscription Webhook Handler
 *
 * Handles lifecycle events for application subscriptions sent from Zid Partner App Market:
 *   - app.market.subscription.active    → New subscription or activation
 *   - app.market.subscription.renew     → Renewal of existing subscription
 *   - app.market.subscription.upgrade   → Plan upgrade / change
 *   - app.market.subscription.suspended → Subscription suspension
 *   - app.market.subscription.expired   → Subscription expired after grace period
 *   - app.market.subscription.refunded  → Subscription payment refunded / cancelled
 *   - app.market.subscription.warning   → 3-day expiration warning
 *
 * Automatically links the store to its workspace, registers/updates the subscription,
 * records payment ledger entries, unarchives or archives the workspace, and stores the
 * `zid_subscription_id` to reliably track every cancellation or renewal.
 */

import { recordAudit } from '@/lib/audit-logs'
import { computeSubscriptionEndDate, isValidIsoDate } from '@/lib/subscription-dates'
import { supabase } from '@/lib/supabase'
import { archiveWorkspace, unarchiveWorkspace } from '@/lib/workspace-archive'

import { getZidConfig } from './config'
import { getAccessToken } from './token'

export interface ZidSubscriptionPayload {
  event_name?: string
  event?: string
  app_id?: number | string
  store_id?: number | string
  storeId?: number | string
  store_uuid?: string
  store_url?: string
  plan_id?: number | string
  plan_name?: string
  plan_type?: string
  status?: string
  amount_paid?: number | string
  amount?: number | string
  start_date?: string
  end_date?: string | null
  payment_date?: string
  merchant_email?: string
  merchant_phone_no?: string
  subscription_id?: number | string
  id?: number | string
  old_plan_name?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

export interface SubscriptionResult {
  success: boolean
  action: 'activated' | 'renewed' | 'upgraded' | 'cancelled' | 'warning' | 'skipped' | 'no_workspace'
  subscriptionId?: string
  zidSubscriptionId?: string
  workspaceId?: string
  message: string
}

function parseDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const match = value.match(/^\d{4}-\d{2}-\d{2}/)
  if (match && isValidIsoDate(match[0])) {
    return match[0]
  }
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    const iso = parsed.toISOString().slice(0, 10)
    if (isValidIsoDate(iso)) return iso
  }
  return null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Fetch fresh subscription details directly from Zid's App Market API.
 * Endpoint: GET https://api.zid.sa/v1/market/app/subscription
 */
export async function fetchZidSubscriptionDetails(merchantId: string): Promise<Record<string, unknown> | null> {
  try {
    const tokens = await getAccessToken(merchantId)
    if (!tokens?.accessToken) return null

    const config = getZidConfig()
    const url = `${config.apiUrl}/v1/market/app/subscription`

    let authHeader = tokens.authorization || tokens.accessToken
    if (!authHeader.startsWith('Bearer ')) {
      authHeader = `Bearer ${authHeader}`
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        'X-Manager-Token': tokens.accessToken,
        Accept: 'application/json',
        'Accept-Language': 'ar',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.warn('[Zid Subscription] API fetch returned non-200:', res.status)
      return null
    }

    const data = await res.json()
    return data?.subscription ?? null
  } catch (err) {
    console.error('[Zid Subscription] Failed to query Zid subscription API:', err)
    return null
  }
}

/**
 * Resolves the workspace associated with a Zid store identifier or merchant email.
 */
async function resolveWorkspaceForZidStore(
  storeId: number | string,
  storeUuid?: string,
  merchantEmail?: string
): Promise<{ workspaceId: string; userId: string; storeId: string; merchantId?: string } | null> {
  const storeStr = String(storeId)

  // 1. By store_id in merchant_tokens
  if (storeId && storeId !== 0) {
    const { data: byStore } = await supabase
      .from('merchant_tokens')
      .select('workspace_id, merchant_id, store_id')
      .eq('store_id', storeStr)
      .maybeSingle()

    if (byStore?.workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, user_id')
        .eq('id', byStore.workspace_id)
        .maybeSingle()

      if (ws) {
        return {
          workspaceId: ws.id,
          userId: ws.user_id,
          storeId: storeStr,
          merchantId: byStore.merchant_id ?? undefined,
        }
      }
    }

    // 1b. By merchant_id
    const { data: byMerchant } = await supabase
      .from('merchant_tokens')
      .select('workspace_id, merchant_id, store_id')
      .eq('merchant_id', storeStr)
      .maybeSingle()

    if (byMerchant?.workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, user_id')
        .eq('id', byMerchant.workspace_id)
        .maybeSingle()

      if (ws) {
        return {
          workspaceId: ws.id,
          userId: ws.user_id,
          storeId: byMerchant.store_id ?? storeStr,
          merchantId: byMerchant.merchant_id ?? undefined,
        }
      }
    }
  }

  // 2. By store UUID if provided
  if (storeUuid) {
    const { data: byUuid } = await supabase
      .from('merchant_tokens')
      .select('workspace_id, merchant_id, store_id')
      .eq('uuid', storeUuid)
      .maybeSingle()

    if (byUuid?.workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, user_id')
        .eq('id', byUuid.workspace_id)
        .maybeSingle()

      if (ws) {
        return {
          workspaceId: ws.id,
          userId: ws.user_id,
          storeId: byUuid.store_id ?? storeStr,
          merchantId: byUuid.merchant_id ?? undefined,
        }
      }
    }
  }

  // 3. By merchant email matching a user account
  if (merchantEmail) {
    const { data: user } = await supabase
      .from('users')
      .select('id, active_workspace_id')
      .eq('email', merchantEmail.trim().toLowerCase())
      .maybeSingle()

    if (user?.active_workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, user_id')
        .eq('id', user.active_workspace_id)
        .maybeSingle()

      if (ws) {
        return {
          workspaceId: ws.id,
          userId: ws.user_id,
          storeId: storeStr,
        }
      }
    }
  }

  return null
}

/**
 * Main Webhook Handler for Zid App Market Subscriptions.
 */
export async function handleZidSubscriptionWebhook(
  incomingEvent: string,
  storeIdParam: number,
  rawPayload: ZidSubscriptionPayload
): Promise<SubscriptionResult> {
  const data = (rawPayload.data && typeof rawPayload.data === 'object' ? rawPayload.data : rawPayload) as ZidSubscriptionPayload

  const eventName = (
    rawPayload.event_name ||
    rawPayload.event ||
    data.event_name ||
    data.event ||
    incomingEvent ||
    ''
  ).toLowerCase().trim()

  const storeId =
    Number(rawPayload.store_id ?? rawPayload.storeId ?? data.store_id ?? data.storeId ?? storeIdParam) || 0

  const storeUuid = (rawPayload.store_uuid ?? data.store_uuid) as string | undefined
  const merchantEmail = (rawPayload.merchant_email ?? data.merchant_email) as string | undefined
  const merchantPhone = (rawPayload.merchant_phone_no ?? data.merchant_phone_no) as string | undefined

  const planName = String(rawPayload.plan_name ?? data.plan_name ?? 'اشتراك زد')
  const amountPaid = Number(rawPayload.amount_paid ?? data.amount_paid ?? rawPayload.amount ?? data.amount ?? 0)

  const planTypeStr = String(rawPayload.plan_type ?? data.plan_type ?? '').toLowerCase()
  const planNameStr = String(rawPayload.plan_name ?? data.plan_name ?? '').toLowerCase()
  const isFreePlan =
    amountPaid <= 0 ||
    planTypeStr.includes('free') ||
    planTypeStr.includes('trial') ||
    planNameStr.includes('free') ||
    planNameStr.includes('مجان') ||
    planNameStr.includes('تجريب')

  // Subscription ID in Zid App Market:
  const rawSubId = rawPayload.subscription_id ?? data.subscription_id ?? rawPayload.id ?? data.id
  const zidSubscriptionId = rawSubId !== undefined && rawSubId !== null ? String(rawSubId).trim() : ''

  // Dates
  const startDate = parseDateOnly(rawPayload.start_date ?? data.start_date ?? rawPayload.payment_date ?? data.payment_date) || todayIso()
  let endDate = parseDateOnly(rawPayload.end_date ?? data.end_date)
  if (!endDate) {
    endDate = computeSubscriptionEndDate(startDate, 1)
  }

  // Calculate duration in months (minimum 1)
  const diffDays = Math.max(1, Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / (24 * 3600 * 1000)))
  const monthsPaid = Math.max(1, Math.round(diffDays / 30))

  // 1. Locate the workspace
  const resolved = await resolveWorkspaceForZidStore(storeId, storeUuid, merchantEmail)

  if (!resolved) {
    console.warn('[Zid Subscription] No workspace found for store:', { storeId, storeUuid, merchantEmail })
    return {
      success: false,
      action: 'no_workspace',
      message: `لم يتم العثور على مساحة عمل مربوطة بمتجر زد رقم ${storeId}`,
    }
  }

  const { workspaceId, userId } = resolved

  // Update client phone if available and missing
  if (merchantPhone) {
    await supabase
      .from('users')
      .update({ phone: merchantPhone })
      .eq('id', userId)
      .is('phone', null)
  }

  // 2. Classify event
  const isWarning = eventName.includes('warning')
  const isCancellation =
    eventName.includes('suspended') ||
    eventName.includes('suspend') ||
    eventName.includes('expired') ||
    eventName.includes('expire') ||
    eventName.includes('refund') ||
    eventName.includes('cancel')
  const isUpgrade = eventName.includes('upgrade')
  const isRenew = eventName.includes('renew')

  // ── Handling Warning ──────────────────────────────────────────
  if (isWarning) {
    await recordAudit({
      actorId: `zid:store:${storeId}`,
      actorRole: 'system',
      action: 'subscription.zid_warning',
      entityType: 'Subscription',
      entityId: zidSubscriptionId || workspaceId,
      metadata: {
        workspace_id: workspaceId,
        store_id: storeId,
        event: eventName,
        plan_name: planName,
        end_date: endDate,
      },
    })
    return {
      success: true,
      action: 'warning',
      workspaceId,
      zidSubscriptionId,
      message: 'تم تسجيل إشعار قرب انتهاء الاشتراك بنجاح',
    }
  }

  // ── Handling Cancellation / Expiration / Refund ───────────────
  if (isCancellation) {
    // A secondary store cancellation on the free plan must NEVER cancel or affect the active paid subscription!
    if (isFreePlan) {
      await recordAudit({
        actorId: `zid:store:${storeId}`,
        actorRole: 'system',
        action: 'subscription.zid_free_cancelled',
        entityType: 'Subscription',
        entityId: zidSubscriptionId || workspaceId,
        metadata: {
          workspace_id: workspaceId,
          store_id: storeId,
          event: eventName,
          plan_name: planName,
          detail: 'secondary_free_store_cancelled_without_affecting_paid_sub',
        },
      })

      return {
        success: true,
        action: 'skipped',
        workspaceId,
        zidSubscriptionId,
        message: 'إلغاء المتجر المجاني الإضافي لا يؤثر على الاشتراك المدفوع لمساحة العمل',
      }
    }

    let cancelQuery = supabase
      .from('subscriptions')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')

    // If specific zid_subscription_id is known, target it directly
    if (zidSubscriptionId) {
      cancelQuery = cancelQuery.eq('zid_subscription_id', zidSubscriptionId)
    }

    const { data: cancelledSubs, error: cancelErr } = await cancelQuery.select('id')

    if (cancelErr) {
      console.error('[Zid Subscription] Error cancelling subscription:', cancelErr.message)
      return {
        success: false,
        action: 'cancelled',
        workspaceId,
        message: cancelErr.message,
      }
    }

    // Check if workspace has any remaining valid paid subscriptions
    const { data: remainingActive } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .gt('amount_paid', 0)
      .gte('end_date', todayIso())

    if (!remainingActive || remainingActive.length === 0) {
      await archiveWorkspace(workspaceId)
    }

    await recordAudit({
      actorId: `zid:store:${storeId}`,
      actorRole: 'system',
      action: 'subscription.zid_cancelled',
      entityType: 'Subscription',
      entityId: zidSubscriptionId || workspaceId,
      metadata: {
        workspace_id: workspaceId,
        store_id: storeId,
        event: eventName,
        zid_subscription_id: zidSubscriptionId,
        cancelled_count: cancelledSubs?.length ?? 0,
      },
    })

    return {
      success: true,
      action: 'cancelled',
      workspaceId,
      zidSubscriptionId,
      message: 'تم إلغاء الاشتراك وإيقافه داخل المنصة بنجاح',
    }
  }

  // ── Protection Against Free Plan Vulnerability ────────────────
  // The Free plan in Zid App Market is ONLY intended for secondary stores when
  // the workspace already has an active paid subscription (monthly or yearly).
  // If the merchant does not have an active paid subscription, picking the free
  // plan must NOT create any subscription row, must NOT create payments, and
  // must NOT activate or unarchive the workspace.
  if (isFreePlan) {
    const { data: activePaidSubs } = await supabase
      .from('subscriptions')
      .select('id, end_date, amount_paid')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .gt('amount_paid', 0)
      .gte('end_date', todayIso())
      .order('end_date', { ascending: false })
      .limit(1)

    const hasActivePaidSub = !!(activePaidSubs && activePaidSubs.length > 0)

    if (!hasActivePaidSub) {
      console.warn('[Zid Subscription] Free plan rejected: no active paid subscription on workspace:', {
        workspaceId,
        storeId,
        planName,
      })

      await recordAudit({
        actorId: `zid:store:${storeId}`,
        actorRole: 'system',
        action: 'subscription.zid_free_rejected',
        entityType: 'Subscription',
        entityId: zidSubscriptionId || workspaceId,
        metadata: {
          workspace_id: workspaceId,
          store_id: storeId,
          event: eventName,
          plan_name: planName,
          reason: 'free_plan_without_paid_subscription',
        },
      })

      return {
        success: true,
        action: 'skipped',
        workspaceId,
        zidSubscriptionId,
        message: 'تم تجاهل تفعيل الباقة المجانية لعدم وجود اشتراك مدفوع مسبق في مساحة العمل',
      }
    }

    // Workspace ALREADY has an active paid subscription:
    // Secondary store is authorized under the existing paid subscription.
    // Do NOT create a 0-amount subscription, do NOT cancel the paid one, do NOT create a payment.
    await recordAudit({
      actorId: `zid:store:${storeId}`,
      actorRole: 'system',
      action: 'subscription.zid_free_attached',
      entityType: 'Subscription',
      entityId: activePaidSubs[0].id,
      metadata: {
        workspace_id: workspaceId,
        store_id: storeId,
        event: eventName,
        plan_name: planName,
        paid_subscription_id: activePaidSubs[0].id,
      },
    })

    return {
      success: true,
      action: 'skipped',
      workspaceId,
      zidSubscriptionId,
      message: 'تم ربط المتجر بنجاح تحت مظلة الاشتراك المدفوع القائم لمساحة العمل',
    }
  }

  // ── Handling Renewal ──────────────────────────────────────────
  if (isRenew) {
    // Check if we have an existing subscription matching this zid_subscription_id or workspace
    let matchQuery = supabase
      .from('subscriptions')
      .select('id, amount_paid, end_date')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')

    if (zidSubscriptionId) {
      matchQuery = matchQuery.eq('zid_subscription_id', zidSubscriptionId)
    } else {
      matchQuery = matchQuery.eq('platform', 'zid')
    }

    const { data: existingSub } = await matchQuery.order('end_date', { ascending: false }).limit(1).maybeSingle()

    if (existingSub) {
      const updatedTotal = Number(existingSub.amount_paid || 0) + amountPaid
      await supabase
        .from('subscriptions')
        .update({
          end_date: endDate,
          amount_paid: updatedTotal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingSub.id)

      if (amountPaid > 0) {
        await supabase.from('subscription_payments').insert([
          {
            subscription_id: existingSub.id,
            amount: amountPaid,
            currency: 'SAR',
            paid_at: startDate,
            notes: `تجديد اشتراك زد (${planName})`,
            created_by: 'system:zid',
          },
        ])
      }

      await unarchiveWorkspace(workspaceId)

      await recordAudit({
        actorId: `zid:store:${storeId}`,
        actorRole: 'system',
        action: 'subscription.zid_renew',
        entityType: 'Subscription',
        entityId: existingSub.id,
        metadata: {
          workspace_id: workspaceId,
          store_id: storeId,
          zid_subscription_id: zidSubscriptionId,
          end_date: endDate,
          amount_paid: amountPaid,
        },
      })

      return {
        success: true,
        action: 'renewed',
        subscriptionId: existingSub.id,
        zidSubscriptionId,
        workspaceId,
        message: 'تم تجديد الاشتراك بنجاح',
      }
    }
  }

  // ── Handling Upgrade or New Activation ────────────────────────
  // Cancel previous active subscriptions for this workspace
  await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')

  // Insert the newly activated or upgraded subscription
  const { data: newSub, error: subErr } = await supabase
    .from('subscriptions')
    .insert([
      {
        workspace_id: workspaceId,
        user_id: userId,
        start_date: startDate,
        months_paid: monthsPaid,
        end_date: endDate,
        amount_paid: amountPaid,
        currency: 'SAR',
        status: 'active',
        zid_subscription_id: zidSubscriptionId || null,
        plan_name: planName,
        platform: 'zid',
        notes: isUpgrade
          ? `ترقية باقة متجر زد إلى (${planName})`
          : `اشتراك عبر متجر تطبيقات زد (${planName})`,
        created_by: 'system:zid',
      },
    ])
    .select('id')
    .single()

  if (subErr || !newSub) {
    console.error('[Zid Subscription] Failed to create subscription:', subErr?.message)
    return {
      success: false,
      action: isUpgrade ? 'upgraded' : 'activated',
      workspaceId,
      message: subErr?.message ?? 'فشل إنشاء الاشتراك',
    }
  }

  // Record payment if amount > 0
  if (amountPaid > 0) {
    await supabase.from('subscription_payments').insert([
      {
        subscription_id: newSub.id,
        amount: amountPaid,
        currency: 'SAR',
        paid_at: startDate,
        notes: isUpgrade
          ? `دفعة ترقية باقة زد (${planName})`
          : `دفعة اشتراك تطبيق زد (${planName})`,
        created_by: 'system:zid',
      },
    ])
  }

  // Ensure workspace is open and unarchived
  await unarchiveWorkspace(workspaceId)

  await recordAudit({
    actorId: `zid:store:${storeId}`,
    actorRole: 'system',
    action: isUpgrade ? 'subscription.zid_upgrade' : 'subscription.zid_active',
    entityType: 'Subscription',
    entityId: newSub.id,
    metadata: {
      workspace_id: workspaceId,
      store_id: storeId,
      zid_subscription_id: zidSubscriptionId,
      plan_name: planName,
      start_date: startDate,
      end_date: endDate,
      amount_paid: amountPaid,
    },
  })

  return {
    success: true,
    action: isUpgrade ? 'upgraded' : 'activated',
    subscriptionId: newSub.id,
    zidSubscriptionId,
    workspaceId,
    message: isUpgrade ? 'تمت ترقية الباقة بنجاح' : 'تم تفعيل الاشتراك الجديد بنجاح',
  }
}
