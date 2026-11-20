/**
 * Admin-only Odoo contact inbox adapter. Callers MUST enforce ERP Link admin auth.
 * The public form never calls read/list functions.
 */
import 'server-only'
import {
  archiveDatetime, countArchive, readArchive, updateArchiveBySource,
} from '@/lib/central-odoo-archive'
import type {
  ContactMessageListRow, ContactMessageRow, ContactMessageStatus,
} from '@/lib/contact-messages'

type OdooContact = {
  x_source_uuid: string | false
  x_contact_name: string | false
  x_email: string | false
  x_phone: string | false
  x_company: string | false
  x_message: string | false
  x_status: string | false
  x_submitted_at: string | false
  x_is_new_customer: boolean | false
  x_odoo_ticket_id: number | false
  x_email_delivered: boolean
  x_read_at: string | false
  x_read_by: string | false
  create_date: string
}

const SUMMARY_FIELDS = [
  'x_source_uuid', 'x_contact_name', 'x_email', 'x_phone', 'x_company',
  'x_status', 'x_submitted_at', 'x_is_new_customer',
  'x_odoo_ticket_id', 'x_read_at', 'create_date',
]
const FULL_FIELDS = [...SUMMARY_FIELDS, 'x_message', 'x_email_delivered', 'x_read_by']

function time(value: string | false): string {
  return value ? new Date(value.replace(' ', 'T') + 'Z').toISOString() : ''
}
function nullableTime(value: string | false): string | null {
  return value ? time(value) : null
}
function mapSummary(row: OdooContact): ContactMessageListRow {
  return {
    id: row.x_source_uuid || '',
    name: row.x_contact_name || '',
    email: row.x_email || '',
    phone: row.x_phone || '',
    company: row.x_company || '',
    status: (row.x_status || 'new') as ContactMessageStatus,
    is_new_customer: row.x_is_new_customer ?? null,
    odoo_ticket_id: row.x_odoo_ticket_id || null,
    created_at: time(row.x_submitted_at || row.create_date),
    read_at: nullableTime(row.x_read_at),
  }
}

export function useOdooContactInbox(): boolean {
  // Default to central Odoo once credentials exist; allow explicit rollback.
  return process.env.ERPLINK_ARCHIVE_ODOO_CONTACTS_READ_PRIMARY !== 'false'
}

export async function odooContactList(params: {
  status?: ContactMessageStatus | 'all'; limit?: number; offset?: number
}): Promise<{ rows: ContactMessageListRow[]; total: number }> {
  const domain: unknown[] = [['x_source_uuid', '!=', false], ['x_status', '!=', 'test']]
  if (params.status && params.status !== 'all') domain.push(['x_status', '=', params.status])
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const offset = Math.max(params.offset ?? 0, 0)
  const [records, total] = await Promise.all([
    readArchive<OdooContact>('contact', domain, SUMMARY_FIELDS,
      { limit, offset, order: 'x_submitted_at desc, id desc' }),
    countArchive('contact', domain),
  ])
  return { rows: records.map(mapSummary), total }
}

export async function odooContactById(uuid: string): Promise<ContactMessageRow | null> {
  const record = (await readArchive<OdooContact>(
    'contact', [['x_source_uuid', '=', uuid]], FULL_FIELDS, { limit: 1 },
  ))[0]
  if (!record) return null
  return {
    ...mapSummary(record),
    message: record.x_message || '',
    email_delivered: Boolean(record.x_email_delivered),
    read_by: record.x_read_by || null,
  }
}

export async function odooContactNewCount(): Promise<number> {
  return countArchive('contact', [['x_source_uuid', '!=', false], ['x_status', '=', 'new']])
}

export async function odooSetContactStatus(
  uuid: string, status: ContactMessageStatus, actorId: string,
): Promise<boolean> {
  return updateArchiveBySource('contact', uuid, {
    x_status: status,
    x_read_at: status === 'new' ? false : archiveDatetime(new Date().toISOString()),
    x_read_by: status === 'new' ? '' : actorId,
  })
}
