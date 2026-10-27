/**
 * Add Field screen: a created custom field is a RECORD, not a form row.
 *
 * Requested behaviour (2026-10-27):
 *   - a row in the list opens the field's own page, and the field's id is in
 *     the URL (`/app/mapping-center/add-field/<id>`),
 *   - the list carries no delete and no edit action — creating a field is the
 *     only write this screen offers,
 *   - the record page itself is read-only for the same reason,
 *   - the detail route resolves the same permission as the list, otherwise a
 *     user who may open the list would be locked out the moment they open a
 *     field.
 *
 * Negative assertions run against a comment-stripped copy: these files
 * deliberately *name* the retired actions in their comments, and a comment is
 * not code. Every pin has a self-check proving the detector notices the old
 * shape, so none of them is vacuous.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..', 'src')

function readSrc(...parts: string[]): string {
  return fs.readFileSync(path.join(SRC, ...parts), 'utf8')
}

const formRaw = readSrc('app', '(app)', 'app', 'mapping-center', 'add-custom-field-form.tsx')
const detailRaw = readSrc('app', '(app)', 'app', 'mapping-center', 'add-field', '[id]', 'page.tsx')
const layoutRaw = readSrc('app', '(app)', 'app', 'layout.tsx')

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const form = stripComments(formRaw)
const detail = stripComments(detailRaw)

/** True when the list builds its row target with the row id in the path. */
function navigatesWithId(source: string): boolean {
  return /\/app\/mapping-center\/add-field\/\$\{encodeURIComponent\(fieldId\)\}/.test(source)
}

/** True when a row is a link/navigation instead of a form row. */
function rowNavigates(source: string): boolean {
  return /onClick=\{\(\) => openField\(field\)\}/.test(source)
}

/** True when the retired edit/delete actions are reachable again. */
function hasRowActions(source: string): boolean {
  return /handleDelete|startEditField|setDeleteConfirmId|deleteCustomOdooField|updateCustomOdooField|deleteCustomErpNextField|updateCustomErpNextField/.test(
    source
  )
}

describe('add-field list: rows open a record page keyed by id', () => {
  it('pushes the field id into the URL', () => {
    expect(navigatesWithId(form)).toBe(true)
  })

  it('derives that id from the saved row, falling back to the technical name', () => {
    // ERPNext rows carry `Item-custom_x` as their id; a row without one still
    // needs a stable, URL-safe key, and the technical name is unique per model.
    expect(form).toMatch(/const fieldId = String\(field\.id \|\| field\.field_name\)/)
  })

  it('makes the whole row the navigation target, not a button in a corner', () => {
    expect(rowNavigates(form)).toBe(true)
    expect(form).toContain('role="link"')
  })

  it('self-check: the id-in-URL detector rejects a bare list push', () => {
    expect(navigatesWithId(`router.push('/app/mapping-center/add-field')`)).toBe(false)
    expect(navigatesWithId(`router.push(\`/app/mapping-center/add-field/\${encodeURIComponent(fieldId)}\`)`)).toBe(true)
  })
})

describe('add-field list: delete and edit are gone', () => {
  it('has no delete or edit flow left', () => {
    expect(hasRowActions(form)).toBe(false)
  })

  it('no longer imports the mutation actions for existing fields', () => {
    expect(form).not.toContain('deleteCustomOdooField')
    expect(form).not.toContain('updateCustomOdooField')
    expect(form).not.toContain('deleteCustomErpNextField')
    expect(form).not.toContain('updateCustomErpNextField')
  })

  it('keeps the create path intact', () => {
    // Removing the row actions must not remove the ability to add a field.
    expect(form).toContain('createCustomOdooField')
    expect(form).toContain('createCustomErpNextField')
  })

  it('self-check: the retired-action detector still sees the old shape', () => {
    expect(hasRowActions('const handleDelete = async (field) => { /* ... */ }')).toBe(true)
    expect(hasRowActions('startEditField(field)')).toBe(true)
  })
})

describe('add-field record page', () => {
  it('reads the id from the URL segment and matches the saved row by it', () => {
    expect(detail).toMatch(/params: Promise<\{ id: string \}>/)
    expect(detail).toContain('decodeURIComponent(id)')
    expect(detail).toMatch(/String\(f\.id \|\| f\.field_name \|\| ''\) === wantedId/)
  })

  it('is read-only: no edit or delete action on the record', () => {
    expect(detail).not.toContain('deleteCustomOdooField')
    expect(detail).not.toContain('updateCustomOdooField')
    expect(detail).not.toContain('deleteCustomErpNextField')
    expect(detail).not.toContain('updateCustomErpNextField')
    expect(hasRowActions(detail)).toBe(false)
  })

  it('renders ordinary labelled values, never a raw payload', () => {
    expect(detail).toContain('InfoField')
    expect(detail).not.toContain('JSON.stringify')
  })

  it('shows a friendly not-found card instead of throwing', () => {
    // `notFound()` would render the global 404 and lose the way back; the
    // record may simply live in another workspace.
    expect(detail).not.toContain('notFound()')
    expect(detail).toContain('Field not found')
  })
})

describe('detail route permission', () => {
  it('resolves /app/mapping-center/add-field/<id> like the list', () => {
    expect(layoutRaw).toContain(
      "(currentPath.startsWith('/app/mapping-center/add-field/') ? 'mapping-center' : undefined)"
    )
  })

  it('self-check: the exact list prefix alone would not cover a detail path', () => {
    const bareMap = `'/app/mapping-center/add-field': 'mapping-center',`
    expect(bareMap).not.toContain("startsWith('/app/mapping-center/add-field/')")
    expect(layoutRaw).toContain("startsWith('/app/mapping-center/add-field/')")
  })
})
