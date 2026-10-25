/**
 * Transactional email templates.
 *
 * Two templates are live:
 * - `subscriptionRegisteredEmail` — sent when an admin registers a subscription
 *   manually (manual bank-transfer flow, no Stripe).
 * - `contactMessageEmail` — sent to the team inbox (`CONTACT_INBOX_EMAIL`) when
 *   someone submits the public contact form. The customer's own address is set
 *   as Reply-To so a reply answers them directly.
 *
 * The affiliate/payout templates that used to live here were removed with the
 * affiliate system (2026-09-10) once nothing imported them any more. The
 * `partner_*` DB tables were dropped on 2026-10-22 by migration
 * `20261022_db_cleanup_and_cascade.sql`.
 */

import type { Language } from './translations'

export interface SubscriptionRegisteredEmailData {
  clientName: string
  workspaceName: string
  subscriptionNumber: string | null
  startDate: string
  endDate: string
  months: number
  amount: number
  currency: string
}

const wrap = (lang: Language, body: string) => {
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return `<!doctype html>
<html lang="${lang === 'ar' ? 'ar' : 'en'}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <title>ErpLink</title>
</head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f8fa;color:#0f172a;">
  <table cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;padding:24px;">
    <tr><td><h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;">ErpLink</h2></td></tr>
    <tr><td style="font-size:14px;line-height:1.6;color:#334155;">${body}</td></tr>
  </table>
  <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px;">ErpLink</p>
</body>
</html>`
}

const arBr = '<br/>'
const arStrong = (s: string) => `<strong style="color:#0f172a;">${s}</strong>`

/**
 * Everything in this template comes from an unauthenticated public form, so it
 * is HTML-escaped before it is interpolated. Without this, a message containing
 * `<img src=...>` would render inside the notification email.
 */
const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

export interface ContactMessageEmailData {
  name: string
  email: string
  phone: string
  company: string
  message: string
  isNewCustomer: boolean
  ticketId?: number | null
}

const contactRow = (label: string, value: string) =>
  `<tr>
    <td style="padding:6px 0;width:120px;font-size:12px;color:#64748b;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;">${value}</td>
  </tr>`

/** Notification sent to the team inbox when someone submits the public contact form. */
export function contactMessageEmail(data: ContactMessageEmailData): {
  subject: string
  html: string
  text: string
} {
  const subject = `رسالة جديدة من نموذج التواصل — ${data.name}`
  const tag = data.isNewCustomer ? 'عميل جديد' : 'مسجل بالفعل على السيستم'
  const ticket = data.ticketId ? `#${data.ticketId}` : '—'

  const body = `
    <p style="margin:0 0 14px 0;">وصلت رسالة من نموذج التواصل في الموقع.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
      ${contactRow('الاسم', esc(data.name))}
      ${contactRow('الشركة', esc(data.company))}
      ${contactRow('البريد', `<a href="mailto:${esc(data.email)}" style="color:#1366ec;text-decoration:none;">${esc(data.email)}</a>`)}
      ${contactRow('الجوال', `<span dir="ltr">${esc(data.phone)}</span>`)}
      ${contactRow('التصنيف', esc(tag))}
      ${contactRow('تذكرة أودوو', esc(ticket))}
    </table>
    <p style="margin:18px 0 6px 0;font-size:12px;color:#64748b;">الرسالة:</p>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#0f172a;background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:14px;">${esc(data.message)}</div>
    <p style="margin:16px 0 0 0;font-size:11px;color:#94a3b8;">الرد على هذه الرسالة يذهب مباشرة إلى بريد العميل.</p>`

  const text = [
    'رسالة جديدة من نموذج التواصل',
    '',
    `الاسم: ${data.name}`,
    `الشركة: ${data.company}`,
    `البريد: ${data.email}`,
    `الجوال: ${data.phone}`,
    `التصنيف: ${tag}`,
    `تذكرة أودوو: ${ticket}`,
    '',
    'الرسالة:',
    data.message,
  ].join('\n')

  return { subject, html: wrap('ar', body), text }
}

export function subscriptionRegisteredEmail(
  data: SubscriptionRegisteredEmailData,
  lang: Language = 'ar',
): { subject: string; html: string; text: string } {
  const amount = `${data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${data.currency}`
  const subject = lang === 'ar'
    ? 'تم تفعيل اشتراكك في ErpLink'
    : 'Your ErpLink subscription is now active'
  const num = data.subscriptionNumber
    ? (lang === 'ar' ? `<br/>رقم الاشتراك: ${arStrong(data.subscriptionNumber)}` : `<br/>Subscription #: ${data.subscriptionNumber}`)
    : ''
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.clientName)},<br/>تم تسجيل اشتراكك في مساحة العمل "${arStrong(data.workspaceName)}".${num}${arBr}الفترة: ${arStrong(data.startDate)} إلى ${arStrong(data.endDate)} (${data.months} شهر)${arBr}المبلغ: ${arStrong(amount)}`
    : `Hi ${data.clientName},<br/>A subscription has been registered for your workspace "${data.workspaceName}".${num}<br/>Period: ${data.startDate} to ${data.endDate} (${data.months} months)${arBr}Amount: ${amount}`
  return {
    subject,
    html: wrap(lang, body),
    text: subject + '\n\n' + data.startDate + ' → ' + data.endDate,
  }
}
