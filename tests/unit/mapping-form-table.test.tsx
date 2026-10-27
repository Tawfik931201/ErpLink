/**
 * @jest-environment jsdom
 *
 * Editable mapping table = the read-only presentation.
 *
 * The merchant asked for the field-mapping FORM to look exactly like the
 * read-only record card (`MappingFieldsCard`): one bordered card with a muted
 * header strip, one row per mapped field with the same four columns (ERP field,
 * store field, static value, policy) — only now every cell can be changed and
 * rows can be added/removed.
 *
 * The relational extras (inline match, creation mapping, multi-field match)
 * used to be stacked inside the policy cell, which made every row multi-line
 * and broke that look. They now live in a row that expands under the click of
 * a per-row "details" button, so the default state matches the read-only view.
 */

import fs from 'fs'
import path from 'path'

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import React from 'react'

import { LanguageProvider } from '@/components/language-provider'

import FieldMappingForm from '../../src/app/(app)/app/mapping-center/field-mapping-form'

// The form imports server actions, which drag Clerk's ESM build (and the
// Supabase client) into the test. The table layout under test needs none of it.
jest.mock('../../src/app/actions/entity-links', () => ({
  getEntityLinkStats: jest.fn(async () => ({ success: true, count: 0, last: null })),
}))
jest.mock('../../src/app/actions/field-mappings', () => ({
  saveFieldMapping: jest.fn(async () => ({ success: true })),
}))
jest.mock('../../src/app/actions/odoo', () => ({
  getOdooFieldValueOptions: jest.fn(async () => ({ success: false, options: [] })),
  getOdooModelFields: jest.fn(async () => ({ success: false, fields: [] })),
  refreshOdooCache: jest.fn(async () => ({ success: false })),
  dryRunMatch: jest.fn(async () => ({ success: false })),
}))

const FORM_SRC = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'app',
  '(app)',
  'app',
  'mapping-center',
  'field-mapping-form.tsx'
)

const RECORD_SRC = path.join(
  __dirname,
  '..',
  '..',
  'src',
  'app',
  '(app)',
  'app',
  'mapping-center',
  'custom',
  '[id]',
  'mapping-detail-client.tsx'
)

function renderForm(overrides: { initialOdooOperation?: 'create' | 'update' | 'delete' } = {}) {
  return render(
    <LanguageProvider initialLang="ar">
      <FieldMappingForm
        initialModels={[{ model: 'product.template', name: 'Product' }]}
        hasOdooConnection
        preloadedModel="product.template"
        preloadedFields={[
          { value: 'name', label: 'Name', type: 'char' },
          { value: 'list_price', label: 'Sales Price', type: 'float' },
          { value: 'categ_id', label: 'Category', type: 'many2one', relation: 'product.category' },
        ]}
        initialName="Products mapping"
        initialOdooModel="product.template"
        initialOdooOperation={overrides.initialOdooOperation ?? 'create'}
        initialMappings={{
          'product.template': [
            { id: 'a1', erpField: 'name', zidField: 'name' },
            { id: 'a2', erpField: 'categ_id', zidField: 'category', policy: 'none' },
          ],
        }}
      />
    </LanguageProvider>
  )
}

describe('FieldMappingForm — same presentation as the record view', () => {
  it('renders the four read-only columns as a header row', () => {
    renderForm()

    expect(screen.getByText('الحقول المربوطة')).toBeInTheDocument()
    expect(screen.getByText('حقل ERP')).toBeInTheDocument()
    expect(screen.getByText('حقل المتجر')).toBeInTheDocument()
    expect(screen.getByText('قيمة ثابتة')).toBeInTheDocument()
    expect(screen.getByText('السياسة')).toBeInTheDocument()
  })

  it('shows one row per saved mapping plus the add-row affordance', () => {
    const { container } = renderForm()

    // Two mapped lines + the "add field" strip row.
    expect(container.querySelectorAll('tbody tr').length).toBe(3)
    expect(screen.getByRole('button', { name: /Add New Field|إضافة/ })).toBeInTheDocument()
  })

  it('keeps the relational extras collapsed until the row is expanded', () => {
    renderForm()

    // Not visible by default — that is what makes the row single-line again.
    expect(screen.queryByText('مطابقة السجل المرتبط')).not.toBeInTheDocument()
    expect(screen.queryByText('مطابقة متقدمة (متعدد الحقول)')).not.toBeInTheDocument()
  })

  it('pins the layout contract in source (square card, muted header strip, per-row expansion)', () => {
    const src = fs.readFileSync(FORM_SRC, 'utf8')

    // Card wrapper identical in shape to the record card.
    expect(src).toContain('<div className="overflow-hidden border border-border bg-card">')
    // Muted header strip with the same title and icon.
    expect(src).toContain('border-b border-border bg-muted px-3 py-1.5')
    expect(src).toContain('<Layers className="h-3.5 w-3.5 text-muted-foreground" />')
    // Same column order/widths as MappingFieldsCard (plus a narrow actions cell).
    expect(src).toContain('w-[30%] px-3 py-1.5 text-start font-bold')
    expect(src).toContain('w-[27%] px-3 py-1.5 text-start font-bold')
    expect(src).toContain('w-[18%] px-3 py-1.5 text-start font-bold')
    expect(src).toContain('w-[20%] px-3 py-1.5 text-start font-bold')
    // Rows: hairline separators only, no cell borders.
    expect(src).toContain('border-b border-border/40 last:border-0 hover:bg-muted/30')
    // Expansion is state-driven, one row at a time.
    expect(src).toContain('expandedLineId')
    expect(src).toContain('{rowIsRelational && isExpanded && (')
    // The cell pickers use the compact monospace rendering.
    expect(src.match(/compact\n/g)?.length || src.match(/compact\r\n/g)?.length || 0).toBeGreaterThan(0)
    // No leftover bespoke table chrome.
    expect(src).not.toContain('border-separate border-spacing-0')
    expect(src).not.toContain('rounded-full px-2 py-0.5 text-[10px] font-medium border')
  })
})

describe('FieldMappingForm — header is the record page header grid', () => {
  it('renders the four-column caption grid with live controls in the cells', () => {
    const { container } = renderForm()

    // One card holding a 4-column grid, exactly like the record page.
    const grid = container.querySelector('.grid.grid-cols-2.gap-4.md\\:grid-cols-4')
    expect(grid).toBeInTheDocument()

    // Every cell is a tiny uppercase caption over a value — never a label above
    // a boxed input, which is what made the form look unlike the record page.
    const cells = grid!.children
    expect(cells.length).toBeGreaterThanOrEqual(6)
    for (const cell of Array.from(cells)) {
      const caption = cell.firstElementChild
      expect(caption?.tagName).toBe('P')
      expect(caption?.className).toContain('text-[10px]')
      expect(caption?.className).toContain('uppercase')
      expect(caption?.className).toContain('tracking-wider')
      expect(caption?.className).toContain('text-muted-foreground')
    }

    // The cells are the record's own fields, and each one is editable.
    expect(screen.getByText('حدث زد')).toBeInTheDocument()
    expect(screen.getByText('نموذج أودو')).toBeInTheDocument()
    expect(screen.getByText('العملية')).toBeInTheDocument()
    expect(screen.getByText('الاتجاه')).toBeInTheDocument()
    expect(screen.getByText('المتجر')).toBeInTheDocument()
    expect(grid!.querySelectorAll('input').length).toBeGreaterThan(3)
  })

  it('picks a connected STORE, not a platform chip', () => {
    // The merchant recognises a store, not a platform: a mapping belongs to one
    // store, and its platform follows from it. The old "Store platform" chip row
    // (Zid / Salla / Shopify) is gone.
    const src = fs.readFileSync(FORM_SRC, 'utf8')
    expect(src).not.toContain('منصة المتجر')
    expect(src).not.toContain('Store platform')
    // Every linked store is offered, whichever platform owns it.
    expect(src).toContain('const allStores')
    expect(src).toContain("key: `zid:${s.id}`")
    expect(src).toContain("key: `salla:${s.id}`")
    expect(src).toContain("key: `shopify:${s.id}`")
  })

  it('has no relations-graph drawing left', () => {
    // Removed on request: the graph duplicated what the "Related models" cell
    // already lists. The relations themselves are still saved with the payload.
    const src = fs.readFileSync(FORM_SRC, 'utf8')
    expect(src).not.toContain('RelationsGraph')
    expect(src).not.toContain('relations-graph')
    expect(src).toContain('relations: cleanedRelations')
  })

  it('shows the match/fallback cells exactly as the record page does', () => {
    // The record page always lists ERP match field / store match field /
    // fallback policy, so the form must too once the operation needs them.
    renderForm({ initialOdooOperation: 'update' })

    expect(screen.getByText('حقل المطابقة في ERP')).toBeInTheDocument()
    expect(screen.getByText('حقل المطابقة في زد')).toBeInTheDocument()
    expect(screen.getByText('سياسة الغياب')).toBeInTheDocument()
  })

  it('keeps the form and the display on the same visual language (source pins)', () => {
    const src = fs.readFileSync(FORM_SRC, 'utf8')
    const recordSrc = fs.readFileSync(RECORD_SRC, 'utf8')

    // One shared caption style, character for character.
    const caption = 'text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'
    expect(recordSrc).toContain(caption)
    expect(src).toContain('function FormCell(')
    expect(src).toContain(caption)
    // Same card + grid geometry as the record page.
    expect(recordSrc).toContain('border border-border bg-card p-4')
    expect(src).toContain('<div className="border border-border bg-card p-4">')
    expect(src).toContain('grid grid-cols-2 gap-4 md:grid-cols-4')
    // The explanatory paragraphs the record page does not have are gone.
    expect(src).not.toContain('النموذج الأساسي الذي يمثل البيانات')
    expect(src).not.toContain('حدد اسماً توضيحياً لقاعدة مطابقة الحقول')
  })
})
