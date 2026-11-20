'use server'

import crypto from 'crypto'

import { auth, currentUser } from '@clerk/nextjs/server'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'

import { isAdmin, getActiveWorkspaceId } from '@/lib/auth'
import { isOdooArchiveEnabled, readArchive, updateArchiveBySource, upsertArchive } from '@/lib/central-odoo-archive'
import { executeKw } from '@/lib/odoo'
import { getOrCreateDbUser } from '@/lib/users'
import { ensureSupportDiscussChannel, getSupportDiscussMessages, postSupportDiscussMessage } from '@/lib/support-discuss'

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


type CentralTicket = {
  id: number
  x_name: string | false
  x_subject: string | false
  x_description: string | false
  x_status: string | false
  x_email: string | false
  x_user_id: string | false
  x_workspace_uuid: string | false
  x_helpdesk_ticket_id: number | false
  x_source_uuid: string | false
  create_date: string
}
const CENTRAL_TICKET_FIELDS = [
  'id','x_name','x_subject','x_description','x_status','x_email',
  'x_user_id','x_workspace_uuid','x_helpdesk_ticket_id','x_source_uuid','create_date',
]
async function centralTicketForUser(id: number): Promise<CentralTicket> {
  const { userId } = await auth()
  if (!userId || !Number.isSafeInteger(id) || id <= 0) throw new Error('Unauthorized')
  const workspaceId = await getActiveWorkspaceId()
  const user = await currentUser()
  const email = user?.emailAddresses[0]?.emailAddress || ''
  const domain: unknown[] = [['id', '=', id]]
  if (!isAdmin(userId)) {
    if (!workspaceId) throw new Error('No active workspace')
    domain.push(['x_workspace_uuid', '=', workspaceId])
    domain.push('|', ['x_user_id', '=', userId], ['x_email', '=', email])
  }
  const rows = await readArchive<CentralTicket>('support', domain, CENTRAL_TICKET_FIELDS, { limit: 1 })
  if (!rows.length) throw new Error('Ticket not found or forbidden')
  return rows[0]
}
function mapCentralTicket(ticket: CentralTicket): Ticket {
  return {
    id: -ticket.id,
    name: ticket.x_subject || ticket.x_name || 'Support ticket',
    ticket_ref: 'CENTRAL-' + ticket.id,
    stage_id: [0, ticket.x_status || 'Open'],
    create_date: ticket.create_date.replace(' ', 'T') + 'Z',
    description: ticket.x_description || false,
  }
}

/**
 * يتأكد أن التذكرة المطلوب الوصول إليها تخص صاحب الجلسة الحالي.
 *
 * أرقام التذاكر في Odoo تسلسلية (1, 2, 3…)، فأي مستخدم مسجّل كان بإمكانه
 * تمرير رقم تذكرة عميل آخر وقراءتها أو الرد عليها أو إغلاقها. التذاكر
 * مرتبطة بـ partner_email — وهذا هو معيار الملكية، نفس المعيار المطبّق في
 * getClientTickets وفي /api/tickets/attachments.
 *
 * الأدمن يتجاوز الفحص (نفس المنطق المطبّق في /api/tickets/attachments:54).
 */
async function assertOwnsTicket(ticketId: number): Promise<void> {
  const { userId } = await auth()
  if (!userId) {
    throw new Error('Unauthorized')
  }

  if (isAdmin(userId)) {
    return
  }

  const user = await currentUser()
  const email = user?.emailAddresses[0]?.emailAddress
  if (!email) {
    throw new Error('User has no primary email address registered in Clerk')
  }

  const owned = await executeKw<number[]>(
    'helpdesk.ticket',
    'search',
    [[['id', '=', ticketId], ['partner_email', '=', email]]],
    { limit: 1 }
  )

  if (!owned || owned.length === 0) {
    throw new Error('Forbidden - you do not have access to this ticket')
  }
}

/**
 * Fetches tickets from helpdesk.ticket for the logged-in Clerk user.
 * Filters by matching the user's email to the Odoo partner_email field.
 */

export async function getClientTickets() {
  const { userId } = await auth()
  const user = await currentUser()
  if (!userId || !user) throw new Error('Unauthorized access')
  const email = user.emailAddresses[0]?.emailAddress
  if (!email) throw new Error('User has no primary email address registered in Clerk')
  const workspaceId = await getActiveWorkspaceId()
  let legacy: Ticket[] = []
  let central: CentralTicket[] = []
  let legacyError = ''
  let centralError = ''

  try {
    const partnerIds = isAdmin(userId) ? [] : await executeKw<number[]>('res.partner', 'search', [[['email', '=', email]]])
    // Platform admins may review the shared Helpdesk. Merchants remain
    // restricted to their own email/partner records.
    const domain: unknown[] = isAdmin(userId) ? [] : partnerIds?.length
      ? ['|', ['partner_email', '=', email], ['partner_id', 'in', partnerIds]]
      : [['partner_email', '=', email]]
    try {
      legacy = await executeKw<Ticket[]>('helpdesk.ticket', 'search_read', [domain],
        { fields: ['id','name','ticket_ref','stage_id','create_date','description'], order:'create_date desc',limit:100 })
    } catch {
      const fallback = await executeKw<Array<Omit<Ticket, 'ticket_ref'>>>(
        'helpdesk.ticket', 'search_read', [domain],
        { fields: ['id','name','stage_id','create_date','description'], order:'create_date desc',limit:100 })
      legacy = fallback.map(row => ({ ...row, ticket_ref: false }))
    }
  } catch (error) {
    legacyError = error instanceof Error ? error.message : 'Helpdesk read failed'
    console.warn('[tickets] legacy Helpdesk unavailable:', legacyError)
  }

  if (isOdooArchiveEnabled()) {
    try {
      const domain: unknown[] = []
      if (!isAdmin(userId)) {
        if (!workspaceId) throw new Error('No active workspace')
        domain.push(['x_workspace_uuid', '=', workspaceId])
        domain.push('|', ['x_user_id', '=', userId], ['x_email', '=', email])
      }
      central = await readArchive<CentralTicket>('support', domain, CENTRAL_TICKET_FIELDS,
        { limit: 100, order: 'create_date desc' })
    } catch (error) {
      centralError = error instanceof Error ? error.message : 'Central Odoo unavailable'
      console.warn('[tickets] central Odoo unavailable:', centralError)
    }
  }

  if (legacyError && (centralError || !isOdooArchiveEnabled())) {
    return { success: false, error: legacyError + (centralError ? '; ' + centralError : '') }
  }
  const legacyIds = new Set(legacy.map(row => row.id))
  const uniqueCentral = central.filter(row =>
    !row.x_helpdesk_ticket_id || !legacyIds.has(row.x_helpdesk_ticket_id))
  return {
    success: true,
    tickets: [...legacy, ...uniqueCentral.map(mapCentralTicket)]
      .sort((a,b) => Date.parse(b.create_date) - Date.parse(a.create_date)),
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

  // Central ERP Link support is the primary backend when configured. The legacy
  // Helpdesk database may be absent (or use an Odoo edition without Helpdesk).
  // Never attempt a legacy create after a central RPC error: the central write
  // might have committed even if the HTTP response was lost.
  if (isOdooArchiveEnabled() && !files.some(file => file.size > 0)) {
    try {
      const workspaceId = await getActiveWorkspaceId()
      if (!workspaceId) {
        return { success: false, error: 'Select a workspace before creating a support ticket.' }
      }
      const ticketId = await upsertArchive('support', 'app-ticket:' + crypto.randomUUID(), {
        x_name: title.trim(),
        x_subject: title.trim(),
        x_description: description?.trim() || '',
        x_email: email,
        x_contact_name: user.fullName || email,
        x_user_id: userId,
        x_workspace_uuid: workspaceId,
        x_status: 'open',
        x_priority: 'normal',
        x_helpdesk_ticket_id: 0,
      })
      // Discuss is best-effort: a channel failure must not lose a saved ticket.
      try {
        await ensureSupportDiscussChannel({
          id: ticketId, x_source_uuid: '', x_workspace_uuid: workspaceId,
          x_subject: title.trim(),
        })
      } catch (discussError) {
        console.warn('[tickets] Discuss channel setup deferred:', discussError)
      }
      revalidatePath('/app/tickets')
      return { success: true, ticketId: -ticketId }
    } catch (error) {
      console.error('[tickets] central support create failed:', error)
      return { success: false, error: 'Could not save the ticket in ERP Link support. Please retry; if the problem continues, contact support.' }
    }
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

    // Mirror metadata to the central ERP Link Odoo database; the original
    // helpdesk ticket and chatter remain the source of truth for replies/files.
    if (isOdooArchiveEnabled()) {
      try {
        const workspaceId = await getActiveWorkspaceId()
        await upsertArchive('support', `helpdesk:${ticketId}`, {
          x_name: title.trim(),
          x_subject: title.trim(),
          x_description: description?.trim() || '',
          x_email: customerEmail,
          x_contact_name: partnerName,
          x_user_id: userId,
          x_workspace_uuid: workspaceId || '',
          x_helpdesk_ticket_id: ticketId,
          x_status: 'open',
        })
      } catch (mirrorError) {
        console.error('[tickets] central Odoo mirror unavailable; helpdesk ticket retained:', mirrorError)
      }
    }

    // 5. Force a revalidation of the tickets page so the UI updates with the new ticket
    revalidatePath('/app/tickets')

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
  if (ticketId < 0 && isOdooArchiveEnabled()) {
    try {
      const ticket = await centralTicketForUser(-ticketId)
      const rows = await readArchive<{
        id: number
        x_message: string | false
        x_submitted_at: string | false
        x_author_email: string | false
        create_date: string
      }>('supportMessage', [['x_support_ticket_id', '=', ticket.id]],
        ['id','x_message','x_submitted_at','x_author_email','create_date'],
        { limit: 100, order: 'create_date asc' })
      // Include replies from Odoo Discuss as well as older central message records.
      // A Discuss failure should not hide archived replies.
      let discussMessages: OdooMessage[] = []
      try {
        discussMessages = (await getSupportDiscussMessages(ticket)).map(row => ({
          id: -row.id,
          body: row.body || '',
          date: row.date,
          author_id: row.author_id,
          attachment_ids: [],
        }))
      } catch (discussError) {
        console.warn('[tickets] Discuss read unavailable:', discussError)
      }
      const messages: OdooMessage[] = rows.map(row => ({
        id: row.id,
        body: row.x_message || '',
        date: row.x_submitted_at || row.create_date,
        author_id: [0, row.x_author_email || 'Support'],
        attachment_ids: [],
      }))
      return { success: true,
        messages: [...messages, ...discussMessages].sort((a, b) =>
          Date.parse(a.date.replace(' ', 'T')) - Date.parse(b.date.replace(' ', 'T'))),
        attachments: [] as OdooAttachment[] }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Central ticket read failed' }
    }
  }
  const { userId } = await auth()
  if (!userId) {
    throw new Error('Unauthorized')
  }

  try {
    await assertOwnsTicket(ticketId)
  } catch (error: any) {
    console.error('Ticket ownership check failed:', error?.message || error)
    return { success: false, error: error.message || 'Unauthorized' }
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
  if (ticketId < 0 && isOdooArchiveEnabled()) {
    try {
      const ticket = await centralTicketForUser(-ticketId)
      if (ticket.x_status === 'closed') return { success: false, error: 'Ticket is closed' }
      if (!messageContent?.trim()) return { success: false, error: 'Message cannot be empty' }
      if (files.some(file => file.size > 0)) {
        return { success: false, error: 'Attachments to central-only tickets are not supported yet' }
      }
      await postSupportDiscussMessage(ticket, user.fullName || email, messageContent.trim())
      revalidatePath('/app/tickets')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Central support reply failed' }
    }
  }
  if (isNaN(ticketId)) {
    return { success: false, error: 'Invalid ticket ID' }
  }

  if (!messageContent || !messageContent.trim()) {
    return { success: false, error: 'Message cannot be empty' }
  }

  try {
    await assertOwnsTicket(ticketId)
  } catch (error: any) {
    console.error('Ticket ownership check failed:', error?.message || error)
    return { success: false, error: error.message || 'Unauthorized' }
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

    const postedMessageId = await executeKw<number>(
      'helpdesk.ticket',
      'message_post',
      [ticketId],
      kwargs
    )

    if (isOdooArchiveEnabled()) {
      try {
        const workspaceId = await getActiveWorkspaceId()
        const existingCentral = await readArchive<{ id: number }>('support',
          [['x_source_uuid', '=', `helpdesk:${ticketId}`]], ['id'], { limit: 1 })
        const centralTicketId = existingCentral[0]?.id || await upsertArchive('support',
          `helpdesk:${ticketId}`, {
            x_name: `Support ticket ${ticketId}`,
            x_helpdesk_ticket_id: ticketId,
            x_email: email,
            x_user_id: userId,
            x_workspace_uuid: workspaceId || '',
          })
        await upsertArchive('supportMessage', `helpdesk-message:${postedMessageId}`, {
          x_name: `Reply to ticket ${ticketId}`,
          x_support_ticket_id: centralTicketId,
          x_helpdesk_ticket_id: ticketId,
          x_user_id: userId,
          x_workspace_uuid: workspaceId || '',
          x_author_email: email,
          x_message: messageContent.trim(),
          x_attachment_names: files.filter(file => file.size > 0).map(file => file.name).join(', '),
          x_submitted_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        })
      } catch (mirrorError) {
        console.error('[tickets] central Odoo reply mirror failed; original helpdesk message retained:', mirrorError)
      }
    }

    // Revalidate the page path
    revalidatePath('/app/tickets')
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
  if (ticketId < 0 && isOdooArchiveEnabled()) {
    try {
      const ticket = await centralTicketForUser(-ticketId)
      const updated = await updateArchiveBySource('support', ticket.x_source_uuid || '', { x_status: 'closed' })
      if (!updated) throw new Error('Central ticket not updated')
      revalidatePath('/app/tickets')
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Central ticket close failed' }
    }
  }
  const { userId } = await auth()
  if (!userId) {
    return { success: false, error: 'Unauthorized' }
  }

  try {
    await assertOwnsTicket(ticketId)
  } catch (error: any) {
    console.error('Ticket ownership check failed:', error?.message || error)
    return { success: false, error: error.message || 'Unauthorized' }
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

    if (isOdooArchiveEnabled()) {
      try {
        await updateArchiveBySource('support', `helpdesk:${ticketId}`, {
          x_status: 'closed',
        })
      } catch (mirrorError) {
        console.error('[tickets] central Odoo close mirror failed:', mirrorError)
      }
    }

    revalidatePath('/app/tickets')
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
