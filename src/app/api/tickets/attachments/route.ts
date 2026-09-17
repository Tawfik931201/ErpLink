import { auth } from '@clerk/nextjs/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'

import { executeKw } from '@/lib/odoo'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tickets/attachments?id=[attachmentId]
 * Securely downloads and pipes binary files from Odoo to the client.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth()
  if (!userId) {
    return new NextResponse('Unauthorized access', { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const idStr = searchParams.get('id')
  if (!idStr) {
    return new NextResponse('Missing attachment ID', { status: 400 })
  }

  const attachmentId = parseInt(idStr, 10)
  if (isNaN(attachmentId)) {
    return new NextResponse('Invalid attachment ID format', { status: 400 })
  }

  try {
    // In Odoo 18 (saas-19.3), 'datas' is removed. We read 'raw' instead.
    const attachment = await executeKw<any[]>(
      'ir.attachment',
      'read',
      [[attachmentId]],
      { fields: ['name', 'raw', 'mimetype'] }
    )

    if (!attachment || attachment.length === 0) {
      return new NextResponse('Attachment not found', { status: 404 })
    }

    const file = attachment[0]
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
      }
    })
  } catch (error: any) {
    console.error('Error fetching attachment from Odoo:', error)
    return new NextResponse(error.message || 'Internal Server Error', { status: 500 })
  }
}
