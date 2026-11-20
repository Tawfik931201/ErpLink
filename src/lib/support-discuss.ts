/**
 * ERP Link private support conversations in Odoo Discuss.
 * Every channel is associated with exactly one central support ticket.
 * Never accept a channel ID from a browser; resolve it after ticket authorization.
 */
import 'server-only'
import { centralDiscussCall } from '@/lib/central-odoo-archive'

export type SupportDiscussTicket = {
  id: number
  x_source_uuid: string | false
  x_workspace_uuid: string | false
  x_subject: string | false
}

type ChannelRow = { id: number; name: string; description: string | false }
type MessageRow = {
  id: number
  body: string | false
  date: string
  author_id: [number, string] | false
  attachment_ids: number[]
}
const channelName = (ticket: SupportDiscussTicket) => `ERP Link Support #${ticket.id}`
const channelTag = (ticket: SupportDiscussTicket) =>
  `erplink-support-ticket:${ticket.id}:${ticket.x_workspace_uuid || ''}:${ticket.x_source_uuid || ''}`

export async function findSupportDiscussChannel(ticket: SupportDiscussTicket): Promise<number | null> {
  const rows = await centralDiscussCall<ChannelRow[]>('discuss.channel', 'search_read',
    [[['name', '=', channelName(ticket)], ['channel_type', '=', 'group']]],
    { fields: ['id', 'name', 'description'], limit: 20 })
  const matches = rows.filter(row => row.description === channelTag(ticket))
  if (matches.length > 1) throw new Error('Duplicate support Discuss channels require administrator review')
  return matches[0]?.id ?? null
}

export async function ensureSupportDiscussChannel(ticket: SupportDiscussTicket): Promise<number> {
  const existing = await findSupportDiscussChannel(ticket)
  if (existing) return existing

  // A private group with only the connected support staff member. Additional
  // Odoo staff can be invited through Discuss; the external customer never
  // receives access to the central Odoo database.
  const supportLogin = process.env.ERPLINK_ARCHIVE_ODOO_USERNAME
  if (!supportLogin) throw new Error('Central Odoo support login is unavailable')
  const users = await centralDiscussCall<Array<{ partner_id: [number, string] | false }>>(
    'res.users', 'search_read', [[['login', '=', supportLogin]]],
    { fields: ['partner_id'], limit: 1 })
  const supportPartnerId = users[0]?.partner_id?.[0]
  if (!supportPartnerId) throw new Error('Central Odoo support partner is unavailable')
  return centralDiscussCall<number>('discuss.channel', 'create', [{
    name: channelName(ticket),
    description: channelTag(ticket),
    channel_type: 'group',
    channel_partner_ids: [[4, supportPartnerId]],
  }])
}

export async function getSupportDiscussMessages(ticket: SupportDiscussTicket): Promise<MessageRow[]> {
  const channelId = await findSupportDiscussChannel(ticket)
  if (!channelId) return []
  return centralDiscussCall<MessageRow[]>('mail.message', 'search_read',
    [[['model', '=', 'discuss.channel'], ['res_id', '=', channelId],
      ['message_type', '=', 'comment']]],
    { fields: ['id', 'body', 'date', 'author_id', 'attachment_ids'], order: 'date asc', limit: 200 })
}

export async function postSupportDiscussMessage(
  ticket: SupportDiscussTicket, authorName: string, message: string,
): Promise<number> {
  const channelId = await ensureSupportDiscussChannel(ticket)
  // Odoo Discuss escapes message_post plain text itself; do not double-encode HTML.
  const body = `${authorName}: ${message}`
  return centralDiscussCall<number>('discuss.channel', 'message_post', [[channelId]], {
    body, message_type: 'comment', subtype_xmlid: 'mail.mt_comment',
  })
}
