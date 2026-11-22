import { auth, currentUser } from '@clerk/nextjs/server'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/auth'
import { executeKw } from '@/lib/odoo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tickets/attachments?id=[attachmentId]
 * Securely downloads and pipes binary files from Odoo to the client.
 * Enforces ownership check: attachment must belong to a helpdesk ticket of the logged in user.
 */
export async function GET(request: NextRequest) {
  const { checkRateLimit, rateLimitKeyFromHeaders } = await import('@/lib/rate-limit')
  const rlKey = rateLimitKeyFromHeaders((n) => request.headers.get(n), 'ticket-attachment')
  const rl = checkRateLimit(rlKey, 60, 60_000)
  if (!rl.allowed) {
    return new NextResponse('Too many requests', { status: 429 })
  }

  const { userId } = await auth()
  const user = await currentUser()
  if (!userId || !user) {
    return new NextResponse('Unauthorized access', { status: 401 })
  }

  const userEmail = user.emailAddresses?.[0]?.emailAddress
  if (!userEmail && !isAdmin(userId)) {
    return new NextResponse('User has no primary email registered', { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const idStr = searchParams.get('id')
  if (!idStr) {
    return new NextResponse('Missing attachment ID', { status: 400 })
  }

  const attachmentId = parseInt(idStr, 10)
  if (isNaN(attachmentId) || attachmentId <= 0) {
    return new NextResponse('Invalid attachment ID format', { status: 400 })
  }

  try {
    // Metadata first: do not load the binary until ownership + declared size
    // have been checked. Odoo 20 removed 'datas'; asking for it here used to
    // fail before we could check the requesting user's ticket ownership.
    const attachment = await executeKw<any[]>(
      'ir.attachment',
      'read',
      [[attachmentId]],
      { fields: ['name', 'mimetype', 'res_model', 'res_id', 'file_size'] }
    )

    if (!attachment || attachment.length === 0) {
      return new NextResponse('Attachment not found', { status: 404 })
    }

    const file = attachment[0]

    // Ownership check (IDOR mitigation)
    if (!isAdmin(userId)) {
      let isOwner = false
      let ticketId: number | null = null

      if (file.res_model === 'helpdesk.ticket' && file.res_id) {
        ticketId = Number(file.res_id)
      } else if (file.res_model === 'mail.message' && file.res_id) {
        // Resolve parent message to check if it belongs to helpdesk.ticket
        const messages = await executeKw<any[]>(
          'mail.message',
          'read',
          [[Number(file.res_id)]],
          { fields: ['model', 'res_id'] }
        )
        if (messages && messages.length > 0 && messages[0].model === 'helpdesk.ticket') {
          ticketId = Number(messages[0].res_id)
        }
      }

      if (ticketId && userEmail) {
        const matchingTickets = await executeKw<any[]>(
          'helpdesk.ticket',
          'search_read',
          [[['id', '=', ticketId], ['partner_email', '=', userEmail]]],
          { fields: ['id'] }
        )
        if (matchingTickets && matchingTickets.length > 0) {
          isOwner = true
        }
      }

      if (!isOwner) {
        return new NextResponse('Forbidden - You do not have permission to access this attachment', { status: 403 })
      }
    }

    // A size check AFTER Base64 decode still lets a user ask Odoo for an
    // arbitrarily huge file and exhaust the Node heap. Limit it first using
    // the stored metadata, then check the encoded length before decoding.
    const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
    const MAX_BASE64_CHARS = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
    const declaredSize = Number(file.file_size ?? 0)
    if (Number.isFinite(declaredSize) && declaredSize > MAX_ATTACHMENT_BYTES) {
      return new NextResponse('Attachment too large', { status: 413 })
    }

    // Modern Odoo uses 'raw'. Legacy versions may only expose 'datas'.
    // Attempt the legacy field ONLY when Odoo explicitly reports that 'raw'
    // does not exist, not after authentication/network failures.
    let binaryRows: any[]
    try {
      binaryRows = await executeKw<any[]>(
        'ir.attachment', 'read', [[attachmentId]], { fields: ['raw'] }
      )
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      if (!/invalid field ['"]raw['"]|keyerror:\s*['"]raw['"]/i.test(reason)) throw error
      binaryRows = await executeKw<any[]>(
        'ir.attachment', 'read', [[attachmentId]], { fields: ['datas'] }
      )
    }
    const binaryRecord = binaryRows?.[0]
    const base64Data = binaryRecord?.raw || binaryRecord?.datas
    if (typeof base64Data !== 'string' || !base64Data) {
      return new NextResponse('Attachment content is empty', { status: 404 })
    }
    if (base64Data.length > MAX_BASE64_CHARS) {
      return new NextResponse('Attachment too large', { status: 413 })
    }
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      return new NextResponse('Attachment too large', { status: 413 })
    }

    // Serve binary stream. `nosniff` + `attachment` disposition stop the
    // browser from executing a served file as HTML/JS even if Odoo stored
    // a wrong mimetype.
    const safeName = String(file.name || 'attachment').replace(/["\r\n]/g, '_')
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': file.mimetype || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error: any) {
    console.error('Error fetching attachment from Odoo:', error?.message || error)
    // Generic message on purpose: the raw error can leak Odoo/stack details.
    return new NextResponse('Failed to load attachment', { status: 500 })
  }
}
