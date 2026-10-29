/**
 * order-payment.ts — Inbound payment creation & invoice reconciliation in Odoo.
 *
 * Supports Odoo versions 14 through 20:
 *   - Odoo 15-20: Uses `account.payment.method.line` on the journal
 *   - Odoo 14: Uses `account.payment.method` with `payment_type = 'inbound'`
 *   - Universal XML-RPC `account.move.line.reconcile` across versions 14-20
 *   - Bidirectional reconciliation:
 *       a) Payment created when invoice already exists -> reconciles immediately.
 *       b) Payment created before invoice -> stored in `odoo_entity_links`,
 *          reconciled automatically when invoice is created/posted later.
 */

import { resolveEntityLinkId, upsertEntityLink, type EntityLinkPlatform } from '@/lib/entity-links'
import { getEffectiveStandardMappingSettings, type MappingStoreType } from '@/lib/mapping-settings'
import type { OdooClient } from '@/lib/odoo-client'
import { supabase } from '@/lib/supabase'

import { normalizePaymentKey, paymentKeysFromOrder } from './analytic-distribution'

export interface PaymentJournalMapping {
  zid_payment_method: string
  odoo_journal_id: string | number
}

/**
 * Determine if an order is marked as paid across various platform payload shapes.
 */
export function isOrderPaid(zidData: Record<string, unknown> | null | undefined): boolean {
  if (!zidData || typeof zidData !== 'object') return false
  const d = zidData as any
  const candidates = [
    d.payment_status,
    d.payment?.status,
    d.payment?.payment_status,
    d.order?.payment_status,
    d.order?.payment?.status,
    d.financial_status,
    d.payment_status_name,
  ]

  for (const c of candidates) {
    if (!c) continue
    const s = String(c).trim().toLowerCase()
    if (s === 'paid' || s === 'مدفوع' || s === 'completed' || s === 'captured' || s === 'authorized') {
      return true
    }
  }

  // Check top-level order status if specifically 'paid'
  const orderStatus = String(
    d.order_status || d.status || d.order?.order_status || d.order?.status || ''
  )
    .trim()
    .toLowerCase()
  if (orderStatus === 'paid' || orderStatus === 'مدفوع') {
    return true
  }

  return false
}

/**
 * Extract total payment amount from order payload.
 */
export function extractPaymentAmount(zidData: Record<string, unknown> | null | undefined): number {
  if (!zidData || typeof zidData !== 'object') return 0
  const d = zidData as any
  const candidates = [
    d.order_total,
    d.total_price,
    d.order?.order_total,
    d.order?.total_price,
    d.grand_total,
    d.total,
    d.amounts?.total?.amount,
    d.amounts?.total,
  ]
  for (const c of candidates) {
    if (c === undefined || c === null || typeof c === 'object') continue
    const parsed = parseFloat(String(c).replace(/[^0-9.-]/g, ''))
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return 0
}

/**
 * Extract payment date formatted as YYYY-MM-DD.
 */
export function extractPaymentDate(zidData: Record<string, unknown> | null | undefined): string {
  if (!zidData || typeof zidData !== 'object') return new Date().toISOString().slice(0, 10)
  const d = zidData as any
  const rawDate =
    d.payment?.paid_at ||
    d.paid_at ||
    d.payment?.date ||
    d.updated_at ||
    d.created_at ||
    d.order?.updated_at ||
    d.order?.created_at
  if (typeof rawDate === 'string' && rawDate.trim()) {
    const parsed = new Date(rawDate)
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10)
    }
  }
  return new Date().toISOString().slice(0, 10)
}

/**
 * Match a Zid payment method to the user-configured Odoo journal ID.
 */
export function matchPaymentJournal(
  mappings: PaymentJournalMapping[] | null | undefined,
  zidData: Record<string, unknown> | null | undefined,
  platform: 'zid' | 'salla' | 'shopify' = 'zid'
): number | null {
  if (!Array.isArray(mappings) || mappings.length === 0 || !zidData) return null
  const keys = paymentKeysFromOrder(zidData, platform)

  // 1. Normalized key match (e.g. 'cod', 'applepay', 'creditcard')
  for (const m of mappings) {
    if (!m.zid_payment_method || !m.odoo_journal_id) continue
    const mapKey = normalizePaymentKey(m.zid_payment_method)
    if (keys.includes(mapKey)) {
      const id = Number(m.odoo_journal_id)
      if (Number.isInteger(id) && id > 0) return id
    }
  }

  // 2. Direct string match on raw code/slug/title
  const d = zidData as any
  const rawCodes = [
    d.payment_method?.code,
    d.payment_method?.slug,
    d.payment_method?.id,
    d.payment_method,
    d.payment?.method?.code,
    d.payment?.method?.slug,
    d.payment?.method,
    d.gateway,
  ]
    .filter(Boolean)
    .map(v => String(v).toLowerCase().trim())

  for (const m of mappings) {
    if (!m.zid_payment_method || !m.odoo_journal_id) continue
    const target = String(m.zid_payment_method).toLowerCase().trim()
    if (rawCodes.includes(target)) {
      const id = Number(m.odoo_journal_id)
      if (Number.isInteger(id) && id > 0) return id
    }
  }

  return null
}

/**
 * Create and post an inbound customer payment in Odoo across versions 14 to 20.
 */
export async function createOdooPayment(
  client: OdooClient,
  params: {
    partnerId: number
    amount: number
    journalId: number
    date?: string
    ref?: string
    currencyId?: number
  }
): Promise<number> {
  const major = await client.getMajorVersion().catch(() => 17)
  const paymentValues: Record<string, unknown> = {
    payment_type: 'inbound',
    partner_type: 'customer',
    partner_id: params.partnerId,
    amount: params.amount,
    journal_id: params.journalId,
    date: params.date || new Date().toISOString().slice(0, 10),
    ref: params.ref || '',
  }

  if (params.currencyId) {
    paymentValues.currency_id = params.currencyId
  }

  // Odoo 15+: payment_method_line_id on journal
  if (major >= 15) {
    try {
      const methodLines = await client.searchRead<any>(
        'account.payment.method.line',
        [['journal_id', '=', params.journalId], ['payment_type', '=', 'inbound']],
        ['id', 'name'],
        1
      )
      if (methodLines?.[0]?.id) {
        paymentValues.payment_method_line_id = methodLines[0].id
      }
    } catch (err: any) {
      console.warn('[OrderPayment] Could not resolve payment_method_line_id (Odoo 15+):', err?.message || err)
    }
  } else {
    // Odoo 14: payment_method_id
    try {
      const methods = await client.searchRead<any>(
        'account.payment.method',
        [['payment_type', '=', 'inbound']],
        ['id', 'name'],
        1
      )
      if (methods?.[0]?.id) {
        paymentValues.payment_method_id = methods[0].id
      }
    } catch (err: any) {
      console.warn('[OrderPayment] Could not resolve payment_method_id (Odoo 14):', err?.message || err)
    }
  }

  const paymentId = await client.create('account.payment', paymentValues)

  // Post payment to generate move lines
  try {
    await client.execute('account.payment', 'action_post', [[paymentId]])
    console.info(`[OrderPayment] Posted inbound payment #${paymentId}`)
  } catch (e1: any) {
    try {
      await client.execute('account.payment', 'action_post', [paymentId])
      console.info(`[OrderPayment] Posted inbound payment #${paymentId} via [paymentId]`)
    } catch (e2: any) {
      try {
        await client.execute('account.payment', 'post', [paymentId])
        console.info(`[OrderPayment] Posted inbound payment #${paymentId} via post`)
      } catch (e3: any) {
        console.warn(`[OrderPayment] Could not post payment #${paymentId} (left in draft):`, e3?.message || e3)
      }
    }
  }

  return paymentId
}

/**
 * Reconcile an inbound payment with a customer invoice across Odoo versions 14 to 20.
 */
export async function reconcilePaymentWithInvoice(
  client: OdooClient,
  paymentId: number,
  invoiceId: number
): Promise<boolean> {
  try {
    // Verify invoice is posted
    const invoices = await client.searchRead<any>(
      'account.move',
      [['id', '=', invoiceId]],
      ['id', 'state', 'payment_state', 'move_type']
    )
    const inv = invoices?.[0]
    if (!inv || inv.state !== 'posted') {
      console.info(`[OrderPayment] Invoice #${invoiceId} is not in posted state (${inv?.state}), reconciliation deferred.`)
      return false
    }

    // Resolve payment move ID
    let paymentMoveId = paymentId
    try {
      const payments = await client.searchRead<any>(
        'account.payment',
        [['id', '=', paymentId]],
        ['id', 'move_id']
      )
      if (payments?.[0]?.move_id) {
        paymentMoveId = Array.isArray(payments[0].move_id) ? payments[0].move_id[0] : payments[0].move_id
      }
    } catch {
      // paymentMoveId remains paymentId
    }

    // Fetch unreconciled lines for both moves
    const [invLines, payLines] = await Promise.all([
      client.searchRead<any>(
        'account.move.line',
        [['move_id', '=', invoiceId], ['reconciled', '=', false], ['debit', '>', 0]],
        ['id', 'account_id', 'debit', 'credit', 'reconciled']
      ),
      client.searchRead<any>(
        'account.move.line',
        [['move_id', '=', paymentMoveId], ['reconciled', '=', false], ['credit', '>', 0]],
        ['id', 'account_id', 'debit', 'credit', 'reconciled']
      ),
    ])

    if (!invLines?.length || !payLines?.length) {
      console.info(
        `[OrderPayment] Cannot reconcile payment #${paymentId} with invoice #${invoiceId}: missing unreconciled move lines. (inv debit lines: ${invLines?.length ?? 0}, pay credit lines: ${payLines?.length ?? 0})`
      )
      return false
    }

    let reconciledAny = false
    for (const invLine of invLines) {
      const invAccId = Array.isArray(invLine.account_id) ? invLine.account_id[0] : invLine.account_id
      const matchingPay =
        payLines.find(p => {
          const payAccId = Array.isArray(p.account_id) ? p.account_id[0] : p.account_id
          return invAccId === payAccId
        }) || payLines[0]

      if (matchingPay) {
        try {
          await client.execute('account.move.line', 'reconcile', [[invLine.id, matchingPay.id]])
          console.info(`[OrderPayment] Reconciled invoice line #${invLine.id} with payment line #${matchingPay.id}`)
          reconciledAny = true
        } catch (recErr: any) {
          try {
            await client.execute('account.move.line', 'reconcile', [invLine.id, matchingPay.id])
            reconciledAny = true
          } catch (recErr2: any) {
            console.warn(`[OrderPayment] Failed to reconcile lines #${invLine.id} and #${matchingPay.id}:`, recErr2?.message || recErr2)
          }
        }
      }
    }

    return reconciledAny
  } catch (err: any) {
    console.warn(`[OrderPayment] Reconcile error between payment #${paymentId} and invoice #${invoiceId}:`, err?.message || err)
    return false
  }
}

/**
 * Main workflow: sync inbound payment when an order is paid in Zid,
 * and reconcile with existing invoice if available.
 */
export async function syncOrderPayment(params: {
  client: OdooClient
  saleOrderId: number
  zidData: Record<string, unknown>
  workspaceId: string
  platform: 'zid' | 'salla' | 'shopify'
  storeId: string
  zidEntityId: string
}): Promise<{ paymentId?: number; reconciled?: boolean; skippedReason?: string }> {
  const { client, saleOrderId, zidData, workspaceId, platform, storeId, zidEntityId } = params

  try {
    const stdSettings = await getEffectiveStandardMappingSettings(
      supabase,
      workspaceId,
      platform as MappingStoreType,
      'orders',
      storeId
    )

    const paymentSyncEnabled =
      stdSettings?.order?.payment_sync_enabled ??
      stdSettings?.payment_sync_enabled ??
      true

    if (paymentSyncEnabled === false) {
      return { skippedReason: 'payment_sync_disabled' }
    }

    if (!isOrderPaid(zidData)) {
      return { skippedReason: 'order_not_paid' }
    }

    const mappings = (stdSettings?.order?.payment_journal_mappings ||
      stdSettings?.payment_journal_mappings ||
      []) as PaymentJournalMapping[]

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return { skippedReason: 'no_payment_journal_mappings_configured' }
    }

    const journalId = matchPaymentJournal(mappings, zidData, platform)
    if (!journalId) {
      console.info(
        `[OrderPayment] No journal mapped for payment in order "${zidEntityId}". Skipping payment creation.`
      )
      return { skippedReason: 'no_matching_journal_found' }
    }

    // Check if payment already exists (idempotency)
    const existingPaymentId = await resolveEntityLinkId({
      workspaceId,
      platform: platform as EntityLinkPlatform,
      storeId: String(storeId),
      odooModel: 'account.payment',
      storeEntityId: String(zidEntityId),
    })

    // Read sale.order to fetch partner, currency, invoice_ids
    const orders = await client.searchRead<any>(
      'sale.order',
      [['id', '=', saleOrderId]],
      ['id', 'name', 'partner_id', 'currency_id', 'invoice_ids']
    )
    const order = orders?.[0]
    if (!order) {
      return { skippedReason: 'sale_order_not_found' }
    }

    const partnerId = Array.isArray(order.partner_id) ? order.partner_id[0] : order.partner_id
    if (!partnerId) {
      return { skippedReason: 'missing_partner_id' }
    }

    const currencyId = Array.isArray(order.currency_id) ? order.currency_id[0] : order.currency_id
    const amount = extractPaymentAmount(zidData)
    if (amount <= 0) {
      return { skippedReason: 'invalid_payment_amount' }
    }

    const paymentDate = extractPaymentDate(zidData)
    const paymentRef = `Zid Order #${order.name || zidEntityId}`

    let paymentId: number
    if (existingPaymentId) {
      paymentId = existingPaymentId
      console.info(`[OrderPayment] Payment #${paymentId} already exists for Zid order "${zidEntityId}". Checking reconciliation...`)
    } else {
      paymentId = await createOdooPayment(client, {
        partnerId,
        amount,
        journalId,
        date: paymentDate,
        ref: paymentRef,
        currencyId,
      })

      await upsertEntityLink(
        {
          workspaceId,
          platform: platform as EntityLinkPlatform,
          storeId: String(storeId),
          odooModel: 'account.payment',
          storeEntityId: String(zidEntityId),
        },
        paymentId
      )
    }

    // Reconcile with invoice if invoice exists and is posted
    let reconciled = false
    const invoiceIds: number[] = Array.isArray(order.invoice_ids)
      ? order.invoice_ids.filter((v: unknown) => Number.isInteger(Number(v)) && Number(v) > 0)
      : []

    if (invoiceIds.length > 0) {
      const postedInvoices = await client.searchRead<any>(
        'account.move',
        [['id', 'in', invoiceIds], ['move_type', '=', 'out_invoice'], ['state', '=', 'posted']],
        ['id']
      )
      for (const inv of postedInvoices || []) {
        const ok = await reconcilePaymentWithInvoice(client, paymentId, inv.id)
        if (ok) reconciled = true
      }
    }

    return { paymentId, reconciled }
  } catch (err: any) {
    console.error(`[OrderPayment] Failed to sync payment for order #${saleOrderId}:`, err)
    return { skippedReason: err?.message || 'payment_sync_error' }
  }
}

/**
 * Reconcile any existing pending payment for an order with a newly created/posted invoice.
 */
export async function reconcilePendingPaymentsForOrder(params: {
  client: OdooClient
  saleOrderId: number
  invoiceId: number
  workspaceId: string
  platform: 'zid' | 'salla' | 'shopify'
  storeId: string
  zidEntityId: string
}): Promise<boolean> {
  const { client, saleOrderId, invoiceId, workspaceId, platform, storeId, zidEntityId } = params

  try {
    let paymentId = await resolveEntityLinkId({
      workspaceId,
      platform: platform as EntityLinkPlatform,
      storeId: String(storeId),
      odooModel: 'account.payment',
      storeEntityId: String(zidEntityId),
    })

    // If not found in entity_links, try searching account.payment by ref
    if (!paymentId) {
      try {
        const orders = await client.searchRead<any>('sale.order', [['id', '=', saleOrderId]], ['name'])
        const orderName = orders?.[0]?.name
        const searchTerms = [`Zid Order #${orderName || zidEntityId}`, `Zid Order #${zidEntityId}`]
        for (const term of searchTerms) {
          const payments = await client.searchRead<any>(
            'account.payment',
            [['ref', '=', term]],
            ['id', 'state'],
            1
          )
          if (payments?.[0]?.id) {
            paymentId = payments[0].id
            break
          }
        }
      } catch {
        // Non-fatal search
      }
    }

    if (!paymentId) {
      return false
    }

    return await reconcilePaymentWithInvoice(client, paymentId, invoiceId)
  } catch (err: any) {
    console.warn(`[OrderPayment] Reconcile pending payment exception:`, err?.message || err)
    return false
  }
}
