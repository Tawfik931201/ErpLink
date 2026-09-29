/**
 * Transactional email templates.
 *
 * Only one template is live: `subscriptionRegisteredEmail`, sent when an admin
 * registers a subscription manually (manual bank-transfer flow, no Stripe).
 *
 * The affiliate/payout templates that used to live here were removed with the
 * affiliate system (2026-09-10) once nothing imported them any more. The
 * `partner_*` DB tables are still in the database and untouched — a separate
 * cleanup migration will drop them later.
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
