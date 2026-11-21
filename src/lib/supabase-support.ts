import 'server-only'

import { auth, currentUser } from '@clerk/nextjs/server'
import { unstable_cache } from 'next/cache'
import { isAdmin, getActiveWorkspaceId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

// Only server actions may call these helpers. The database tables are private
// (no anon/authenticated grants) and every query is scoped using Clerk context.
type TicketRow = {
  id: number
  workspace_id: string
  user_id: string
  email: string
  contact_name: string | null
  subject: string
  description: string
  status: 'open' | 'closed'
  created_at: string
}
type MessageRow = {
  id: number
  ticket_id: number
  author_id: string | null
  author_name: string
  body: string
  created_at: string
}

async function session() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  const admin = isAdmin(userId)
  const workspaceId = await getActiveWorkspaceId()
  if (!workspaceId && !admin) throw new Error('No active workspace')
  return { userId, workspaceId, admin }
}

async function ownedTicket(ticketId: number): Promise<TicketRow> {
  const { userId, workspaceId, admin } = await session()
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) throw new Error('Invalid ticket')
  let query = supabase.from('support_tickets').select('*').eq('id', ticketId)
  if (!admin) query = query.eq('workspace_id', workspaceId!).eq('user_id', userId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Ticket not found or forbidden')
  return data as TicketRow
}

export async function listSupabaseTickets() {
  const { userId, workspaceId, admin } = await session()
  let query = supabase.from('support_tickets')
    .select('id,subject,description,status,created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (!admin) query = query.eq('workspace_id', workspaceId!).eq('user_id', userId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data || []).map(row => ({
    id: -Number(row.id),
    name: row.subject,
    ticket_ref: 'SUP-' + row.id,
    stage_id: [0, row.status === 'closed' ? 'Closed' : 'Open'] as [number, string],
    create_date: row.created_at,
    description: row.description || false,
  }))
}

export async function createSupabaseTicket(title: string, description: string, files: File[]) {
  const { userId, workspaceId } = await session()
  if (files.some(file => file.size > 0)) {
    return { success: false, error: 'Ticket attachments are not supported in Supabase yet.' }
  }
  const user = await currentUser()
  const email = user?.emailAddresses[0]?.emailAddress
  if (!email) return { success: false, error: 'Email not found' }
  const { data, error } = await supabase.from('support_tickets').insert({
    workspace_id: workspaceId, user_id: userId, email,
    contact_name: user?.fullName || email,
    subject: title.trim(), description: description?.trim() || '',
    status: 'open',
  }).select('id').single()
  if (error) return { success: false, error: error.message }
  return { success: true, ticketId: -Number(data.id) }
}

export async function readSupabaseMessages(negativeId: number) {
  const ticket = await ownedTicket(-negativeId)
  const { data, error } = await supabase.from('support_messages')
    .select('id,author_id,author_name,body,created_at')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true }).limit(200)
  if (error) throw new Error(error.message)
  return {
    success: true,
    messages: ((data || []) as MessageRow[]).map(row => ({
      id: row.id,
      body: row.body,
      date: row.created_at,
      author_id: [0, row.author_name || 'Support'] as [number, string],
      attachment_ids: [] as number[],
    })),
    attachments: [] as { id: number; name: string; mimetype: string }[],
  }
}

export async function sendSupabaseMessage(negativeId: number, message: string, files: File[]) {
  const ticket = await ownedTicket(-negativeId)
  if (ticket.status === 'closed') return { success: false, error: 'Ticket is closed' }
  if (!message.trim()) return { success: false, error: 'Message cannot be empty' }
  if (files.some(file => file.size > 0)) return { success: false, error: 'Attachments are not supported yet' }
  const { userId } = await session()
  const user = await currentUser()
  const { error } = await supabase.from('support_messages').insert({
    ticket_id: ticket.id, author_id: userId,
    author_name: user?.fullName || ticket.email, body: message.trim(),
  })
  return error ? { success: false, error: error.message } : { success: true }
}

export async function closeSupabaseTicket(negativeId: number) {
  const ticket = await ownedTicket(-negativeId)
  const { error } = await supabase.from('support_tickets')
    .update({ status: 'closed', updated_at: new Date().toISOString() })
    .eq('id', ticket.id).eq('workspace_id', ticket.workspace_id)
  return error ? { success: false, error: error.message } : { success: true }
}

// Cache each (Clerk user, workspace) separately to prevent repeated DB polls
// on every route navigation. Ticket reply/close actions invalidate this tag.
const cachedPending = unstable_cache(
  async (userId: string, workspaceId: string) => {
    const { data: tickets, error } = await supabase.from('support_tickets')
      .select('id').eq('workspace_id', workspaceId).eq('user_id', userId)
      .eq('status', 'open').order('created_at', { ascending: false }).limit(50)
    if (error) throw new Error(error.message)
    const ids = (tickets || []).map(t => t.id)
    if (!ids.length) return { success: true, hasPending: false }
    const { data: messages, error: msgError } = await supabase.from('support_messages')
      .select('ticket_id,author_id').in('ticket_id', ids)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200)
    if (msgError) throw new Error(msgError.message)
    const seen = new Set<number>()
    for (const message of messages || []) {
      if (seen.has(message.ticket_id)) continue
      seen.add(message.ticket_id)
      if (!message.author_id || message.author_id !== userId) return { success: true, hasPending: true }
    }
    return { success: true, hasPending: false }
  },
  ['supabase-support-pending-v1'], { revalidate: 60, tags: ['pending-tickets'] },
)

export async function pendingSupabaseTickets(): Promise<{ success: boolean; hasPending: boolean }> {
  const { userId, workspaceId } = await session()
  if (!workspaceId) throw new Error('No active workspace')
  return cachedPending(userId, workspaceId)
}
