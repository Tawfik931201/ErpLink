'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { recordAudit } from '@/lib/audit-logs'
import { getActiveUserId, getActiveWorkspaceId, isAdmin } from '@/lib/auth'
import { sendEmail } from '@/lib/email'
import { subscriptionRegisteredEmail } from '@/lib/email-templates'
import {
  addDaysToDate,
  addMonthsToDate,
  computeSubscriptionEndDate,
  isValidIsoDate,
} from '@/lib/subscription-dates'
import { daysUntilExpiry, isSubscriptionExpired } from '@/lib/subscription-utils'
import { supabase } from '@/lib/supabase'
import { archiveWorkspace, unarchiveWorkspace } from '@/lib/workspace-archive'
import {
  isTrialExpired,
  trialDaysRemaining,
  trialEndDate,
  trialEndMs,
} from '@/lib/workspace-trial'

/** Shape of a row fetched from the `subscriptions` table (via `select('*')`). */
interface RawSubscription {
  id: string
  workspace_id: string
  user_id: string
  start_date: string
  months_paid: number
  end_date: string
  amount_paid: number | string
  currency: string
  status: string
  notes: string | null
  created_at: string
  archived_at: string | null
}

// ──────────────────────────── Helpers ────────────────────────────

async function requireAdmin() {
  const adminId = await getActiveUserId()
  if (!adminId || !isAdmin(adminId)) {
    throw new Error('Unauthorized: admin only')
  }
  return adminId
}

/** end_date = start_date + months - 1 day (inclusive period). */
function computeEndDate(startDate: string, months: number): string {
  return computeSubscriptionEndDate(startDate, months)
}

function isValidDate(dateStr: string): boolean {
  return isValidIsoDate(dateStr)
}

// ──────────────────────── Read: my subscription ────────────────────────

export interface MySubscription {
  id: string
  workspace_id: string
  user_id: string
  start_date: string
  months_paid: number
  end_date: string
  amount_paid: number | string
  currency: string
  status: string
  notes: string | null
  created_at: string
  isExpired: boolean
  daysRemaining: number
}

/**
 * Free-trial state of the active workspace, returned by
 * `getMyActiveSubscription` ONLY when the workspace has no active-status
 * subscription row (a paid subscription always takes precedence — trial is
 * then null). Derived from `workspaces.created_at` + 7 days; see
 * `src/lib/workspace-trial.ts` for the policy.
 */
export interface WorkspaceTrial {
  /** Trial end as epoch ms — the banner counts down to this exact instant. */
  endsAtMs: number
  /** Trial end as YYYY-MM-DD (UTC) for display, or null if uncomputable. */
  endsAt: string | null
  daysRemaining: number
  isExpired: boolean
}

/** Build the trial payload from a workspace's `created_at`, or null if unknown. */
function buildWorkspaceTrial(createdAt: string | null): WorkspaceTrial | null {
  const endsAtMs = trialEndMs(createdAt)
  if (endsAtMs == null) return null
  return {
    endsAtMs,
    endsAt: trialEndDate(createdAt),
    daysRemaining: trialDaysRemaining(createdAt),
    isExpired: isTrialExpired(createdAt),
  }
}

/**
 * The active subscription of the current user's active workspace (if any).
 * Used by the client dashboard card and the expiry banner.
 *
 * Side effect: if the subscription is expired — or the workspace has no
 * subscription and its 7-day free trial has run out — the workspace is
 * archived immediately (lazy trigger) so the UI reflects the correct state
 * without waiting for the periodic `archiveExpiredWorkspaces` pass in the
 * sync-queue runner.
 *
 * `trial` is non-null only when there is no active-status subscription row;
 * a paid subscription supersedes the trial entirely.
 */
export async function getMyActiveSubscription() {
  try {
    const userId = await getActiveUserId()
    if (!userId) {
      return { success: false as const, subscription: null, trial: null, workspaceArchived: false }
    }

    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) {
      return { success: true as const, subscription: null, trial: null, workspaceArchived: false }
    }

    // One row read gives both the archive flag and the trial clock's origin.
    // `select('*')` on purpose, not a lean column list: `archived_at` only
    // exists once migration 20261018 is applied, and naming a missing column
    // fails the whole request — which would take `created_at` (and with it the
    // trial countdown) down in any environment that has not pasted it.
    // On error wsRow is null → no trial info → the plain no-subscription state
    // (fail-open, exactly like the old `isWorkspaceArchived` behaviour).
    const { data: wsRow } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .maybeSingle()

    const createdAt = (wsRow?.created_at as string | null) ?? null
    const archived = wsRow?.archived_at != null

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .order('end_date', { ascending: false })
      .limit(1)

    if (error) {
      return {
        success: false as const,
        error: error.message,
        subscription: null,
        trial: null,
        workspaceArchived: false,
      }
    }

    const sub = data?.[0]
    if (!sub) {
      // No subscription → the workspace is either inside its free trial or
      // past it. If past, archive it now (fire-and-forget) and report the
      // expired trial so the banner can show the closed state.
      const trial = buildWorkspaceTrial(createdAt)
      if (trial?.isExpired) {
        archiveWorkspace(workspaceId).catch(() => {
          /* best-effort; the periodic pass will retry */
        })
      }
      return { success: true as const, subscription: null, trial, workspaceArchived: archived }
    }

    // Lazy archive: if the subscription is expired, archive the workspace now.
    // Fire-and-forget — the banner should not wait for this write to complete.
    if (isSubscriptionExpired(sub)) {
      archiveWorkspace(workspaceId).catch(() => {
        /* best-effort; the periodic pass will retry */
      })
    }

    return {
      success: true as const,
      subscription: {
        ...sub,
        isExpired: isSubscriptionExpired(sub),
        daysRemaining: daysUntilExpiry(sub.end_date),
      } satisfies MySubscription,
      // A paid subscription supersedes the trial entirely.
      trial: null,
      workspaceArchived: archived,
    }
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : 'unexpected',
      subscription: null,
      trial: null,
      workspaceArchived: false,
    }
  }
}

// ──────────────────────── Admin: register subscription ────────────────────────

const RegisterSchema = z.object({
  clientEmail: z.string().email().max(255),
  workspaceId: z.string().uuid().optional().nullable(),
  newWorkspaceName: z.string().trim().max(120).optional().nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  monthsPaid: z.coerce.number().int().min(1).max(120),
  amountPaid: z.coerce.number().min(0).max(99_999_999),
  cancelExisting: z.boolean().optional(),
  clientPhone: z.string().trim().max(30).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

/**
 * Admin manually registers a subscription for a client (manual payment flow).
 * - Finds the client by email (must already have an account).
 * - Uses an existing workspace, or creates one.
 * - end_date is computed; when `cancelExisting` is true, other active
 *   subscriptions on the workspace are cancelled, otherwise the new one is
 *   added alongside them.
 * - A payment row is created for the paid amount.
 * - No commission is created (affiliate system removed).
 */
export async function registerSubscription(input: {
  clientEmail: string
  workspaceId?: string | null
  newWorkspaceName?: string | null
  startDate: string
  monthsPaid: number
  amountPaid: number
  cancelExisting?: boolean
  clientPhone?: string | null
  notes?: string | null
}) {
  try {
    const adminId = await requireAdmin()
    const parsed = RegisterSchema.parse(input)

    if (!isValidDate(parsed.startDate)) {
      return { success: false, error: 'invalid_start_date' }
    }
    if (!parsed.workspaceId && !parsed.newWorkspaceName) {
      return { success: false, error: 'workspace_required' }
    }

    // 1. Find the client user by email
    const { data: client, error: userErr } = await supabase
      .from('users')
      .select('id, email, name, active_workspace_id')
      .eq('email', parsed.clientEmail)
      .maybeSingle()

    if (userErr || !client) {
      return {
        success: false,
        error: 'client_not_found',
        message:
          'العميل غير موجود في النظام. يجب أن يكون للعميل حساب مسجل قبل تسجيل اشتراكه.',
      }
    }

    // 2. Resolve the workspace (existing or newly created)
    let workspaceId = parsed.workspaceId ?? null
    let ownerUserId = client.id
    let workspaceName = parsed.newWorkspaceName?.trim() ?? ''
    let workspaceSubNumber: string | null = null

    if (workspaceId) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, user_id, name, subscription_number')
        .eq('id', workspaceId)
        .maybeSingle()

      if (!ws) return { success: false, error: 'workspace_not_found' }
      if (ws.user_id !== client.id) {
        return { success: false, error: 'workspace_not_owned_by_client' }
      }
      ownerUserId = ws.user_id
      workspaceName = ws.name ?? workspaceName
      workspaceSubNumber = ws.subscription_number ?? null
    } else {
      const { data: ws, error: wsErr } = await supabase
        .from('workspaces')
        .insert([
          {
            user_id: client.id,
            name: parsed.newWorkspaceName!.trim(),
          },
        ])
        .select('id, subscription_number')
        .single()

      if (wsErr || !ws) return { success: false, error: wsErr?.message ?? 'workspace_create_failed' }
      workspaceId = ws.id
      workspaceSubNumber = ws.subscription_number ?? null

      // Make it the client's active workspace if they don't have one
      if (!client.active_workspace_id) {
        await supabase
          .from('users')
          .update({ active_workspace_id: workspaceId })
          .eq('id', client.id)
      }
    }

    // NOTE: affiliate auto-detect removed (affiliate system cancelled).
    // No affiliate column exists any more (dropped 2026-10-22).

    const startDate = parsed.startDate
    const endDate = computeEndDate(startDate, parsed.monthsPaid)

    // 4. Cancel previous active subscriptions on this workspace (only when requested)
    if (parsed.cancelExisting) {
      await supabase
        .from('subscriptions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
    }

    // 4b. Save the client's phone number (best-effort)
    if (parsed.clientPhone) {
      const { error: phoneErr } = await supabase
        .from('users')
        .update({ phone: parsed.clientPhone })
        .eq('id', client.id)
      if (phoneErr) console.error('[subscriptions] phone update error:', phoneErr.message)
    }

    // 5. Insert the subscription (manual payment only — no commission).
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .insert([
        {
          workspace_id: workspaceId,
          user_id: ownerUserId,
          start_date: startDate,
          months_paid: parsed.monthsPaid,
          end_date: endDate,
          amount_paid: parsed.amountPaid,
          currency: 'USD',
          status: 'active',
          notes: parsed.notes ?? null,
          created_by: adminId,
        },
      ])
      .select()
      .single()

    if (subErr) return { success: false, error: subErr.message }

    // 5a. Unarchive the workspace — a valid subscription now exists on it.
    // (Best-effort: failure here does not fail the registration; the periodic
    // archive pass or the next extension will reconcile the state.)
    // `workspaceId` is set by both branches above (existing lookup or insert).
    await unarchiveWorkspace(workspaceId!)

    // 5b. Record the payment for this subscription
    if (parsed.amountPaid > 0) {
      const { error: payErr } = await supabase.from('subscription_payments').insert([
        {
          subscription_id: sub.id,
          amount: parsed.amountPaid,
          currency: 'USD',
          paid_at: startDate,
          notes: parsed.notes ?? 'دفعة تسجيل اشتراك',
          created_by: adminId,
        },
      ])
      if (payErr) console.error('[subscriptions] payment insert error:', payErr.message)
    }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'subscription.register',
      entityType: 'Subscription',
      entityId: sub.id,
      metadata: {
        workspace_id: workspaceId,
        client_user_id: ownerUserId,
        start_date: startDate,
        months: parsed.monthsPaid,
        end_date: endDate,
        amount: parsed.amountPaid,
      },
    })

    // Notify the client about the new subscription
    if (client.email) {
      try {
        const tpl = subscriptionRegisteredEmail(
          {
            clientName: client.name || client.email,
            workspaceName,
            subscriptionNumber: workspaceSubNumber,
            startDate,
            endDate,
            months: parsed.monthsPaid,
            amount: parsed.amountPaid,
            currency: 'USD',
          },
          'ar',
        )
        await sendEmail({ to: client.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
      } catch (emailErr) {
        console.error('[subscriptions] client notification email failed:', emailErr)
      }
    }

    revalidatePath('/admin/subscriptions')
    revalidatePath('/app/dashboard')
    return { success: true, subscription: sub }
  } catch (err) {
    console.error('[subscriptions] registerSubscription error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'unexpected_error' }
  }
}

// ──────────────────────── Admin: extend / cancel ────────────────────────

const ExtendSchema = z
  .object({
    subscriptionId: z.string().uuid(),
    months: z.coerce.number().int().min(0).max(120).optional(),
    days: z.coerce.number().int().min(0).max(3650).optional(),
    amountPaid: z.coerce.number().min(0).max(99_999_999),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => (d.months ?? 0) > 0 || (d.days ?? 0) > 0, {
    message: 'months_or_days_required',
  })

/**
 * Extend an active subscription.
 *
 * Two modes (can be combined):
 * - `months`: calendar months added to the current `end_date`. Only allowed on
 *   a non-expired subscription — extending an expired one by months requires a
 *   fresh registration instead (unchanged behaviour).
 * - `days`: whole days added. Allowed on an expired subscription too, in which
 *   case the new `end_date` is `today + days` (grace / manual-renewal flow).
 *   Days do NOT change `months_paid` (it is the MRR divisor).
 *
 * When the new `end_date` is valid (>= today), the workspace is unarchived if
 * it was archived due to expiry.
 */
export async function extendSubscription(input: {
  subscriptionId: string
  months?: number
  days?: number
  amountPaid: number
  notes?: string | null
}) {
  try {
    const adminId = await requireAdmin()
    const parsed = ExtendSchema.parse(input)

    const { data: existing, error: readErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', parsed.subscriptionId)
      .maybeSingle()

    if (readErr || !existing) {
      return { success: false, error: readErr?.message ?? 'subscription_not_found' }
    }
    if (existing.status !== 'active') {
      return { success: false, error: 'subscription_not_active' }
    }

    const months = parsed.months ?? 0
    const days = parsed.days ?? 0
    const expired = isSubscriptionExpired(existing)

    if (expired && months > 0) {
      // Unchanged behaviour for the months path — extending an expired
      // subscription by months needs a fresh registration (billing decision).
      // The days path below is the manual-renewal / grace-period flow.
      return {
        success: false,
        error: 'subscription_expired',
        message: 'لا يمكن تمديد اشتراك منتهٍ بالأشهر. سجّل اشتراكاً جديداً، أو استخدم تمديد بالأيام.',
      }
    }

    // Base date: normal case = current end_date; expired + days = today
    // (so the days actually extend from now, not from the past end_date).
    const baseDate = expired ? new Date().toISOString().slice(0, 10) : existing.end_date
    const newEndDate = addDaysToDate(addMonthsToDate(baseDate, months), days)

    const { data: updated, error: upErr } = await supabase
      .from('subscriptions')
      .update({
        end_date: newEndDate,
        months_paid: Number(existing.months_paid) + months,
        amount_paid: Number(existing.amount_paid) + parsed.amountPaid,
        notes: parsed.notes ?? existing.notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.subscriptionId)
      .select()
      .single()

    if (upErr) return { success: false, error: upErr.message }

    // If the subscription is now valid again, unarchive the workspace.
    if (!isSubscriptionExpired({ end_date: newEndDate })) {
      await unarchiveWorkspace(existing.workspace_id)
    }

    // Record the extension payment
    if (parsed.amountPaid > 0) {
      const { error: payErr } = await supabase.from('subscription_payments').insert([
        {
          subscription_id: existing.id,
          amount: parsed.amountPaid,
          currency: 'USD',
          paid_at: new Date().toISOString().slice(0, 10),
          notes: parsed.notes ?? 'دفعة تمديد اشتراك',
          created_by: adminId,
        },
      ])
      if (payErr) console.error('[subscriptions] extension payment insert error:', payErr.message)
    }

    // Record the extension payment (manual payment only — no commission).

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'subscription.extend',
      entityType: 'Subscription',
      entityId: parsed.subscriptionId,
      metadata: { months, days, new_end_date: newEndDate, amount: parsed.amountPaid },
    })

    revalidatePath('/admin/subscriptions')
    revalidatePath('/app/dashboard')
    return { success: true, subscription: updated }
  } catch (err) {
    console.error('[subscriptions] extendSubscription error:', err)
    return { success: false, error: err instanceof Error ? err.message : 'unexpected_error' }
  }
}

/** Cancel an active subscription (manual). */
export async function cancelSubscription(input: { subscriptionId: string }) {
  try {
    const adminId = await requireAdmin()
    const parsed = z.object({ subscriptionId: z.string().uuid() }).parse(input)

    const { data: updated, error } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', parsed.subscriptionId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'subscription.cancel',
      entityType: 'Subscription',
      entityId: parsed.subscriptionId,
      metadata: { workspace_id: updated.workspace_id },
    })

    revalidatePath('/admin/subscriptions')
    revalidatePath('/app/dashboard')
    return { success: true, subscription: updated }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unexpected_error' }
  }
}

// ──────────────────────── Admin: archive / restore subscriptions ────────────────────────

/**
 * Soft-hide an old workspace subscription so it no longer clutters the
 * client's statement. Records are kept (audit trail + payments intact).
 */
export async function archiveSubscription(input: { subscriptionId: string }) {
  try {
    const adminId = await requireAdmin()
    const parsed = z.object({ subscriptionId: z.string().uuid() }).parse(input)

    const { data: updated, error } = await supabase
      .from('subscriptions')
      .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', parsed.subscriptionId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'subscription.archive',
      entityType: 'Subscription',
      entityId: parsed.subscriptionId,
      metadata: { workspace_id: updated.workspace_id },
    })

    revalidatePath('/admin/subscriptions')
    revalidatePath('/app/dashboard')
    return { success: true, subscription: updated }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unexpected_error' }
  }
}

/** Bring an archived subscription back into the visible statement. */
export async function restoreSubscription(input: { subscriptionId: string }) {
  try {
    const adminId = await requireAdmin()
    const parsed = z.object({ subscriptionId: z.string().uuid() }).parse(input)

    const { data: updated, error } = await supabase
      .from('subscriptions')
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .eq('id', parsed.subscriptionId)
      .select()
      .single()

    if (error) return { success: false, error: error.message }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'subscription.restore',
      entityType: 'Subscription',
      entityId: parsed.subscriptionId,
      metadata: { workspace_id: updated.workspace_id },
    })

    revalidatePath('/admin/subscriptions')
    revalidatePath('/app/dashboard')
    return { success: true, subscription: updated }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unexpected_error' }
  }
}

const AddPaymentSchema = z.object({
  subscriptionId: z.string().uuid(),
  amount: z.coerce.number().positive().max(99_999_999),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional().nullable(),
})

/**
 * Admin records an additional payment against a subscription (e.g. an
 * upgrade difference). The subscription's running `amount_paid` total is
 * increased by the same amount.
 */
export async function addSubscriptionPayment(input: {
  subscriptionId: string
  amount: number
  paidAt: string
  notes?: string | null
}) {
  try {
    const adminId = await requireAdmin()
    const parsed = AddPaymentSchema.parse(input)

    const { data: existing, error: readErr } = await supabase
      .from('subscriptions')
      .select('id, amount_paid, workspace_id, user_id, status')
      .eq('id', parsed.subscriptionId)
      .maybeSingle()

    if (readErr || !existing) {
      return { success: false, error: readErr?.message ?? 'subscription_not_found' }
    }

    if (existing.status === 'cancelled') {
      return {
        success: false,
        error: 'subscription_cancelled',
        message: 'لا يمكن تسجيل دفعة على اشتراك ملغى.',
      }
    }

    const { data: payment, error: payErr } = await supabase
      .from('subscription_payments')
      .insert([
        {
          subscription_id: existing.id,
          amount: parsed.amount,
          currency: 'USD',
          paid_at: parsed.paidAt,
          notes: parsed.notes ?? null,
          created_by: adminId,
        },
      ])
      .select()
      .single()

    if (payErr) return { success: false, error: payErr.message }

    // Increase the running total on the subscription
    await supabase
      .from('subscriptions')
      .update({
        amount_paid: Math.round((Number(existing.amount_paid) + parsed.amount) * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: 'subscription.payment.add',
      entityType: 'SubscriptionPayment',
      entityId: payment.id,
      metadata: { subscription_id: existing.id, workspace_id: existing.workspace_id, amount: parsed.amount },
    })

    revalidatePath('/admin/subscriptions')
    revalidatePath('/admin/clients')
    revalidatePath('/app/dashboard')
    return { success: true, payment }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unexpected_error' }
  }
}

// ──────────────────────── Admin: listings & pickers ────────────────────────

export interface AdminSubscriptionRow {
  id: string
  workspace_id: string
  user_id: string
  start_date: string
  months_paid: number
  end_date: string
  amount_paid: number | string
  currency: string
  status: string
  notes: string | null
  created_at: string
  isExpired: boolean
  daysRemaining: number
  workspace_name: string | null
  client_name: string | null
  client_email: string | null
  subscription_number: string | null
  active_sub_count: number
}

export interface UserPick {
  id: string
  email: string
  name: string | null
  active_workspace_id: string | null
  workspaces: { id: string; name: string }[]
}

// NOTE: Affiliate system removed.
// `AffiliatePick`, `getActiveAffiliates` and `detectAffiliateForClient` were
// deleted, and the `partner_*` tables were dropped 2026-10-22. See AGENTS.md.

/** Admin: list all subscriptions with client / workspace info (manual payments only). */
export async function getAllSubscriptions() {
  try {
    await requireAdmin()

    // 1. Fetch all workspaces (up to 5000)
    const { data: workspaces, error: wsErr } = await supabase
      .from('workspaces')
      .select('id, name, subscription_number, user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(5000)

    if (wsErr) return { success: false as const, error: wsErr.message, rows: [] }

    const wsList = workspaces ?? []
    if (wsList.length === 0) return { success: true as const, rows: [] }

    // 2. Fetch users in bulk
    const userIds = Array.from(new Set(wsList.map((w) => w.user_id).filter(Boolean)))
    const { data: users } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', userIds.length ? userIds : ['__none__'])

    const userMap = new Map((users ?? []).map((u) => [u.id, u]))

    // 3. Fetch subscriptions in bulk
    const wsIds = wsList.map((w) => w.id)
    const { data: subs } = await supabase
      .from('subscriptions')
      .select(
        'id, workspace_id, user_id, start_date, months_paid, end_date, amount_paid, currency, status, notes, created_at, archived_at',
      )
      .in('workspace_id', wsIds)
      .order('created_at', { ascending: false })
      .limit(5000)

    const subMap = new Map<string, RawSubscription[]>()
    if (subs) {
      for (const sub of subs) {
        if (!subMap.has(sub.workspace_id)) {
          subMap.set(sub.workspace_id, [])
        }
        subMap.get(sub.workspace_id)!.push(sub)
      }
    }

    // 5. Construct rows (Flattened: one row per subscription)
    const rows: AdminSubscriptionRow[] = []

    for (const ws of wsList) {
      const user = ws.user_id ? userMap.get(ws.user_id) : null
      const wsSubs = subMap.get(ws.id) ?? []
      const activeSubCount = wsSubs.filter(
        (s) => s.status === 'active' && !isSubscriptionExpired(s),
      ).length

      if (wsSubs.length > 0) {
        // If there are subscriptions, add each one as an independent row
        for (const sub of wsSubs) {
          rows.push({
            id: sub.id,
            workspace_id: ws.id,
            user_id: ws.user_id || '',
            start_date: sub.start_date,
            months_paid: sub.months_paid,
            end_date: sub.end_date,
            amount_paid: sub.amount_paid,
            currency: sub.currency,
            status: sub.status,
            notes: sub.notes,
            created_at: sub.created_at,
            isExpired: isSubscriptionExpired(sub),
            daysRemaining: daysUntilExpiry(sub.end_date),
            workspace_name: ws.name,
            client_name: user?.name ?? null,
            client_email: user?.email ?? null,
            subscription_number: ws.subscription_number || null,
            active_sub_count: activeSubCount,
          })
        }
      } else {
        // Workspace with no subscription, add one empty row
        rows.push({
          id: '',
          workspace_id: ws.id,
          user_id: ws.user_id || '',
          start_date: '',
          months_paid: 0,
          end_date: '',
          amount_paid: 0,
          currency: 'USD',
          status: 'none',
          notes: null,
          created_at: ws.created_at,
          isExpired: true,
          daysRemaining: 0,
          workspace_name: ws.name,
          client_name: user?.name ?? null,
          client_email: user?.email ?? null,
          subscription_number: ws.subscription_number || null,
          active_sub_count: 0,
        })
      }
    }

    return { success: true as const, rows }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', rows: [] }
  }
}

// ──────────────────────── Admin: one subscription record ────────────────────────

export interface SubscriptionDetailSubscription {
  id: string
  workspace_id: string
  user_id: string
  start_date: string
  months_paid: number
  end_date: string
  amount_paid: number | string
  currency: string
  status: string
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string | null
  archived_at: string | null
  isExpired: boolean
  daysRemaining: number
}

export interface SubscriptionDetailPayment {
  id: string
  amount: number | string
  currency: string
  paid_at: string
  notes: string | null
  created_by: string | null
  created_at: string
}

export interface SubscriptionHistoryRow {
  id: string
  start_date: string
  end_date: string
  months_paid: number
  amount_paid: number | string
  currency: string
  status: string
  archived_at: string | null
  isExpired: boolean
  daysRemaining: number
}

export interface SubscriptionDetail {
  subscription: SubscriptionDetailSubscription
  workspace: {
    id: string
    name: string
    subscription_number: string | null
    created_at: string
    archived_at: string | null
  } | null
  client: { id: string; name: string | null; email: string | null } | null
  payments: SubscriptionDetailPayment[]
  /** Every other subscription on the same workspace, newest first. */
  history: SubscriptionHistoryRow[]
  totals: { paid: number; payments_count: number }
}

/** Cheap shape check, so a hand-typed URL is a 404 instead of a Postgres 400. */
const SUBSCRIPTION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Admin: everything about one subscription, for `/admin/subscriptions/<id>`.
 *
 * The list is a table with basic columns; the record page is the only place that
 * reads the payment ledger and the workspace's other subscriptions. `users.phone`
 * is deliberately not selected — it is missing in environments where
 * `20260805_client_phone_and_archive.sql` was never applied, and selecting it
 * would fail the whole record read.
 */
export async function getSubscriptionDetail(subscriptionId: string) {
  try {
    await requireAdmin()

    if (!SUBSCRIPTION_UUID_RE.test(subscriptionId)) {
      return { success: false as const, error: 'not_found', detail: null }
    }

    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select(
        'id, workspace_id, user_id, start_date, months_paid, end_date, amount_paid, currency, status, notes, created_by, created_at, updated_at, archived_at',
      )
      .eq('id', subscriptionId)
      .maybeSingle()

    if (subErr) return { success: false as const, error: subErr.message, detail: null }
    if (!sub) return { success: false as const, error: 'not_found', detail: null }

    const [wsRes, userRes, payRes, historyRes] = await Promise.all([
      supabase
        .from('workspaces')
        .select('id, name, subscription_number, created_at, archived_at')
        .eq('id', sub.workspace_id)
        .maybeSingle(),
      sub.user_id
        ? supabase.from('users').select('id, name, email').eq('id', sub.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('subscription_payments')
        .select('id, amount, currency, paid_at, notes, created_by, created_at')
        .eq('subscription_id', subscriptionId)
        .order('paid_at', { ascending: false }),
      supabase
        .from('subscriptions')
        .select('id, start_date, end_date, months_paid, amount_paid, currency, status, archived_at')
        .eq('workspace_id', sub.workspace_id)
        .order('created_at', { ascending: false }),
    ])

    const payments = (payRes.data ?? []) as SubscriptionDetailPayment[]
    const paid = Math.round(payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100

    const history: SubscriptionHistoryRow[] = ((historyRes.data ?? []) as Omit<
      SubscriptionHistoryRow,
      'isExpired' | 'daysRemaining'
    >[])
      .filter((row) => row.id !== subscriptionId)
      .map((row) => ({
        ...row,
        isExpired: isSubscriptionExpired(row),
        daysRemaining: daysUntilExpiry(row.end_date),
      }))

    const detail: SubscriptionDetail = {
      subscription: {
        ...sub,
        isExpired: isSubscriptionExpired(sub),
        daysRemaining: daysUntilExpiry(sub.end_date),
      },
      workspace: wsRes.data ?? null,
      client: userRes.data ?? null,
      payments,
      history,
      totals: { paid, payments_count: payments.length },
    }

    return { success: true as const, error: undefined, detail }
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : 'unexpected',
      detail: null,
    }
  }
}

/** Admin: search users by email (for the registration picker). */
export async function searchUsersByEmail(email: string) {  try {
    await requireAdmin()

    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, active_workspace_id')
      .ilike('email', `%${email.trim().toLowerCase()}%`)
      .order('email', { ascending: true })
      .limit(10)

    if (error) return { success: false as const, error: error.message, users: [] }

    const users: UserPick[] = await Promise.all(
      (data ?? []).map(async (u) => {
        const { data: workspaces } = await supabase
          .from('workspaces')
          .select('id, name')
          .eq('user_id', u.id)
          .order('created_at', { ascending: false })
          .limit(20)

        return {
          id: u.id,
          email: u.email,
          name: u.name,
          active_workspace_id: u.active_workspace_id,
          workspaces: workspaces ?? [],
        }
      }),
    )

    return { success: true as const, users }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', users: [] }
  }
}

// ──────────────────────── Admin: financial stats (MRR) ────────────────────────

export interface AdminStats {
  activeSubscriptions: number
  mrr: number
  totalRevenue: number
  monthRevenue: number
  expiringSoon: number
  expiredSubscriptions: number
}

/** Admin: overview figures for the stats page (MRR, revenue). Manual payments only. */
export async function getAdminStats() {
  try {
    await requireAdmin()

    const today = new Date().toISOString().slice(0, 10)
    const monthStart = today.slice(0, 7) + '-01'

    const { data: activeSubs, error: activeErr } = await supabase
      .from('subscriptions')
      .select('amount_paid, months_paid, end_date')
      .eq('status', 'active')

    if (activeErr) return { success: false as const, error: activeErr.message, stats: null }

    let mrr = 0
    let activeSubscriptions = 0
    let expiringSoon = 0
    let expiredSubscriptions = 0
    for (const s of activeSubs ?? []) {
      if (isSubscriptionExpired(s)) {
        expiredSubscriptions++
        continue
      }
      activeSubscriptions++
      mrr += Number(s.amount_paid) / Math.max(1, Number(s.months_paid))
      const days = daysUntilExpiry(s.end_date)
      if (days >= 0 && days <= 30) expiringSoon++
    }
    mrr = Math.round(mrr * 100) / 100

    const { data: payments } = await supabase
      .from('subscription_payments')
      .select('amount, paid_at')

    let totalRevenue = 0
    let monthRevenue = 0
    for (const p of payments ?? []) {
      totalRevenue += Number(p.amount)
      if ((p.paid_at ?? '').slice(0, 10) >= monthStart) monthRevenue += Number(p.amount)
    }
    totalRevenue = Math.round(totalRevenue * 100) / 100
    monthRevenue = Math.round(monthRevenue * 100) / 100

    // NOTE: affiliate system removed — no commission/payout queries.
    // The `partner_*` tables were dropped 2026-10-22.
    return {
      success: true as const,
      stats: {
        activeSubscriptions,
        mrr,
        totalRevenue,
        monthRevenue,
        expiringSoon,
        expiredSubscriptions,
      } as AdminStats,
    }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', stats: null }
  }
}

// NOTE: `detectAffiliateForClient` removed — affiliate system cancelled.
// `getActiveAffiliates` removed as well. The `partner_*` tables were dropped
// 2026-10-22 (migration 20261022_db_cleanup_and_cascade.sql).

// ──────────────────────── Admin: Clients (statements) ────────────────────────

export interface AdminClientWorkspace {
  id: string
  name: string
  subscription_number: string | null
  created_at: string
}

export interface AdminClientActiveSub {
  id: string
  workspace_id: string
  workspace_name: string
  subscription_number: string | null
  start_date: string
  end_date: string
  months_paid: number
  amount_paid: number | string
  status: string
  isExpired: boolean
  daysRemaining: number
}

export interface AdminClientRow {
  user_id: string
  name: string | null
  email: string
  phone: string | null
  created_at: string
  workspaces: AdminClientWorkspace[]
  has_paid: boolean
  total_paid: number
  active_sub: AdminClientActiveSub | null
}

/**
 * Lean subscription row for the admin client list: exactly the columns the
 * merge below reads (see the scoped select in `getAllClients`). Separate from
 * `RawSubscription` (the full `select('*')` shape) on purpose.
 */
interface RawClientSub {
  id: string
  workspace_id: string
  amount_paid: number | string
  status: string
  archived_at: string | null
  start_date: string
  end_date: string
  months_paid: number
}

/** Admin: list all clients (users with workspaces) with their subscription state. */
export async function getAllClients(params?: { limit?: number; offset?: number }) {  try {
    await requireAdmin()

    // Optional server-side pagination for the admin table. When omitted the
    // legacy full-list behaviour is kept so existing callers don't break.
    const limit = params?.limit ? Math.min(500, Math.max(1, params.limit)) : 2000
    const offset = params?.offset ? Math.max(0, params.offset) : 0

    // NOTE: no `phone` here — see src/lib/users.ts. The column exists only
    // in migration 20260805 (never applied in some environments); selecting
    // it fails the whole query. `phone: null` below is restored to the real
    // value by applying that migration and re-adding the column here.
    const { data: users, error: uErr, count: totalCount } = await supabase
      .from('users')
      .select('id, email, name, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (uErr) return { success: false as const, error: uErr.message, rows: [], totalCount: 0 }

    const userIds = (users ?? []).map((u) => u.id)

    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id, name, subscription_number, user_id, created_at')
      .in('user_id', userIds.length ? userIds : ['__none__'])
      .order('created_at', { ascending: false })
      .limit(2000)

    const wsByUser = new Map<string, AdminClientWorkspace[]>()
    for (const ws of workspaces ?? []) {
      if (!ws.user_id) continue
      const list = wsByUser.get(ws.user_id) ?? []
      list.push({
        id: ws.id,
        name: ws.name,
        subscription_number: ws.subscription_number ?? null,
        created_at: ws.created_at,
      })
      wsByUser.set(ws.user_id, list)
    }

    // Scoped + lean: only subscriptions of THIS page's workspaces, and only
    // the columns the merge below reads (was: global select('*') limit 10000,
    // which shipped every subscription row on every admin page view).
    const wsIds = (workspaces ?? []).map((w) => w.id)
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('id,workspace_id,amount_paid,status,archived_at,start_date,end_date,months_paid')
      .in('workspace_id', wsIds.length ? wsIds : ['__none__'])
      .limit(2000)

    const subsByWs = new Map<string, RawClientSub[]>()
    for (const s of subs ?? []) {
      const list = subsByWs.get(s.workspace_id) ?? []
      list.push(s)
      subsByWs.set(s.workspace_id, list)
    }

    const rows: AdminClientRow[] = (users ?? []).map((u) => {
      const wsList = wsByUser.get(u.id) ?? []
      let totalPaid = 0
      let hasPaid = false
      const candidates: AdminClientActiveSub[] = []

      for (const ws of wsList) {
        for (const s of subsByWs.get(ws.id) ?? []) {
          totalPaid += Number(s.amount_paid)
          if (Number(s.amount_paid) > 0) hasPaid = true
          if (s.status !== 'active' || s.archived_at) continue
          candidates.push({
            id: s.id,
            workspace_id: ws.id,
            workspace_name: ws.name,
            subscription_number: ws.subscription_number,
            start_date: s.start_date,
            end_date: s.end_date,
            months_paid: s.months_paid,
            amount_paid: s.amount_paid,
            status: s.status,
            isExpired: isSubscriptionExpired(s),
            daysRemaining: daysUntilExpiry(s.end_date),
          })
        }
      }

      const byEndDesc = (a: AdminClientActiveSub, b: AdminClientActiveSub) =>
        new Date(b.end_date).getTime() - new Date(a.end_date).getTime()
      const notExpired = candidates.filter((c) => !c.isExpired).sort(byEndDesc)
      const allSorted = [...candidates].sort(byEndDesc)
      const activeSub = notExpired[0] ?? allSorted[0] ?? null

      return {
        user_id: u.id,
        name: u.name,
        email: u.email,
        // Null until migration 20260805 (users.phone) is applied — see above.
        phone: null,
        created_at: u.created_at,
        workspaces: wsList,
        has_paid: hasPaid,
        total_paid: Math.round(totalPaid * 100) / 100,
        active_sub: activeSub,
      }
    })

    return { success: true as const, rows: rows.filter((r) => r.workspaces.length > 0), totalCount: totalCount ?? 0 }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', rows: [], totalCount: 0 }
  }
}

export interface ClientStatementSubscription {
  id: string
  workspace_id: string
  workspace_name: string | null
  subscription_number: string | null
  start_date: string
  months_paid: number
  end_date: string
  amount_paid: number | string
  currency: string
  status: string
  notes: string | null
  created_at: string
  archived_at: string | null
  isExpired: boolean
  daysRemaining: number
}

export interface ClientStatementPayment {
  id: string
  subscription_id: string
  amount: number | string
  currency: string
  paid_at: string
  notes: string | null
  created_at: string
  workspace_name: string | null
  subscription_number: string | null
}

export interface ClientStatementData {
  user: { id: string; email: string; name: string | null; created_at: string }
  workspaces: { id: string; name: string; subscription_number: string | null; created_at: string }[]
  subscriptions: ClientStatementSubscription[]
  payments: ClientStatementPayment[]
  total_paid: number
  total_months: number
  active_sub_count: number
}

/** Admin: full billing statement for one client (all workspaces + all subscriptions). */
export async function getClientStatement(userId: string) {
  try {
    await requireAdmin()

    const { data: user, error: uErr } = await supabase
      .from('users')
      .select('id, email, name, created_at')
      .eq('id', userId)
      .single()

    if (uErr || !user) return { success: false as const, error: 'client_not_found', data: null }

    const { data: workspaces } = await supabase
      .from('workspaces')
      .select('id, name, subscription_number, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    const wsList = workspaces ?? []
    const wsIds = wsList.map((w) => w.id)
    const wsMap = new Map(wsList.map((w) => [w.id, w]))

    const { data: subs } = await supabase
      .from('subscriptions')
      .select('*')
      .in('workspace_id', wsIds.length ? wsIds : ['__none__'])
      .order('created_at', { ascending: false })

    let totalPaid = 0
    let totalMonths = 0
    let activeCount = 0

    const subscriptions: ClientStatementSubscription[] = (subs ?? []).map((s) => {
      const ws = wsMap.get(s.workspace_id)
      if (s.status === 'active') {
        totalMonths += Number(s.months_paid)
        if (!isSubscriptionExpired(s)) activeCount++
      }
      return {
        id: s.id,
        workspace_id: s.workspace_id,
        workspace_name: ws?.name ?? null,
        subscription_number: ws?.subscription_number ?? null,
        start_date: s.start_date,
        months_paid: s.months_paid,
        end_date: s.end_date,
        amount_paid: s.amount_paid,
        currency: s.currency,
        status: s.status,
        notes: s.notes,
        created_at: s.created_at,
        archived_at: s.archived_at ?? null,
        isExpired: isSubscriptionExpired(s),
        daysRemaining: daysUntilExpiry(s.end_date),
      }
    })

    // Fetch all payments for these subscriptions
    const subIds = subscriptions.map((s) => s.id)
    const { data: paymentRows } = await supabase
      .from('subscription_payments')
      .select('*')
      .in('subscription_id', subIds.length ? subIds : ['__none__'])
      .order('paid_at', { ascending: false })

    const subInfoMap = new Map(subscriptions.map((s) => [s.id, s]))
    const payments: ClientStatementPayment[] = (paymentRows ?? []).map((p) => {
      const info = subInfoMap.get(p.subscription_id)
      return {
        id: p.id,
        subscription_id: p.subscription_id,
        amount: p.amount,
        currency: p.currency,
        paid_at: p.paid_at,
        notes: p.notes,
        created_at: p.created_at,
        workspace_name: info?.workspace_name ?? null,
        subscription_number: info?.subscription_number ?? null,
      }
    })

    // Total paid = sum of all recorded payments (all statuses), matching the payments tab
    totalPaid = Math.round((paymentRows ?? []).reduce((s, p) => s + Number(p.amount), 0) * 100) / 100

    return {
      success: true as const,
      data: {
        user,
        workspaces: wsList,
        subscriptions,
        payments,
        total_paid: Math.round(totalPaid * 100) / 100,
        total_months: totalMonths,
        active_sub_count: activeCount,
      } satisfies ClientStatementData,
    }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', data: null }
  }
}

/** Client: Get active workspace billing history and subscription number. */
export async function getMyWorkspaceBillingDetails() {  try {
    const userId = await getActiveUserId()
    if (!userId) return { success: false as const, error: 'unauthorized', workspace: null, subscriptions: [] }

    const workspaceId = await getActiveWorkspaceId()
    if (!workspaceId) return { success: false as const, error: 'no_active_workspace', workspace: null, subscriptions: [] }

    // Fetch workspace
    const { data: ws, error: wsErr } = await supabase
      .from('workspaces')
      .select('id, name, subscription_number, user_id')
      .eq('id', workspaceId)
      .maybeSingle()

    if (wsErr || !ws) {
      return { success: false as const, error: wsErr?.message ?? 'workspace_not_found', workspace: null, subscriptions: [] }
    }

    // Fetch all subscriptions for this workspace
    const { data: subs, error: subsErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (subsErr) {
      return { success: false as const, error: subsErr.message, workspace: null, subscriptions: [] }
    }

    const subscriptions = (subs ?? []).map((sub) => ({
      ...sub,
      isExpired: isSubscriptionExpired(sub),
      daysRemaining: daysUntilExpiry(sub.end_date),
    }))

    return {
      success: true as const,
      workspace: {
        id: ws.id,
        name: ws.name,
        subscription_number: ws.subscription_number || null,
        user_id: ws.user_id,
      },
      subscriptions,
    }
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof Error ? err.message : 'unexpected',
      workspace: null,
      subscriptions: [],
    }
  }
}

/** Client/Admin: Securely fetch a single subscription for printing invoice. */
export async function getSubscriptionForInvoice(subscriptionId: string) {
  try {
    const userId = await getActiveUserId()
    if (!userId) return { success: false as const, error: 'unauthorized', subscription: null }

    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('*, workspaces(id, name, subscription_number), users!subscriptions_user_id_fkey(id, name, email)')
      .eq('id', subscriptionId)
      .maybeSingle()

    if (subErr || !sub) {
      return { success: false as const, error: subErr?.message ?? 'subscription_not_found', subscription: null }
    }

    // Check if user is owner/member of workspace OR is admin
    const isAdminUser = isAdmin(userId)
    if (!isAdminUser && sub.user_id !== userId) {
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('workspace_id', sub.workspace_id)
        .eq('user_id', userId)
        .maybeSingle()

      if (!member) {
        return { success: false as const, error: 'unauthorized', subscription: null }
      }
    }

    return {
      success: true as const,
      subscription: {
        ...sub,
        isExpired: isSubscriptionExpired(sub),
        daysRemaining: daysUntilExpiry(sub.end_date),
        workspace_name: sub.workspaces?.name ?? null,
        workspace_sub_num: sub.workspaces?.subscription_number ?? null,
        client_name: sub.users?.name ?? null,
        client_email: sub.users?.email ?? null,
      },
    }
  } catch (err) {
    return { success: false as const, error: err instanceof Error ? err.message : 'unexpected', subscription: null }
  }
}
