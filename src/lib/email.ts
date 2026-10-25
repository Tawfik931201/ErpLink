import sgMail from '@sendgrid/mail'
import nodemailer from 'nodemailer'

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const EMAIL_FROM = process.env.EMAIL_FROM || 'noreply@erplink.app'
const EMAIL_MOCK_MODE = process.env.EMAIL_MOCK_MODE === 'true'

const SMTP_HOST = process.env.SMTP_HOST
const SMTP_PORT = process.env.SMTP_PORT
const SMTP_USER = process.env.SMTP_USER
const SMTP_PASS = process.env.SMTP_PASS

let configured = false
let smtpTransport: any = null

function ensureConfigured() {
  if (configured) return
  
  if (SENDGRID_API_KEY) {
    sgMail.setApiKey(SENDGRID_API_KEY)
    configured = true
    return
  }
  
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT) === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    })
    configured = true
    return
  }
  
  console.warn('[email] Neither SendGrid nor SMTP env variables are configured')
  if (EMAIL_MOCK_MODE) {
    console.info('[email] EMAIL_MOCK_MODE=true — emails will be logged only (development mode)')
  }
}

export interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
  /**
   * Where a reply should go when it is not `to`. The contact form sets this to
   * the customer's own address, so hitting Reply in the inbox answers them
   * instead of the sending mailbox.
   */
  replyTo?: string
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: boolean; error?: string }> {
  ensureConfigured()
  
  if (SENDGRID_API_KEY) {
    try {
      await sgMail.send({
        to: input.to,
        from: EMAIL_FROM,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      })
      return { ok: true }
    } catch (err: any) {
      console.error('[email] SendGrid send failed:', err?.message || err)
      // Fallback to SMTP if configured
      if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
        console.info('[email] SendGrid failed, trying SMTP fallback...')
      } else {
        return { ok: false, error: err?.message || 'send_failed' }
      }
    }
  }
  
  if (smtpTransport || (SMTP_HOST && SMTP_USER && SMTP_PASS)) {
    if (!smtpTransport) {
      smtpTransport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT || 587),
        secure: Number(SMTP_PORT) === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      })
    }
    try {
      await smtpTransport.sendMail({
        from: EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      })
      return { ok: true }
    } catch (err: any) {
      console.error('[email] SMTP send failed:', err?.message || err)
      return { ok: false, error: err?.message || 'send_failed' }
    }
  }
  
  if (EMAIL_MOCK_MODE) {
    console.info('[email] [MOCK] would send to', input.to, 'subject:', input.subject)
    return { ok: true }
  }

  console.error('[email] Email NOT sent — no SendGrid/SMTP providers configured and EMAIL_MOCK_MODE is not set.')
  return { ok: false, error: 'email_not_configured' }
}
