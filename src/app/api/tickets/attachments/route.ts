import { auth } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { readOwnedOdooAttachment } from '@/lib/odoo-support'
import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/** Downloads Odoo Studio files only after the central-ticket owner/workspace check. */
export async function GET(request: NextRequest) {
  const rl = checkRateLimit(
    rateLimitKeyFromHeaders((name) => request.headers.get(name), 'ticket-attachment'),
    60, 60_000,
  )
  if (!rl.allowed) return new NextResponse('Too many requests', { status: 429 })

  const { userId } = await auth()
  if (!userId) return new NextResponse('Unauthorized', { status: 401 })
  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isSafeInteger(id) || id <= 0) {
    return new NextResponse('Invalid attachment ID', { status: 400 })
  }

  try {
    const file = await readOwnedOdooAttachment(id)
    const safeName = file.name.replace(/["\r\n]/g, '_')
    return new NextResponse(file.buffer, {
      headers: {
        'Content-Type': file.mimetype,
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(safeName) + '"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    // Do not disclose ticket existence, ownership, model IDs or credentials.
    console.error('[support] denied or failed Odoo attachment download',
      error instanceof Error ? error.message : 'unknown')
    return new NextResponse('Attachment unavailable', { status: 404 })
  }
}
