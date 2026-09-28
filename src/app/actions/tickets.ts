'use server'

import crypto from 'crypto'

import { auth, currentUser } from '@clerk/nextjs/server'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'

import { executeKw } from '@/lib/odoo'
import { getOrCreateDbUser } from '@/lib/users'

export interface Ticket {
  id: number;
  name: string;
  ticket_ref: string | false;
  stage_id: [number, string] | false;
  create_date: string;
  description: string | false;
}

export interface OdooMessage {
  id: number;
  body: string;
  date: string;
  author_id: [number, string] | false;
  attachment_ids: number[];
}

export interface OdooAttachment {
  id: number;
  name: string;
  mimetype: string;
}

/**
 * Fetches tickets from helpdesk.ticket for the logged-in Clerk user.
 * Filters by matching the user's email to the Odoo partner_email field.
 */
export async function getClientTickets() {
  const { userId } = await auth()
  const user = await currentUser()

  if (!userId || !user) {
    throw new Error('Unauthorized access')
  }

  const email = user.emailAddresses[0]?.emailAddress
  if (!email) {
    throw new Error('User has no primary email address registered in Clerk')
  }

  try {
    const tickets = await executeKw<Ticket[]>(
      'helpdesk.ticket',
      'search_read',
      [[['partner_email', '=', email]]],
      {
        fields: ['id', 'name', 'ticket_ref', 'stage_id', 'create_date', 'description'],
        order: 'create_date desc',
      }
    )
    return { success: true, tickets }
  } catch (error: any) {
    console.error('Error fetching client tickets:', error)
    return { success: false, error: error.message || 'Failed to retrieve tickets from Odoo Helpdesk' }
  }
}

/**
 * Creates a support ticket in helpdesk.ticket with optional file attachments.
 */
export async function createTicket(formData: FormData) {
  const { userId } = await auth()
  const user = await currentUser()

  if (!userId || !user) {
    return { success: false, error: 'Unauthorized. Please sign in to submit support tickets.' }
  }

  const email = user.emailAddresses[0]?.emailAddress
  if (!email) {
    return { success: false, error: 'Your account does not have a primary email address.' }
  }

  const title = formData.get('title') as string
  const description = formData.get('description') as string
  const files = formData.getAll('attachments') as File[]

  if (!title || !title.trim()) {
    return { success: false, error: 'Please provide a ticket title.' }
  }

  try {
    // Fetch user profile details from Supabase
    const dbUser = await getOrCreateDbUser(userId)
    const customerEmail = dbUser.email || email

    let partnerName = dbUser.name?.trim() || ''
    if (!partnerName || partnerName.toLowerCase() === 'erplink') {
      partnerName = customerEmail
    }

    // 1. Search for existing partner matching email
    const partnerIds = await executeKw<number[]>(
      'res.partner',
      'search',
      [[['email', '=', customerEmail]]]
    )

    let partnerId = partnerIds[0]

    // 2. If the partner record doesn't exist, create it in Odoo dynamically.
    if (!partnerId) {
      partnerId = await executeKw<number>(
        'res.partner',
        'create',
        [{
          name: partnerName,
          email: customerEmail,
        }]
      )
    } else {
      // Self-healing: if the existing partner in Odoo is named 'erplink', rename it to the correct name from Supabase
      try {
        const partners = await executeKw<any[]>(
          'res.partner',
          'read',
          [[partnerId]],
          { fields: ['name'] }
        )
        if (partners && partners.length > 0 && partners[0].name.toLowerCase() === 'erplink') {
          await executeKw<boolean>(
            'res.partner',
            'write',
            [[partnerId], { name: partnerName }]
          )
        }
      } catch (err) {
        console.error('Failed to self-heal Odoo partner name:', err)
      }
    }

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000'
    const ticketId = await executeKw<number>(
      'helpdesk.ticket',
      'create',
      [{
        name: title.trim(),
        description: description?.trim() || '',
        partner_id: partnerId,
        team_id: 1,
        x_user_impersonation: `${appBaseUrl}/api/admin/impersonate?userId=${dbUser.id}`,
      }]
    )

    // 4. Upload attachments if present and link them to the new ticket
    for (const file of files) {
      if (file.size === 0 || !file.name) continue
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const sha1Checksum = crypto.createHash('sha1').update(buffer).digest('hex')
      const base64Data = buffer.toString('base64')
      await executeKw<number>(
        'ir.attachment',
        'create',
        [{
          name: file.name,
          type: 'binary',
          raw: base64Data,
          datas: base64Data,
          res_model: 'helpdesk.ticket',
          res_id: ticketId,
          mimetype: file.type || 'application/octet-stream',
          file_size: file.size,
          checksum: sha1Checksum,
        }]
      )
    }

    // 5. Force a revalidation of the tickets page so the UI updates with the new ticket
    revalidatePath('/dashboard/tickets')

    return { success: true, ticketId }
  } catch (error: any) {
    console.error('Error creating ticket:', error)
    return { success: false, error: error.message || 'Failed to submit the support ticket to Odoo' }
  }
}

/**
 * Fetches messages related to a specific ticket from the Odoo mail.message chatter,
 * along with attachment details (name, mimetype).
 */
export async function getTicketMessages(ticketId: number) {
  const { userId } = await auth()
  if (!userId) {
    throw new Error('Unauthorized')
  }

  try {
    const messages = await executeKw<OdooMessage[]>(
      'mail.message',
      'search_read',
      [[
        ['model', '=', 'helpdesk.ticket'],
        ['res_id', '=', ticketId],
        ['body', '!=', ''],
        ['subtype_id.internal', '=', false]
      ]],
      {
        fields: ['id', 'body', 'date', 'author_id', 'attachment_ids'],
        order: 'date asc',
      }
    )

    // Collect all unique attachment IDs referenced in the messages
    const attachmentIds = Array.from(new Set(messages.flatMap(msg => msg.attachment_ids || [])))
    let attachments: OdooAttachment[] = []

    if (attachmentIds.length > 0) {
      attachments = await executeKw<OdooAttachment[]>(
        'ir.attachment',
        'read',
        [attachmentIds],
        { fields: ['id', 'name', 'mimetype'] }
      )
    }

    return { success: true, messages, attachments }
  } catch (error: any) {
    console.error('Error fetching ticket messages:', error)
    return { success: false, error: error.message || 'Failed to retrieve ticket discussion' }
  }
}

/**
 * Sends a message/response on the ticket chatter in Odoo with optional file attachments.
 */
export async function sendTicketMessage(formData: FormData) {
  const { userId } = await auth()
  const user = await currentUser()

  if (!userId || !user) {
    return { success: false, error: 'Unauthorized' }
  }

  const email = user.emailAddresses[0]?.emailAddress
  if (!email) {
    return { success: false, error: 'Email not found' }
  }

  const ticketIdStr = formData.get('ticketId') as string
  const messageContent = formData.get('message') as string
  const files = formData.getAll('attachments') as File[]

  const ticketId = parseInt(ticketIdStr, 10)
  if (isNaN(ticketId)) {
    return { success: false, error: 'Invalid ticket ID' }
  }

  if (!messageContent || !messageContent.trim()) {
    return { success: false, error: 'Message cannot be empty' }
  }

  try {
    // 1. Search for existing partner matching email
    const partnerIds = await executeKw<number[]>(
      'res.partner',
      'search',
      [[['email', '=', email]]]
    )
    const partnerId = partnerIds[0]

    if (!partnerId) {
      return { success: false, error: 'Your Odoo partner contact record was not found.' }
    }

    // 2. Upload attachments first if they exist, linking them to the ticket
    const attachmentIds: number[] = []
    for (const file of files) {
      if (file.size === 0 || !file.name) continue
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const sha1Checksum = crypto.createHash('sha1').update(buffer).digest('hex')
      const base64Data = buffer.toString('base64')
      const attachmentId = await executeKw<number>(
        'ir.attachment',
        'create',
        [{
          name: file.name,
          type: 'binary',
          raw: base64Data,
          datas: base64Data,
          res_model: 'helpdesk.ticket',
          res_id: ticketId,
          mimetype: file.type || 'application/octet-stream',
          file_size: file.size,
          checksum: sha1Checksum,
        }]
      )
      attachmentIds.push(attachmentId)
    }

    // 3. Post a message to the Odoo chatter thread, attaching uploaded files
    const kwargs: Record<string, any> = {
      body: messageContent.trim(),
      message_type: 'comment',
      subtype_xmlid: 'mail.mt_comment',
      author_id: partnerId,
    }

    if (attachmentIds.length > 0) {
      kwargs.attachment_ids = attachmentIds
    }

    await executeKw<number>(
      'helpdesk.ticket',
      'message_post',
      [ticketId],
      kwargs
    )

    // Revalidate the page path
    revalidatePath('/dashboard/tickets')
    revalidateTag('pending-tickets')

    return { success: true }
  } catch (error: any) {
    console.error('Error sending message:', error)
    return { success: false, error: error.message || 'Failed to submit response to Odoo helpdesk' }
  }
}

/**
 * Closes a support ticket by moving it to the "Closed" stage in Odoo.
 */
export async function closeTicket(ticketId: number) {
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    // 1. Search for stages corresponding to closed/solved names
    let stageIds = await executeKw<number[]>(
      'helpdesk.stage',
      'search',
      [[
        ['name', 'in', ['Closed', 'Solved', 'مغلقة', 'تم الحل', 'مغلق', 'closed', 'solved', 'Closed/Solved']]
      ]]
    )

    // 2. Fallback to fuzzy name search
    if (!stageIds || stageIds.length === 0) {
      stageIds = await executeKw<number[]>(
        'helpdesk.stage',
        'search',
        [[
          '|',
          ['name', '=ilike', '%closed%'],
          ['name', '=ilike', '%مغلق%']
        ]]
      )
    }

    const closedStageId = stageIds && stageIds.length > 0 ? stageIds[0] : null
    if (!closedStageId) {
      return { success: false, error: 'Could not find a "Closed" stage in your Odoo Helpdesk setup.' }
    }

    // 4. Update the ticket stage to Closed
    await executeKw<boolean>(
      'helpdesk.ticket',
      'write',
      [[ticketId], { stage_id: closedStageId }]
    )

    revalidatePath('/dashboard/tickets')
    revalidateTag('pending-tickets')
    return { success: true }
  } catch (error: any) {
    console.error('Error closing ticket:', error)
    return { success: false, error: error.message || 'Failed to close ticket in Odoo' }
  }
}

/**
 * Checks if the merchant has any open tickets where the latest message in the thread
 * was sent by a support agent (not by the merchant themselves).
 */
/**
 * Inner implementation of pending-ticket check, extracted for caching.
 * Performs 3 Odoo XML-RPC queries: stages, tickets, then messages.
 */
const getCachedPendingTickets = unstable_cache(
  async (email: string) => {
    // 1. Search for stages corresponding to closed/solved names
    let closedStageIds = await executeKw<number[]>(
      'helpdesk.stage',
      'search',
      [[
        ['name', 'in', ['Closed', 'Solved', 'مغلقة', 'تم الحل', 'مغلق', 'closed', 'solved', 'Closed/Solved']]
      ]]
    )

    // Fallback to fuzzy search
    if (!closedStageIds || closedStageIds.length === 0) {
      closedStageIds = await executeKw<number[]>(
        'helpdesk.stage',
        'search',
        [[
          '|',
          ['name', '=ilike', '%closed%'],
          ['name', '=ilike', '%مغلق%']
        ]]
      )
    }

    // 2. Fetch the merchant's open tickets (exclude closed stages)
    const openTicketsDomain: any[] = [
      ['partner_email', '=', email]
    ]
    if (closedStageIds && closedStageIds.length > 0) {
      openTicketsDomain.push(['stage_id', 'not in', closedStageIds])
    }

    const openTickets = await executeKw<any[]>(
      'helpdesk.ticket',
      'search_read',
      [openTicketsDomain],
      { fields: ['id'] }
    )

    const openTicketIds = openTickets.map(t => t.id)
    if (openTicketIds.length === 0) {
      return { success: true, hasPending: false }
    }

    // 3. Fetch latest messages for these tickets in one query
    const messages = await executeKw<any[]>(
      'mail.message',
      'search_read',
      [[
        ['model', '=', 'helpdesk.ticket'],
        ['res_id', 'in', openTicketIds],
        ['subtype_id.internal', '=', false]
      ]],
      {
        fields: ['res_id', 'email_from', 'author_id'],
        order: 'id desc',
      }
    )

    // 4. Determine if the latest message on any ticket is from the support agent
    const latestMessageByTicket: Record<number, any> = {}
    for (const msg of messages) {
      if (!latestMessageByTicket[msg.res_id]) {
        latestMessageByTicket[msg.res_id] = msg
      }
    }

    let hasPending = false
    const merchantEmailClean = email.trim().toLowerCase()

    for (const ticketId of openTicketIds) {
      const latestMsg = latestMessageByTicket[ticketId]
      if (latestMsg) {
        const emailFromStr = (latestMsg.email_from || '').trim().toLowerCase()
        const emailMatch = emailFromStr.match(/<([^>]+)>/)
        const senderEmail = emailMatch ? emailMatch[1].trim() : emailFromStr

        if (senderEmail && senderEmail !== merchantEmailClean) {
          hasPending = true
          break
        }
      }
    }

    return { success: true, hasPending }
  },
  ['pending-tickets-check'],
  { revalidate: 60, tags: ['pending-tickets'] }
)

/**
 * Checks if the merchant has any open tickets where the latest message in the thread
 * was sent by a support agent (not by the merchant themselves).
 *
 * Uses a 60-second in-memory cache to avoid 3 Odoo XML-RPC calls on every navigation.
 */
export async function checkPendingTickets() {
  const { userId } = await auth()
  const user = await currentUser()
  if (!userId || !user) {
    return { success: false, hasPending: false }
  }

  const email = user.emailAddresses[0]?.emailAddress
  if (!email) {
    return { success: false, hasPending: false }
  }

  try {
    return await getCachedPendingTickets(email)
  } catch (error: any) {
    // Do not flood dev server logs on every route navigation if helpdesk ticketing is not configured
    return { success: false, hasPending: false }
  }
}
