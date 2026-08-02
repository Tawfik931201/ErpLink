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

const wrap = (lang: Language, body: string) => {
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  return `<!doctype html>
<html lang="${lang === 'ar' ? 'ar' : 'en'}" dir="${dir}">
<head>
  <meta charset="utf-8" />
  <title>ZidLink Partners</title>
</head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f8fa;color:#0f172a;">
  <table cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;padding:24px;">
    <tr><td><h2 style="margin:0 0 12px 0;font-size:20px;font-weight:800;">ZidLink Partners</h2></td></tr>
    <tr><td style="font-size:14px;line-height:1.6;color:#334155;">${body}</td></tr>
  </table>
  <p style="text-align:center;font-size:11px;color:#94a3b8;margin-top:16px;">ZidLink · Powered by Partners Program</p>
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
  const subject = lang === 'ar' ? 'تم استلام طلب الشراكة' : 'Partner application received'
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.partnerName)},<br/>تم استلام طلبك للانضمام لبرنامج الشركاء. سيقوم فريق الإدارة بمراجعته خلال أيام وسيصلك إشعار فور البت في طلبك.`
    : `Hi ${data.partnerName},<br/>We received your application to the partners program. The admin team will review it shortly and we will notify you once a decision is made.`
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
  const subject = lang === 'ar' ? 'تمت الموافقة على طلب الشراكة 🎉' : 'Your partner application was approved'
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.partnerName)},<br/>تمت الموافقة على طلبك في برنامج الشركاء.${arBr}الاسم الظاهر: ${arStrong(data.displayName)}${arBr}الطبقة: ${arStrong(data.tier)}${arBr}نسبة العمولة: ${arStrong(`${Math.round(data.commissionRate * 100)}%`)}${arBr}الآن يمكنك الدخول للوحة الشراكة وبدء إضافة عملائك.`
    : `Hi ${data.partnerName},<br/>Your partner application has been approved.<br/>Display name: ${data.displayName}<br/>Tier: ${data.tier}<br/>Commission rate: ${Math.round(data.commissionRate * 100)}%<br/>Open your partner dashboard to start adding clients.`
  const cta = lang === 'ar'
    ? arCta(data.dashboardUrl, 'فتح لوحة الشريك')
    : arCta(data.dashboardUrl, 'Open Partner Dashboard')
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
  const subject = lang === 'ar' ? 'بخصوص طلب الشراكة' : 'Regarding your partner application'
  const reason = data.reason
    ? (lang === 'ar' ? `<br/>السبب: ${arStrong(data.reason)}` : `<br/>Reason: ${data.reason}`)
    : ''
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.partnerName)},<br/>للأسف لم يتم قبول طلبك للانضمام لبرنامج الشركاء حالياً.${reason}<br/>يمكنك تقديم طلب جديد لاحقاً.`
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
    ? `${data.partnerName} أضافك كعميل في ZidLink — فعّل حسابك`
    : `${data.partnerName} added you as a ZidLink client — activate your account`
  const body = lang === 'ar'
    ? `مرحباً ${arStrong(data.clientName)},<br/>${arStrong(data.partnerName)} دعاك لبيئة عمل ZidLink باسم "${arStrong(data.workspaceName)}".<br/>اضغط الزر أدناه لتعيين كلمة المرور وبدء الاستخدام.`
    : `Hi ${data.clientName},<br/>${data.partnerName} invited you to a ZidLink workspace named "${data.workspaceName}".<br/>Click the button below to set your password and start using ZidLink.`
  const cta = lang === 'ar' ? arCta(data.activationUrl, 'فعّل حسابك') : arCta(data.activationUrl, 'Activate Your Account')
  return {
    subject,
    html: wrap(lang, body + cta),
    text: subject + '\n\n' + data.activationUrl,
  }
}
