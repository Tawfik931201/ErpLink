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
import { withErpCreateIdentity } from '@/lib/erp-effect-context'
import { getEffectiveStandardMappingSettings, type MappingStoreType } from '@/lib/mapping-settings'
import type { OdooClient } from '@/lib/odoo-client'
import { readSallaAmount } from '@/lib/salla/order-amounts'
import { supabase } from '@/lib/supabase'

import { normalizePaymentKey, paymentKeysFromOrder } from './analytic-distribution'
import { extractOrderCurrency } from './order-currency'

export interface PaymentJournalMapping {
  zid_payment_method: string
  odoo_journal_id: string | number
}

/**
 * Determine if an order is marked as paid across various platform payload shapes.
 */
export function isOrderPaid(zidData: Record<string, unknown> | null | undefined, platform?: string): boolean {
  if (!zidData || typeof zidData !== 'object') return false
  const d = zidData as any
  if (platform === 'salla') {
    if (d.is_pending_payment === true) return false
    const paid = readSallaAmount(d.payment_actions?.refund_action?.paid_amount)
    const total = readSallaAmount(d.amounts?.total ?? d.total)
    // Payment identity is per order. Wait for full payment so an initial
    // partial amount cannot consume the identity for the settled order.
    if (paid !== undefined && total !== undefined) return paid > 0 && Math.round(paid * 100) >= Math.round(total * 100)
  }
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
export function extractPaymentAmount(zidData: Record<string, unknown> | null | undefined, platform?: string): number {
  if (!zidData || typeof zidData !== 'object') return 0
  const d = zidData as any
  if (platform === 'salla') {
    const total = readSallaAmount(d.amounts?.total ?? d.total)
    if (total !== undefined) return total
  }
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
    companyId?: number
    /** Order sync persists the identity before posting so failures can be retried safely. */
    post?: boolean
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
  }
  if (params.ref) {
    // Odoo 14–17 delegate ref to account.move; memo was introduced in 18.
    if (major >= 18) {
      paymentValues.memo = params.ref
    } else {
      paymentValues.ref = params.ref
    }
  }

  if (params.currencyId) {
    paymentValues.currency_id = params.currencyId
  }
  if (params.companyId) paymentValues.company_id = params.companyId

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

  // Odoo 20 may keep a posted account.payment without a journal entry when
  // Accounting is installed and the journal has no explicit outstanding
  // account. Our reconciliation path needs move_id, so force Odoo 20 to assign
  // its standard outstanding-receipts account at creation time. Odoo 14–19
  // keep their existing create behaviour unchanged.
  const paymentId = major >= 20
    ? await client.execute<number>(
        'account.payment',
        'create',
        [paymentValues],
        { context: { force_payment_move: true } }
      )
    : await client.create('account.payment', paymentValues)
  if (params.post === false) return paymentId

  // Post payment to generate move lines
  try {
    await client.execute('account.payment', 'action_post', [[paymentId]])
    console.info(`[OrderPayment] Posted inbound payment #${paymentId}`)
  } catch {
    try {
      await client.execute('account.payment', 'action_post', [paymentId])
      console.info(`[OrderPayment] Posted inbound payment #${paymentId} via [paymentId]`)
    } catch {
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
    if (!inv || inv.state !== 'posted' || inv.move_type !== 'out_invoice') {
      console.info(`[OrderPayment] Invoice #${invoiceId} is not in posted state (${inv?.state}), reconciliation deferred.`)
      return false
    }

    // Resolve payment move ID
    let paymentMoveId: number | null = null
    try {
      const payments = await client.searchRead<any>(
        'account.payment',
        [['id', '=', paymentId]],
        ['id', 'move_id']
      )
      if (payments?.[0]?.move_id) {
        const rawMoveId = Array.isArray(payments[0].move_id) ? payments[0].move_id[0] : payments[0].move_id
        if (Number.isInteger(Number(rawMoveId)) && Number(rawMoveId) > 0) paymentMoveId = Number(rawMoveId)
      }
    } catch {
      // Payment and journal-entry ids are independent sequences. Never guess.
    }
    if (!paymentMoveId) return false

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
        })

      if (matchingPay) {
        try {
          await client.execute('account.move.line', 'reconcile', [[invLine.id, matchingPay.id]])
          console.info(`[OrderPayment] Reconciled invoice line #${invLine.id} with payment line #${matchingPay.id}`)
          reconciledAny = true
        } catch {
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
}): Promise<{ paymentId?: number; reconciled?: boolean; skippedReason?: string; errorReason?: string }> {
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

    if (!isOrderPaid(zidData, platform)) {
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
      ['id', 'name', 'partner_id', 'currency_id', 'invoice_ids', 'amount_total', 'company_id']
    )
    const order = orders?.[0]
    if (!order) {
      return { skippedReason: 'sale_order_not_found', errorReason: 'sale_order_not_found' }
    }
    const companyId = Number(Array.isArray(order.company_id) ? order.company_id[0] : order.company_id)
    if (!Number.isInteger(companyId) || companyId <= 0) return { skippedReason: 'missing_order_company', errorReason: 'missing_order_company' }

    const partnerId = Array.isArray(order.partner_id) ? order.partner_id[0] : order.partner_id
    if (!partnerId) {
      return { skippedReason: 'missing_partner_id', errorReason: 'missing_partner_id' }
    }

    const currencyId = Array.isArray(order.currency_id) ? order.currency_id[0] : order.currency_id
    let amount = extractPaymentAmount(zidData, platform)
    // Lines may have been converted into the configured fallback currency.
    // A fully paid source total cannot be reused with a different currency id.
    // Use Odoo's resulting total, preserving the exact conversion and rounding
    // already applied to lines, shipping, discounts and taxes by the order sync.
    if (currencyId) {
      let orderCurrency = Array.isArray(order.currency_id) ? String(order.currency_id[1] || '').trim().toUpperCase() : ''
      if (!/^[A-Z]{3}$/.test(orderCurrency)) {
        const currencies = await client.searchRead<any>('res.currency', [['id', '=', currencyId]], ['name'], 1)
        orderCurrency = String(currencies?.[0]?.name || '').trim().toUpperCase()
      }
      if (!orderCurrency) return { skippedReason: 'unknown_order_currency', errorReason: 'unknown_order_currency' }
      if (extractOrderCurrency(zidData, platform) !== orderCurrency) {
        amount = Number(order.amount_total)
      }
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return { skippedReason: 'invalid_payment_amount', errorReason: 'invalid_payment_amount' }
    }

    const paymentDate = extractPaymentDate(zidData)
    const paymentRef = `${platform === 'salla' ? 'Salla' : 'Zid'} Order #${order.name || zidEntityId}`

    let paymentId: number
    if (existingPaymentId) {
      paymentId = existingPaymentId
      console.info(`[OrderPayment] Payment #${paymentId} already exists for Zid order "${zidEntityId}". Checking reconciliation...`)
    } else {
      const journals = await client.searchRead<any>(
        'account.journal', [['id', '=', journalId], ['company_id', '=', companyId], ['type', 'in', ['bank', 'cash']]], ['id'], 1
      )
      if (!journals?.[0]?.id) return { skippedReason: 'invalid_payment_journal_for_order_company', errorReason: 'invalid_payment_journal_for_order_company' }
      const createPayment = () => createOdooPayment(client, {
        partnerId,
        amount,
        journalId,
        date: paymentDate,
        ref: paymentRef,
        currencyId,
        companyId,
        post: false,
      })
      paymentId = platform === 'salla' ? await withErpCreateIdentity('salla-order-payment', createPayment) : await createPayment()

      const linked = await upsertEntityLink(
        {
          workspaceId,
          platform: platform as EntityLinkPlatform,
          storeId: String(storeId),
          odooModel: 'account.payment',
          storeEntityId: String(zidEntityId),
        },
        paymentId
      )
      if (!linked) return { paymentId, skippedReason: 'payment_link_persistence_failed', errorReason: 'payment_link_persistence_failed' }
    }

    // Save identity BEFORE posting. A posting failure must be observable and the
    // next delivery must retry this same draft, rather than create another payment.
    const readPayment = async () => (await client.searchRead<any>(
      'account.payment', [['id', '=', paymentId]], ['id', 'state', 'company_id'], 1
    ))?.[0]
    let payment = await readPayment()
    const isOrderCompany = (record: { company_id?: unknown } | undefined): boolean =>
      Number(Array.isArray(record?.company_id) ? record.company_id[0] : record?.company_id) === companyId
    if (!isOrderCompany(payment)) return { paymentId, skippedReason: 'linked_payment_company_mismatch', errorReason: 'linked_payment_company_mismatch' }
    if (payment.state === 'draft') {
      let verifiedAfterFault = false
      try {
        await client.execute('account.payment', 'action_post', [[paymentId]])
      } catch (postError) {
        // Odoo can commit action_post and then fail XML-RPC serialization of
        // its None return. Never repeat the write: verify the committed state.
        payment = await readPayment().catch(() => { throw postError })
        if (!isOrderCompany(payment) || !['posted', 'in_process', 'paid'].includes(payment?.state)) throw postError
        verifiedAfterFault = true
      }
      // Also verify a normal RPC response; a return value alone is not proof
      // of the payment state or of its continued company ownership.
      if (!verifiedAfterFault) payment = await readPayment()
    }
    if (!isOrderCompany(payment)) return { paymentId, skippedReason: 'linked_payment_company_mismatch', errorReason: 'linked_payment_company_mismatch' }
    if (!['posted', 'in_process', 'paid'].includes(payment?.state)) {
      return { paymentId, skippedReason: 'payment_not_posted', errorReason: 'payment_not_posted' }
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
        ['id', 'payment_state', 'amount_residual']
      )
      const isSettled = (invoice: { payment_state?: string; amount_residual?: unknown } | undefined): boolean =>
        !!invoice && (['paid', 'in_payment'].includes(invoice.payment_state || '') ||
          (typeof invoice.amount_residual === 'number' && invoice.amount_residual === 0))
      for (const inv of postedInvoices || []) {
        // A replay after reconciliation has no unreconciled lines left. That
        // is success, rather than a reason to retry or create another payment.
        if (isSettled(inv)) { reconciled = true; continue }
        const ok = await reconcilePaymentWithInvoice(client, paymentId, inv.id)
        if (ok) { reconciled = true; continue }
        const [currentInvoice] = await client.searchRead<any>(
          'account.move', [['id', '=', inv.id]], ['id', 'payment_state', 'amount_residual'], 1
        )
        if (isSettled(currentInvoice)) { reconciled = true; continue }
        // Newer Odoo versions may accept action_post and leave a payment
        // in_process without move_id (journal outstanding-account setup).
        // With a posted, unpaid invoice this is not completed payment sync.
        return { paymentId, reconciled, skippedReason: 'payment_invoice_reconciliation_failed', errorReason: 'payment_invoice_reconciliation_failed' }
      }
    }

    return { paymentId, reconciled }
  } catch (err: any) {
    console.error(`[OrderPayment] Failed to sync payment for order #${saleOrderId}:`, err)
    const errorReason = err?.message || 'payment_sync_error'
    return { skippedReason: errorReason, errorReason }
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
  const { client, invoiceId, workspaceId, platform, storeId, zidEntityId } = params

  try {
    const paymentId = await resolveEntityLinkId({
      workspaceId,
      platform: platform as EntityLinkPlatform,
      storeId: String(storeId),
      odooModel: 'account.payment',
      storeEntityId: String(zidEntityId),
    })

    // A human-readable ref is not an identity: store order numbers can collide,
    // including across connection generations. Only use the scoped durable link.
    if (!paymentId) {
      return false
    }

    return await reconcilePaymentWithInvoice(client, paymentId, invoiceId)
  } catch (err: any) {
    console.warn(`[OrderPayment] Reconcile pending payment exception:`, err?.message || err)
    return false
  }
}
