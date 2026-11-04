import fs from 'fs'
import path from 'path'

/**
 * Source pins for the analytic-distribution injection in `buildOrderLineItems`.
 * The failure modes here are silent: an injected key can be stripped by the
 * unsupported-key allowlist, or an unprobed field is never written, and both
 * look like "the rule was saved but Odoo shows nothing".
 *
 * Source under test: src/lib/sync-engine.ts
 */

const sourcePath = path.join(process.cwd(), 'src', 'lib', 'sync-engine.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

function injectionBlock(): string {
  const start = source.indexOf('// Analytic distribution — Standard Mapping')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('return lines', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('buildOrderLineItems analytic distribution', () => {
  it('probes analytic_distribution and analytic_account_id with the line meta', () => {
    const start = source.indexOf('const lineFieldNames')
    const end = source.indexOf('const lineFieldMeta', start)
    const names = source.slice(start, end)

    expect(names).toContain("'analytic_distribution'")
    expect(names).toContain("'analytic_account_id'")
  })

  it('injects after the unsupported-key allowlist, before returning the lines', () => {
    const allowlist = source.indexOf('const ALLOWED_LINE_KEYS')
    const injection = source.indexOf('resolveAnalyticDistribution({')
    const block = injectionBlock()

    expect(allowlist).toBeGreaterThan(-1)
    expect(injection).toBeGreaterThan(allowlist)
    expect(block).toContain('Object.assign(line, analyticFields)')
  })

  it('is limited to Zid and Salla', () => {
    const block = injectionBlock()
    expect(block).toMatch(/platform === 'zid' \|\| platform === 'salla'/)
    expect(block).not.toContain("'shopify'")
  })

  it('never overwrites a line that already has an analytic field', () => {
    const block = injectionBlock()
    expect(block).toContain("'analytic_distribution' in line")
    expect(block).toContain("'analytic_account_id' in line")
  })

  it('reads the config from __settings and from both Standard Mapping shapes', () => {
    const block = injectionBlock()
    expect(block).toContain('(settings as any)?.analytic')
    expect(block).toContain('(orderStdSettings as any)?.analytic')
    expect(block).toContain('(orderStdSettings as any)?.order?.analytic')
  })

  it('fails Zid orders visibly when a configured distribution cannot be applied', () => {
    const block = injectionBlock()
    expect(block).toContain("if (platform === 'zid') throw err")
    expect(block).toContain("throw new Error('Matched analytic rules cannot be applied")
    expect(block).toContain("fetchFieldMeta(client, 'sale.order', ['analytic_account_id'])")
    // Salla keeps its established behavior; this strict setting contract is Zid's.
    expect(block).toMatch(/catch \(err: any\) \{[\s\S]*continuing without it/)
  })

  it('self-check: the ordering assertions reject the pre-injection shape', () => {
    const oldShape = `
      const ALLOWED_LINE_KEYS = new Set(['product_id'])
      return lines
      // resolveAnalyticDistribution( never called
    `
    const allowlist = oldShape.indexOf('const ALLOWED_LINE_KEYS')
    const injection = oldShape.indexOf('resolveAnalyticDistribution({')
    expect(injection).toBe(-1)
    expect(allowlist).toBeGreaterThan(-1)
  })
})
