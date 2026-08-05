import type { Language } from './translations'

export interface PartnerApplicationEmailData {
  partnerName: string
  reviewUrl: string
}

export interface PartnerApprovedEmailData {
  partnerName: string
  displayName: string
  tier: string
  commissionRate: number
  dashboardUrl: string
}

export interface PartnerRejectedEmailData {
  partnerName: string
  reason?: string
}

export interface ClientActivationEmailData {
  clientName: string
  email: string
  partnerName: string
  activationUrl: string
  workspaceName: string
}

export interface PayoutStatusEmailData {
  partnerName: string
  action: 'approved' | 'paid' | 'rejected'
  amount: number
  currency: string
  paymentReference?: string | null
  note?: string | null
  payoutsUrl: string
}

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
  <title>ErpLink Affiliates</title>
</head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f8fa;color:#0f172a;">
  <table cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;padding:24px;">
    <tr><td><h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;">ErpLink Affiliates</h2></td></tr>
    <tr><td style="font-size:14px;line-height:1.6;color:#334155;">${body}</td></tr>
  </table>
  <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px;">ErpLink · Powered by Affiliate Program</p>
</body>
</html>`
}

const arCta = (url: string, label: string) =>
  `<p style="margin:20px 0 0 0;">
     <a href="${url}" style="display:inline-block;background:#0066ff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;font-size:13px;">${label}</a>
   </p>`
const arBr = '<br/>'
const arStrong = (s: string) => `<strong style="color:#0f172a;">${s}</strong>`

export function partnerApplicationEmail(
  data: PartnerApplicationEmailData,
  lang: Language = 'ar',
): { subject: string; html: string; text: string } {
  const subject = lang === 'ar' ? 'تم استلام طلب الأفلييت' : 'Affiliate application received'
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.partnerName)},<br/>تم استلام طلبك للانضمام لبرنامج الأفلييت. سيقوم فريق الإدارة بمراجعته خلال أيام وسيصلك إشعار فور البت في طلبك.`
    : `Hi ${data.partnerName},<br/>We received your application to the affiliate program. The admin team will review it shortly and we will notify you once a decision is made.`
  const reviewLine = lang === 'ar'
    ? `<p style="margin:8px 0 0 0;color:#64748b;font-size:12px;">صفحة المراجعة: <a href="${data.reviewUrl}" style="color:#0066ff;">${data.reviewUrl}</a></p>`
    : `<p style="margin:8px 0 0 0;color:#64748b;font-size:12px;">Review page: <a href="${data.reviewUrl}" style="color:#0066ff;">${data.reviewUrl}</a></p>`
  return {
    subject,
    html: wrap(lang, body + reviewLine),
    text: subject + '\n\n' + (lang === 'ar' ? 'تم استلام طلبك.' : 'We received your application.'),
  }
}

export function partnerApprovedEmail(
  data: PartnerApprovedEmailData,
  lang: Language = 'ar',
): { subject: string; html: string; text: string } {
  const subject = lang === 'ar' ? 'تمت الموافقة على طلب الأفلييت 🎉' : 'Your affiliate application was approved'
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.partnerName)},<br/>تمت الموافقة على طلبك في برنامج الأفلييت.${arBr}الاسم الظاهر: ${arStrong(data.displayName)}${arBr}الطبقة: ${arStrong(data.tier)}${arBr}نسبة العمولة: ${arStrong(`${Math.round(data.commissionRate * 100)}%`)}${arBr}الآن يمكنك الدخول للوحة الأفلييت وبدء إضافة عملائك.`
    : `Hi ${data.partnerName},<br/>Your affiliate application has been approved.<br/>Display name: ${data.displayName}<br/>Tier: ${data.tier}<br/>Commission rate: ${Math.round(data.commissionRate * 100)}%<br/>Open your affiliate dashboard to start adding clients.`
  const cta = lang === 'ar'
    ? arCta(data.dashboardUrl, 'فتح لوحة الأفلييت')
    : arCta(data.dashboardUrl, 'Open Affiliate Dashboard')
  return {
    subject,
    html: wrap(lang, body + cta),
    text: subject + '\n\n' + data.dashboardUrl,
  }
}

export function partnerRejectedEmail(
  data: PartnerRejectedEmailData,
  lang: Language = 'ar',
): { subject: string; html: string; text: string } {
  const subject = lang === 'ar' ? 'بخصوص طلب الأفلييت' : 'Regarding your affiliate application'
  const reason = data.reason
    ? (lang === 'ar' ? `<br/>السبب: ${arStrong(data.reason)}` : `<br/>Reason: ${data.reason}`)
    : ''
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.partnerName)},<br/>للأسف لم يتم قبول طلبك للانضمام لبرنامج الأفلييت حالياً.${reason}<br/>يمكنك تقديم طلب جديد لاحقاً.`
    : `Hi ${data.partnerName},<br/>Unfortunately your application was not approved at this time.${reason}<br/>You may apply again later.`
  return {
    subject,
    html: wrap(lang, body),
    text: subject,
  }
}

export function clientActivationEmail(
  data: ClientActivationEmailData,
  lang: Language = 'ar',
): { subject: string; html: string; text: string } {
  const subject = lang === 'ar'
    ? `${data.partnerName} أضافك كعميل في ErpLink — فعّل حسابك`
    : `${data.partnerName} added you as a ErpLink client — activate your account`
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.clientName)},<br/>${arStrong(data.partnerName)} دعاك لبيئة عمل ErpLink باسم "${arStrong(data.workspaceName)}".<br/>اضغط الزر أدناه لتعيين كلمة المرور وبدء الاستخدام.`
    : `Hi ${data.clientName},<br/>${data.partnerName} invited you to a ErpLink workspace named "${data.workspaceName}".<br/>Click the button below to set your password and start using ErpLink.`
  const cta = lang === 'ar' ? arCta(data.activationUrl, 'فعّل حسابك') : arCta(data.activationUrl, 'Activate Your Account')
  return {
    subject,
    html: wrap(lang, body + cta),
    text: subject + '\n\n' + data.activationUrl,
  }
}

export function payoutStatusEmail(
  data: PayoutStatusEmailData,
  lang: Language = 'ar',
): { subject: string; html: string; text: string } {
  const amount = `${data.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${data.currency}`
  const actionLabel =
    data.action === 'paid'
      ? lang === 'ar' ? 'تم الدفع' : 'Paid'
      : data.action === 'approved'
        ? lang === 'ar' ? 'تم الاعتماد' : 'Approved'
        : lang === 'ar' ? 'تم الرفض' : 'Rejected'

  const subject = lang === 'ar'
    ? `${actionLabel} — طلب صرف بمبلغ ${amount}`
    : `${actionLabel} — payout of ${amount}`

  let body: string
  if (data.action === 'paid') {
    body = lang === 'ar'
      ? `مرحباً ${arStrong(data.partnerName)},<br/>تم دفع طلب الصرف الخاص بك بمبلغ ${arStrong(amount)}.${data.paymentReference ? `<br/>مرجع الدفع: ${arStrong(data.paymentReference)}` : ''}${data.note ? `<br/>ملاحظة: ${arStrong(data.note)}` : ''}`
      : `Hi ${data.partnerName},<br/>Your payout of ${amount} has been paid.${data.paymentReference ? `<br/>Payment reference: ${data.paymentReference}` : ''}${data.note ? `<br/>Note: ${data.note}` : ''}`
  } else if (data.action === 'approved') {
    body = lang === 'ar'
      ? `مرحباً ${arStrong(data.partnerName)},<br/>تم اعتماد طلب الصرف الخاص بك بمبلغ ${arStrong(amount)} وهو قيد الدفع حالياً.${data.note ? `<br/>ملاحظة: ${arStrong(data.note)}` : ''}`
      : `Hi ${data.partnerName},<br/>Your payout request of ${amount} has been approved and is being processed.${data.note ? `<br/>Note: ${data.note}` : ''}`
  } else {
    body = lang === 'ar'
      ? `مرحباً ${arStrong(data.partnerName)},<br/>للأسف تم رفض طلب الصرف الخاص بك بمبلغ ${arStrong(amount)}.${data.note ? `<br/>السبب: ${arStrong(data.note)}` : ''}`
      : `Hi ${data.partnerName},<br/>Unfortunately your payout request of ${amount} was rejected.${data.note ? `<br/>Reason: ${data.note}` : ''}`
  }

  const cta = lang === 'ar'
    ? arCta(data.payoutsUrl, 'عرض طلبات الصرف')
    : arCta(data.payoutsUrl, 'View Payouts')
  return {
    subject,
    html: wrap(lang, body + cta),
    text: subject + '\n\n' + data.payoutsUrl,
  }
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
    : `Hi ${data.clientName},<br/>A subscription has been registered for your workspace "${data.workspaceName}".${num}<br/>Period: ${data.startDate} to ${data.endDate} (${data.months} months)<br/>Amount: ${amount}`
  return {
    subject,
    html: wrap(lang, body),
    text: subject + '\n\n' + data.startDate + ' → ' + data.endDate,
  }
}
