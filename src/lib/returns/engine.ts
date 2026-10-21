/**
 * Orchestrates one return: resolve the original sale order, work out what is
 * still unreturned, then write it to Odoo using the configured mode.
 *
 * The quantity rule is deliberately self-correcting instead of storing a
 * "how much did we already return" counter of our own:
 *
 *   target returned   = platform's cumulative returned quantity
 *   already returned  = Odoo's own view of it
 *                       (negative-SO ledger, or ordered - qty_delivered)
 *   to return now     = target - already
 *
 * A redelivered webhook therefore computes 0 and does nothing, a genuine
 * second partial return computes the delta, and a failed attempt is retried
 * with the full remaining amount instead of a lost one.
 */

import { resolveEntityLinkId, upsertEntityLink } from '@/lib/entity-links'
import type { OdooClient } from '@/lib/odoo-client'
import type { PlatformKey } from '@/lib/platform-fields'

import {
  returnDedupeKey,
  returnSnapshotSignature,
  type ReturnSettings,
  type StoreReturnLine,
} from './detect'
import {
  createCreditNote,
  createNegativeSaleOrder,
  createStockReturn,
  findInvoiceForOrder,
  readNegativeReturnLedger,
  readSaleOrder,
  resolveOdooProductId,
  type OdooReturnLine,
  type OriginalSaleOrder,
} from './odoo'

export interface ReturnEventInput {
  client: OdooClient
  platform: PlatformKey
  event: string
  workspaceId: string
  storeId: string
  orderId: string
  payload: Record<string, unknown>
  settings: ReturnSettings
  /** Salla: cumulative refunded quantities taken from the payload/API. */
  refundedLines?: StoreReturnLine[]
  /** Zid: remaining returnable quantities from `view-for-return`. */
  remaining?: { known: boolean; lines: StoreReturnLine[] }
  autoConfirm?: boolean
}

export interface ReturnOutcome {
  handled: boolean
  status: 'success' | 'failed' | 'skipped'
  message: string
  odooRecordId?: number
  actions: string[]
}

function skipped(message: string): ReturnOutcome {
  return { handled: true, status: 'skipped', message, actions: [] }
}

async function resolveStoreLines(
  client: OdooClient,
  platform: PlatformKey,
  lines: readonly StoreReturnLine[]
): Promise<{ byProduct: Map<number, number>; unresolved: number }> {
  const byProduct = new Map<number, number>()
  let unresolved = 0
  for (const line of lines) {
    const odooId = await resolveOdooProductId(client, platform, line.storeProductId, line.sku)
    if (!odooId) {
      unresolved += 1
      continue
    }
    byProduct.set(odooId, (byProduct.get(odooId) || 0) + Math.abs(line.quantity))
  }
  return { byProduct, unresolved }
}

async function buildReturnLines(
  client: OdooClient,
  original: OriginalSaleOrder,
  platform: PlatformKey,
  input: ReturnEventInput
): Promise<OdooReturnLine[]> {
  if (input.settings.mode === 'negative_so' && original.lines.length === 0) return []

  const ledger =
    input.settings.mode === 'negative_so'
      ? await readNegativeReturnLedger(client, original.name)
      : new Map<number, number>()

  // Zid only ever gives us "remaining returnable", so the cumulative returned
  // quantity is derived from the order itself. Salla gives the refunded lines
  // directly. Whichever source exists, the result is a per-product total.
  let targets = new Map<number, number>()
  if (input.remaining?.known) {
    const { byProduct, unresolved } = await resolveStoreLines(
      client,
      platform,
      input.remaining.lines
    )
    // Zid documents that `view-for-return` lists ONLY products that can still
    // come back, so a product missing from the list has nothing left to
    // return. The exception is an unresolvable row: then "missing" may mean
    // "we could not match it in Odoo", and guessing 0 would silently skip a
    // real return, while guessing "not returned" only delays it. Delay wins.
    const absentMeansFullyReturned = unresolved === 0
    for (const line of original.lines) {
      const remaining = byProduct.has(line.productId)
        ? byProduct.get(line.productId) || 0
        : absentMeansFullyReturned
          ? 0
          : line.orderedQty
      const target = Math.max(0, line.orderedQty - remaining)
      if (target > 0) targets.set(line.productId, target)
    }
  } else if (input.refundedLines && input.refundedLines.length > 0) {
    targets = (await resolveStoreLines(client, platform, input.refundedLines)).byProduct
  } else {
    throw new Error('return_quantities_unknown')
  }

  // One product can appear on several order lines (different prices/discounts).
  // The target is per product, so it is spent once: without this budget the
  // second line would repeat the full quantity, and a credit note would refund
  // more than the customer paid.
  const consumed = new Map<number, number>()
  const out: OdooReturnLine[] = []
  for (const line of original.lines) {
    const target = targets.get(line.productId) || 0
    if (target <= 0) continue
    const already =
      input.settings.mode === 'negative_so'
        ? ledger.get(line.productId) || 0
        : Math.max(0, line.orderedQty - line.deliveredQty)
    const available = Math.max(0, target - already - (consumed.get(line.productId) || 0))
    const quantity =
      input.settings.mode === 'negative_so'
        ? available
        : Math.min(available, Math.max(0, line.deliveredQty - already))
    if (quantity <= 0) continue
    consumed.set(line.productId, (consumed.get(line.productId) || 0) + quantity)
    out.push({
      productId: line.productId,
      quantity,
      priceUnit: line.priceUnit,
      name: line.productName,
      taxIds: line.taxIds,
      saleLineId: line.id,
    })
  }
  return out
}

async function createFromPayloadWithoutOrder(
  input: ReturnEventInput,
  lines: readonly StoreReturnLine[]
): Promise<ReturnOutcome> {
  const { client, platform, workspaceId, storeId, orderId, settings } = input
  if (lines.length === 0) return skipped('no_return_lines')
  const signature = returnSnapshotSignature(lines, `${platform}:${orderId}`)
  const key = returnDedupeKey(platform, orderId, signature)
  const existing = await resolveEntityLinkId({
    workspaceId,
    platform,
    storeId,
    odooModel: 'sale.order',
    storeEntityId: key,
  })
  if (existing) return skipped(`already_applied:${existing}`)

  const resolved: OdooReturnLine[] = []
  for (const line of lines) {
    const productId = await resolveOdooProductId(client, platform, line.storeProductId, line.sku)
    if (!productId) continue
    resolved.push({
      productId,
      quantity: Math.abs(line.quantity),
      priceUnit: line.priceUnit || 0,
      name: line.name || '',
      taxIds: [],
    })
  }
  if (resolved.length === 0) return skipped('no_matching_products')

  const created = await client.create('sale.order', {
    partner_id: false,
    client_order_ref: `RET:${platform}:${orderId}`,
    origin: `${platform}:${orderId}`,
    note: settings.reason || `Return of ${platform}:${orderId}`,
    order_line: resolved.map(line => [
      0,
      0,
      {
        product_id: line.productId,
        name: line.name || `Return - ${orderId}`,
        product_uom_qty: -Math.abs(line.quantity),
        price_unit: line.priceUnit,
      },
    ]),
  })
  await upsertEntityLink(
    { workspaceId, platform, storeId, odooModel: 'sale.order', storeEntityId: key },
    Number(created)
  )
  return {
    handled: true,
    status: 'success',
    message: `negative_so_without_original:${created}`,
    odooRecordId: Number(created),
    actions: ['negative_so'],
  }
}

export async function processReturnEvent(input: ReturnEventInput): Promise<ReturnOutcome> {
  const { client, platform, workspaceId, storeId, orderId, settings } = input
  if (settings.mode === 'nothing') {
    return { handled: false, status: 'skipped', message: 'returns_disabled', actions: [] }
  }

  try {
    const linkedId = await resolveEntityLinkId({
      workspaceId,
      platform,
      storeId,
      odooModel: 'sale.order',
      storeEntityId: orderId,
    })
    const original = linkedId ? await readSaleOrder(client, linkedId) : null

    if (!original) {
      if (settings.fallback_when_missing === 'skip') {
        return skipped(`original_order_not_found:${orderId}`)
      }
      return createFromPayloadWithoutOrder(input, input.refundedLines || [])
    }
    if (original.state === 'cancel') {
      return skipped(`original_order_cancelled:${original.name}`)
    }

    const lines = await buildReturnLines(client, original, platform, input)
    if (lines.length === 0) {
      return skipped(`nothing_to_return:${original.name}`)
    }

    const actions: string[] = []
    let odooRecordId: number | undefined

    if (settings.mode === 'negative_so') {
      odooRecordId = await createNegativeSaleOrder(client, original, lines, settings.reason)
      actions.push(`negative_so:${odooRecordId}`)
      if (input.autoConfirm) {
        await client.execute('sale.order', 'action_confirm', [[odooRecordId]])
        actions.push('confirmed')
      }
    } else {
      const majorVersion = await client.getMajorVersion().catch(() => 17)
      const stock = await createStockReturn(client, original.id, lines, majorVersion)
      actions.push(`stock_return:${stock.pickingIds.join(',') || 'none'}`)
      odooRecordId = original.id

      if (settings.create_credit_note) {
        const invoiceId = await findInvoiceForOrder(client, original)
        if (!invoiceId) {
          actions.push('credit_note_skipped:no_invoice')
        } else {
          const creditId = await createCreditNote(
            client,
            original,
            invoiceId,
            lines,
            settings.credit_note_journal_id,
            settings.reason
          )
          actions.push(`credit_note:${creditId}`)
        }
      }
    }

    return {
      handled: true,
      status: 'success',
      message: actions.join('|'),
      odooRecordId,
      actions,
    }
  } catch (err: any) {
    return {
      handled: true,
      status: 'failed',
      message: err?.message ? String(err.message).slice(0, 300) : String(err).slice(0, 300),
      actions: [],
    }
  }
}
