import fs from 'fs'
import path from 'path'

import {
  SYNC_LOG_FAILURE_RETENTION_DAYS,
  SYNC_LOG_SUCCESS_RETENTION_HOURS,
} from '@/lib/sync-engine'

const SOURCE_PATH = path.join(process.cwd(), 'src/lib/sync/log-retention.ts')

describe('sync logs have no automatic age-based deletion', () => {
  it('retains successful logs without a deadline', () => {
    expect(SYNC_LOG_SUCCESS_RETENTION_HOURS).toBe(Number.POSITIVE_INFINITY)
  })

  it('retains non-successful logs without a deadline', () => {
    expect(SYNC_LOG_FAILURE_RETENTION_DAYS).toBe(Number.POSITIVE_INFINITY)
  })

  it('never issues a DELETE on sync_logs', () => {
    const src = fs.readFileSync(SOURCE_PATH, 'utf8')
    const body = src.slice(src.indexOf('export async function cleanupExpiredLogs'))
    expect(body).not.toContain('.delete(')
    expect(body).not.toContain('.from(\'sync_logs\')')
  })
})
