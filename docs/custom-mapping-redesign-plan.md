# خطة إعادة تصميم وتوحيد واجهات ربط الحقول المخصصة (Custom Field Mapping) على طراز أودوو (Odoo-Style)

> **هدف الوثيقة:** توفير خطة هندسية وتصميمية شاملة ومفصلة بالكامل لإعادة تصميم صفحة إدارة الحقول المخصصة (`/app/mapping-center/custom`) وتفاصيل كل خريطة (`/app/mapping-center/custom/[id]`) لتطابق تماماً النمط البصري والوظيفي لصفحات السجلات (Logs) في النظام (`/app/logs` و `/app/logs/[id]`).
> **ملاحظة:** هذه الوثيقة مكتوبة لتكون **مرجعاً مستقلاً بذاته**؛ أي جلسة عمل مستقبلية ستنفذ أي جزء قادم من هذه الخطة لن تحتاج إلى قراءة أي ملف آخر في المشروع سوى هذه الوثيقة وحدها.

---

## أولاً: ما تم إنجازه (الجزء الأول والثاني مكتملان ✅)

1. **إعادة تصميم قائمة الحقول المخصصة (`src/app/(app)/app/mapping-center/custom-mapping-client.tsx`):**
   - تحويل القائمة إلى جدول على طراز أودوو (Borderless Table مع `divide-y divide-border/60` ورأس `bg-muted/50`).
   - إضافة شريط البحث المتقدم (بالاسم، نموذج أودوو، والحدث) ومرشحات المتاجر، اتجاه المزامنة، وعمليات أودوو.
   - تفعيل النقر على الصفوف للانتقال مباشرة إلى صفحة التفاصيل `/app/mapping-center/custom/[id]`.

2. **إنشاء مسار وصفحة التفاصيل (`/app/mapping-center/custom/[id]`):**
   - إنشاء صفحة الخادم `src/app/(app)/app/mapping-center/custom/[id]/page.tsx` مع جلب البيانات عبر `getFieldMappingById` من `src/app/actions/field-mappings.ts`.
   - إنشاء مكون العميل `src/app/(app)/app/mapping-center/custom/[id]/custom-mapping-detail-client.tsx` لعرض الهيكل، إعدادات المطابقة، ثنائيات الحقول المربوطة، وسجل المزامنة المرتبط.

3. **توحيد نموذج الإنشاء والتعديل (`FieldMappingForm` - `src/app/(app)/app/mapping-center/field-mapping-form.tsx`) ✅:**
   - جعل نموذج إضافة وتعديل الحقول متناسقاً تماماً مع بطاقات ونماذج أودوو (أقسام نظيفة بحدود `border-border/70`، حقول إدخال منسقة بدقة، وتسميات واضحة وملاحظات مساعدة).
   - دعم اختيار الحقول، نماذج أودوو، والأحداث بسلاسة عبر القوائم المنسدلة الذكية (`SearchableSelect`).

---

## ثانياً: الأجزاء القادمة (الجزء الثالث: توحيد باقي صفحات "مركز الربط")
1. **الربط القياسي (Standard Mapping - `/app/mapping-center`):**
   - تحويل بطاقات الإعدادات الحالية إلى هيكل يماثل سجلات أودوو.
2. **ربط التصنيفات (Categories Mapping - `/app/mapping-center/categories`):**
   - تحويل جدول ربط التصنيفات ليكون بنظام الصفوف غير المحددة (Borderless Table) مع خلفية الرأس الموحدة.
3. **إضافة حقل جديد (Add New Field - `/app/mapping-center/add-field`):**
   - إعادة تنسيق النموذج (Form) ليكون بطاقة مركزية نظيفة مع العناوين الفرعية الصغيرة.

---

## ثالثاً: دليل الألوان والـ Tailwind Classes المرجعي (Cheat Sheet)

- **خلفية الجدول / السجل:** `bg-card`
- **لون الحدود:** `border-border/70` أو `divide-border/60`
- **خلفية رأس الجدول / شريط الأدوات:** `bg-muted/50` أو `bg-muted`
- **نصوص الرؤوس (Headers):** `text-[11px] font-bold text-muted-foreground uppercase tracking-wider`
- **نصوص البيانات الأساسية:** `text-xs text-foreground`
- **نصوص البيانات التقنية / IDs:** `font-mono text-xs`
- **التسميات الفرعية (Labels):** `text-[10px] font-semibold uppercase tracking-wider text-muted-foreground`
- **تأثير المرور (Hover):** `hover:bg-muted/50 cursor-pointer transition-colors`
