import 'server-only'

import { randomUUID } from 'node:crypto'
import { auth, currentUser } from '@clerk/nextjs/server'

import { centralSupportCall } from '@/lib/central-odoo-archive'
import {
  checkImpersonationWriteBlock, getActiveUserId, getActiveWorkspaceId, isAdmin,
} from '@/lib/auth'

// Tickets, conversations, contacts and binary attachments use only the central
// ERP Link Odoo Studio database. Supabase is NOT used for support data.
// The existing workspace authorization resolver still reads account/workspace
// metadata; it never reads or writes support tables.
const TICKET = 'x_erplink_support_ticket'
const MAX_FILES = 5
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

type Relation = [number, string] | false
type TicketRecord = {
  id: number
  x_name: string | false
  x_subject: string | false
  x_description: string | false
  x_status: string | false
  x_ticket_stage: string | false
  x_user_id: string | false
  x_workspace_uuid: string | false
  x_email: string | false
  x_partner_id: Relation
  create_date: string
}
type MessageRecord = {
  id: number
  body: string | false
  date: string
  author_id: Relation
  attachment_ids: number[]
}
type LegacyMessage = {
  id: number
  x_message: string | false
  x_author_email: string | false
  x_submitted_at: string | false
  create_date: string
}
type AttachmentRecord = {
  id: number
  name: string
  mimetype: string | false
  res_model: string | false
  res_id: number
  file_size: number
}
const TICKET_FIELDS = [
  'id', 'x_name', 'x_subject', 'x_description', 'x_status',
  'x_ticket_stage', 'x_user_id', 'x_workspace_uuid', 'x_email',
  'x_partner_id', 'create_date',
]
const stageNames: Record<string, string> = {
  open: 'Open', in_progress: 'In Progress',
  waiting_customer: 'Waiting for Customer', resolved: 'Resolved',
  closed: 'Closed', test: 'Test',
}

function html(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/\r?\n/g, '<br/>')
}
function timestamp() { return new Date().toISOString().replace('T', ' ').slice(0, 19) }
function validId(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid ticket ID')
}
async function session() {
  const { userId: sessionUserId } = await auth()
  if (!sessionUserId) throw new Error('Unauthorized')
  const userId = (await getActiveUserId()) || sessionUserId
  const admin = isAdmin(sessionUserId) && userId === sessionUserId
  const workspaceId = await getActiveWorkspaceId()
  if (!admin && !workspaceId) throw new Error('No active workspace')
  return { userId, workspaceId, admin }
}
async function ownedTicket(id: number) {
  validId(id)
  const { userId, workspaceId, admin } = await session()
  const domain: unknown[] = [['id', '=', id]]
  if (!admin) {
    domain.push(['x_user_id', '=', userId], ['x_workspace_uuid', '=', workspaceId])
  }
  const rows = await centralSupportCall<TicketRecord[]>(
    TICKET, 'search_read', [domain], { fields: TICKET_FIELDS, limit: 1 },
  )
  if (!rows.length) throw new Error('Ticket not found or access denied')
  return rows[0]
}
function validateFiles(files: File[]) {
  if (files.length > MAX_FILES) throw new Error('Maximum 5 attachments per message')
  let total = 0
  for (const file of files) {
    if (!file.name || file.name.length > 255) throw new Error('Invalid attachment filename')
    if (file.size > MAX_FILE_BYTES) throw new Error('Each attachment must be 10 MB or less')
    total += file.size
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('Attachments exceed 20 MB')
}
async function partnerByEmail(email: string, name: string): Promise<number> {
  const rows = await centralSupportCall<Array<{ id: number }>>(
    'res.partner', 'search_read', [[['email', '=ilike', email]]],
    { fields: ['id'], limit: 1 },
  )
  if (rows.length) return rows[0].id
  return centralSupportCall<number>('res.partner', 'create', [{
    name: name || email, email, company_type: 'person',
  }])
}
async function addAttachments(ticketId: number, messageId: number, files: File[]) {
  for (const file of files) {
    if (!file.size) continue
    // Odoo 20 exposes binary data through "raw" (an object containing base64).
    // Save directly in Odoo's attachment storage and link it to the chatter.
    const data = Buffer.from(await file.arrayBuffer()).toString('base64')
    const attachmentId = await centralSupportCall<number>('ir.attachment', 'create', [{
      name: file.name, type: 'binary', raw: data,
      res_model: TICKET, res_id: ticketId,
    }])
    await centralSupportCall<boolean>(
      'mail.message', 'write', [[messageId], { attachment_ids: [[4, attachmentId]] }],
    )
  }
}
async function postCustomerMessage(
  ticketId: number, partnerId: number | null, body: string, files: File[],
) {
  const postedId = await centralSupportCall<number>(
    TICKET, 'message_post', [[ticketId]],
    {
      body: html(body || 'Attachment sent'),
      message_type: 'comment', subtype_xmlid: 'mail.mt_comment',
      ...(partnerId ? { author_id: partnerId } : {}),
    },
  )
  await addAttachments(ticketId, postedId, files)
  return postedId
}

export async function listOdooTickets() {
  const { userId, workspaceId, admin } = await session()
  const domain: unknown[] = [['x_source_uuid', '!=', 'qa-studio-20261123-1932']]
  if (!admin) {
    domain.push(['x_user_id', '=', userId], ['x_workspace_uuid', '=', workspaceId])
  }
  const rows = await centralSupportCall<TicketRecord[]>(
    TICKET, 'search_read', [domain], {
      fields: TICKET_FIELDS, limit: 100, order: 'create_date desc, id desc',
    },
  )
  return rows.map(row => {
    const stage = row.x_ticket_stage || row.x_status || 'open'
    return {
      id: row.id,
      name: row.x_subject || row.x_name || 'Support Ticket',
      ticket_ref: 'SUP-' + row.id,
      stage_id: [0, stageNames[stage] || stage] as [number, string],
      create_date: row.create_date,
      description: row.x_description || false,
    }
  })
}

export async function createOdooTicket(title: string, description: string, files: File[]) {
  await checkImpersonationWriteBlock('support tickets')
  validateFiles(files)
  const { userId, workspaceId } = await session()
  if (!workspaceId) throw new Error('No active workspace')
  const clerkUser = await currentUser()
  const email = clerkUser?.emailAddresses?.[0]?.emailAddress?.trim().toLowerCase()
  if (!email) throw new Error('Account email is required')
  const name = clerkUser?.fullName || email
  const partnerId = await partnerByEmail(email, name)
  const id = await centralSupportCall<number>(TICKET, 'create', [{
    x_name: title, x_subject: title, x_description: description,
    x_email: email, x_contact_name: name, x_partner_id: partnerId,
    x_user_id: userId, x_workspace_uuid: workspaceId,
    x_source_uuid: 'app-ticket:' + randomUUID(),
    x_status: 'open', x_ticket_stage: 'open', x_channel: 'app',
    x_last_customer_reply: timestamp(),
  }])
  // A ticket is durable even if a subsequent attachment fails. Include its ID
  // in the error so the user knows not to submit a duplicate ticket.
  try {
    if (description.trim() || files.length) {
      await postCustomerMessage(id, partnerId, description, files)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Attachment failed'
    return { success: false, ticketId: id, error: 'Ticket SUP-' + id + ' was created, but message/attachment upload failed: ' + reason }
  }
  return { success: true, ticketId: id }
}

export async function readOdooMessages(id: number) {
  await ownedTicket(id)
  const [rows, legacy] = await Promise.all([
    centralSupportCall<MessageRecord[]>(
      'mail.message', 'search_read',
      [[['model', '=', TICKET], ['res_id', '=', id], ['message_type', '=', 'comment'], ['is_internal', '=', false]]],
      { fields: ['id', 'body', 'date', 'author_id', 'attachment_ids'], order: 'date asc, id asc', limit: 200 },
    ),
    centralSupportCall<LegacyMessage[]>(
      'x_erplink_support_message', 'search_read', [[['x_support_ticket_id', '=', id]]],
      { fields: ['id', 'x_message', 'x_author_email', 'x_submitted_at', 'create_date'], order: 'id asc', limit: 100 },
    ),
  ])
  const messages = rows.map(row => ({
    id: row.id, body: row.body || '', date: row.date,
    author_id: row.author_id, attachment_ids: row.attachment_ids || [],
  }))
  for (const msg of legacy) {
    messages.push({
      id: -msg.id,
      body: html(msg.x_message || ''),
      date: msg.x_submitted_at || msg.create_date,
      author_id: [0, msg.x_author_email || 'Support'],
      attachment_ids: [],
    })
  }
  messages.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  const ids = Array.from(new Set(rows.flatMap(msg => msg.attachment_ids || [])))
  const attachments = ids.length
    ? await centralSupportCall<Array<{ id: number; name: string; mimetype: string | false }>>(
        'ir.attachment', 'search_read', [[['id', 'in', ids]]],
        { fields: ['id', 'name', 'mimetype'], limit: 200 },
      )
    : []
  return {
    messages,
    attachments: attachments.map(row => ({
      id: row.id, name: row.name, mimetype: row.mimetype || 'application/octet-stream',
    })),
  }
}

export async function sendOdooMessage(id: number, body: string, files: File[]) {
  await checkImpersonationWriteBlock('support replies')
  validateFiles(files)
  if (!body.trim() && files.length === 0) throw new Error('Please enter a message or attach a file')
  const ticket = await ownedTicket(id)
  if (ticket.x_ticket_stage === 'closed' || ticket.x_status === 'closed') {
    throw new Error('Ticket is closed')
  }
  const partnerId = Array.isArray(ticket.x_partner_id) ? ticket.x_partner_id[0] : null
  await postCustomerMessage(id, partnerId, body.trim(), files)
  await centralSupportCall<boolean>(TICKET, 'write', [[id], {
    x_last_customer_reply: timestamp(),
    x_ticket_stage: ticket.x_ticket_stage === 'waiting_customer' ? 'open' : (ticket.x_ticket_stage || 'open'),
    x_status: 'open',
  }])
  return { success: true }
}

export async function closeOdooTicket(id: number) {
  await checkImpersonationWriteBlock('support tickets')
  await ownedTicket(id)
  await centralSupportCall<boolean>(TICKET, 'write', [[id], {
    x_ticket_stage: 'closed', x_status: 'closed',
  }])
  return { success: true }
}

export async function pendingOdooTickets() {
  const { userId, workspaceId, admin } = await session()
  const domain: unknown[] = [['x_ticket_stage', 'not in', ['closed', 'resolved']]]
  if (!admin) domain.push(['x_user_id', '=', userId], ['x_workspace_uuid', '=', workspaceId])
  const tickets = await centralSupportCall<Array<{ id: number; x_partner_id: Relation }>>(
    TICKET, 'search_read', [domain],
    { fields: ['id', 'x_partner_id'], limit: 50, order: 'create_date desc' },
  )
  if (!tickets.length) return { success: true, hasPending: false }
  const messages = await centralSupportCall<Array<{ res_id: number; author_id: Relation }>>(
    'mail.message', 'search_read',
    [[['model', '=', TICKET], ['res_id', 'in', tickets.map(row => row.id)], ['message_type', '=', 'comment'], ['is_internal', '=', false]]],
    { fields: ['res_id', 'author_id'], order: 'date desc, id desc', limit: 200 },
  )
  const seen = new Set<number>()
  for (const msg of messages) {
    if (seen.has(msg.res_id)) continue
    seen.add(msg.res_id)
    const ticket = tickets.find(row => row.id === msg.res_id)
    const customer = ticket?.x_partner_id
    if (ticket && (!Array.isArray(customer) || !Array.isArray(msg.author_id) || msg.author_id[0] !== customer[0])) {
      return { success: true, hasPending: true }
    }
  }
  return { success: true, hasPending: false }
}

export async function readOwnedOdooAttachment(id: number) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid attachment')
  const rows = await centralSupportCall<AttachmentRecord[]>(
    'ir.attachment', 'read', [[id], ['id', 'name', 'mimetype', 'res_model', 'res_id', 'file_size']],
  )
  const file = rows[0]
  if (!file) throw new Error('Attachment not found')
  let ticketId: number | null = null
  if (file.res_model === TICKET) {
    ticketId = file.res_id
  } else if (file.res_model === 'mail.message') {
    const msgs = await centralSupportCall<Array<{ model: string; res_id: number; is_internal: boolean }>>(
      'mail.message', 'read', [[file.res_id], ['model', 'res_id', 'is_internal']],
    )
    if (msgs[0]?.model === TICKET && !msgs[0].is_internal) ticketId = msgs[0].res_id
  }
  if (!ticketId) throw new Error('Attachment is not part of an ERP Link ticket')
  await ownedTicket(ticketId)
  // A ticket may contain internal Odoo notes and private attachments. Only
  // files explicitly linked to a customer-visible chatter message can leave Odoo.
  const linked = await centralSupportCall<Array<{ id: number }>>(
    'mail.message', 'search_read',
    [[['model', '=', TICKET], ['res_id', '=', ticketId],
      ['attachment_ids', 'in', [id]], ['message_type', '=', 'comment'],
      ['is_internal', '=', false]]],
    { fields: ['id'], limit: 1 },
  )
  if (!linked.length) throw new Error('Internal attachment')
  if (file.file_size > MAX_FILE_BYTES) throw new Error('Attachment too large')
  const dataRows = await centralSupportCall<Array<{ raw: string | { content?: string } | false }>>(
    'ir.attachment', 'read', [[id], ['raw']],
  )
  const raw = dataRows[0]?.raw
  const encoded = typeof raw === 'string' ? raw : (raw && raw.content) || ''
  if (!encoded || encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8) {
    throw new Error('Invalid attachment content or size')
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length > MAX_FILE_BYTES) throw new Error('Attachment too large')
  return {
    name: file.name, mimetype: file.mimetype || 'application/octet-stream', buffer,
  }
}


/** Public contact submissions also become Odoo Studio support tickets. */
export async function createPublicContactTicket(input: {
  name: string; email: string; phone: string; company: string; message: string;
}, sourceUuid: string): Promise<number> {
  const email = input.email.trim().toLowerCase()
  const partnerId = await partnerByEmail(email, input.name)
  const subject = 'Contact: ' + input.company + ' — ' + input.name
  const id = await centralSupportCall<number>(TICKET, 'create', [{
    x_name: subject, x_subject: subject, x_description: input.message,
    x_email: email, x_contact_name: input.name, x_phone: input.phone,
    x_company: input.company, x_partner_id: partnerId,
    x_source_uuid: 'public-contact:' + sourceUuid,
    x_status: 'open', x_ticket_stage: 'open', x_channel: 'contact',
    x_last_customer_reply: timestamp(),
  }])
  // A failed chatter post must never erase a successfully stored ticket.
  try { await postCustomerMessage(id, partnerId, input.message, []) }
  catch (error) { console.error('[support] public ticket chatter post failed:', error) }
  return id
}
