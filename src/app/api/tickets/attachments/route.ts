import { auth } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { readOwnedOdooAttachment } from '@/lib/odoo-support'
import { isTicketChatPreviewImage } from '@/lib/ticket-chat-media'
import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Serve ticket images inline ONLY for a safe MIME allowlist and an explicit
 * preview request. All other formats (including SVG/HTML) stay downloads.
 * Ownership, workspace and customer-visible-message checks remain unchanged.
 */
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
    const inlinePreview = request.nextUrl.searchParams.get('preview') === '1' &&
      isTicketChatPreviewImage(file.mimetype)
    return new NextResponse(file.buffer, {
      headers: {
        'Content-Type': inlinePreview ? file.mimetype.toLowerCase().trim() : file.mimetype,
        'Content-Disposition': (inlinePreview ? 'inline' : 'attachment') +
          '; filename="' + encodeURIComponent(safeName) + '"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch (error) {
    // Do not disclose ticket existence, ownership, model IDs or credentials.
    console.error('[support] denied or failed Odoo attachment download',
      error instanceof Error ? error.message : 'unknown')
    return new NextResponse('Attachment unavailable', { status: 404 })
  }
}
