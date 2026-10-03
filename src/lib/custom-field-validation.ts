/**
 * Validation for the "add custom field" server action.
 *
 * These are pure functions on purpose. A `'use server'` module may only export
 * async functions (Next fails the build otherwise), and this logic is worth
 * unit-testing on its own — see `tests/unit/custom-field-validation.test.ts`.
 *
 * Why it exists: Server Actions are public HTTP endpoints. The React form in
 * `mapping-center/add-custom-field-form.tsx` already validates the technical
 * name before calling us, but that is a convenience for the user, not a
 * security boundary. `injectFieldIntoViews` also interpolates the label into
 * an XML `string="..."` attribute of a real Odoo view arch, so an unescaped
 * quote breaks out of the attribute and injects arbitrary view markup into the
 * customer's ERP.
 */

/** The field types the UI offers, in the order it offers them. */
export const CUSTOM_FIELD_TYPES = [
  'char',
  'text',
  'integer',
  'float',
  'boolean',
  'date',
  'datetime',
  'many2one',
  'selection',
  'monetary',
] as const

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

/** Odoo: `x_` prefix. ERPNext: `custom_` prefix. Mirrors the form's regexes. */
const ODOO_TECHNICAL_NAME_RE = /^x_[a-z][a-z0-9_]{0,61}$/
const ERPNEXT_TECHNICAL_NAME_RE = /^custom_[a-z][a-z0-9_]{0,61}$/

/** Odoo model technical names, e.g. `sale.order`, `product.template`. */
const MODEL_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/

/**
 * Escape a value for use inside an XML attribute value.
 *
 * Odoo's view arch is parsed as XML, so `"`, `<`, `>` and `&` are the only
 * characters that can break out of `string="…"`. `&` must be replaced first or
 * it would double-escape the entities produced after it.
 */
export function escapeXmlAttr(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Render a selection field's options as Odoo's python-literal selection string.
 *
 * The format is `[('key', 'Label'), …]`, so a key or label containing a quote,
 * comma, paren or backslash would change the parsed structure — e.g. a key of
 * `a'), ('b` would silently add a second option. Backslash-escaping a single
 * quote is not enough, so anything structural is stripped.
 */
export function buildSelectionString(
  options: Array<{ key: string; label: string }>
): string {
  const tuple = (v: unknown) => `'${String(v ?? '')
    .replace(/[\\'(),[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()}'`
  return `[${options.map(o => `(${tuple(o.key)}, ${tuple(o.label)})`).join(', ')}]`
}

export interface CustomFieldInput {
  technicalName: string
  fieldLabel: string
  fieldType: string
  odooModel: string
  relation?: string
  selectionOptions?: Array<{ key: string; label: string }>
  groupIds?: number[]
  help?: string
}

export type ValidationResult =
  | { ok: true; value: CustomFieldInput & { fieldType: CustomFieldType } }
  | { ok: false; error: string }

const MAX_LABEL_LENGTH = 128
const MAX_HELP_LENGTH = 1000
const MAX_SELECTION_OPTIONS = 200

/**
 * Validate and normalise a create-custom-field payload.
 *
 * `erpType` only decides which technical-name prefix is legal; everything else
 * is identical for the two ERPs.
 */
export function validateCustomFieldInput(
  input: CustomFieldInput,
  erpType?: string
): ValidationResult {
  const technicalName = String(input?.technicalName ?? '').trim()
  const nameRe = erpType === 'erpnext' ? ERPNEXT_TECHNICAL_NAME_RE : ODOO_TECHNICAL_NAME_RE
  if (!nameRe.test(technicalName)) {
    return {
      ok: false,
      error:
        erpType === 'erpnext'
          ? 'Invalid technical name: must start with custom_ and use only lowercase letters, numbers and underscores'
          : 'Invalid technical name: must start with x_ and use only lowercase letters, numbers and underscores',
    }
  }

  const fieldLabel = String(input?.fieldLabel ?? '').trim()
  if (!fieldLabel) return { ok: false, error: 'Field label is required' }
  if (fieldLabel.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `Field label is too long (max ${MAX_LABEL_LENGTH} characters)` }
  }

  const odooModel = String(input?.odooModel ?? '').trim()
  if (!MODEL_NAME_RE.test(odooModel)) {
    return { ok: false, error: 'Invalid model name' }
  }

  const fieldType = String(input?.fieldType ?? '').trim()
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(fieldType)) {
    return { ok: false, error: `Unsupported field type: ${fieldType}` }
  }
  const typedType = fieldType as CustomFieldType

  const help = String(input?.help ?? '')
  if (help.length > MAX_HELP_LENGTH) {
    return { ok: false, error: `Help text is too long (max ${MAX_HELP_LENGTH} characters)` }
  }

  // `relation` is written into ir.model.fields as the many2one target, so an
  // arbitrary string here would let a caller point the field at any model.
  let relation: string | undefined
  if (typedType === 'many2one') {
    const rel = String(input?.relation ?? '').trim()
    if (!MODEL_NAME_RE.test(rel)) {
      return { ok: false, error: 'A valid related model is required for a Link (many2one) field' }
    }
    relation = rel
  }

  // Every option needs a non-empty key; an empty key is what the form already
  // filters out, so an empty one here means a hand-crafted call.
  let selectionOptions: Array<{ key: string; label: string }> | undefined
  if (typedType === 'selection') {
    const opts = input?.selectionOptions ?? []
    if (!Array.isArray(opts) || opts.length === 0) {
      return { ok: false, error: 'A selection field needs at least one option' }
    }
    if (opts.length > MAX_SELECTION_OPTIONS) {
      return { ok: false, error: `Too many selection options (max ${MAX_SELECTION_OPTIONS})` }
    }
    selectionOptions = opts.map(o => ({
      key: String(o?.key ?? '').trim(),
      label: String(o?.label ?? '').trim(),
    }))
    if (selectionOptions.some(o => !o.key)) {
      return { ok: false, error: 'Every selection option needs a key' }
    }
  }

  let groupIds: number[] | undefined
  if (Array.isArray(input?.groupIds) && input!.groupIds!.length > 0) {
    const ids = input!.groupIds!
    if (!ids.every(id => Number.isInteger(id) && id > 0)) {
      return { ok: false, error: 'Invalid security group id' }
    }
    groupIds = [...ids]
  }

  return {
    ok: true,
    value: {
      technicalName,
      fieldLabel,
      fieldType: typedType,
      odooModel,
      relation,
      selectionOptions,
      groupIds,
      help,
    },
  }
}
