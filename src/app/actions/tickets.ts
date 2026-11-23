'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { auth } from '@clerk/nextjs/server'
import {
  listOdooTickets, createOdooTicket, readOdooMessages,
  sendOdooMessage, closeOdooTicket, pendingOdooTickets, markOdooTicketRead,
} from '@/lib/odoo-support'

export interface Ticket {
  id: number
  name: string
  ticket_ref: string | false
  stage_id: [number, string] | false
  create_date: string
  description: string | false
  unread_count: number
}

export interface OdooMessage {
  id: number
  body: string
  date: string
  author_id: [number, string] | false
  attachment_ids: number[]
  is_customer: boolean
}

export interface OdooAttachment {
  id: number
  name: string
  mimetype: string
}

/** ERP Link support is workspace-scoped and stored in central Odoo Studio only. */
export async function getClientTickets() {
  try {
    const tickets: Ticket[] = await listOdooTickets()
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
  const files = formData.getAll('attachments').filter((value): value is File => typeof value !== 'string')
  try {
    const result = await createOdooTicket(title, description, files)
    if (result.success) revalidatePath('/app/tickets')
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ticket creation failed' }
  }
}

export async function getTicketMessages(ticketId: number) {
  try {
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('Invalid ticket ID')
    const result = await readOdooMessages(ticketId)
    const messages: OdooMessage[] = result.messages
    return { success: true, messages, attachments: result.attachments as OdooAttachment[] }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ticket messages unavailable' }
  }
}

export async function sendTicketMessage(formData: FormData) {
  const ticketId = Number(formData.get('ticketId'))
  const message = String(formData.get('message') || '')
  const files = formData.getAll('attachments').filter((value): value is File => typeof value !== 'string')
  try {
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('Invalid ticket ID')
    const result = await sendOdooMessage(ticketId, message, files)
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
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('Invalid ticket ID')
    const result = await closeOdooTicket(ticketId)
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
    return await pendingOdooTickets()
  } catch {
    return { success: false, hasPending: false, unreadCount: 0 }
  }
}

/** Persist the last support reply actually displayed by this customer in Odoo. */
export async function markTicketRead(ticketId: number, supportMessageId: number) {
  try {
    const result = await markOdooTicketRead(ticketId, supportMessageId)
    return result
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unable to mark ticket as read' }
  }
}
