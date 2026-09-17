# بنية التطبيق — Architecture (erplink)

> صورة دقيقة بتاريخ 2026-09-10 بعد قراءة `package.json` وشجرة `src/` و `git status`.
> ملاحظة: قسم الأفلييت في `AGENTS.md` **لا يطابق الشجرة الحالية**:
> ملفات `partner*`/`affiliate*`/`commission*`/`payout*` **محذوفة من القرص كتغييرات
> غير مُثبتة (uncommitted)** — أي أن إلغاء الأفلييت (FR-1) بدأ تنفيذياً ولم يُوثَّق بعد.
> هذه الوثيقة توثّق واقع القرص.

## 1. المكدس (Stack)

| الطبقة | التقنية | الإصدار / الملاحظة |
|---|---|---|
| Framework | Next.js (App Router) | `^14.2.5` — `src/app/(app)` + `src/app/(public)` |
| UI | React 18 + Tailwind + Radix + shadcn-style | `recharts`, `framer-motion`, `zustand`, `swr`/`react-query` |
| Auth | Clerk | `@clerk/nextjs ^5.2.0` + webhook في `api/webhooks/clerk` |
| DB | Supabase (Postgres REST) | `@supabase/supabase-js ^2.45.0` — عميل service_role للكتابة |
| ORM (تتبّع) | Prisma | `^5.17.0` — `prisma generate` فقط، SQL هو مصدر الحقيقة |
| ERP | Odoo (XML-RPC) | `xmlrpc ^1.3.2` عبر `odoo-client.ts` / `odoo.ts` |
| Stores | Zid / Salla / Shopify | OAuth (`api/auth/*`, `api/*/connect`, `api/*/callback`) + webhooks |
| Queue | `sync-queue.ts` + `sync-queue-runner.ts` (`setInterval` 5s) | `bull`/`ioredis`/`node-cron` مثبتة لكن **غير مستخدمة** — لا `new Queue` في `src` |
| Email | SendGrid ثم SMTP ثم mock | `src/lib/email.ts` + `email-templates.ts` (`subscriptionRegisteredEmail` فقط نشط) |
| i18n | ملف محلي | `src/lib/translations.ts` (ar/en) |
| Jobs | node-cron, Telegram notifier | `telegram-notifier.ts`, `telegram-long-poller.ts` |

## 2. خريطة `src/app/actions` (الواقع — 24 ملفاً)

| الملف | المجال |
|---|---|
| `workspaces.ts`, `workspace-members.ts`, `layout-info.ts` | مساحات العمل والأعضاء |
| `subscription-actions.ts` | الاشتراكات (تسجيل/تمديد/إلغاء يدوي للأدمن) |
| `odoo.ts`, `stock-sync.ts` | ربط Odoo ومزامنة المخزون |
| `field-mappings.ts`, `standard-mapping.ts`, `static-mappings.ts`, `category-mappings.ts`, `order-status-mappings.ts`, `mapping-constants.ts` (في lib) | خرائط الحقول والتصنيفات والحالات |
| `custom-fields.ts`, `custom-fields-erpnext.ts` | الحقول المخصصة |
| `order-dashboard.ts`, `order-bulk-actions.ts`, `order-merge.ts`, `order-timeline.ts` | الطلبات |
| `dashboard.ts`, `sync-logs.ts`, `transfers.ts`, `settings.ts`, `telegram-settings.ts`, `tickets.ts`, `contact.ts`, `signup-intent.ts`, `impersonate.ts` | لوحات وإعدادات ودعم |

> لا توجد ملفات `partners.ts` / `partner-actions.ts` / `partner-admin.ts` /
> `affiliate-actions.ts` — أي إشارة لها في `AGENTS.md` تاريخية.

## 3. خريطة `src/app/api`

- `api/admin/impersonate` — انتحال الأدمن (محروس).
- `api/auth/[...nextauth]` (بقايا)، `api/auth/zid/{authorize,callback}`.
- `api/{salla,shopify,zid}/{connect,callback}` — بدء OAuth وإتمامه.
- `api/sign-up-intent/set` — نية التسجيل قبل إكمال الربط.
- `api/tickets/attachments` — مرفقات التذاكر.
- `api/test-sync` — اختبار المزامنة.
- `api/webhooks/{clerk,odoo,salla,shopify,zid,zid/stream}` — مستقبلات المنصات.

## 4. خريطة `src/lib` (الأساسية)

- `supabase.ts` (عميل service_role) · `auth.ts` (`isAdmin`/`requireAdmin`) · `prisma.ts`
- `odoo-client.ts` · `odoo.ts` · `odoo-webhook.ts` — طبقة Odoo
- `zid-client.ts` · `zid/` · `salla-client.ts` · `shopify-client.ts` — عملاء المنصات
- `sync-engine.ts` · `sync-queue.ts` · `sync-queue-runner.ts` · `webhook-emitter.ts` — المزامنة
- `subscription-utils.ts` — حسابات `end_date`/الحالة · `audit-logs.ts` · `users.ts`
- `email.ts` · `email-templates.ts` · `translations.ts` · `locale.ts` · `crypto.ts`
- `redis.ts` · `telegram-notifier.ts` · `telegram-long-poller.ts` · `utils.ts`
- `field-utils.ts` · `mapping-constants.ts` · `workspace-members-constants.ts`

## 5. المسارات (Routes)

- `(public)`: `contact` · `pricing` · `privacy` · `sign-in` · `sign-up` · `terms`
  (صفحة `/partners` المذكورة في `AGENTS.md` **غير موجودة** — ملغاة مع الأفلييت).
- `(app)`: `admin` (ومنها `admin/subscriptions` + `AdminSubscriptionsClient.tsx`) ·
  `dashboard` · `invoice` · `onboarding`.
- المكوّنات: `components/subscription/` (`SubscriptionStatusCard`, `SubscriptionBanner`).

## 6. قاعدة البيانات — SQL مصدر الحقيقة

- `supabase/migrations/` (~35 ملفاً): خرائط المنتجات والحقول الثابتة، إعدادات المزامنة،
  الأعضاء والصلاحيات، الطلبات (إلغاء/تسليم)، `subscriptions` + `subscription_payments`،
  `platform_token_tables` (20260909)، `affiliate_client_invites` (20260803 — **غير مستخدم**).
- `partner_system` (20260711): جداول `partner_*` — **مهجورة**، لا تبنِ عليها.
- `prisma/schema.prisma`: نموذج تتبّع — قد توجد أعمدة غير مستخدمة؛ SQL هو المرجع.

## 7. أوامر شائعة

```bash
npm run dev          # سيرفر التطوير
npm run type-check   # tsc --noEmit (يجب أن يبقى أخضر — غيّر md/yml فقط هنا)
npm run lint         # next lint
npm run db:generate  # prisma generate
```
