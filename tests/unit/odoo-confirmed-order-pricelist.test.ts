import fs from 'fs'
import path from 'path'

describe('Odoo confirmed order pricelist guard & immediate queue processing', () => {
  it('pins that sync-engine prunes pricelist_id on confirmed order error in safeWriteOdooRecord', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')
    expect(src).toMatch(/cannot change the pricelist/i)
    expect(src).toContain('delete cleanValues.pricelist_id')
  })

  it('pins that sale.order update deletes effectiveOdooValues.pricelist_id before safeWriteOdooRecord', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-engine.ts'), 'utf8')
    expect(src).toContain('delete effectiveOdooValues.pricelist_id')
    expect(src).toContain("if (odooOperation === 'create' && orderSettings.default_pricelist_id && !effectiveOdooValues.pricelist_id)")
  })

  it('pins that processWorkspaceQueue supports forceImmediate bypass for Send Now', () => {
    const queueSrc = fs.readFileSync(path.resolve(__dirname, '../../src/lib/sync-queue.ts'), 'utf8')
    expect(queueSrc).toContain('forceImmediate = false')
    expect(queueSrc).toContain('if (!forceImmediate)')

    const dashSrc = fs.readFileSync(path.resolve(__dirname, '../../src/app/actions/queue-dashboard.ts'), 'utf8')
    expect(dashSrc).toContain('processWorkspaceQueue(workspaceId, 25, true)')
  })
})
