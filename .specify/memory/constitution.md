# دستور المشروع — Project Constitution (erplink)

> مرجع سريع لأي AI يعمل على هذا المشروع. التفاصيل في
> `.specify/memory/architecture.md` و `specs/001-simplify-and-integrate/`.

## 1. البساطة أولاً (Simplicity first)

- أي ميزة جديدة يجب أن تقلل خطوات المستخدم أو تبقيها كما هي — لا نضيف شاشات بلا مبرر.
- الهدف: ربط المتجر في **3 دقائق** عبر معالج من **3 خطوات** فقط.
- تبسيط بنية التنقل IA من 9 أقسام إلى **5 كحد أقصى**.
- عند التعارض بين المرونة والبساطة: البساطة تفوز، والمرونة تذهب للإعدادات المتقدمة.

## 2. الدفع يدوي (Manual payments)

- لا بوابات دفع آلية في هذا الطور. الأدمن يسجّل الاشتراك/التمديد/الإلغاء يدوياً.
- `end_date` هو مصدر الحقيقة لحالة الاشتراك (لا انتهاء تلقائي في الكود).
- أي مبلغ مدفوع يُسجَّل مع العملة وعدد الأشهر ومنشئ العملية (`created_by`) للتدقيق.

## 3. لا أفلييت (No affiliate system)

- نظام الأفلييت/الشركاء **ملغى**: لا `partner_profiles` جديدة، لا عمولات، لا طلبات صرف.
- الوثائق القديمة التي تذكر `partners.ts` / `partner-actions.ts` / `partner-admin.ts` /
  `affiliate-actions.ts` تعتبر **تاريخية** — هذه الملفات غير موجودة في الشجرة الحالية.
- جداول `partner_*` وملف `20260803_affiliate_client_invites.sql` قد تبقى في قواعد قديمة
  لكنها **غير مستخدمة** — لا تبنِ عليها كوداً جديداً ولا تعيد مساراتها المحذوفة
  (`/onboarding/accept`، `/claim-workspace`، `/admin/workspace-links`).

## 4. Supabase service_role للكتابة (DB writes)

- كل الكتابة عبر عميل `supabase` من `@/lib/supabase` (مفتاح service_role) — تجاوز RLS مقصود.
- ملفات `supabase/migrations/*.sql` هي **مصدر الحقيقة** للسكيمـا؛
  `prisma/schema.prisma` للتتبع وتوليد العميل فقط (`prisma generate`).
- أي تغيير سكيمـا = ملف migration جديد، لا تعديل يدوي على قاعدة الإنتاج.

## 5. Clerk للمصادقة (Auth)

- `user_id` هو نصّ Clerk `userId` — لا جدول مستخدمين محلي بديل.
- صلاحيات الأدمن عبر `ADMIN_USER_IDS` (Clerk IDs مفصولة بفواصل) و `isAdmin()` من `@/lib/auth`.
- كل Server Action إدارية محروسة بـ `requireAdmin()`.

## 6. Odoo مالك المخزون والسعر (Odoo owns stock & price)

- Odoo هو مصدر الحقيقة للمخزون والأسعار؛ المنصات (Zid/Salla/Shopify) مرايا.
- المزامنة عبر `sync-engine.ts` + `sync-queue.ts` + `sync-queue-runner.ts`
  (حاليا `setInterval` داخل Webhook — `bull`/`ioredis`/`node-cron` مثبتة لكن غير مستخدمة) — لا كتابة مباشرة متجاوزة للطابور.
- إعدادات الربط (الحقول، التصنيفات، الحالات) لكل مساحة عمل (workspace) على حدة.

## 7. قواعد عمل عامة

- TypeScript صارم: أي تغيير يجب أن يجتاز `npm run type-check` و `npm run lint`.
- كل عملية حساسة تُسجَّل في `audit_logs` عبر `src/lib/audit-logs.ts`.
- الواجهة عربية/إنجليزية عبر `src/lib/translations.ts` — لا نصوص مباشرة بلا ترجمة.
- البريد عبر `src/lib/email.ts` (SendGrid أولاً ثم SMTP ثم mock — `AGENTS.md` كان يذكر Resend خطأً).
