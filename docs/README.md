# توثيق المنصة (Audit Practice Platform Docs)

هذا المجلد يحمل وثائق التصميم المعتمدة لمنصة Ledgerly لإدارة مهام التدقيق الخارجي. الترتيب المقترح للقراءة هو ترتيب الأرقام. هذه الوثائق تسبق أي ربط بيانات حقيقية: أي تنفيذ يخالفها يُعد انحرافًا حتى تُحدَّث الوثيقة أولًا.

## الفهرس

| الوثيقة | الموضوع | متى تُقرأ |
|---|---|---|
| [`01-architecture.md`](01-architecture.md) | مراجعة النسخة الحالية (نتائج الاختبارات والبناء وسجل المشكلات KI-1..6)، البنية ثلاثية الطبقات، قرار المحلي/السحابي، القرارات المعمارية الملزمة ADR-1..9 | أولًا |
| [`02-entity-model.md`](02-entity-model.md) | مواصفات الكيانات: الأساسية التسعة (المكتب، العميل، المهمة، السنة المالية، الحساب، ورقة العمل، الدليل، الاستثناء، المراجعة) + المساندة، مع العلاقات والثوابت ودورات الحياة | ثانيًا |
| [`03-database-design.md`](03-database-design.md) | استراتيجية التخزين (SQLite محلي/PostgreSQL سحابي)، حقول المزامنة، سجل التغييرات، الهجرات، التشفير والنسخ الاحتياطي، خريطة حفظ نتائج المحرك الحالي | ثالثًا |
| [`04-permissions.md`](04-permissions.md) | الأدوار الثمانية، مصفوفة الصلاحيات، قواعد فصل المهام الصارمة، هوية المستخدم في الوضع المحلي، نموذج التنفيذ في طبقة المستودعات | رابعًا |
| [`05-standards-mapping.md`](05-standards-mapping.md) | خريطة معايير ISA على كيانات وبوابات المنصة، والقواعد العبرية المفروضة في الكود، وحدود التصريح المهني | رابعًا (مرجعيًا) |
| [`../db/schema.sql`](../db/schema.sql) | المخطط التنفيذي الملزم (DDL محمول) — مُتحقق منه فعليًا على SQLite (24 جدولًا، قيود CHECK/FK/فهارس فريدة تعمل) | مع 03 |

## الوضع الراهن بعد اعتماد هذا التصميم

- **ما زال كما هو:** محرك `core.mjs` بلا أي تعديل — هو أول وحدة تحليل في المنصة.
- **ما أُضيف:** توثيق التصميم + المخطط المرجعي. لا كود تنفيذي للكيانات بعد.
- **الترتيب التنفيذي القادم (بوابة المرحلة 0 ثم المرحلة 1):**
  1. إغلاق سجل الاعتمادات: KI-5 (تثبيت أمر الاختبار) → KI-1 (مصدر SheetJS) → KI-2 (ترقية pdfjs مع اختبار تراجع) — كل واحدة وحدة مستقلة مختبرة.
  2. طبقة المستودعات + تطبيق `db/schema.sql` محليًا (Migration 0001) + حقول المزامنة القياسية.
  3. الوحدة الأولى للمرحلة 1: «الحفظ والتتبع» وفق خريطة §7 من docs/03 (استيراد عينة → تشغيل مطابقة → إعادة تحميل → بقاء النتائج وسجل التغييرات).

## قواعد تعديل هذه الوثائق

1. أي إضافة كيان أو تغيير قيد: تُعدَّل docs/02 أولًا، ثم `db/schema.sql`، ثم كود التنفيذ — بهذا الترتيب حرفيًا.
2. أي انحراف عن ADR (docs/01 §5) يتطلب ADR جديدًا يعلل التغيير، لا صمتًا.
3. كل وحدة تنفيذية تترك اختباراتها في `tests/` وتُحدث هذه الصفحة بخطوة واحدة في قائمة الترتيب أعلاه.

| [`08-product-scope-and-delivery-roadmap.md`](08-product-scope-and-delivery-roadmap.md) | Agreed extended product scope, staged delivery gates, safety boundaries and acceptance criteria | Before implementation of new modules |
| [`../db/supabase/migrations/20261019131031_brp_extended_audit_suite.sql`](../db/supabase/migrations/202610190003_extended_audit_suite.sql) | Additive database foundation for independence, workpaper versions, analytics, sampling, PBC, billing, quality, AI advisory and firm dashboards | Staging only after migrations 0001 and 0002 |


## Added implementation notes

| [`10-ai-copilot.md`](10-ai-copilot.md) | AI Copilot architecture, privacy minimization, server-side secrets, and mandatory production rollout gates | Before enabling any AI provider call |
