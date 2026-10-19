# 02 — نموذج الكيانات ومواصفاتها (Entity Model)

> هذه الوثيقة تُعرّف الكيانات الأساسية للمنصة ومساندتها، قبل ربط أي بيانات حقيقية وبناء أي جداول تنفيذية. كل كيان موصوف بـ: الغرض، الحقول، العلاقات، الثوابت (قواعد لا تُخترق)، ودورة الحياة. النسخة التنفيذية من الحقول موجودة في `db/schema.sql` وتلتزم بهذه الوثيقة.

---

## 1. مبادئ النموذج

1. **سلسلة العزل المطلقة:** كل كيان أعمال يحمل `firm_id`، وكل ما يتعلق بعملية تدقيق يحمل أيضًا `engagement_id` (مباشرًا أو عبر كيانه الأب). الاستعلام لا يُنفَّذ أبدًا دون تصفية بهذين المفتاحين حسب النطاق.
2. **جذر التجميع هو المهمة (Engagement):** لا توجد بيانات تدقيق بلا مهمة. الاستيراد، والمطابقة، والاستثناء، وورقة العمل، والدليل، والمراجعة — كلها أبناء المهمة.
3. **قابلية التتبع في الاتجاهين:** من الاستنتاج إلى الدليل إلى البيانات المصدرية، ومن أي سطر بيانات إلى ما نتج عنه من نتائج واستنتاجات.
4. **الإضافة فقط حيثما كان التاريخ مهمًا:** سجل التغييرات والمراجعات لا تُعدّل ولا تُحذف أبدًا؛ الحذف المنطقي (soft delete) هو الوحيد المسموح في الكيانات الأعمال.
5. **لا اعتماد صامت:** كل انتقال من «مقترح آلي» إلى «معتمد» يتطلب فعلًا بشريًا مسجَّلًا بهويته ووقته ومعطياته.

## 2. خريطة العلاقات العامة

```
Firm 1──∞ User 1──∞ RoleAssignment
Firm 1──∞ Client 1──∞ FiscalYear 1──∞ Engagement 1──∞ WorkingPaper
                        │                 │
                        │                 ├──∞ ImportBatch 1──∞ TransactionLine
                        │                 ├──∞ ReconciliationRun 1──∞ Match
                        │                 ├──∞ Exception
                        │                 ├──∞ Risk 1──∞ AuditProcedure 1──∞ Sample
                        │                 ├──∞ Evidence
                        │                 ├──∞ Misstatement
                        │                 └──∞ Review
                        └──∞ ClientAcceptance
CrossLink: ربط أفقي حر بين أي كيائن داخل المهمة الواحدة
ChangeLog: يوثق كل فعل على أي كيان
```

---

## 3. الكيانات الأساسية التسعة (من التوجه المعتمد)

### 3.1 المكتب — `firm`

| البند | المواصفة |
|---|---|
| الغرض | جذر العزل لكل شيء: بيانات، مستخدمون، صلاحيات، مزامنة. لا يوجد «عالم مشترك» بين مكتبين |
| الحقول الأساسية | `id`, `name`, `license_number` (رقم الترخيص المهني), `country` (افتراضي: JO), `timezone`, `default_currency`, `settings_json` (منهجية المكتب: سياسة الأهمية النسبية، نطاقات التفاوت، قوالب البرامج), `status` |
| العلاقات | يملك كل ما عداه؛ المستخدمون أعضاؤه |
| الثوابت | لا يُحذف إطلاقًا (يُؤرشف)؛ `settings_json` لا يُعدّل إلا بدور إداري ويوثق في سجل التغييرات |
| ملاحظة معمارية | حتى في التشغيل المحلي لمكتب واحد يُحفظ `firm_id` على كل صف — كي تعمل المزامنة السحابية والعزل دون إعادة بناء |

### 3.2 العميل — `client`

| البند | المواصفة |
|---|---|
| الغرض | ملف مستقل لكل عميل يفصل بياناته وارتباطه عن أي عميل آخر |
| الحقول الأساسية | `id`, `firm_id`, `name`, `legal_form` (فردية/شراكة/ذ.م.م/مساهمة/غير ربحي), `tax_number`, `industry`, `contact_json`, `status` (active/archived) |
| العلاقات | `fiscal_years`, `acceptance_records`; المهمة تنتمي للعميل عبر سنة مالية |
| الثوابت | الاسم غير فارغ ضمن المكتب الواحد؛ أرشفة العميل تمنع إنشاء مهام جديدة له ولا تحذف تاريخه |
| الربط المهني | ISA 220 (قبول الارتباط) عبر كيان `client_acceptance` |

### 3.3 المهمة — `engagement` (جذر التجميع)

| البند | المواصفة |
|---|---|
| الغرض | «ملف مهمة التدقيق»: الحاوية التي تربط البيانات والمخاطر والإجراءات والأدلة والمراجعات والاستنتاجات |
| الحقول الأساسية | `id`, `firm_id`, `client_id`, `fiscal_year_id`, `engagement_type` (annual_audit/interim/special/other), `partner_id`, `manager_id`, `status`, `engagement_letter_ref`, `materiality_json` (أرقام الأهمية وأسسها — تُملأ في المرحلة 3), `opened_at`, `closed_at` |
| العلاقات | أب لكل كيانات التدقيق (§4) |
| الثوابت | يجب أن يقع `period_start/period_end` للسنة المالية قبل تاريخ فتح المهمة أو ضمنها منطقيًا؛ لا تُنشأ بيانات تدقيق على مهمة `closed`؛ الشريك المسؤول إلزامي قبل الخروج من حالة `planning` |
| دورة الحياة | `planning → fieldwork → review → finalization → closed` (مع `cancelled`) — الانتقالات مسموحة فقط للأمام، وكل انتقال يوثق في سجل التغييرات |
| بوابات دورة الحياة | الخروج من `review` يتطلب مراجعة شريك مسجلة (§3.9)؛ الإغلاق يتطلب خلو سجل الاستثناءات من حالات `open` بلا قرار (resolved/waived موثق) |
| الربط المهني | ISA 220, ISA 230 (ملف المهمة), ISA 700 (بوابة الإصدار) |

### 3.4 السنة المالية — `fiscal_year`

| البند | المواصفة |
|---|---|
| الغرض | تحديد فترة القوائم المالية التي تُنفَّذ عليها المهام |
| الحقول الأساسية | `id`, `firm_id`, `client_id`, `start_date`, `end_date`, `reporting_framework` (IFRS/محلي/آخر), `status` (open/closed) |
| العلاقات | العميل 1—∞ سنة مالية؛ السنة 1—∞ مهمة |
| الثوابت | `start_date < end_date`؛ لا تداخل بين سنتين ماليتين للعميل الواحد؛ إغلاق السنة يمنع استيراد بيانات عليها دون دور إداري وتوثيق |
| ملاحظة | السنة المالية كيان مستقل عن المهمة لأن السنة الواحدة قد تحمل أكثر من مهمة (سنوية + مرحلية + خاصة) |

### 3.5 الحساب — `account`

| البند | المواصفة |
|---|---|
| الغرض | دليل حسابات العميل لكل سنة مالية (يُستورد من ميزان المراجعة في المرحلة 3) ويُستخدم في ربط القوائم وتوجيه أوراق العمل |
| الحقول الأساسية | `id`, `firm_id`, `client_id`, `fiscal_year_id`, `code`, `name`, `name_en`, `type` (asset/liability/equity/revenue/expense), `parent_id`, `is_postable` (حساب قيد مقابل مجموعة), `currency`, `opening_balance_minor`, `closing_balance_minor`, `mapping_code` (رمز الربط بقوائم/بند تقرير) |
| العلاقات | أب-أبناء (شجرة)؛ تُربط به سطور دفتر الأستاذ والتحريفات وأوراق العمل |
| الثوابت | `code` فريد لكل سنة مالية؛ مجموع أبناء المجموعة = رصيدها عند التجميع (تحقق عند الاستيراد)؛ نوع الحساب لا يتغير بعد ربطه بتحريف |
| الربط المهني | ISA 315 (فهم البنود), المرحلة 6 (ربط ميزان المراجعة بالقوائم) |

### 3.6 ورقة العمل — `working_paper`

| البند | المواصفة |
|---|---|
| الغرض | وحدة التوثيق: تربط الإجراء ببياناته وأدلته واستنتاجه ومراجعته |
| الحقول الأساسية | `id`, `firm_id`, `engagement_id`, `reference` (ترقيم هرمي مثل `A-1000-02`), `cycle` (treasury/revenue/purchasing/payroll/inventory/capex/general), `title`, `paper_type` (reconciliation/analytical/sample_test/lead_schedule/support/memo), `preparer_id`, `prepared_at`, `status`, `conclusion`, `conclusion_status` (supported/supported_with_exceptions/insufficient_evidence), `source_refs_json` (مراجع تشغيلات المطابقة/الدفعات/العينات) |
| العلاقات | أبناء المهمة؛ أدلة ومراجعات واستثناءات معلقة بها عبر `cross_link` أو مباشرة |
| الثوابت | `reference` فريد داخل المهمة؛ الانتقال إلى `reviewed` يتطلب استنتاجًا غير فارغ + مراجعة مسجلة (§3.9)؛ لا يُحذف بعد مراجعة — يُستبدل بإصدار جديد برابط «supersedes» |
| دورة الحياة | `draft → in_review → reviewed` (+ `returned` ترجع إلى `draft`) — توقيع المُعِدّ مطلوب قبل المراجعة |
| الربط المهني | ISA 230 (توثيق وتوقيع ومراجعة), ISA 500 (كفاية الدليل المرتبط) |

### 3.7 الدليل — `evidence`

| البند | المواصفة |
|---|---|
| الغرض | كل مستند أو ناتج حاسوبي يُسند عليه استنتاج: ملفات عميل، تأكيدات، لقطات، مذكرات، ونواتج المحرك (تشغيلات مطابقة، تقارير تحليل) |
| الحقول الأساسية | `id`, `firm_id`, `engagement_id`, `working_paper_id` (اختياري قبل الإلحاق), `title`, `evidence_kind` (file/import_batch/match_run/confirmation/memo/screenshot), `file_name`, `file_sha256`, `file_size`, `mime_type`, `storage_path` (محلي) أو `object_key` (سحابي), `source` (client_provided/generated/external), `obtained_at`, `obtained_by`, `supersedes_id`, `retention_until` |
| العلاقات | يُلحق بورقة عمل (أو بالمهمة مباشرة)؛ الاستثناءات والمراجعات تشير إليه |
| الثوابت | **ثابت بعد الإنشاء:** لا تعديل ولا حذف؛ التصحيح = دليل جديد يعلّم السابق `superseded`؛ `file_sha256` إلزامي للنوع `file` ويُتحقق منه عند القراءة (كشف التلاعب) |
| الربط المهني | ISA 500/501 (كفاية وملاءمة الدليل), ISA 505 (التأكيدات الخارجية) |

### 3.8 الاستثناء — `exception`

| البند | المواصفة |
|---|---|
| الغرض | سجل مركزي لكل ما يحتاج قرارًا أو تفسيرًا: فروقات مطابقة، حالات ملتبسة، تكرارات، عمليات معكوسة، رسوم بنكية، فروق عملة، تحذيرات استيراد، نتائج تحليلات |
| الحقول الأساسية | `id`, `firm_id`, `engagement_id`, `kind` (انظر أدناه), `severity` (info/low/medium/high), `source_type` (import/reconciliation/trial_balance/journal_test/analytics), `source_refs_json` (batch_id / run_id / line ids / procedure_id), `title`, `detail`, `detected_at`, `detected_by` (engine/user), `root_cause`, `disposition` (open/under_review/resolved/waived/escalated), `disposition_note`, `disposition_by`, `disposition_at`, `working_paper_id` (اختياري — الاستثناءات تدخل أوراق عمل) |
| أنواع `kind` الأساسية للمرحلة 1 | `unmatched_bank`, `unmatched_ledger`, `ambiguous_candidates`, `amount_difference`, `date_outside_window`, `possible_duplicate`, `possible_reversal`, `bank_fee_pattern`, `fx_difference`, `sign_convention_conflict`, `unparseable_row`, `validation_warning` |
| العلاقات | مصدره دائمًا بيانات مرجعية (سطور/تشغيل/إجراء)؛ قد يولّد إجراءً أو ورقة عمل |
| الثوابت | لا يُنشأ استثناء بلا `source_refs_json` (لا تنبيه بلا بياناته)؛ `disposition` إلزامي غير فارغ قبل إغلاق المهمة؛ كشف الاستثناءات من المحرك **عديم الأثر الجانبي (idempotent)**: إعادة تشغيل المطابقة لا تكرر استثناءات مطابقة لنفس المصادر بمعرفات جديدة |
| الربط المهني | ISA 315 (مؤشرات مخاطر), ISA 330 (نتائج الإجراءات), ISA 450 (تحريفات محتملة تُحوَّل عند ثبوتها) |

### 3.9 المراجعة — `review`

| البند | المواصفة |
|---|---|
| الغرض | توثيق المراجعة والتوقيع على أوراق العمل والاستثناءات والمخرجات، على مستويات هرمية |
| الحقول الأساسية | `id`, `firm_id`, `engagement_id`, `target_type` (working_paper/exception/engagement/report_draft), `target_id`, `level` (preparer_check/senior_review/manager_review/partner_signoff/eqcr), `reviewer_id`, `reviewed_at`, `decision` (approved/approved_with_notes/returned), `findings_json` (قائمة ملاحظات، كل واحدة قابلة للإغلاق), `extent_note` (نطاق المراجعة), `round_no` |
| العلاقات | تشير إلى أي هدف داخل المهمة؛ المراجعة تعلق على الأداة لا تُعدّلها مباشرة (الأداة تستقبل الحالة من محرك دورة الحياة) |
| الثوابت | **مستويات مترتبة:** لا `senior_review` قبل `preparer_check`، ولا `partner_signoff` قبل سابقيه؛ **المراجع ≠ المُعِدّ** (قاعدة فصل مهام صارمة مفروضة على مستوى النظام)؛ المراجعات غير قابلة للتعديل أو الحذف — التعديل = جولة جديدة `round_no+1` |
| الربط المهني | ISA 220 (ضبط الجودة), ISA 230 (توثيق المراجع والتاريخ ونطاق المراجعة), ISA 700 (اعتماد الرأي) |

---

## 4. الكيانات المساندة (تخدم الأساسية وتُنفَّذ مع مراحلها)

### 4.1 `user` و `role_assignment`
عضو فريق المكتب: `id`, `firm_id`, `display_name`, `email`, `auth_kind` (local_pin/cloud), `status`. الإسناد: `user_id`, `role`, `scope_type` (firm/engagement), `scope_id`. القواعد: أدوار متعددة مسموحة؛ لا إسناد ذاتي لدور شريك؛ كل إسناد يوثق. التفاصيل في `docs/04-permissions.md`.

### 4.2 `client_acceptance`
قبول الارتباط واستمراريته والاستقلالية: `client_id`, `decision` (accepted/continued/declined), `independence_check_done`, `notes`, `performed_by`, `performed_at`. قاعدة: لا تُفتح مهمة قبل سجل قبول `accepted/continued` ساري لسنة المهمة. (ISA 220)

### 4.3 `import_batch` (دفعة الاستيراد)
وحدة التتبع لكل ملف/مصدر مستورد: `engagement_id`, `batch_kind` (bank_statement/ledger/trial_balance/supporting), `source_type` (csv/xlsx/pdf/ocr/manual), `file_name`, `file_sha256`, `column_mapping_json`, `parse_warnings_json`, `row_count`, `imported_by/at`. قواعد: تجزئة الملف تُسجل دائمًا؛ إعادة استيراد نفس التجزئة على المهمة نفسها تنشأ دفعة جديدة معلّمة `duplicate_of_id` ولا تُخفي الأولى. (ISA 500 — هوية الدليل المصدر)

### 4.4 `transaction_line` (سطر معاملة موحّد)
سطر بنكي أو أستاذ: `batch_id`, `engagement_id`, `side` (bank/ledger), `line_no` (رقم الصف المصدر), `tx_date`, `value_date`, `description_raw`, `description_norm`, `debit_minor`, `credit_minor`, `signed_amount_minor`, `balance_minor`, `currency`, `account_id` (للأستاذ — يُلأ بعد المرحلة 3), `raw_json` (السطر الأصلي كما استورد). قواعد: `raw_json` لا يُعدّل — النص الأصلي هو المرجع عند النزاع؛ `signed_amount_minor = credit − debit` بقاعدة الإشارة الموثقة للمحرك.

### 4.5 `reconciliation_run` (تشغيل مطابقة)
تنفيذ غير قابل للتغيير: `bank_batch_id`, `ledger_batch_id`, `params_json` (`amount_tolerance_minor`, `date_window_days`, قاعدة الإشارة), `result_summary_json`, `run_at`, `run_by`. قاعدة: لا تُحدَّث نتائج تشغيل سابق — التغيير يعني تشغيلًا جديدًا؛ لهذا كل مقارنة تاريخية بين تشغيلين ممكنة وموثقة. (ISA 230)

### 4.6 `match` (مطابقة)
`run_id`, `bank_line_id`, `ledger_line_id`, `match_basis` (exact/amount_date/manual), `status` (suggested/approved/rejected), `amount_diff_minor`, `date_diff_days`, `decided_by/at`, `note`. قواعد: المطابقة المولّدة آليًا تبدأ `suggested` ولا تنتقل `approved` إلا بقرار مسجَّل؛ السطر الواحد لا يدخل أكثر من مطابقة `approved` واحدة؛ المطابقة اليدوية `manual` تسمح فقط إن لم يكن أي من السطرين في مطابقة معتمدة، وتُعلَّم دائمًا للمراجعة. (ADR-4)

### 4.7 `cross_link` (ربط أفقي)
شبكة الارتباطات التي تجعل الأوراق «مترابطة»: `from_type/from_id`, `to_type/to_id`, `relation` (supports/contradicts/explains/supersedes/generates), `created_by/at`. قاعدة: الربط داخل `engagement_id` الواحد فقط (يُتحقق من انتماء الطرفين).

### 4.8 `risk` و `audit_procedure` و `sample` (المرحلتان 3–4)
- **الخطر:** `assertion_scope` (fs_level/assertion), `description`, `category` (fraud/error), `likelihood`, `impact`, `inherent_risk`, `assessed_by/at`. بوابة قبول المرحلة 3: كل خطر جوهري له إجراء واحد على الأقل موثق.
- **الإجراء:** `risk_id`, `working_paper_id`, `method` (inspection/observation/recalculation/confirmation/analytical/inquiry/caat), `status` (planned/performed/evaluated), `result_summary`.
- **العينة:** `procedure_id`, `method` (random/systematic/mus/judgmental), `population_ref`, `population_size`, `sample_size`, `interval`, `seed`, `selection_json`, `evaluation_json`, `conclusion`. قاعدة: `seed` + المنهجية يُسجلان إلزاميًا كي تكون الاختيار قابلًا لإعادة الإنتاج. (ISA 530)

### 4.9 `misstatement` (التحريف — المرحلة 6)
`engagement_id`, `account_id`, `assertion`, `source_exception_id`, `amount_minor`, `currency`, `type` (factual/judgmental/projected), `corrected` (true/false), `note`. قاعدة: التحريف غير المصحح يبقى في السجل مع تجميعه تلقائيًا لمقارنته بالأهمية النسبية قبل الرأي. (ISA 450)

### 4.10 `change_log` (سجل التغييرات — عرضي)
`firm_id`, `engagement_id` (اختياري), `actor_id`, `device_id`, `action`, `entity_type`, `entity_id`, `before_json/after_json`, `reason`, `occurred_at`, `sync_batch_id`. قواعد: **إضافة فقط** — لا UPDATE ولا DELETE على الجدول بأي صلاحية؛ كل فعل كيان يكتب صفًا واحدًا على الأقل؛ هذا الجدول هو أساس المزامنة والثقة (ADR-5).

---

## 5. دورات الحياة (آلات حالة مفروضة على مستوى الكود)

| الكيان | الحالات | الانتقالات المسموحة |
|---|---|---|
| `engagement` | planning, fieldwork, review, finalization, closed, cancelled | للأمام فقط كما في الترتيب؛ `cancelled` من planning/fieldwork فقط |
| `working_paper` | draft, in_review, reviewed, returned | draft→in_review→reviewed؛ returned→draft؛ الإصدار الجديد يعلّم القديم supersedes |
| `match` | suggested, approved, rejected | suggested→approved/rejected (بقرار مسجَّل)؛ لا انتقالات عكسية — التصحيح بمطابقة/قرار جديد |
| `exception` | open, under_review, resolved, waived, escalated | أي → under_review → resolved/waived/escalated؛ إعادة فتح مسموحة بقرار مراجع مع سبب موثق |
| `client_acceptance` | drafted, accepted/continued/declined, expired | قبول جديد بعد انتهاء صلاحية السابق |

انتقال غير مسموح في أي آلة حالة = خطأ برمجي يُرفض ويُسجل، لا تحذيرًا يتجاهله الواجهة.

---

## 6. مبدأ التسمية والاتساق

- أسماء الجداول مفردة (`engagement` لا `engagements`)، الحقول `snake_case`، المعرفات `id` نصيًا (UUID).
- كل جدول أعمال يبدأ بـ `firm_id` ثم مفاتيح نطاقه (`client_id`, `engagement_id`) ثم حقوله ثم حقول المزامنة القياسية (§3 من `docs/03-database-design.md`).
- كل قيمة مالية تنتهي بـ `_minor` وتصاحبها `currency`. كل تاريخ `ISO-8601` (نص `YYYY-MM-DD` أو طابع UTC كامل حسب الحقل).
- أي كيان جديد مستقبلًا يُضاف أولًا إلى هذه الوثيقة ويُراجع أثره على سلسلة العزل قبل كتابة أي DDL.
