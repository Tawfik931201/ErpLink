'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import {
  listSupabaseTickets, createSupabaseTicket, readSupabaseMessages,
  sendSupabaseMessage, closeSupabaseTicket, pendingSupabaseTickets,
} from '@/lib/supabase-support'

export interface Ticket {
  id: number
  name: string
  ticket_ref: string | false
  stage_id: [number, string] | false
  create_date: string
  description: string | false
}

export interface OdooMessage {
  id: number
  body: string
  date: string
  author_id: [number, string] | false
  attachment_ids: number[]
}

export interface OdooAttachment {
  id: number
  name: string
  mimetype: string
}

/** ERP Link support is private, workspace-scoped and stored in Supabase.
 * Merchant Odoo connections are used for ERP integrations only. */
export async function getClientTickets() {
  try {
    const tickets: Ticket[] = await listSupabaseTickets()
    return { success: true, tickets }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ticket list failed' }
  }
}

export async function createTicket(formData: FormData) {
  const { userId } = await auth()
  if (!userId) return { success: false, error: 'Unauthorized' }
  const title = String(formData.get('title') || '').trim()
  if (!title) return { success: false, error: 'Please provide a ticket title.' }
  const description = String(formData.get('description') || '')
  const files = formData.getAll('attachments').filter((value): value is File => value instanceof File)
  try {
    const result = await createSupabaseTicket(title, description, files)
    if (result.success) revalidatePath('/app/tickets')
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ticket creation failed' }
  }
}

export async function getTicketMessages(ticketId: number) {
  try {
    if (ticketId >= 0) throw new Error('Invalid ticket ID')
    const result = await readSupabaseMessages(ticketId)
    const messages: OdooMessage[] = result.messages
    return { success: true, messages, attachments: result.attachments as OdooAttachment[] }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ticket messages unavailable' }
  }
}

export async function sendTicketMessage(formData: FormData) {
  const ticketId = Number(formData.get('ticketId'))
  const message = String(formData.get('message') || '')
  const files = formData.getAll('attachments').filter((value): value is File => value instanceof File)
  try {
    if (!Number.isSafeInteger(ticketId) || ticketId >= 0) throw new Error('Invalid ticket ID')
    const result = await sendSupabaseMessage(ticketId, message, files)
    if (result.success) {
      revalidatePath('/app/tickets')
      revalidateTag('pending-tickets')
    }
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ticket reply failed' }
  }
}

export async function closeTicket(ticketId: number) {
  try {
    if (!Number.isSafeInteger(ticketId) || ticketId >= 0) throw new Error('Invalid ticket ID')
    const result = await closeSupabaseTicket(ticketId)
    if (result.success) {
      revalidatePath('/app/tickets')
      revalidateTag('pending-tickets')
    }
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ticket close failed' }
  }
}

export async function checkPendingTickets() {
  try {
    return await pendingSupabaseTickets()
  } catch {
    return { success: false, hasPending: false }
  }
}
