import { isTerminalReturnReview } from '@/lib/sync-queue'

describe('terminal return business validation', () => {
  it.each([
    'return_grouped_components_require_review',
    'return_damaged_requires_financial_review',
    'return_receipt_quantity_invalid',
    'return_receipt_quantity_exceeds_original:197',
    'return_fallback_order_line_ambiguous:QA-SKU',
    'return_fallback_unit_price_unavailable:QA-SKU',
    'return_fallback_product_not_found:QA-SKU',
    'return_configured_product_not_found:QA-SKU',
    'return_configured_customer_not_found',
    'return_order_match_missing_but_linked:57',
    'return_order_match_conflicts_with_durable_link',
    'return_mode_changed_existing_financial_effect_requires_review',
    'return_stock_without_credit_note_requires_review',
    'return_grouped_mixed_parent_component_requires_review',
    'return_grouped_parent_quantity_invalid',
    'return_grouped_stock_quantity_invalid',
    'return_grouped_partial_inventory_effect_requires_review',
    'order_cod_fee_product_not_configured_requires_review',
    'order_cod_fee_missing_on_sale_order_requires_review:73:5',
    'order_cod_fee_currency_rate_invalid_requires_review',
    'order_cod_fee_amount_mismatch_requires_review:73:5:10',
    'return_request_unreadable',
  ])('freezes deterministic review reason %s rather than retrying it', reason => {
    expect(isTerminalReturnReview(reason)).toBe(true)
  })

  it.each([
    'stock_return_missing_delivered_moves:197:1',
    'ERP_OUTCOME_UNKNOWN:negative_so_readback',
    'payment_invoice_reconciliation_failed',
    'network error',
  ])('does not mistake infrastructure or missing deliveries for terminal review: %s', reason => {
    expect(isTerminalReturnReview(reason)).toBe(false)
  })
})
