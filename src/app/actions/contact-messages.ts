'use server'

import { revalidatePath } from 'next/cache'

import { recordAudit } from '@/lib/audit-logs'
import { getActiveUserId, isAdmin } from '@/lib/auth'
import {
  countNewContactMessages as countNewContactMessagesUnsafe,
  getContactMessageById as fetchContactMessage,
  listContactMessages,
  setContactMessageStatus,
  type ContactMessageStatus,
} from '@/lib/contact-messages'

/**
 * Admin-only surface for the contact-form inbox.
 *
 * Every function here is a server action reachable from the browser, so every
 * one of them re-checks `isAdmin` — the page-level redirect in
 * `admin/layout.tsx` protects rendering, not the action endpoints. The storage
 * layer (`src/lib/contact-messages.ts`) is intentionally auth-free because the
 * public form writes to it.
 */

const STATUSES: readonly ContactMessageStatus[] = ['new', 'read', 'archived']

async function requireAdmin(): Promise<string> {
  const adminId = await getActiveUserId()
  if (!adminId || !isAdmin(adminId)) {
    throw new Error('Unauthorized: admin only')
  }
  return adminId
}

export async function getContactMessages(params?: {
  status?: ContactMessageStatus | 'all'
  limit?: number
  offset?: number
}) {
  try {
    await requireAdmin()
    const status = params?.status && (params.status === 'all' || STATUSES.includes(params.status))
      ? params.status
      : 'all'

    const result = await listContactMessages({
      status,
      limit: params?.limit,
      offset: params?.offset,
    })

    return {
      success: result.ok,
      rows: result.rows,
      total: result.total,
      error: result.error,
    }
  } catch (err) {
    return {
      success: false,
      rows: [],
      total: 0,
      error: err instanceof Error ? err.message : 'unexpected_error',
    }
  }
}

export async function getNewContactMessageCount() {
  try {
    await requireAdmin()
    const count = await countNewContactMessagesUnsafe()
    return { success: true, count }
  } catch {
    return { success: false, count: 0 }
  }
}

/**
 * One record for `/admin/messages/<id>`. The list never ships the message body,
 * so opening a row is a read of its own.
 */
export async function getContactMessage(id: string) {
  try {
    await requireAdmin()
    const result = await fetchContactMessage(id)
    return {
      success: result.ok,
      row: result.row,
      error: result.error,
    }
  } catch (err) {
    return {
      success: false,
      row: null,
      error: err instanceof Error ? err.message : 'unexpected_error',
    }
  }
}

export async function updateContactMessageStatus(id: string, status: ContactMessageStatus) {
  try {
    const adminId = await requireAdmin()

    if (!id || !STATUSES.includes(status)) {
      return { success: false, error: 'invalid_input' }
    }

    const result = await setContactMessageStatus(id, status, adminId)
    if (!result.ok) {
      return { success: false, error: result.error || 'update_failed' }
    }

    await recordAudit({
      actorId: adminId,
      actorRole: 'admin',
      action: `contact_message.${status}`,
      entityType: 'contact_message',
      entityId: id,
    })

    revalidatePath('/admin/messages')
    revalidatePath('/admin/messages/[id]', 'page')
    revalidatePath('/admin')
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unexpected_error' }
  }
}
