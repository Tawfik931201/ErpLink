/**
 * Retention policy pins for sync_logs (season plan: DB must not bloat).
 *
 * - success rows are purged after 72h (operational value exhausted),
 * - non-success rows are kept 60 days (audit + manual replay window),
 * then purged. cleanupExpiredLogs itself hits the DB and is untestable
 * without one, so this suite pins the exported constants and the query
 * shapes in source.
 */

import fs from 'fs'
import path from 'path'

import {
  SYNC_LOG_FAILURE_RETENTION_DAYS,
  SYNC_LOG_SUCCESS_RETENTION_HOURS,
} from '@/lib/sync-engine'

const SRC = path.join(__dirname, '..', '..', 'src')

describe('sync_logs retention policy', () => {
  it('keeps success rows 72 hours', () => {
    expect(SYNC_LOG_SUCCESS_RETENTION_HOURS).toBe(72)
  })

  it('keeps failed/other rows 60 days', () => {
    expect(SYNC_LOG_FAILURE_RETENTION_DAYS).toBe(60)
  })

  it('purges by status-specific cutoffs (success ≠ others)', () => {
    const src = fs.readFileSync(path.join(SRC, 'lib', 'sync', 'log-retention.ts'), 'utf8')
    const fn = src.slice(src.indexOf('export async function cleanupExpiredLogs'))
    // rule 1 targets success only, rule 2 excludes success
    expect(fn).toContain(".eq('status', 'success')")
    expect(fn).toContain(".neq('status', 'success')")
    // the old 7-day blanket purge must be gone
    expect(fn).not.toContain('7 * 24 * 60 * 60 * 1000')
    expect(fn).not.toContain('sevenDaysAgo')
  })
})
