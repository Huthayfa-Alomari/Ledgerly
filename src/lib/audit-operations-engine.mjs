import { parseJodAmount, roundJod } from './jod-money.mjs';

const ARABIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
function normText(value) {
  return String(value ?? '').replace(/[٠-٩]/g, d => String(ARABIC.indexOf(d)))
    .replace(/[۰-۹]/g, d => String(PERSIAN.indexOf(d)))
    .normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ـ/g, '').toLowerCase().trim();
}
function amount(row) {
  const d = parseJodAmount(row?.debit);
  const c = parseJodAmount(row?.credit);
  const a = parseJodAmount(row?.amount);
  return Math.max(Math.abs(d ?? 0), Math.abs(c ?? 0), Math.abs(a ?? 0));
}
function rowDate(row) { const v = String(row?.date ?? ''); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
function rowHour(row) {
  const m = String(row?.dateRaw ?? row?.time ?? '').match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}
function issue(id, title, severity, rows, detail, action) {
  return { id, title, severity, count: rows.length, rowNumbers: rows.map(row => row.rowNumber), examples: rows.slice(0, 12), detail, action };
}

/** Rules surface screening signals for auditor review, not proof of fraud. */
export function runAdvancedJournalTests(rows, options = {}) {
  const data = Array.isArray(rows) ? rows : [];
  const roundedThreshold = Number.isFinite(options.largeRoundedThreshold) ? options.largeRoundedThreshold : 1000;
  const openingHour = Number.isFinite(options.openingHour) ? options.openingHour : 7;
  const closingHour = Number.isFinite(options.closingHour) ? options.closingHour : 19;
  const weekend = data.filter(row => {
    const date = rowDate(row); if (!date) return false;
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    return day === 5 || day === 6;
  });
  const afterHours = data.filter(row => {
    const hour = rowHour(row); return hour !== null && (hour < openingHour || hour >= closingHour);
  });
  const rounded = data.filter(row => {
    const value = amount(row); if (value < roundedThreshold) return false;
    return Math.abs(value / 1000 - Math.round(value / 1000)) < 1e-8 ||
      Math.abs(value / 5000 - Math.round(value / 5000)) < 1e-8;
  });
  const noAmount = data.filter(row => amount(row) === 0);
  const duplicateMap = new Map();
  for (const row of data) {
    const value = amount(row), ref = normText(row.reference), account = normText(row.accountCode), desc = normText(row.description);
    if (!(value > 0) || (!ref && !desc)) continue;
    const key = [ref, account, desc, value.toFixed(3)].join('|');
    const matches = duplicateMap.get(key) || []; matches.push(row); duplicateMap.set(key, matches);
  }
  const duplicateRows = [];
  for (const list of duplicateMap.values()) if (list.length > 1) duplicateRows.push(...list);

  const counts = Array(9).fill(0); let n = 0;
  for (const row of data) {
    const value = amount(row); if (!(value > 0) || !Number.isFinite(value)) continue;
    const first = String(value.toFixed(8)).replace(/[^0-9]/g, '').match(/[1-9]/);
    if (first) { counts[Number(first[0]) - 1] += 1; n += 1; }
  }
  const benford = {
    populationSize: n,
    observed: counts.map((count, i) => ({ digit: i + 1, count, proportion: n ? count / n : 0, expectedProportion: Math.log10(1 + 1 / (i + 1)) })),
    interpretable: n >= 50,
    note: n >= 50 ? 'مقارنة وصفية مع توزيع Benford. ملاءمة الاختبار تعتمد على طبيعة المجتمع؛ الانحراف وحده لا يثبت الخطأ أو الاحتيال.' : 'عدد القيم أقل من 50؛ النسب للمعلومات فقط ولا تُفسَّر إحصائيًا.',
  };
  const issues = [
    issue('journal-weekend', 'قيود بتاريخ الجمعة أو السبت', 'medium', weekend, 'تاريخ القيد يقع في نهاية الأسبوع المعتادة في الأردن وقد يكون طبيعيًا.', 'راجع المستخدم المنشئ ووقت التسجيل والمستند والموافقة بحسب المخاطر.'),
    issue('journal-after-hours', 'قيود خارج نافذة الدوام الافتراضية', 'medium', afterHours, 'وقت القيد خارج النافذة الافتراضية؛ قد لا تتوفر منطقة زمنية موثوقة.', 'راجع توقيت المصدر وصلاحيات المستخدم والسبب التجاري.'),
    issue('journal-rounded-amount', 'مبالغ كبيرة مدوّرة', 'low', rounded, 'المبلغ يساوي مضاعفات 1,000 أو 5,000 د.أ ويبلغ الحد الافتراضي على الأقل.', 'قارن بالمستند والأهمية النسبية وطبيعة المعاملة.'),
    issue('journal-duplicate-line', 'أسطر متطابقة تستحق التحقق', 'high', duplicateRows, 'توجد أسطر متطابقة في المرجع والحساب والوصف والمبلغ؛ لا يثبت التطابق حدوث دفع مكرر.', 'قارن بالمستند والمدفوعات البنكية والمورد وتاريخ التسوية.'),
    issue('journal-zero', 'أسطر بلا مبلغ واضح', 'low', noAmount, 'قد تكون عناوين أو أسطر غير مالية أو قيودًا ناقصة؛ لم تُحذف تلقائيًا.', 'حدد إن كانت الصفوف ضمن المجتمع المالي محل الفحص.'),
  ].filter(item => item.count > 0);
  return { scannedCount: data.length, issues, benford, parameters: { roundedThreshold, openingHour, closingHour, weekendDays: ['Friday', 'Saturday'] } };
}

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reproducible random/systematic/MUS selection; professional sample design remains the auditor's responsibility. */
export function selectAuditSample(rows, options = {}) {
  const population = Array.isArray(rows) ? rows.slice() : [];
  const method = options.method || 'random';
  const size = Number(options.sampleSize ?? 25);
  const seed = Number(options.seed ?? 20261023) >>> 0;
  const amountOf = typeof options.amountOf === 'function' ? options.amountOf : amount;
  if (!Number.isInteger(size) || size < 1) throw new Error('حجم العينة يجب أن يكون عددًا صحيحًا موجبًا.');
  if (!['random', 'systematic', 'mus'].includes(method)) throw new Error('طريقة اختيار العينة غير مدعومة.');
  if (!population.length) throw new Error('مجتمع الاختبار فارغ.');
  if (method !== 'mus' && size > population.length) throw new Error('حجم العينة لا يمكن أن يتجاوز عدد عناصر المجتمع لهذه الطريقة.');
  const random = seededRandom(seed);
  let interval = null, randomStart = null, populationTotal = null, selected = [];
  if (method === 'random') {
    const indices = population.map((_, index) => index);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    selected = indices.slice(0, size).sort((a, b) => a - b).map(index => ({ row: population[index], index: index + 1, hits: [] }));
  } else if (method === 'systematic') {
    interval = population.length / size; randomStart = random() * interval;
    const indices = new Set();
    for (let i = 0; i < size; i++) indices.add(Math.min(population.length - 1, Math.floor(randomStart + i * interval)));
    selected = [...indices].sort((a, b) => a - b).map(index => ({ row: population[index], index: index + 1, hits: [] }));
  } else {
    const amounts = population.map(row => Math.abs(Number(amountOf(row)) || 0));
    if (amounts.some(value => !Number.isFinite(value) || value < 0)) throw new Error('يحتوي مجتمع MUS على قيمة غير صالحة.');
    populationTotal = amounts.reduce((sum, value) => sum + value, 0);
    if (!(populationTotal > 0)) throw new Error('لا يمكن إجراء MUS دون قيم مالية موجبة.');
    interval = populationTotal / size; randomStart = random() * interval;
    const positions = Array.from({ length: size }, (_, i) => randomStart + i * interval);
    const hitsByIndex = new Map(); let cumulative = 0, positionIndex = 0;
    for (let i = 0; i < amounts.length; i++) {
      const end = cumulative + amounts[i];
      while (positionIndex < positions.length && positions[positionIndex] < end) {
        if (amounts[i] > 0) {
          const hits = hitsByIndex.get(i) || []; hits.push(positionIndex + 1); hitsByIndex.set(i, hits);
        }
        positionIndex += 1;
      }
      cumulative = end;
    }
    selected = [...hitsByIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, hits]) => ({ row: population[index], index: index + 1, hits }));
  }
  return {
    method, seed, populationSize: population.length, requestedSampleSize: size, selectedItemCount: selected.length,
    populationTotal: populationTotal === null ? null : roundJod(populationTotal),
    interval: interval === null ? null : Number(interval.toFixed(6)),
    randomStart: randomStart === null ? null : Number(randomStart.toFixed(6)),
    selections: selected, createdAt: new Date().toISOString(),
    note: method === 'mus'
      ? 'اختيار MUS احتمالي بوحدات نقدية. يجب توثيق المجتمع والتعامل مع التحديدات المتكررة والأهمية النسبية وتقييم النتائج.'
      : 'تم حفظ البذرة وطريقة الاختيار لإعادة الإنتاج؛ يحدد المدقق كفاية حجم العينة ويقيّم النتائج.',
  };
}

const LINES = [
  { key: 'cash', ar: 'النقد وما في حكمه', en: 'Cash and cash equivalents', statement: 'sfp', normal: 'debit', group: 'assets' },
  { key: 'receivables', ar: 'الذمم المدينة', en: 'Trade and other receivables', statement: 'sfp', normal: 'debit', group: 'assets' },
  { key: 'inventory', ar: 'المخزون', en: 'Inventories', statement: 'sfp', normal: 'debit', group: 'assets' },
  { key: 'fixed-assets', ar: 'الممتلكات والآلات والمعدات', en: 'Property, plant and equipment', statement: 'sfp', normal: 'debit', group: 'assets' },
  { key: 'other-assets', ar: 'أصول أخرى', en: 'Other assets', statement: 'sfp', normal: 'debit', group: 'assets' },
  { key: 'payables', ar: 'الذمم الدائنة', en: 'Trade and other payables', statement: 'sfp', normal: 'credit', group: 'liabilities' },
  { key: 'borrowings', ar: 'القروض والتسهيلات', en: 'Borrowings', statement: 'sfp', normal: 'credit', group: 'liabilities' },
  { key: 'tax-liabilities', ar: 'ضرائب مستحقة', en: 'Tax liabilities', statement: 'sfp', normal: 'credit', group: 'liabilities' },
  { key: 'other-liabilities', ar: 'التزامات أخرى', en: 'التزامات أخرى', statement: 'sfp', normal: 'credit', group: 'liabilities' },
  { key: 'capital', ar: 'رأس المال', en: 'Share capital', statement: 'sfp', normal: 'credit', group: 'equity' },
  { key: 'retained-earnings', ar: 'الأرباح المحتجزة', en: 'Retained earnings', statement: 'sfp', normal: 'credit', group: 'equity' },
  { key: 'revenue', ar: 'الإيرادات', en: 'Revenue', statement: 'spl', normal: 'credit', group: 'income' },
  { key: 'cost-sales', ar: 'تكلفة المبيعات', en: 'Cost of sales', statement: 'spl', normal: 'debit', group: 'expenses' },
  { key: 'admin-expenses', ar: 'المصاريف الإدارية والعمومية', en: 'Administrative expenses', statement: 'spl', normal: 'debit', group: 'expenses' },
  { key: 'finance-costs', ar: 'تكاليف التمويل', en: 'Finance costs', statement: 'spl', normal: 'debit', group: 'expenses' },
  { key: 'tax-expense', ar: 'مصروف ضريبة الدخل', en: 'Income tax expense', statement: 'spl', normal: 'debit', group: 'expenses' },
  { key: 'other-income', ar: 'إيرادات أخرى', en: 'Other income', statement: 'spl', normal: 'credit', group: 'income' },
];
export function financialStatementLines() { return LINES.map(line => ({ ...line })); }
export function buildDraftFinancialStatements(trialBalance, mappings = {}) {
  const rows = Array.isArray(trialBalance) ? trialBalance : [];
  const totals = new Map(LINES.map(line => [line.key, { line, current: 0, comparative: 0, accountCount: 0 }]));
  const unmapped = [];
  for (const row of rows) {
    const mapping = mappings[String(row.code)] || mappings[String(row.engagementId) + '::' + String(row.code)];
    const line = LINES.find(item => item.key === mapping?.lineKey);
    if (!line) { unmapped.push(row); continue; }
    const net = (Number(row.closingDebit) || 0) - (Number(row.closingCredit) || 0);
    const current = roundJod(line.normal === 'debit' ? net : -net);
    const comparative = parseJodAmount(mapping?.comparativeJod ?? 0) ?? 0;
    const slot = totals.get(line.key);
    slot.current = roundJod(slot.current + current); slot.comparative = roundJod(slot.comparative + comparative); slot.accountCount += 1;
  }
  const entries = [...totals.values()].filter(item => item.accountCount > 0 || item.current !== 0 || item.comparative !== 0);
  const sum = (group, field) => roundJod(entries.filter(item => item.line.group === group).reduce((total, item) => total + item[field], 0));
  const current = { assets: sum('assets', 'current'), liabilities: sum('liabilities', 'current'), equity: sum('equity', 'current'), income: sum('income', 'current'), expenses: sum('expenses', 'current') };
  const comparative = { assets: sum('assets', 'comparative'), liabilities: sum('liabilities', 'comparative'), equity: sum('equity', 'comparative'), income: sum('income', 'comparative'), expenses: sum('expenses', 'comparative') };
  for (const value of [current, comparative]) {
    value.profit = roundJod(value.income - value.expenses);
    value.totalLiabilitiesEquity = roundJod(value.liabilities + value.equity);
    value.balanceDifference = roundJod(value.assets - value.totalLiabilitiesEquity);
  }
  return { lines: entries, unmapped, current, comparative, allMapped: unmapped.length === 0, note: 'مسودة تعتمد على الربط اليدوي؛ لا تصنّف الحسابات تلقائيًا ولا تضمن الامتثال الكامل لمعايير IFRS أو متطلبات العرض والإفصاح.' };
}

function readTag(xml, tag) {
  const re = new RegExp('<(?:[A-Za-z0-9_-]+:)?' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?' + tag + '\\s*>', 'i');
  const match = String(xml).match(re);
  return match ? match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
}
function readNestedTag(xml, parent, child) {
  const re = new RegExp('<(?:[A-Za-z0-9_-]+:)?' + parent + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?' + parent + '\\s*>', 'i');
  const match = String(xml).match(re);
  return match ? readTag(match[1], child) : '';
}
export function parseUblInvoiceXml(xml) {
  const source = String(xml ?? '');
  if (!source.trim() || source.length > 10 * 1024 * 1024) throw new Error('ملف XML فارغ أو يتجاوز حد 10 ميغابايت.');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('تم رفض XML الذي يحتوي تعريف كيانات أو DOCTYPE.');
  if (!/<(?:[A-Za-z0-9_-]+:)?Invoice(?:\s|>)/i.test(source)) throw new Error('لم يعثر على عنصر UBL Invoice.');
  const version = readTag(source, 'UBLVersionID');
  const payableText = readNestedTag(source, 'LegalMonetaryTotal', 'PayableAmount');
  const taxText = readNestedTag(source, 'TaxTotal', 'TaxAmount');
  const baseText = readNestedTag(source, 'LegalMonetaryTotal', 'LineExtensionAmount');
  const supplierId = readNestedTag(source, 'AccountingSupplierParty', 'CompanyID');
  const supplierName = readNestedTag(source, 'AccountingSupplierParty', 'RegistrationName') || readNestedTag(source, 'AccountingSupplierParty', 'Name');
  const result = {
    invoiceId: readTag(source, 'ID'), issueDate: readTag(source, 'IssueDate'),
    supplierTaxId: supplierId, supplierName,
    currency: readTag(source, 'DocumentCurrencyCode') || readTag(source, 'TaxCurrencyCode'),
    payableAmount: payableText ? parseJodAmount(payableText) : null,
    taxAmount: taxText ? parseJodAmount(taxText) : null,
    lineExtensionAmount: baseText ? parseJodAmount(baseText) : null,
    ublVersion: version || 'غير محدد',
  };
  result.validation = {
    hasInvoiceId: Boolean(result.invoiceId), hasIssueDate: Boolean(result.issueDate),
    hasSupplierTaxId: Boolean(result.supplierTaxId), hasPayableAmount: Boolean(payableText) && result.payableAmount !== null,
    isUbl21: version === '2.1',
    readyForHumanReview: Boolean(result.invoiceId && result.issueDate && payableText && result.payableAmount !== null),
  };
  result.note = 'فحص محلي للحقول الأولية فقط؛ ليس تحققًا من صحة التوقيع أو اعتمادًا ضريبيًا أو اتصالًا بنظام JoFotara.';
  return result;
}

export function buildWhatsappReminder({ phone = '', firmName = 'مكتب التدقيق', clientName = 'العميل', requestTitle = '', dueDate = '' } = {}) {
  const message = 'مرحبًا، معك ' + firmName + '. نتابع طلب مستندات التدقيق الخاص بـ ' + clientName + ': ' + requestTitle + '.' +
    (dueDate ? ' الموعد المطلوب: ' + dueDate + '.' : '') + ' يرجى إرسال المستند عبر القناة الآمنة المعتمدة لدى المكتب. شكرًا.';
  const digits = String(phone).replace(/\D/g, '');
  return { message, url: 'https://wa.me/' + digits + '?text=' + encodeURIComponent(message) };
}
export function calculateOfficeMetrics(engagements = [], timeEntries = [], invoices = []) {
  const totalHours = timeEntries.reduce((sum, entry) => sum + Math.max(0, Number(entry.hours) || 0), 0);
  const actualCost = roundJod(timeEntries.reduce((sum, entry) => sum + Math.max(0, Number(entry.hours) || 0) * Math.max(0, parseJodAmount(entry.hourlyRateJod) ?? 0), 0));
  const contractedFees = roundJod(engagements.reduce((sum, item) => sum + Math.max(0, parseJodAmount(item.feeJod) ?? 0), 0));
  const billed = roundJod(invoices.reduce((sum, item) => sum + Math.max(0, parseJodAmount(item.totalJod) ?? 0), 0));
  const outstanding = roundJod(invoices.filter(item => item.status !== 'مدفوعة').reduce((sum, item) => sum + Math.max(0, parseJodAmount(item.totalJod) ?? 0), 0));
  return { totalHours, actualCost, contractedFees, billed, outstanding, unbilledContractedFees: roundJod(Math.max(0, contractedFees - billed)) };
}
export function validateLocalWorkpaperTransition(workpaper, nextStatus, reviewerIdentity = '') {
  const current = String(workpaper?.status ?? 'مسودة'), preparer = normText(workpaper?.preparer), reviewer = normText(reviewerIdentity || workpaper?.reviewer);
  const allowed = { 'مسودة': ['قيد التنفيذ', 'بانتظار المراجعة'], 'قيد التنفيذ': ['مسودة', 'بانتظار المراجعة'], 'بانتظار المراجعة': ['تعديلات مطلوبة', 'معتمد'], 'تعديلات مطلوبة': ['قيد التنفيذ', 'بانتظار المراجعة'], 'معتمد': ['تعديلات مطلوبة'] };
  if (nextStatus === current) return { valid: true, reason: 'لا تغيير', requiresReview: false };
  if (!(allowed[current] || []).includes(nextStatus)) return { valid: false, reason: 'انتقال الحالة غير مسموح في سير العمل المحلي.', requiresReview: false };
  if (nextStatus === 'معتمد') {
    if (!reviewer) return { valid: false, reason: 'أدخل هوية المراجع قبل الاعتماد.', requiresReview: true };
    if (preparer && reviewer === preparer) return { valid: false, reason: 'يجب أن يكون المراجع مختلفًا عن معدّ ورقة العمل.', requiresReview: true };
    return { valid: true, reason: 'اعتماد محلي باسم المراجع المدخل؛ لا يمثل هوية موثقة في الوضع المحلي.', requiresReview: true };
  }
  return { valid: true, reason: 'انتقال محلي مقبول.', requiresReview: false };
}
export function rollForwardWorkpapers(previousPapers, newEngagementId, createId = () => 'wp-' + Math.random().toString(36).slice(2)) {
  return (Array.isArray(previousPapers) ? previousPapers : []).map(paper => ({
    ...paper, id: createId(), engagementId: newEngagementId, status: 'مسودة', preparer: '', reviewer: '',
    reviewNotes: '', version: 1, history: [], updatedAt: new Date().toISOString().slice(0, 10), conclusion: '', evidenceIds: [],
  }));
}
export function inferBankColumns(headers, savedProfiles = []) {
  const normalize = value => normText(value).replace(/[\s_\-./،,:]/g, '');
  const items = (Array.isArray(headers) ? headers : []).map(header => ({ header, key: normalize(header) }));
  const aliases = {
    date: ['date', 'transactiondate', 'valuedate', 'التاريخ', 'تاريخالحركة', 'تاريخالقيمة'],
    description: ['description', 'details', 'narration', 'memo', 'البيان', 'الوصف', 'تفاصيل'],
    debit: ['debit', 'withdrawal', 'مدين', 'سحب', 'مدفوعات'],
    credit: ['credit', 'deposit', 'دائن', 'إيداع', 'مقبوضات'],
    amount: ['amount', 'المبلغ', 'قيمةالحركة'], balance: ['balance', 'الرصيد'],
    reference: ['reference', 'transactionid', 'chequeno', 'المرجع', 'رقمالحركة', 'رقمالشيك'],
  };
  const mapping = {};
  for (const [field, values] of Object.entries(aliases)) {
    const match = items.find(item => values.some(value => item.key === normalize(value)));
    if (match) mapping[field] = match.header;
  }
  const profile = (Array.isArray(savedProfiles) ? savedProfiles : []).find(item => Array.isArray(item.headers) &&
    item.headers.length === items.length && item.headers.every(header => items.some(key => key.header === header)));
  return { mapping: profile?.mapping || mapping, matchedSavedProfile: profile?.name || '', headerSignature: items.map(item => item.key).join('|') };
}
