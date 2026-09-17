# سجل التغييرات — History 001

> ماذا تم، متى، ولماذا. الأحدث أولاً.

## 2026-09-10 — تنفيذ شامل: إلغاء أفلييت + دفع يدوي + P0/P1 + دمج spec-kit

- **ماذا (4 وكلاء متوازيين):**
  1. أفلييت: حذف `getActiveAffiliates`/`detectAffiliateForClient`/العمولات التلقائية من `subscription-actions.ts`، حذف منتقي الأفلييت من `AdminSubscriptionsClient`/`ClientStatementClient`، حذف مفاتيح `partners.*` من `translations.ts`، توجيه البانر للدعم، حذف ملفات `partner*/affiliate*/commission*/payout*`، إعادة كتابة `AGENTS.md` (دفع يدوي فقط).
  2. P0: تبسيط IA لـ 5 أقسام في `dashboard/layout.tsx`، طيّ جداول 32-48 Checkbox + presets (أساسي/الكل) في `connect-store`، زر واحد "اختبر واحفظ" + اسم تلقائي في `odoo-form`، `onboarding/page.tsx` redirect لـ `setup`، شارة صحة في `SetupWizard`.
  3. P1/P2: شوبيفاي — `SHOPIFY_API_VERSION` موحد + معالجة 429 + `SHOPIFY_TOPIC_CATALOG` + GDPR الثلاثة + `scopes_update` + toggle=webhook حقيقي + زر مزامنة الاشتراكات؛ سلة — scopes موسعة + merchant مرن + 200 سريع + idempotency + `app.uninstalled` + mutex للـrefresh؛ زد — stubs للمرتجعات + `delivery/payment-methods` للخرائط + صحة webhooks + مفتاح مخزون ⇄.
  4. دمج: قسم spec-kit في `AGENTS.md`، تصحيح `constitution.md` (setInterval لا Bull، SendGrid لا Resend)، تعليم `STRIPE_*/REDIS_URL` كـ legacy في `.env.example`.
- **لماذا:** قرار المستخدم (إلغاء أفلييت، دفع يدوي) + هدف "اربط في 3 دقائق" مع أقصى استفادة من زد/سلة/شوبيفاي.
- **التحقق:** `npm run type-check` أخضر، `npm run lint` تحذيرات فقط (موجودة مسبقاً). الجداول `partner_*` بقيت في DB للتنظيف لاحقاً.
- **متبقٍ:** إزالة الاعتماديات الميتة من `package.json` (تتطلب `npm install`)، migration تنظيف `partner_*`، نشر عام في متاجر المنصات.

## 2026-09-10 — تركيب spec-kit الخفيف (التوثيق فقط)

- **ماذا:** إضافة هيكل `.specify/` + `specs/001-simplify-and-integrate/` + `.github/prompts/`
  وتحديث `AGENTS.md` — ملفات `md`/`yml` فقط، بدون أي تغيير كودي.
- **لماذا:** تمكين أي AI من فهم التطبيق وتاريخه بسرعة دون إعادة تهيئة مشروع Next.js القائم
  (متوافق مع https://github.com/github/spec-kit — الهيكل فقط، لا CLI).
- **التحقق:** قراءة `AGENTS.md` + `package.json` + شجرة `src/` قبل الكتابة؛ لا كسر لـ `type-check`.

## 2026-09-10 — اكتشاف فجوة توثيق الأفلييت (من الاستكشاف المباشر للشجرة)

- **ماذا:** `AGENTS.md` يصف نظام أفلييت كاملاً (`partners.ts`، `partner-actions.ts`،
  `partner-admin.ts`، `affiliate-actions.ts`، مسارات `/partners` و `/partner/*`)،
  لكن البحث في `src/` أثبت **عدم وجود أي ملف** `partner*`/`affiliate*`/`payout*`/`commission*`
  على القرص باستثناء الاشتراكات (`subscription-actions.ts` + `components/subscription/`)،
  و`git status` يُظهر هذه الحذوفات **كتغييرات غير مُثبتة (uncommitted)** —
  أي أن FR-1 قيد التنفيذ فعلياً دون توثيق.
- **لماذا:** توثيق الواقع بدل الوهم — البنود FR-1/T01-T03 تُغلق هذه الفجوة رسمياً.
- **الأثر:** `architecture.md` يعتمد واقع القرص؛ قسم الأفلييت في `AGENTS.md` موسوم تاريخياً.
- **أعمال موازية مرصودة (غير مُثبتة أيضاً):** مجلد `dashboard/setup/` (معالج؟)،
  `src/lib/shopify-topics.ts` (GDPR؟)، migration `20260909_platform_token_tables.sql` —
  تُوثَّق كاملة عند تثبيتها.

## الأساس — تقارير الاستكشاف الخمسة (قبل 2026-09-10)

> نقطة البداية التاريخية لهذه المواصفة كما وردت من مالك المشروع:

1. **تقرير استكشاف 1 — الجرد العام:** بنية Next.js 14 + Supabase + Clerk + Odoo + Zid/Salla/Shopify،
   وخريطة أولية للمجلدات.
2. **تقرير استكشاف 2 — المصادقة والصلاحيات:** Clerk + `ADMIN_USER_IDS` + `requireAdmin`.
3. **تقرير استكشاف 3 — الاشتراكات والدفع اليدوي:** دورة التسجيل/التمديد/الإلغاء و`end_date` مصدر الحقيقة.
4. **تقرير استكشاف 4 — التكاملات:** OAuth والـ webhooks للمنصات الثلاث + طابور المزامنة (Bull/Redis).
5. **تقرير استكشاف 5 — قرار التبسيط:** إلغاء الأفلييت، IA من 9→5، معالج 3 خطوات،
   ومتطلبات GDPR/scopes/المرتجعات — وهو ما تُشرعنه هذه المواصفة (FR-1…FR-5).

> ملاحظة أمانة: نصوص التقارير الخمسة الأصلية غير مضمّنة في المستودع؛
> يُنصح بإضافتها لاحقاً تحت `specs/001-simplify-and-integrate/discovery/` عند توفرها.
