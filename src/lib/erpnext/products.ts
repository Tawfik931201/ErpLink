import { toNameString } from '@/lib/sync-helpers'

export function applyErpNextItemDefaults(values: Record<string, unknown>, zidData: Record<string, unknown>): void {
  if (!values.item_code && zidData.sku) values.item_code = zidData.sku
  if (!values.item_name && zidData.name) values.item_name = toNameString(zidData.name)
  if (!values.item_group) values.item_group = 'All Item Groups'
  if (!values.stock_uom) values.stock_uom = 'Nos'
}
