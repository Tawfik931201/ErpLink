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
    // In Odoo 18 (saas-19.3), 'datas' is removed. We read 'raw' instead.
    const attachment = await executeKw<any[]>(
      'ir.attachment',
      'read',
      [[attachmentId]],
      { fields: ['name', 'raw', 'datas', 'mimetype', 'res_model', 'res_id'] }
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

    const base64Data = file.raw || file.datas
    if (!base64Data) {
      return new NextResponse('Attachment content is empty', { status: 404 })
    }

    const buffer = Buffer.from(base64Data, 'base64')

    // Serve binary stream with correct mimetype
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': file.mimetype || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error: any) {
    console.error('Error fetching attachment from Odoo:', error)
    return new NextResponse(error.message || 'Internal Server Error', { status: 500 })
  }
}
