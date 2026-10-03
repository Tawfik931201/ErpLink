import {
  CUSTOM_FIELD_TYPES,
  buildSelectionString,
  escapeXmlAttr,
  validateCustomFieldInput,
} from '@/lib/custom-field-validation'

/**
 * The custom-field Server Action used to interpolate the user-supplied label
 * straight into an Odoo view arch (`string="${fieldLabel}"`) with no escaping,
 * and to filter its Supabase update by row id only. These tests pin both fixes.
 */

describe('escapeXmlAttr', () => {
  it('leaves ordinary text untouched', () => {
    expect(escapeXmlAttr('Order Total')).toBe('Order Total')
    expect(escapeXmlAttr('حقول الطلب')).toBe('حقول الطلب')
  })

  it('escapes the quote that would break out of the attribute', () => {
    expect(escapeXmlAttr('a" onload="alert(1)')).toBe('a&quot; onload=&quot;alert(1)')
  })

  it('escapes angle brackets and ampersands', () => {
    expect(escapeXmlAttr('<script>')).toBe('&lt;script&gt;')
    expect(escapeXmlAttr('a & b')).toBe('a &amp; b')
  })

  it('escapes the ampersand first so entities are not double-escaped', () => {
    // '&<"' → if '&' were escaped last this would become '&amp;lt;'
    expect(escapeXmlAttr('&<"')).toBe('&amp;&lt;&quot;')
  })

  it('escapes single quotes too, since some arches use them', () => {
    expect(escapeXmlAttr("it's")).toBe('it&apos;s')
  })

  it('cannot be used to inject a second attribute', () => {
    const injected = escapeXmlAttr('X"/><field name="x_evil')
    expect(injected).not.toContain('"')
    expect(injected).not.toContain('<')
  })
})

describe('buildSelectionString', () => {
  it('renders the python-literal selection format', () => {
    expect(buildSelectionString([{ key: 'draft', label: 'مسودة' }])).toBe("[('draft', 'مسودة')]")
  })

  it('joins several options', () => {
    expect(
      buildSelectionString([
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
      ])
    ).toBe("[('a', 'A'), ('b', 'B')]")
  })

  it('strips the characters that would forge an extra option', () => {
    // A naive backslash escape of the quote would produce a second tuple here.
    const out = buildSelectionString([{ key: "a'), ('b", label: 'x' }])
    expect(out).toBe("[('a b', 'x')]")
  })

  it('neutralises parens, commas, brackets and backslashes', () => {
    const out = buildSelectionString([{ key: 'k', label: "a'), ('evil', 'p" }])
    expect(out).toBe("[('k', 'a evil p')]")
  })

  it('cannot escape the outer list', () => {
    const out = buildSelectionString([{ key: "] , ('z', 'q", label: 'L' }])
    expect(out).toBe("[('z q', 'L')]")
    // exactly one option tuple survived
    expect(out.match(/\(/g)).toHaveLength(1)
  })
})

describe('validateCustomFieldInput', () => {
  const base = {
    technicalName: 'x_order_total',
    fieldLabel: 'Order Total',
    fieldType: 'char',
    odooModel: 'sale.order',
  }

  it('accepts a well-formed payload', () => {
    const res = validateCustomFieldInput(base)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.technicalName).toBe('x_order_total')
      expect(res.value.fieldType).toBe('char')
    }
  })

  it('trims surrounding whitespace on the name and label', () => {
    const res = validateCustomFieldInput({ ...base, technicalName: '  x_a  ', fieldLabel: '  A  ' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.technicalName).toBe('x_a')
      expect(res.value.fieldLabel).toBe('A')
    }
  })

  it('rejects a technical name that is not an x_ identifier', () => {
    // This is the injection the old code allowed straight into an XML attribute.
    const res = validateCustomFieldInput({ ...base, technicalName: 'x_a"><field name="x_evil' })
    expect(res.ok).toBe(false)
  })

  it('rejects a name with the wrong prefix', () => {
    expect(validateCustomFieldInput({ ...base, technicalName: 'custom_a' }).ok).toBe(false)
  })

  it('accepts the erpnext prefix only when erpType says so', () => {
    expect(validateCustomFieldInput({ ...base, technicalName: 'custom_a' }, 'erpnext').ok).toBe(true)
    expect(validateCustomFieldInput({ ...base, technicalName: 'x_a' }, 'erpnext').ok).toBe(false)
  })

  it('rejects an empty label', () => {
    expect(validateCustomFieldInput({ ...base, fieldLabel: '   ' }).ok).toBe(false)
  })

  it('rejects an over-long label', () => {
    expect(validateCustomFieldInput({ ...base, fieldLabel: 'x'.repeat(129) }).ok).toBe(false)
  })

  it('rejects a model name that is not a dotted identifier', () => {
    expect(validateCustomFieldInput({ ...base, odooModel: 'sale.order"; drop' }).ok).toBe(false)
    expect(validateCustomFieldInput({ ...base, odooModel: '' }).ok).toBe(false)
  })

  it('rejects a field type outside the allowlist', () => {
    expect(validateCustomFieldInput({ ...base, fieldType: 'binary' }).ok).toBe(false)
    expect(validateCustomFieldInput({ ...base, fieldType: '' }).ok).toBe(false)
  })

  it('accepts every field type the UI offers', () => {
    for (const t of CUSTOM_FIELD_TYPES) {
      const payload: Parameters<typeof validateCustomFieldInput>[0] = { ...base, fieldType: t }
      if (t === 'many2one') payload.relation = 'res.partner'
      if (t === 'selection') payload.selectionOptions = [{ key: 'a', label: 'A' }]
      expect(validateCustomFieldInput(payload).ok).toBe(true)
    }
  })

  it('requires a relation for many2one', () => {
    expect(validateCustomFieldInput({ ...base, fieldType: 'many2one' }).ok).toBe(false)
    expect(validateCustomFieldInput({ ...base, fieldType: 'many2one', relation: 'res.partner' }).ok).toBe(true)
  })

  it('requires at least one selection option with a key', () => {
    expect(validateCustomFieldInput({ ...base, fieldType: 'selection' }).ok).toBe(false)
    expect(validateCustomFieldInput({ ...base, fieldType: 'selection', selectionOptions: [] }).ok).toBe(false)
    expect(
      validateCustomFieldInput({ ...base, fieldType: 'selection', selectionOptions: [{ key: '', label: 'A' }] }).ok
    ).toBe(false)
  })

  it('ignores selection options on a non-selection field', () => {
    const res = validateCustomFieldInput({ ...base, fieldType: 'char', selectionOptions: [] })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.selectionOptions).toBeUndefined()
  })

  it('rejects non-integer or non-positive group ids', () => {
    expect(validateCustomFieldInput({ ...base, groupIds: [1, -2] }).ok).toBe(false)
    expect(validateCustomFieldInput({ ...base, groupIds: [1.5] }).ok).toBe(false)
    expect(validateCustomFieldInput({ ...base, groupIds: [1, 2] }).ok).toBe(true)
  })

  it('rejects an over-long help text', () => {
    expect(validateCustomFieldInput({ ...base, help: 'x'.repeat(1001) }).ok).toBe(false)
  })

  it('survives a payload with missing keys', () => {
    const res = validateCustomFieldInput({} as Parameters<typeof validateCustomFieldInput>[0])
    expect(res.ok).toBe(false)
  })
})
