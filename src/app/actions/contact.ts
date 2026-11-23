'use server'

import { headers } from 'next/headers'

import { insertContactMessage, finalizeContactMessage } from '@/lib/contact-messages'
import { createPublicContactTicket } from '@/lib/odoo-support'
import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'

// The public contact form has one persistence provider: central Odoo Studio.
// Mail alerts are configured and sent by Odoo, not the application SMTP provider.
const CONTACT_RATE_LIMIT = 10
const CONTACT_RATE_WINDOW_MS = 10 * 60 * 1000

export async function submitContact(formData: FormData) {
  const name = String(formData.get('name') || '').trim()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const phone = String(formData.get('phone') || '').trim()
  const company = String(formData.get('company') || '').trim()
  const message = String(formData.get('message') || '').trim()

  if (!name) return { success: false, error: 'Name is required' }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: 'Valid email is required' }
  }
  if (!phone) return { success: false, error: 'Phone is required' }
  if (!company) return { success: false, error: 'Company is required' }
  if (!message) return { success: false, error: 'Message is required' }

  const hdr = await headers()
  const limit = checkRateLimit(
    rateLimitKeyFromHeaders((key) => hdr.get(key), 'contact-form'),
    CONTACT_RATE_LIMIT, CONTACT_RATE_WINDOW_MS,
  )
  if (!limit.allowed) return { success: false, error: 'rate_limited' }

  const input = { name, email, phone, company, message }
  const saved = await insertContactMessage(input)
  if (!saved.ok) return { success: false, error: 'failed' }

  try {
    const ticketId = await createPublicContactTicket(input, saved.id)
    await finalizeContactMessage(saved.id, {
      odooTicketId: ticketId, isNewCustomer: null, emailDelivered: false,
    })
    return { success: true }
  } catch (error) {
    console.error('[contact] Odoo contact record saved but ticket creation failed:', error)
    // Keep the message in the Odoo contact inbox for the support team.
    return { success: false, error: 'Support ticket could not be created; message is saved in Odoo' }
  }
}
