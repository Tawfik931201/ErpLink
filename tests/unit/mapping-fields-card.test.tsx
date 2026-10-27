/**
 * @jest-environment jsdom
 *
 * Custom-mapping record page: the saved `mappings` payload must be shown as
 * ordinary fields, never as a raw JSON blob.
 *
 * The stored shape is `{ "<odoo_model>": [ { erpField, zidField, staticValue } ],
 * __settings: {...} }` (verified against live rows). A merchant opens this page
 * to read "what maps to what", so:
 *   - every model gets its own table with ERP field / store field / static
 *     value / policy columns,
 *   - `__settings` is rendered as labelled values,
 *   - no JSON syntax (`{`, `}`, `"key":`) leaks into the DOM.
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import React from 'react'

import { MappingFieldsCard } from '@/app/(app)/app/mapping-center/custom/[id]/mapping-fields-card'

const PAYLOAD = {
  'pos.category': [
    { id: 'a1', erpField: 'name', zidField: 'name', staticValue: '' },
    { id: 'a2', erpField: 'parent_id', zidField: 'parent', policy: 'create' },
    { id: 'a3', erpField: 'sequence', staticValue: '10' },
  ],
  'res.partner': [{ id: 'b1', erpField: 'email', zidField: 'customer.email' }],
  __settings: {
    relations: [{ sourceModel: 'pos.category', targetModel: 'res.partner' }],
    payloadPaths: { 'pos.category': 'category' },
    deleteBehavior: ['archive'],
    variantSyncMode: 'AS_VARIANTS',
    addDiscountAsLine: true,
    discountProductSku: 'DISC',
    discountMode: 'percent',
  },
}

describe('MappingFieldsCard', () => {
  it('renders every mapped field as a value instead of JSON', () => {
    const { container } = render(<MappingFieldsCard mappings={PAYLOAD} ar={false} />)

    expect(screen.getAllByText('pos.category').length).toBeGreaterThan(0)
    expect(screen.getByText('res.partner')).toBeInTheDocument()
    expect(screen.getAllByText('name').length).toBeGreaterThan(0)
    expect(screen.getByText('parent_id')).toBeInTheDocument()
    expect(screen.getByText('customer.email')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()

    // No JSON syntax anywhere in the rendered output.
    const text = container.textContent || ''
    expect(text).not.toContain('{')
    expect(text).not.toContain('}')
    expect(text).not.toContain('"erpField"')
    expect(text).not.toContain('__settings')
  })

  it('shows the field count per model and in total', () => {
    render(<MappingFieldsCard mappings={PAYLOAD} ar={false} />)

    // 3 + 1 across 2 models.
    expect(screen.getByText('4 fields · 2 models')).toBeInTheDocument()
    expect(screen.getByText('3 fields')).toBeInTheDocument()
    expect(screen.getByText('1 fields')).toBeInTheDocument()
  })

  it('renders the policy of a line as a labelled chip', () => {
    render(<MappingFieldsCard mappings={PAYLOAD} ar={false} />)
    expect(screen.getByText('Create record')).toBeInTheDocument()
  })

  it('renders __settings as labelled values, not as a payload', () => {
    render(<MappingFieldsCard mappings={PAYLOAD} ar={false} />)

    expect(screen.getByText('Additional settings')).toBeInTheDocument()
    expect(screen.getByText('Model relations')).toBeInTheDocument()
    expect(screen.getByText('Payload paths')).toBeInTheDocument()
    expect(screen.getByText('DISC')).toBeInTheDocument()
    expect(screen.getByText('Percent')).toBeInTheDocument()
  })

  it('does not show the retired store-deletion and variant-mode rows', () => {
    // Both were removed from the record view on request: the form owns those
    // choices, and echoing them here only duplicated a setting the merchant
    // reads as noise.
    render(<MappingFieldsCard mappings={PAYLOAD} ar={false} />)

    expect(screen.queryByText('On store deletion')).not.toBeInTheDocument()
    expect(screen.queryByText('Archive')).not.toBeInTheDocument()
    expect(screen.queryByText('Variant sync')).not.toBeInTheDocument()
    expect(screen.queryByText('As variants')).not.toBeInTheDocument()
  })

  it('keeps the empty state when nothing is mapped', () => {
    render(<MappingFieldsCard mappings={{ __settings: {} }} ar={false} />)
    expect(screen.getByText('No mapped fields yet.')).toBeInTheDocument()
    // Nothing meaningful in __settings ⇒ no empty settings card either.
    expect(screen.queryByText('Additional settings')).not.toBeInTheDocument()
  })

  it('accepts a payload stored as a JSON string', () => {
    render(<MappingFieldsCard mappings={JSON.stringify(PAYLOAD)} ar={false} />)
    expect(screen.getAllByText('pos.category').length).toBeGreaterThan(0)
    expect(screen.getByText('customer.email')).toBeInTheDocument()
  })

  it('does not throw on malformed data', () => {
    render(<MappingFieldsCard mappings={'{not json'} ar={false} />)
    expect(screen.getByText('No mapped fields yet.')).toBeInTheDocument()
  })

  it('renders Arabic labels when ar is set', () => {
    render(<MappingFieldsCard mappings={PAYLOAD} ar />)
    expect(screen.getByText('الحقول المربوطة')).toBeInTheDocument()
    expect(screen.getAllByText('حقل ERP').length).toBeGreaterThan(0)
    expect(screen.getByText('إعدادات إضافية')).toBeInTheDocument()
  })
})
