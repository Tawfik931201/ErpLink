import sgMail from '@sendgrid/mail'

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@zidlink.app'

let configured = false

function ensureConfigured() {
  if (configured) return
  if (!SENDGRID_API_KEY) {
    console.warn('[email] SENDGRID_API_KEY is not set — emails will be logged only')
    return
  }
  sgMail.setApiKey(SENDGRID_API_KEY)
  configured = true
}

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  ensureConfigured()
  if (!SENDGRID_API_KEY) {
    console.info('[email] would send to', input.to, 'subject:', input.subject)
    return { ok: true }
  }
  try {
    await sgMail.send({
      to: input.to,
      from: EMAIL_FROM,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
    return { ok: true }
  } catch (err: any) {
    console.error('[email] send failed:', err?.message || err)
    return { ok: false, error: err?.message || 'send_failed' }
  }
}
