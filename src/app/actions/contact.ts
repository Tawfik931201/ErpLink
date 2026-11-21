'use server'

import { headers } from 'next/headers'

import { insertContactMessage, finalizeContactMessage } from '@/lib/contact-messages'
import { sendEmail } from '@/lib/email'
import { contactMessageEmail } from '@/lib/email-templates'
import { checkRateLimit, rateLimitKeyFromHeaders } from '@/lib/rate-limit'

/**
 * The contact form writes to three places, in this exact order:
 *
 * 1. `contact_messages` (database) — FIRST, because it is the only destination
 *    that cannot fail for external reasons. This is what `/admin/messages`
 *    shows, and the message is safe the moment this insert returns.
 * 2. Odoo helpdesk — the CRM record (res.partner + helpdesk.ticket), tagged
 *    "عميل جديد" / "مسجل بالفعل على السيستم". Best effort: an Odoo outage must
 *    not lose the message, so the ticket id is attached to the saved row
 *    afterwards.
 * 3. Email — OPTIONAL and currently OFF. It only runs when
 *    `CONTACT_INBOX_EMAIL` is set and SendGrid/SMTP is configured. The
 *    customer's address rides along as Reply-To, so replying from the inbox
 *    answers them directly.
 *
 * The submission succeeds if the row was saved OR the ticket was created. Both
 * failing is the only case that returns an error, because that is the only case
 * where the customer's words exist nowhere.
 */

const CONTACT_RATE_LIMIT = 10
const CONTACT_RATE_WINDOW_MS = 10 * 60 * 1000
const MAX_INBOX_RECIPIENTS = 5

export async function submitContact(formData: FormData) {
  const name = formData.get('name') as string
  const email = formData.get('email') as string
  const phone = formData.get('phone') as string
  const company = formData.get('company') as string
  const message = formData.get('message') as string

  if (!name?.trim()) {
    return { success: false, error: 'Name is required' }
  }
  if (!email?.trim()) {
    return { success: false, error: 'Email is required' }
  }
  if (!phone?.trim()) {
    return { success: false, error: 'Phone is required' }
  }
  if (!company?.trim()) {
    return { success: false, error: 'Company is required' }
  }
  if (!message?.trim()) {
    return { success: false, error: 'Message is required' }
  }

  // A public, unauthenticated form is an abuse target. Generous enough for
  // someone correcting a typo, tight enough to stop a script from filling the
  // admin inbox. Per-process and best-effort (see lib/rate-limit.ts).
  const headerStore = await headers()
  const limit = checkRateLimit(
    rateLimitKeyFromHeaders((n) => headerStore.get(n), 'contact-form'),
    CONTACT_RATE_LIMIT,
    CONTACT_RATE_WINDOW_MS,
  )
  if (!limit.allowed) {
    return { success: false, error: 'rate_limited' }
  }

  const customerEmail = email.trim().toLowerCase()
  const customerPhone = phone.trim()
  const customerName = name.trim()
  const customerCompany = company.trim()
  const customerMessage = message.trim()

  // ── 1. Save to the system (durable, first) ────────────────────────────────
  const saved = await insertContactMessage({
    name: customerName,
    email: customerEmail,
    phone: customerPhone,
    company: customerCompany,
    message: customerMessage,
  })
  const savedId = saved.ok ? saved.id : null

  // Platform contact submissions stay in Supabase. Merchant Odoo connections
  // must never be used as the ERP Link public support inbox.
  const ticketId: number | null = null
  const isNewCustomer: boolean | null = null

  // ── 3. Email (opt-in via CONTACT_INBOX_EMAIL; off by default) ─────────────
  let emailed = false

  const inbox = (process.env.CONTACT_INBOX_EMAIL || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_INBOX_RECIPIENTS)

  if (inbox.length > 0) {
    try {
      const tpl = contactMessageEmail({
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        company: customerCompany,
        message: customerMessage,
        isNewCustomer: isNewCustomer ?? true,
        ticketId,
      })

      // One message per recipient: SendGrid's `to` is a single address while
      // nodemailer accepts a list, so looping keeps both providers honest.
      const results = []
      for (const recipient of inbox) {
        results.push(
          await sendEmail({
            to: recipient,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
            replyTo: customerEmail,
          }),
        )
      }
      emailed = results.some((result) => result.ok)
      const failed = results.filter((result) => !result.ok)
      if (failed.length > 0) {
        console.error(
          '[contact] notification email failed:',
          failed.map((result) => result.error).join(', '),
        )
      }
    } catch (err) {
      console.error('[contact] notification email threw:', err)
    }
  }

  // Mirror the outcome of every channel onto the saved row, so the admin list
  // can tell "Odoo did not create a ticket" from "unknown".
  if (savedId) {
    await finalizeContactMessage(savedId, {
      odooTicketId: ticketId,
      isNewCustomer,
      emailDelivered: emailed,
    })
  }

  // Nowhere to read it means the customer must be told, so they can retry.
  if (!savedId && !ticketId) {
    return { success: false, error: 'failed' }
  }

  return { success: true }
}
