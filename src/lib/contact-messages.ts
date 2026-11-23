import 'server-only'

import { randomUUID } from 'node:crypto'

import { archiveDatetime, updateArchiveBySource, upsertArchive } from '@/lib/central-odoo-archive'
import {
  odooContactById, odooContactList, odooContactNewCount, odooSetContactStatus,
} from '@/lib/central-contact-inbox'

// The public contact inbox is a central Odoo Studio model. No contact messages,
// support tickets, replies, attachments or notification data use Supabase.
export type ContactMessageStatus = 'new' | 'read' | 'archived'

export interface ContactMessageInput {
  name: string
  email: string
  phone: string
  company: string
  message: string
}
export interface ContactMessageListRow {
  id: string
  name: string
  company: string
  email: string
  phone: string
  status: ContactMessageStatus
  is_new_customer: boolean | null
  odoo_ticket_id: number | null
  created_at: string
  read_at: string | null
}
export interface ContactMessageRow extends ContactMessageListRow {
  message: string
  email_delivered: boolean
  read_by: string | null
}
export interface ListContactMessagesParams {
  status?: ContactMessageStatus | 'all'
  limit?: number
  offset?: number
}

export async function insertContactMessage(
  input: ContactMessageInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const id = randomUUID()
  try {
    await upsertArchive('contact', id, {
      x_name: input.name, x_contact_name: input.name,
      x_email: input.email, x_phone: input.phone, x_company: input.company,
      x_message: input.message, x_subject: 'Contact: ' + input.company,
      x_status: 'new', x_submitted_at: archiveDatetime(new Date().toISOString()),
      x_email_delivered: false,
    })
    return { ok: true, id }
  } catch (error) {
    console.error('[contact] Odoo inbox insert failed:', error)
    return { ok: false, error: 'Central support inbox unavailable' }
  }
}

export async function finalizeContactMessage(
  id: string,
  data: { odooTicketId: number | null; isNewCustomer: boolean | null; emailDelivered: boolean },
): Promise<void> {
  try {
    await updateArchiveBySource('contact', id, {
      x_odoo_ticket_id: data.odooTicketId || 0,
      x_is_new_customer: Boolean(data.isNewCustomer),
      x_email_delivered: data.emailDelivered,
    })
  } catch (error) {
    console.error('[contact] Odoo inbox finalization failed:', error)
  }
}

export async function listContactMessages(params: ListContactMessagesParams = {}) {
  try {
    const result = await odooContactList(params)
    return { ok: true, rows: result.rows, total: result.total }
  } catch (error) {
    return { ok: false, rows: [] as ContactMessageListRow[], total: 0,
      error: error instanceof Error ? error.message : 'odoo_unavailable' }
  }
}

export async function getContactMessageById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, row: null as ContactMessageRow | null, error: 'not_found' }
  }
  try {
    const row = await odooContactById(id)
    return { ok: Boolean(row), row, ...(row ? {} : { error: 'not_found' }) }
  } catch (error) {
    return { ok: false, row: null as ContactMessageRow | null,
      error: error instanceof Error ? error.message : 'odoo_unavailable' }
  }
}

export async function countNewContactMessages(): Promise<number> {
  try {
    return await odooContactNewCount()
  } catch {
    return 0
  }
}

export async function setContactMessageStatus(
  id: string, status: ContactMessageStatus, actorId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ok = await odooSetContactStatus(id, status, actorId)
    return ok ? { ok: true } : { ok: false, error: 'not_found' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'odoo_unavailable' }
  }
}
