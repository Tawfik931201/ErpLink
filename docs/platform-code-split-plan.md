# خطة فصل الكود حسب المنصة — لم تُبدأ بعد

> الحالة: **مخطط فقط**. لم يُنفّذ أي تقسيم.
> التاريخ: 2026-09-29
> مرجع السياق: `AGENTS.md` → قسم "Safe Cleanup (2026-09-29)"

## 0) القرار المتفق عليه مع المستخدم

- المطلوب فصل **الكود والملفات** لكل منصة، وليس تغيير الواجهة.
- صفحة الربط الموحّدة `/app/connect-store` تبقى كما هي — لا تُلمس.
- Odoo و ERPNext يُعاملان كـ"عائلة ERP" واحدة لأنهما يمران بنفس الكود.
- **لا نبدأ التقسيم قبل وجود اختبارات.** حالياً صفر اختبارات.

## 1) الوضع الحالي (الأرقام الحقيقية)

| الملف | السطور | المشكلة |
|---|---:|---|
| `src/lib/sync-engine.ts` | 7,365 | محرك المزامنة الكامل، كل المنصات فيه |
| `src/app/(app)/app/mapping-center/field-mapping-client.tsx` | 5,233 | UI المطابقة، كل المنصات فيه |
| `src/app/(app)/app/mapping-center/field-mapping-form.tsx` | 2,928 | منطق المطابقة، كل المنصات فيه |
| `src/lib/mapping-constants.ts` | 1,205 | ثوابت كل المنصات في ملف واحد |
| `src/app/api/webhooks/odoo/route.ts` | 1,068 | مسار Odoo/ERPNext |

### ما هو منفصل أصلاً (لا نلمسه)

طبقة العملاء (API clients) مفصولة بالفعل — نحو 70% من العمل منجز:

```
src/lib/zid-client.ts          src/lib/salla-client.ts
src/lib/shopify-client.ts      src/lib/odoo-client.ts
src/lib/erpnext-engine.ts
src/lib/zid/{auth,config,token,types,webhooks}.ts   ← 817 سطر، منفصل
```

**الخبر الجيد:** المشكلة ليست في عملاء الـ API، بل في **طبقة التنسيق**
(الملفات التي تقرر أي منصة تُعامل وكيف).

## 2) المشاكل الحقيقية (مرقّمة بالأرقام)

### أ) تكرار منطق "حقل المعرّف" في 6 أماكن داخل `sync-engine.ts`

نفس الفكرة مكررة بشكل حرفي: لكل منصة حقل ببادئة `x_` (حديث) وآخر
بدون بادئة (قديم)، ويُبحث عن الأحدث أولاً.

| السطر | الدالة | الشكل |
|---:|---|---|
| 461–474 | `resolveSingleRelationId` | `if/else if` × 3 منصات |
| 663–667 | نفس الدالة (مسار الإنشاء) | `if/else if` × 3 منصات |
| 4573–4578 | `persistPlatformIdOnRecord` | ternary متداخل |
| 5135–5143 | `syncAsVariants` | ternary × 2 |
| 6674–6676 | `executeOdooOperation` | ternary يُرجع مصفوفة |
| 7199–7201 | `findExistingOdooRecord` | ternary |

**الخطر:** لو أضفنا منصة جديدة (Shopify Plus مثلاً) ننسخ 6 كتل وننسى واحدة.
لاحظ أيضاً السطر 7008–7040: منطق مطابقة `x_zid_id` مكتوب يدوياً ويسبق
التوحيد المقترح — أي سلوك تاريخي محفوظ، **لا يُمس**.

### ب) دوال Zid مختلطة داخل المحرك المشترك

هذه الدوال **منطق خالص (pure)** وتخص زد فقط، لكنها تعيش في وسط
`sync-engine.ts`:

| الدالة | السطر | ما تفعله |
|---|---:|---|
| `resolveZidShippingCost` | 885 | تكلفة الشحن من حمولة زد |
| `resolveZidCodAmount` | 937 | مبلغ الدفع عند الاستلام |
| `isSaudiShippingAddress` | 1,090 | هل العنوان سعودي (للتوصيل/الضريبة) |
| `resolveZidStatus` | 2,550 | تحويل حالة زد → حالة Odoo |

**ملاحظة مهمة:** `isSaudiShippingAddress` و`resolveZidStatus` مُصدّرة
(`export`) — قد تكون مستخدمة خارجياً، يجب `grep` قبل نقلها.

## 3) الخطة — 4 مراحل، كل مرحلة commit مستقل

### المرحلة 0 — الاختبارات أولاً (✅ اكتملت 2026-09-29)

بلا اختبارات، التقسيم = تغيير كود إنتاجي بدون شبكة أمان.

> **تم التنفيذ.** `jest.config.js` عبر `next/jest`، و`tests/mocks/supabase.ts`
> يمنع أي اتصال بقاعدة بيانات، و`npm test` أصبح job حاجباً في CI.
> 65 اختباراً في 4 ملفات تغطي بالضبط الدوال التي تنقلها المراحل التالية:
> `tests/unit/zid-order-helpers.test.ts` (المرحلة 2)،
> `tests/unit/sync-queue-dedup.test.ts`، `tests/unit/subscription-dates.test.ts`،
> `tests/unit/odoo-operation-routing.test.ts` (المرحلة 1).
>
> تغطية خط واحد (statements) ~4% من 63k سطر — متوقع، والمهم هو تثبيت
> الدوال الحرجة لا النسبة. الخطط التالية أصبحت آمنة للبدء.

### المرحلة 1 — توحيد `PLATFORM_ID_FIELDS` (صغير الأثر، بلا واجهة)

أنشئ ملفاً واحداً:

```
src/lib/platform-fields.ts
```

```ts
export const PLATFORM_ID_FIELDS = {
  zid:     { current: 'x_zid_id',     legacy: 'zid_id' },
  salla:   { current: 'x_salla_id',   legacy: 'salla_id' },
  shopify: { current: 'x_shopify_id', legacy: 'shopify_id' },
} as const

export function platformIdFields(platform: 'zid' | 'salla' | 'shopify') { ... }
export function pickExistingIdField(
  fields: Set<string>, platform: 'zid' | 'salla' | 'shopify'
): string | undefined   // يعيد current إن وُجد، وإلا legacy
```

ثم استبدل الست كتل. النتيجة: `sync-engine.ts` يفقد ~35 سطراً، وتصبح
إضافة منصة جديدة = سطر واحد في الجدول.

⚠️ **شرط سلوك صارم:** `pickExistingIdField` يجب أن يحترم نفس ترتيب
الأولوية الحالي (`current` قبل `legacy`) في كل موضع. الفروقات بين المواضع
الستة مقصودة أحياناً (مثل 7008–7040) — **لا توحّدها بلا قراءة كل موضع**.

### المرحلة 2 — نقل دوال Zid إلى `src/lib/zid/`

```
src/lib/zid/order-helpers.ts   ← جديد، إنشاؤه هنا
  ├─ resolveZidShippingCost
  ├─ resolveZidCodAmount
  ├─ isSaudiShippingAddress
  └─ resolveZidStatus
```

مناسبة لأن `src/lib/zid/` فيه 5 ملفات منظّمة أصلاً.
`sync-engine.ts` يستوردها. المكسب: منطق الشحن/الضريبة/الحالة لزد في مكان
واحد، واختبارات المرحلة 0 تحميه قبل النقل.

### المرحلة 3 — فصل الثوابت (بسيط، ميكانيكي)

```
src/lib/platforms/zid/fields.ts       ← ZID_EVENTS, ZID_FIELDS
src/lib/platforms/salla/fields.ts     ← SALLA_EVENTS, SALLA_FIELDS
src/lib/platforms/shopify/fields.ts   ← SHOPIFY_EVENTS, SHOPIFY_FIELDS
```

`mapping-constants.ts` يصبح barrel يُعيد التصدير فقط، فلا يتغير أي
`import` في المشروع. ⚠️ راجع `src/lib/shopify-topics.ts` — يذكّر أن
مواضيع Shopify مكررة في 4 أماكن؛ وحّدها في نفس المرحلة.

### المرحلة 4 — UI المطابقة (الأخطر، اتركها لآخر)

`field-mapping-client.tsx` (5,233) + `field-mapping-form.tsx` (2,928)
يخلطان Odoo + Zid + Salla + Shopify في نفس المكوّن.

**لا تُقسَّم بالنسخ واللصق.** الخطة الصحيحة: مكوّن مشترك واحد
(`FieldMappingPanel`) يستقبل `fields` و`labels` من
`platforms/<platform>/mapping.ts`، ويبقى شكل الواجهة كما هو تماماً.

هذه المرحلة تحتاج أكبر تغطية اختبارات لأنها تمس UX مباشرة.

## 4) ما لا نلمسه

- `src/lib/sync-engine.ts` **كبير طبيعياً وليس مكرراً** — تحقّق 2026-09-29 ولم
  يُوجد فيه بلوكات منسوخة. لا تُقسَّمه كـ"تنظيف".
- `src/lib/zid-client.ts` وما شابه — منفصلة وسليمة، لا تحرّكها.
- منطق `dedup_key` في مسارات الـ webhook — دقيق وحسّاس؛ تعديله هو سبب
  فقدان تحديثات الزد二代 فما بعد بصمت. لا يُلمس.

## 5) معيار النجاح

- [ ] `npm run type-check` يمر (0)
- [ ] `npm run lint` يمر (0) — **كان 50 قبل 2026-09-29، فليس اختيارياً**
- [ ] `npm run build` يمر
- [ ] الاختبارات الجديدة تغطي كل دالة تُنقل
- [ ] لا تغيير في `dedup_key` ولا في دوال الفوترة
- [ ] صفر تغيير في السلوك المرصود: نفس الحمولات، نفس الطابور، نفس السجلات

## 6) ترتيب العمل المقترح للـ PR

```
PR-1: jest setup + اختبارات نقية (المرحلة 0)
PR-2: platform-fields.ts (المرحلة 1)
PR-3: zid/order-helpers.ts (المرحلة 2)
PR-4: platforms/*/fields.ts (المرحلة 3)
PR-5: UI mapping panels (المرحلة 4)  ← يحتاج مراجعة بشرية
```
