# خطة فصل الكود حسب المنصة

> الحالة: **المرحلة 0 ✅ / المرحلة 1 ✅** — المراحل 2–4 لم تُبدأ.
> التاريخ: آخر تحديث 2026-09-29
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

| السطر | الدالة | الشكل | نُفّذ؟ |
|---:|---|---|---|
| 461–474 | `resolveSingleRelationId` | `if/else if` × 3 منصات | ✅ |
| 663–667 | نفس الدالة (مسار الإنشاء) | `if/else if` × **منصتان فقط** | ❌ لا فرع shopify |
| 4573–4578 | `persistPlatformIdOnRecord` | ternary متداخل | ✅ |
| 5135–5143 | `syncChildVariantAsVariant` | ternary × 2 | ⚠️ أسماء فقط، fallback بالاستثناء |
| 6674–6676 | `executeOdooOperation` | ternary يُرجع مصفوفة | ✅ |
| 7199–7201 | `syncProductBom` | ternary | ✅ |

> ⚠️ صف 663–667 كان موصوفاً في نسخة سابقة من هذه الخطة بأنه "× 3 منصات".
> **تصحيح**: لا يوجد فرع shopify في ذلك الموضع إطلاقاً. التفاصيل في
> المرحلة 1.

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
> **99 اختباراً في 6 ملفات** تغطي الدوال التي تنقلها المراحل التالية:
> `tests/unit/zid-order-helpers.test.ts` (المرحلة 2)،
> `tests/unit/sync-queue-dedup.test.ts`، `tests/unit/subscription-dates.test.ts`،
> `tests/unit/odoo-operation-routing.test.ts`،
> `tests/unit/clerk-authz-guard.test.ts` (حارس أمني)،
> `tests/unit/platform-fields.test.ts` (المرحلة 1).
>
> تغطية خط واحد (statements) ~4% من 63k سطر — متوقع، والمهم هو تثبيت
> الدوال الحرجة لا النسبة. الخطط التالية أصبحت آمنة للبدء.

### المرحلة 1 — توحيد `PLATFORM_ID_FIELDS` (✅ اكتملت 2026-09-29)

أنشئ ملفاً واحداً:

```
src/lib/platform-fields.ts
```

> **تم التنفيذ.** الجدول صار كما هو في الخطة بالضبط، مع واجهة أوسع قليلاً
> لأن قراءة المواضع الفعلياً كشفت ثلاثة عقود مختلفة لا اثنين.
> `tests/unit/platform-fields.test.ts` (23 اختباراً) يثبّت ترتيب الأولوية.

```ts
export const PLATFORM_ID_FIELDS = {
  zid:     { current: 'x_zid_id',     legacy: 'zid_id' },
  salla:   { current: 'x_salla_id',   legacy: 'salla_id' },
  shopify: { current: 'x_shopify_id', legacy: 'shopify_id' },
} as const

export function platformIdField(p)        // current فقط، بلا fallback
export function platformLegacyIdField(p)  // legacy فقط
export function platformIdFieldNames(p)   // [current, legacy]
export function allPlatformIdFieldNames() // الـ6 أسماء بترتيبها الأصلي
export function pickExistingIdField(fields, p) // current إن وُجد وإلا legacy
export function toPlatformKey(s: string | null | undefined) // يضيّق إلى union، والافتراضي zid
```

#### ⚠️ تصحيح جوهري لجدول المرحلة 1 أعلاه

الجدول في القسم 2-أ افترض أن الست كتل متطابقة وقابلة للتوحيد بحرية.
**القراءة الفعلية لكل موضع أثبتت خلاف ذلك**، لأن 3 منها تختلف دلالياً.
هذا بالضبط ما حذّر منه شرط السلوك الصارم أدناه، وقد تم الالتزام به:

| الموضع | الافتراض القديم | الواقع | القرار |
|---:|---|---|---|
| `resolveSingleRelationId` ~468 | 3 منصات × current/legacy | مطابق تماماً | ✅ `pickExistingIdField` |
| `persistPlatformIdOnRecord` ~4567 | ternary متداخل | مطابق تماماً | ✅ `pickExistingIdField` |
| `executeOdooOperation` ~6662 | ternary يُرجع مصفوفة | مطابق تماماً | ✅ `platformIdFieldNames` |
| `syncProductBom` ~7185 | ternary | مطابق تماماً | ✅ `platformIdField` |
| `syncChildVariantAsVariant` ~5129 | ternary × 2 | **الفallback عند الاستثناء لا عند غياب العمود** | ⚠️ أسماء الحقول فقط، `try/catch` كما هو |
| مسار الإنشاء ~658 | "× 3 منصات" | **منصتان فقط — لا يوجد فرع shopify** | ❌ لم يُلمس، مع تعليق تحذيري |

❌ **لم يُوحَّد عمداً** (سلوك تاريخي محفوظ):

- **مسار إنشاء السجل** (`sync-engine.ts`): لا يكتب `x_shopify_id` إطلاقاً.
  توحيده عبر `pickExistingIdField` **سيبدأ كتابة العمود** — تغيير سلوك.
- **`erpnext-engine.ts` (~223, ~289)**: الملف كله Zid/Salla فقط —
  **صفر** ذكر لـ shopify (تحقّق بالـ grep على الملف كله). إضافة فرع
  shopify ستُفعّل مساراً لم يُختبر في ERPNext إطلاقاً.
- **`erpnext-engine.ts` (~479)**: سلسلة `else if` **عابرة للمنصات** — تفحص
  عمود Zid ثم Salla بغضّ النظر عن منصة الحدث. `pickExistingIdField` مربوط
  بمنصة واحدة، فاستخدامه هنا **سيغيّر المطابقات**.
- **`sync-engine.ts` ~7005/~7036**: منطق `matchStrategy` و`x_zid_id`
  اليدوي — كما نصّت الخطة، يسبق التوحيد ولا يُمس.
- **~1888**: أنواع الحقول الافتراضية تخلو `zid_id`/`salla_id` — ليست نفس
  الجدول.
- **`stock-sync-engine.ts`, `category-mappings.ts`**: منطق مطابقة مختلف
  (`x_zid_id_categ`)، خارج نطاق هذا الجدول.

النتيجة: `sync-engine.ts` يفقد ~35 سطراً كما هو متوقع، وإضافة منصة جديدة
صارت **سطراً واحداً في الجدول** لمنطق current/legacy — أما المواضع
المستثناة فتحتاج قراراً منتجياً منفصلاً (هل نضيف فرع shopify لمسار الإنشاء؟).

> المواضع غير الموحّدة تحمل الآن تعليقاً قصيراً عند كل موضع يوضّح
> **سبب** استثنائه، حتى لا "يبسّطه" الشخص التالي إلى تغيير سلوك.

#### شرط السلوك الصارم (مُنفَّذ)

`pickExistingIdField` يحترم نفس ترتيب الأولوية (`current` قبل `legacy`) في
كل موضع. `npm run type-check` / `lint` / `test` (99) / `build` تمرّ جميعها،
و`pickExistingIdField` موقّع بـ `{ has(key: string): boolean }` لا `Set`
لأن `fetchFieldMeta` يُرجع `Map`.

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

### المرحلة 3 — فصل الثوابت (✅ اكتملت 2026-09-29)

```
src/lib/platforms/odoo/fields.ts       ← ODOO_MODELS, ODOO_FIELDS, STORE_VARIANT_FIELDS
src/lib/platforms/zid/fields.ts        ← ZID_EVENTS, ZID_FIELDS, ZID_SUB_FIELDS
src/lib/platforms/salla/fields.ts      ← SALLA_EVENTS, SALLA_FIELDS
src/lib/platforms/shopify/fields.ts    ← SHOPIFY_EVENTS, SHOPIFY_FIELDS
```

`src/lib/mapping-constants.ts` (1,206 → 19 سطراً) صار **barrel** يُعيد التصدير
فقط، فلا يتغيّر أي `import` في المشروع — شرط نصّت عليه الخطة.

> **تم التنفيذ.** الفصل ميكانيكي: قُطعت الكتل من الملف الأصلي سطراً سطراً
> (لا نسخ يدوي)، وتحقّق أن **الـ1,163 سطراً غير الفارغة نُقلت جميعها حرفياً**
> وأن التصديرات العشرة كلها ما زالت مصدّرة. `ODOO_FIELDS` و`STORE_VARIANT_FIELDS`
> في `platforms/odoo/` لأنها تخص Odoo ولا تخص متجراً بعينه.
>
> الكود الجديد يستورد من `@/lib/platforms/<platform>/fields` مباشرة؛ الـbarrel
> موجود للـbackwards compatibility فقط.

#### ❌ مواضيع Shopify: **لم** تُوحَّد (تصحيح لل plan)

الـplan نصّ على توحيد مواضيع Shopify في نفس المرحلة. **هذا مبني على افتراض
خاطئ** — القوائم الثلاث ليست نسخاً من بعضها:

| القائمة | الغرض | الحجم |
|---|---|---:|
| `shopify.app.toml` | ما يشترك فيه التطبيق فعلياً | — |
| `SHOPIFY_CORE_TOPICS` | ما يطلبه التطبيق عند الربط | 5 |
| `SHOPIFY_TOPIC_CATALOG` | الكتالوج الكامل في الإعدادات | ‎~20 |
| `SHOPIFY_EVENTS` (mapping) | جدول مركز المطابقة، فيه `targetModel` لكل حدث | 11 |

`SHOPIFY_EVENTS` يعرض أحداثاً **لا يشترك فيها التطبيق أصلاً**
(`products/delete`, `orders/cancelled`, `collections/*`)، و**لا** يحتوي
`orders/paid` الذي يشترك فيه فعلاً. دمجها يعني تغيير ما يشترك فيه
التطبيق **أو** ما تعرضه واجهة المطابقة — تغيير سلوك، لا تنظيف.
العلاقة موثّقة الآن في ترويسة `src/lib/platforms/shopify/fields.ts`.

### المرحلة 4 — UI المطابقة (الأخطر، اتركها لآخر)

`field-mapping-client.tsx` (5,233) + `field-mapping-form.tsx` (2,928)
يخلطان Odoo + Zid + Salla + Shopify في نفس المكوّن.

**لا تُقسَّم بالنسخ واللصق.** الخطة الصحيحة: مكوّن مشترك واحد
(`FieldMappingPanel`) يستقبل `fields` و`labels` من
`platforms/<platform>/mapping.ts`، ويبقى شكل الواجهة كما هو تماماً.

هذه المرحلة تحتاج أكبر تغطية اختبارات لأنها تمس UX مباشرة.

### المرحلة 4 — UI المطابقة (⏸ قرار مؤجَّل 2026-09-29 — **لا تُبدأ**)

> **قرار المستخدم: أوقف عند المرحلة 3.** المراحل 1–3 أنجزت الهدف، والمرحلة 4
> مخاطرة أعلى من مكسبها.
>
> **سبب إضافي لم تراعِه الخطة أصلاً:** تقدير "الأربع منصات مختلطة بالتساوي"
> **غير صحيح**. القياس الفعلي لعدد الإحالات:
>
> | الملف | zid | salla | shopify | odoo |
> |---|---:|---:|---:|---:|
> | `field-mapping-client.tsx` (5,233) | 65 | 15 | 15 | **152** |
> | `field-mapping-form.tsx` (2,928) | 26 | 29 | 19 | 29 |
>
> `field-mapping-client.tsx` **مهيمن عليه Odoo** (152 مقابل 65/15/15)، وليس
> مزيجاً متساوياً بين أربع منصات. فاستخراج `FieldMappingPanel` بخصائص
> `fields`/`labels` لكل منصة كان سيحاول توحيد شٍّ ليس موزّعاً بالتساوي أصلاً.
>
> والحاجز الثاني: **لا يوجد أي اختبار مكوّنات في المشروع.** الاختبارات الـ99 كلها
> دوال خالصة. تقسيم 8,161 سطراً يلمس الواجهة بلا شبكة أمان، ولا يمكن التحقق منه
> بصرياً من هنا.
>
> **ما تم إنجازه من المنطق:** `field-mapping-client.tsx` صار يستورد الثوابت من
> `platforms/<platform>/fields` مباشرةً بدل التصدير الموحّد، فتوقّف عن سحب
> `ODOO_MODELS`/`ODOO_FIELDS`/`STORE_VARIANT_FIELDS` (0 إحالة فيه).
> `field-mapping-form.tsx` باقٍ على التصدير الموحّد لأنه يستخدمها فعلاً.
>
> **متى يُعاد النظر:** بعد وجود اختبارات مكوّنات (Testing Library) تغطي
> mapping-center. وقبلها: لا تبدأ.

## 4) ما لا نلمسه

- `src/lib/sync-engine.ts` **كبير طبيعياً وليس مكرراً** — تحقّق 2026-09-29 ولم
  يُوجد فيه بلوكات منسوخة. لا تُقسَّمه كـ"تنظيف".
- `src/lib/zid-client.ts` وما شابه — منفصلة وسليمة، لا تحرّكها.
- منطق `dedup_key` في مسارات الـ webhook — دقيق وحسّاس؛ تعديله هو سبب
  فقدان تحديثات الزد الثاني فما بعد بصمت. لا يُلمس.

## 5) معيار النجاح

- [ ] `npm run type-check` يمر (0)
- [ ] `npm run lint` يمر (0) — **كان 50 قبل 2026-09-29، فليس اختيارياً**
- [ ] `npm run build` يمر
- [ ] الاختبارات الجديدة تغطي كل دالة تُنقل
- [ ] لا تغيير في `dedup_key` ولا في دوال الفوترة
- [ ] صفر تغيير في السلوك المرصود: نفس الحمولات، نفس الطابور، نفس السجلات

## 6) ترتيب العمل المقترح للـ PR

```
PR-1: jest setup + اختبارات نقية (المرحلة 0)   ✅
PR-2: platform-fields.ts (المرحلة 1)            ✅
PR-3: zid/order-helpers.ts (المرحلة 2)          ✅
PR-4: platforms/*/fields.ts (المرحلة 3)         ✅
PR-5: UI mapping panels (المرحلة 4)  ⏸ مؤجَّلة بقرار 2026-09-29
```

> المراحل 0–3 منفصلة في أربعة commits على `main` محلياً (لا يوجد push).
> **تنبيه شائع:** من عدّ 8 commits مختلفة — `b085270` (اختبارات)، `0d0c3fa`
> (حارس Clerk)، `c8ca3e5` (إصلاح AVIF)، `fd58a92` (توثيق اختلافات الـingress)،
> `21285b2` (استيرادات per-platform) ليست مراحل من هذه الخطة.
