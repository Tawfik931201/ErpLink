import { supabase } from './supabase'

/**
 * Storage for the public contact form (`/contact`).
 *
 * The message is written here BEFORE anything else happens, so a slow or broken
 * Odoo connection can never lose it. The admin page at `/admin/messages` reads
 * this table — the email channel is optional and disabled unless
 * `CONTACT_INBOX_EMAIL` is set.
 *
 * This module is deliberately auth-free: it is called from the public server
 * action (`submitContact`) where there is no session at all. Admin-only reads
 * and writes are wrapped with `requireAdmin()` in
 * `src/app/actions/contact-messages.ts`, which is the only module a client
 * component can reach.
 */

export type ContactMessageStatus = 'new' | 'read' | 'archived'

export interface ContactMessageInput {
  name: string
  email: string
  phone: string
  company: string
  message: string
}

export interface ContactMessageRow {
  id: string
  name: string
  email: string
  phone: string
  company: string
  message: string
  status: ContactMessageStatus
  is_new_customer: boolean | null
  odoo_ticket_id: number | null
  email_delivered: boolean
  created_at: string
  read_at: string | null
  read_by: string | null
}

const SELECT_COLUMNS =
  'id, name, email, phone, company, message, status, is_new_customer, odoo_ticket_id, email_delivered, created_at, read_at, read_by'

/**
 * PostgREST answers a missing table with `42P01` (Postgres) or `PGRST205`
 * (schema cache). Both mean "migration 20261025 was not applied", which is a
 * deploy-state problem — showing the visitor of the admin page the raw Postgres
 * wording helps nobody.
 */
function isMissingTableError(message: string | undefined): boolean {
  if (!message) return false
  return (
    message.includes('42P01') ||
    message.includes('PGRST205') ||
    message.includes("Could not find the table 'public.contact_messages'") ||
    message.includes('relation "public.contact_messages" does not exist')
  )
}

/** Durable first write. Returns the row id, or null when the table is missing. */
export async function insertContactMessage(
  input: ContactMessageInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase
      .from('contact_messages')
      .insert([
        {
          name: input.name,
          email: input.email,
          phone: input.phone,
          company: input.company,
          message: input.message,
          status: 'new',
        },
      ])
      .select('id')
      .single()

    if (error) {
      console.error(
        '[contact] failed to save message:',
        error.message,
        isMissingTableError(error.message)
          ? '— apply migration 20261025_contact_messages.sql'
          : '',
      )
      return { ok: false, error: error.message }
    }

    return { ok: true, id: String(data.id) }
  } catch (err) {
    console.error('[contact] failed to save message:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'insert_failed' }
  }
}

/**
 * Records what happened on the external channels AFTER the row was saved.
 * A blank `odoo_ticket_id` in the admin list therefore means the ticket was not
 * created — not "unknown".
 */
export async function finalizeContactMessage(
  id: string,
  data: { odooTicketId: number | null; isNewCustomer: boolean | null; emailDelivered: boolean },
): Promise<void> {
  try {
    const { error } = await supabase
      .from('contact_messages')
      .update({
        odoo_ticket_id: data.odooTicketId,
        is_new_customer: data.isNewCustomer,
        email_delivered: data.emailDelivered,
      })
      .eq('id', id)

    if (error) {
      console.error('[contact] failed to record delivery outcome:', error.message)
    }
  } catch (err) {
    console.error('[contact] failed to record delivery outcome:', err)
  }
}

export interface ListContactMessagesParams {
  status?: ContactMessageStatus | 'all'
  limit?: number
  offset?: number
}

/** Bounded read — the admin list is a page, never a full-table dump. */
export async function listContactMessages(params: ListContactMessagesParams = {}): Promise<{
  ok: boolean
  rows: ContactMessageRow[]
  total: number
  error?: string
}> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const offset = Math.max(params.offset ?? 0, 0)

  try {
    let query = supabase
      .from('contact_messages')
      .select(SELECT_COLUMNS, { count: 'exact' })

    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status)
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[contact] failed to list messages:', error.message)
      return {
        ok: false,
        rows: [],
        total: 0,
        error: isMissingTableError(error.message) ? 'migration_missing' : error.message,
      }
    }

    return { ok: true, rows: (data ?? []) as ContactMessageRow[], total: count ?? 0 }
  } catch (err) {
    console.error('[contact] failed to list messages:', err)
    return {
      ok: false,
      rows: [],
      total: 0,
      error: err instanceof Error ? err.message : 'list_failed',
    }
  }
}

/** Unread count for the admin nav badge. Never throws — a badge is decoration. */
export async function countNewContactMessages(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('contact_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')

    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}

/**
 * `new` → `read` stamps who read it and when; moving back to `new` clears the
 * stamp so the badge cannot disagree with the row.
 */
export async function setContactMessageStatus(
  id: string,
  status: ContactMessageStatus,
  actorId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const stamp = status === 'new' ? null : new Date().toISOString()
    const { error } = await supabase
      .from('contact_messages')
      .update({
        status,
        read_at: stamp,
        read_by: status === 'new' ? null : actorId,
      })
      .eq('id', id)

    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'update_failed' }
  }
}
