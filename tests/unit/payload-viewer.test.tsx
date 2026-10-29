/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'

import { PayloadViewer } from '@/app/(app)/app/logs/payload-viewer'

// Mock useLanguage (relative path per AGENTS.md jest.mock rules)
jest.mock('../../src/components/language-provider', () => ({
  useLanguage: () => ({
    t: (k: string) => k,
    lang: 'ar',
    dir: 'rtl',
  }),
}))

describe('Universal PayloadViewer Component', () => {
  it('renders both Visual and Raw JSON tab buttons', () => {
    render(<PayloadViewer payload={{ anyKey: 'anyValue' }} platform="zid" />)

    expect(screen.getByRole('button', { name: /خانات وجداول مرئية/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /كود JSON/i })).toBeInTheDocument()
  })

  it('renders Product payload: fields as cards, variants as an interactive table', () => {
    const productPayload = {
      product_id: 8801,
      name: 'قميص قطني فاخر',
      brand: 'Zara',
      price: 120,
      variants: [
        { id: 1, size: 'S', color: 'White', stock: 10, sku: 'SHIRT-W-S' },
        { id: 2, size: 'M', color: 'White', stock: 25, sku: 'SHIRT-W-M' },
        { id: 3, size: 'L', color: 'Black', stock: 15, sku: 'SHIRT-B-L' },
      ],
      tags: ['clothing', 'summer', 'cotton'],
    }

    render(<PayloadViewer payload={productPayload} />)

    // Scalar fields
    expect(screen.getByText('قميص قطني فاخر')).toBeInTheDocument()
    expect(screen.getByText('Zara')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()

    // Variants Table headers & rows
    expect(screen.getByText(/Variants/i)).toBeInTheDocument()
    expect(screen.getByText('SHIRT-W-S')).toBeInTheDocument()
    expect(screen.getByText('SHIRT-W-M')).toBeInTheDocument()
    expect(screen.getByText('SHIRT-B-L')).toBeInTheDocument()

    // Tags
    expect(screen.getByText('clothing')).toBeInTheDocument()
    expect(screen.getByText('summer')).toBeInTheDocument()
  })

  it('renders Customer payload: contact fields and addresses as sub-table', () => {
    const customerPayload = {
      id: 501,
      first_name: 'أحمد',
      last_name: 'علي',
      email: 'ahmed@example.com',
      mobile: '0559988776',
      addresses: [
        { id: 10, city: 'الرياض', street: 'طريق الملك فهد', is_default: true },
        { id: 11, city: 'جدة', street: 'شارع التحلية', is_default: false },
      ],
    }

    render(<PayloadViewer payload={customerPayload} />)

    expect(screen.getByText('أحمد')).toBeInTheDocument()
    expect(screen.getByText('ahmed@example.com')).toBeInTheDocument()
    expect(screen.getByText('0559988776')).toBeInTheDocument()

    // Addresses Table
    expect(screen.getByText('الرياض')).toBeInTheDocument()
    expect(screen.getByText('طريق الملك فهد')).toBeInTheDocument()
    expect(screen.getByText('جدة')).toBeInTheDocument()
  })

  it('renders Custom Mapping payload (models as tables, __settings as section)', () => {
    const mappingPayload = {
      'res.partner': [
        { id: 'm1', erpField: 'name', zidField: 'customer.name' },
        { id: 'm2', erpField: 'email', zidField: 'customer.email' },
      ],
      'pos.category': [
        { id: 'c1', erpField: 'name', zidField: 'category.name' },
      ],
      __settings: {
        addDiscountAsLine: true,
        discountProductSku: 'DISC',
      },
    }

    render(<PayloadViewer payload={mappingPayload} />)

    // Table for res.partner
    expect(screen.getByText(/res partner/i)).toBeInTheDocument()
    expect(screen.getByText('customer.name')).toBeInTheDocument()
    expect(screen.getByText('customer.email')).toBeInTheDocument()

    // Table for pos.category
    expect(screen.getByText(/pos category/i)).toBeInTheDocument()
    expect(screen.getByText('category.name')).toBeInTheDocument()

    // Section for settings
    expect(screen.getByText(/Settings: settings/i)).toBeInTheDocument()
    expect(screen.getByText('DISC')).toBeInTheDocument()
  })

  it('switches to raw JSON view when clicking the JSON tab', () => {
    const data = { customKey: 'uniqueValue123' }
    render(<PayloadViewer payload={data} />)

    const jsonTabBtn = screen.getByRole('button', { name: /كود JSON/i })
    fireEvent.click(jsonTabBtn)

    expect(screen.getByText(/"uniqueValue123"/)).toBeInTheDocument()
  })

  it('handles null, undefined, or empty payload gracefully without throwing', () => {
    const { rerender } = render(<PayloadViewer payload={null} />)
    expect(screen.getByText(/لا توجد بيانات متاحة/i)).toBeInTheDocument()

    rerender(<PayloadViewer payload={undefined} />)
    expect(screen.getByText(/لا توجد بيانات متاحة/i)).toBeInTheDocument()

    rerender(<PayloadViewer payload={{}} />)
    expect(screen.getByText(/لا توجد بيانات متاحة/i)).toBeInTheDocument()
  })

  it('filters fields dynamically when typing in search input', () => {
    const sample = {
      targetField: 'FoundMe',
      otherField: 'HideMe',
    }
    render(<PayloadViewer payload={sample} />)

    const searchInput = screen.getByPlaceholderText(/بحث في الحقول والجداول/i)
    fireEvent.change(searchInput, { target: { value: 'FoundMe' } })

    expect(screen.getByText('FoundMe')).toBeInTheDocument()
    expect(screen.queryByText('HideMe')).not.toBeInTheDocument()
  })
})
