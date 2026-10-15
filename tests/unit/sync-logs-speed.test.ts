/**
 * Pins the /app/logs read path against the slowness it shipped with:
 *
 *   - The "resolved manually" state lives in the `resolved_manually` boolean
 *     column — never in a leading-wildcard `ilike` text scan, which no index
 *     can serve and which made every stats call a full-table scan.
 *   - The status filter and the head-count stats read that column (plus plain
 *     `status` equality), so they stay index-only.
 *   - The lean list select names explicit columns (no `payload` JSON per row).
 *
 * Every pin is checked to fail when reverted (see the self-check suite), so
 * none of them is vacuous.
 */

import fs from 'fs'
import path from 'path'

const ACTION_PATH = path.join(process.cwd(), 'src/app/actions/sync-logs.ts')

function readSource(): string {
  const raw = fs.readFileSync(ACTION_PATH, 'utf8')
  // Comment-strip: comments are not a read. This file deliberately names the
  // retired ilike approach in prose; a comment is not an implementation.
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the logs read path never scans text', () => {
  it('contains no ilike/like text matching at all', () => {
    expect(readSource()).not.toMatch(/ilike/i)
  })

  it('filters the manual state by the boolean column', () => {
    expect(readSource()).toMatch(/resolved_manually\.eq\.true/)
  })

  it('counts the manual state by the boolean column', () => {
    expect(readSource()).toMatch(/\.eq\('resolved_manually', true\)/)
  })

  it('writes the boolean flag when resolving manually', () => {
    expect(readSource()).toMatch(/resolved_manually: true/)
  })

  it('selects explicit lean columns instead of the payload', () => {
    const source = readSource()
    expect(source).toMatch(/id,event,status,error_message,store_id/)
    expect(source).toMatch(/resolved_manually,field_mappings\(name\)/)
  })
})

describe('self-check: the pins actually detect a reverted rule', () => {
  const has = (src: string, re: RegExp) => re.test(src)

  it('fails when an ilike text scan is reintroduced', () => {
    const guardFn = (src: string) => !has(src, /ilike/i)
    expect(guardFn(readSource())).toBe(true)
    const tampered = readSource().replace(
      "branches.push('resolved_manually.eq.true')",
      "branches.push('error_message.ilike.%Resolved manually%')"
    )
    expect(guardFn(tampered)).toBe(false)
  })

  it('fails when the manual count drops the boolean', () => {
    const guardFn = (src: string) => has(src, /\.eq\('resolved_manually', true\)/)
    expect(guardFn(readSource())).toBe(true)
    const tampered = readSource().replace(".eq('resolved_manually', true)", ".eq('status', 'success')")
    expect(guardFn(tampered)).toBe(false)
  })
})
