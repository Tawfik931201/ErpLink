import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { auth } from '@clerk/nextjs/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import type { Pool as PgPool } from 'pg'

import { isAdmin } from '@/lib/auth'

/**
 * POST /api/admin/install-partner-schema
 *
 * Admin-only endpoint that runs the partner migration SQL by streaming it
 * to the Postgres connection through `pg.Pool`.
 *
 * Background: this project uses Supabase both via REST (`supabase-js`) and via
 * Prisma. The Supabase project allows the underlying DB over both REST and the
 * direct Postgres connection string (DIRECT_URL), but DNS in some sandboxed
 * environments can fail to resolve the Supabase hostname. When DNS works (local
 * dev, Vercel build, Prod), we can run the migration programmatically.
 *
 * Required: a `pg` connection. Add `DATABASE_URL` and `DIRECT_URL` in env.
 */
export async function POST(_req: NextRequest) {
  const { userId } = await auth()
  if (!isAdmin(userId)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Load SQL from disk. The files are the source of truth.
  const migrations = [
    '20260711_partner_system.sql',
    '20260803_subscriptions.sql',
    '20260803_subscription_number.sql',
    '20260803_affiliate_client_invites.sql',
    '20260804_subscription_payments.sql',
    '20260805_client_phone_and_archive.sql',
  ]
  const sql = migrations
    .map((f) => readFileSync(resolve(process.cwd(), 'supabase', 'migrations', f), 'utf8'))
    .join('\n;\n')

  try {
    // Lazy require so this module isn't loaded eagerly on edge runtimes.
    const { default: pg } = await import('pg')
    const { Pool } = pg as unknown as { Pool: new (cfg: { connectionString: string; ssl: boolean | { rejectUnauthorized: boolean } }) => PgPool }

    let connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
    if (!connectionString) {
      return NextResponse.json(
        { ok: false, error: 'missing_connection_string' },
        { status: 500 },
      )
    }
    // Strip querystring (e.g. ?sslmode=require) — pg ignores it anyway and we
    // want to control `ssl` explicitly.
    connectionString = connectionString.split('?')[0]

    // Try without SSL first (Supabase pooler accepts plain), fallback to SSL.
    const candidates = [
      { connectionString, ssl: false as const },
      { connectionString, ssl: { rejectUnauthorized: false } },
    ]

    let lastErr: unknown = null
    for (const cfg of candidates) {
      const pool = new Pool(cfg)
      try {
        const client = await pool.connect()
        try {
          // Strip SQL comments and run as one statement. Migration uses
          // IF NOT EXISTS everywhere so re-runs are safe.
          const stripped = sql
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n')
          await client.query(stripped)
        } finally {
          client.release()
        }
        await pool.end()
        return NextResponse.json({ ok: true })
      } catch (e) {
        lastErr = e
        try { await pool.end() } catch (_) {}
      }
    }
    const err = lastErr as Error | undefined
    console.error('[install-partner-schema] failed:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'install_failed', code: (err as { code?: string })?.code },
      { status: 500 },
    )
  } catch (err) {
    console.error('[install-partner-schema] outer failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'install_failed' },
      { status: 500 },
    )
  }
}
