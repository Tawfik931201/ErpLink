/**
 * Shared shaping for Odoo field metadata (`getOdooModelFields` results).
 *
 * Every mapping surface needs the same "human label (technical_name)" form for
 * a field dropdown, and the same fallback when Odoo has no label. Keeping the
 * transform in one place means a change to the label format cannot drift
 * between the mapping center and the mapping dialogs.
 */

export type OdooFieldOption = {
  value: string
  label: string
  desc?: string
}

type RawOdooField = {
  value: string
  label?: string
  desc?: string
}

/**
 * Builds a display option: "Barcode (barcode)" when Odoo supplies a distinct
 * label, otherwise the bare technical name so the dropdown is never blank.
 */
export function toOdooFieldOption(field: RawOdooField): OdooFieldOption {
  return {
    value: field.value,
    label: field.label && field.label !== field.value ? `${field.label} (${field.value})` : field.value,
    desc: field.desc || field.value,
  }
}
