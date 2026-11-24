/**
 * Bounded, resumable backfill of historic public contact messages.
 * Preserves the original UUID for admin deep links and reconciliation.
 */
import {
  archiveDatetime, isOdooArchiveEnabled, readArchive, upsertArchive, updateArchiveBySource,
} from '@/lib/central-odoo-archive'
import { supabaseAdmin } from '@/lib/sync-runtime'

const SOURCE = 'erp-link:contact-messages:v1'
type Cursor = { x_last_contact_iso: string | false; x_last_contact_id: string | false }
type ContactRow = {
  id: string; name: string; email: string; phone: string; company: string
  message: string; status: string; created_at: string
  odoo_ticket_id: number | null; is_new_customer: boolean | null
  email_delivered: boolean | null; read_at: string | null; read_by: string | null
}

export async function archiveContactMessagesBatch(): Promise<{ archived: number; error?: string }> {
  if (!isOdooArchiveEnabled()) return { archived: 0 }
  try {
    const checkpoint = (await readArchive<Cursor>(
      'context', [['x_integration_key', '=', SOURCE]],
      ['x_last_contact_iso', 'x_last_contact_id'], { limit: 1 },
    ))[0]
    let query = supabaseAdmin.from('contact_messages')
      .select('id,name,email,phone,company,message,status,created_at,odoo_ticket_id,is_new_customer,email_delivered,read_at,read_by')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(20)
    if (checkpoint?.x_last_contact_iso) {
      const iso = checkpoint.x_last_contact_iso
      query = checkpoint.x_last_contact_id
        ? query.or(`created_at.gt.${iso},and(created_at.eq.${iso},id.gt.${checkpoint.x_last_contact_id})`)
        : query.gt('created_at', iso)
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    let archived = 0
    for (const row of (data ?? []) as ContactRow[]) {
      await upsertArchive('contact', row.id, {
        x_name: row.name,
        x_contact_name: row.name,
        x_email: row.email,
        x_phone: row.phone,
        x_company: row.company,
        x_subject: 'Public contact form',
        x_message: row.message,
        x_status: row.status,
        x_submitted_at: archiveDatetime(row.created_at),
        x_odoo_ticket_id: row.odoo_ticket_id || 0,
        x_is_new_customer: Boolean(row.is_new_customer),
        x_email_delivered: Boolean(row.email_delivered),
        x_read_at: archiveDatetime(row.read_at),
        x_read_by: row.read_by || '',
      })
      const cursorFields = {
        x_name: 'Contact message archive checkpoint',
        x_integration_key: SOURCE,
        x_last_contact_iso: row.created_at,
        x_last_contact_id: row.id,
      }
      if (!checkpoint && archived === 0) {
        await upsertArchive('context', SOURCE, cursorFields)
      } else {
        await updateArchiveBySource('context', SOURCE, cursorFields)
      }
      archived++
    }
    return { archived }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'contact_backfill_failed'
    console.error('[archive] contact backfill failed; source rows retained:', error)
    return { archived: 0, error }
  }
}
