import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

  // Load SQL from disk. The file is the source of truth.
  const filePath = resolve(process.cwd(), 'supabase', 'migrations', '20260711_partner_system.sql')
  const sql = readFileSync(filePath, 'utf8')

  try {
    // Lazy require so this module isn't loaded eagerly on edge runtimes.
    const { default: pg } = await import('pg')
    const { Pool } = pg as unknown as { Pool: any }

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
      { connectionString, ssl: { rejectUnauthorized: false } as any },
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
    const err = lastErr as any
    console.error('[install-partner-schema] failed:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'install_failed', code: err?.code },
      { status: 500 },
    )
  } catch (err: any) {
    console.error('[install-partner-schema] outer failed:', err?.message || err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'install_failed' },
      { status: 500 },
    )
  }
}
