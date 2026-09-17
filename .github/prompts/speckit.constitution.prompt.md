# speckit.constitution — دستور المشروع (اختياري)

> ملف مساعد اختياري مستوحى من spec-kit. الاستخدام: انسخ محتواه كتعليمات نظام
> لأي مساعد AI قبل العمل على erplink.

1. اقرأ `.specify/memory/constitution.md` والتزم بمبادئه السبعة
   (البساطة أولاً، دفع يدوي، لا أفلييت، service_role للكتابة، Clerk، Odoo مالك المخزون).
2. اقرأ `.specify/memory/architecture.md` للخريطة الدقيقة للكود.
3. SQL في `supabase/migrations/` هو مصدر الحقيقة — Prisma للتتبع فقط.
4. لا تكسر `npm run type-check` — عند الشك، غيّر التوثيق فقط واسأل.
5. أي نص واجهة جديد يجب أن يكون ثنائي اللغة (ar/en) عبر `translations.ts`.
