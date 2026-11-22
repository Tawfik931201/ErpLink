import { type NextRequest, NextResponse } from 'next/server'

import { isOdooArchiveEnabled } from '@/lib/central-odoo-archive'
import { secretMatches } from '@/lib/webhook-secret'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Central Odoo archive migration runs INDEPENDENTLY from the order/webhook
 * worker. Configure a protected Hostinger cron for each kind after archive
 * credentials are available:
 *
 * curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
 *   "https://erplink.bizsahla.com/api/cron/central-archive?kind=logs"
 *
 * Supported kinds: logs, contacts, queue. No bulk delete and no multi-tenant
 * user-facing responses; counters only.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!secret || !secretMatches(bearer ?? '', secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isOdooArchiveEnabled()) {
    return NextResponse.json({ success: true, disabled: true, storage: 'supabase' }, { status: 200 })
  }
  const kind = req.nextUrl.searchParams.get('kind') || 'logs'
  if (!['logs', 'contacts', 'queue'].includes(kind)) {
    return NextResponse.json({ error: 'Invalid archive kind' }, { status: 400 })
  }
  try {
    const result = kind === 'contacts'
      ? await (await import('@/lib/central-contact-backfill')).archiveContactMessagesBatch()
      : kind === 'queue'
        ? await (await import('@/lib/central-queue-backfill')).archiveQueueSnapshotsBatch()
        : await (await import('@/lib/central-archive-backfill')).archiveSyncLogsBatch()
    return NextResponse.json(
      { success: !result.error, kind, archived: result.archived, error: result.error },
      { status: result.error ? 502 : 200 },
    )
  } catch (error) {
    console.error('[central-archive] cron failed:', error)
    return NextResponse.json({ success: false, error: 'Archive cycle failed' }, { status: 500 })
  }
}

export async function POST() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 })
}
