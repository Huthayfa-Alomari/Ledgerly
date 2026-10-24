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


function normalizeInvoiceDate(value) {
  const valid = (year, month, day) => {
    if (![year, month, day].every(Number.isInteger) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
      : '';
  };
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return valid(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  const text = normText(value);
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[t\s])/);
  if (match) return valid(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:$|[t\s])/);
  if (match) return valid(Number(match[3]), Number(match[2]), Number(match[1]));
  const parsed = new Date(String(value ?? ''));
  if (!Number.isFinite(parsed.getTime())) return '';
  return valid(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function normalizedInvoiceReference(value) {
  return normText(value).replace(/[^\p{L}\p{N}]/gu, '');
}

function invoiceHeaderKey(value) {
  return normText(value).replace(/[\s_.\-\/\\:،,()]+/g, '');
}

/** Normalize a supplier-invoice register exported as CSV/XLSX into a small, inspectable schema. */
export function normalizeInvoiceRegisterRows(records) {
  if (!Array.isArray(records) || !records.length) {
    return { rows: [], sourceCount: 0, fieldsDetected: [], warnings: ['ملف الفواتير لا يحتوي صفوف بيانات.'] };
  }
  const headers = Array.from(new Set(records.flatMap(row => Object.keys(row || {}))));
  const find = aliases => {
    const normalized = aliases.map(invoiceHeaderKey);
    const exact = headers.find(header => normalized.includes(invoiceHeaderKey(header)));
    if (exact) return exact;
    return headers.find(header => normalized.some(alias => alias.length >= 4 && invoiceHeaderKey(header).includes(alias)));
  };
  const invoiceH = find(['invoice id', 'invoice no', 'invoice number', 'invoice reference', 'رقم الفاتورة', 'رقم فاتورة', 'رقم المستند']);
  const dateH = find(['issue date', 'invoice date', 'document date', 'date', 'تاريخ الإصدار', 'تاريخ الفاتورة', 'تاريخ المستند', 'التاريخ']);
  const supplierH = find(['supplier name', 'supplier', 'vendor name', 'vendor', 'counterparty', 'اسم المورد', 'المورد', 'اسم البائع', 'الطرف المقابل']);
  const taxIdH = find(['supplier tax id', 'tax id', 'vat number', 'tax number', 'الرقم الضريبي للمورد', 'رقم ضريبة المورد', 'الرقم الضريبي']);
  const amountH = find(['payable amount', 'amount due', 'invoice total', 'gross total', 'total amount', 'payable', 'إجمالي الفاتورة', 'المبلغ الإجمالي', 'الإجمالي المستحق', 'المجموع الكلي', 'إجمالي']);
  const taxH = find(['tax amount', 'tax total', 'vat amount', 'ضريبة الفاتورة', 'قيمة الضريبة', 'الضريبة']);
  const currencyH = find(['currency', 'currency code', 'العملة', 'رمز العملة']);
  const warnings = [];
  if (!invoiceH) warnings.push('لم يتم اكتشاف عمود رقم فاتورة واضح.');
  if (!dateH) warnings.push('لم يتم اكتشاف عمود تاريخ فاتورة واضح.');
  if (!supplierH) warnings.push('لم يتم اكتشاف اسم مورد أو طرف مقابل.');
  if (!amountH) warnings.push('لم يتم اكتشاف عمود إجمالي مستحق واضح.');
  const rows = records.map((raw, index) => {
    const get = header => header ? raw?.[header] : undefined;
    const amountRaw = get(amountH);
    const taxRaw = get(taxH);
    const amount = amountRaw === undefined || amountRaw === null || String(amountRaw).trim() === '' ? null : parseJodAmount(amountRaw);
    const tax = taxRaw === undefined || taxRaw === null || String(taxRaw).trim() === '' ? null : parseJodAmount(taxRaw);
    return {
      invoiceId: String(get(invoiceH) ?? '').trim(),
      issueDate: normalizeInvoiceDate(get(dateH)),
      issueDateRaw: String(get(dateH) ?? ''),
      supplierName: String(get(supplierH) ?? '').trim(),
      supplierTaxId: String(get(taxIdH) ?? '').trim(),
      currency: String(get(currencyH) ?? '').trim().toUpperCase(),
      payableAmount: amount,
      taxAmount: tax,
      sourceRowNumber: Number.isInteger(Number(raw?.__sourceRowNumber)) ? Number(raw.__sourceRowNumber) : index + 2,
      sourceFields: { invoice: invoiceH || '', date: dateH || '', supplier: supplierH || '', amount: amountH || '', currency: currencyH || '' },
      invalidAmount: Boolean(amountRaw !== undefined && amountRaw !== null && String(amountRaw).trim() !== '' && amount === null),
    };
  }).filter(row => row.invoiceId || row.supplierName || row.payableAmount !== null);
  return {
    rows,
    sourceCount: rows.length,
    fieldsDetected: [invoiceH, dateH, supplierH, taxIdH, amountH, taxH, currencyH].filter(Boolean),
    warnings,
  };
}

/**
 * Suggests candidate matches between an invoice and journal rows.
 * It never marks an invoice as verified and never modifies accounting data.
 */
export function matchInvoiceToJournal(invoice, journalRows = [], options = {}) {
  const rows = Array.isArray(journalRows) ? journalRows : [];
  const invoiceId = String(invoice?.invoiceId ?? invoice?.invoiceNo ?? invoice?.reference ?? '').trim();
  const invoiceRefKey = normalizedInvoiceReference(invoiceId);
  const supplierName = normText(invoice?.supplierName ?? invoice?.vendorName ?? invoice?.counterparty ?? '');
  const invoiceAmountRaw = invoice?.payableAmount ?? invoice?.totalJod ?? invoice?.totalAmount ?? invoice?.amount;
  const invoiceAmount = invoiceAmountRaw === null || invoiceAmountRaw === undefined || String(invoiceAmountRaw).trim() === ''
    ? null : parseJodAmount(invoiceAmountRaw);
  const invoiceDate = normalizeInvoiceDate(invoice?.issueDate ?? invoice?.date);
  const currency = String(invoice?.currency ?? '').trim().toUpperCase();
  const confirmedJod = ['JOD', 'JD', 'JORDANIAN DINAR', 'JORDANIAN DINARS'].includes(currency);
  const currencyUnconfirmed = !currency;
  const toleranceRaw = Number(options.toleranceJod);
  const toleranceJod = Number.isFinite(toleranceRaw) && toleranceRaw >= 0 ? Math.min(toleranceRaw, 1000) : 0.001;
  const windowRaw = Number(options.dateWindowDays);
  const dateWindowDays = Number.isFinite(windowRaw) ? Math.max(0, Math.min(60, Math.trunc(windowRaw))) : 3;
  const round = value => roundJod(value);
  const dateDiff = date => {
    if (!invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return null;
    return Math.round((Date.parse(String(date) + 'T00:00:00Z') - Date.parse(invoiceDate + 'T00:00:00Z')) / 86400000);
  };
  const rowAmount = row => {
    const debit = parseJodAmount(row?.debit), credit = parseJodAmount(row?.credit), amount = parseJodAmount(row?.amount);
    return Math.max(Math.abs(debit ?? 0), Math.abs(credit ?? 0), Math.abs(amount ?? 0));
  };
  const rowPartyMatch = row => {
    if (!supplierName) return false;
    const party = normText(row?.counterparty ?? row?.supplierName ?? row?.party ?? '');
    const description = normText(row?.description ?? '');
    const idInDescription = invoiceRefKey && normalizedInvoiceReference(description).includes(invoiceRefKey);
    if (idInDescription) return true;
    if (party && (party === supplierName || party.includes(supplierName) || supplierName.includes(party))) return true;
    const targetTokens = supplierName.split(/\s+/).filter(token => token.length >= 4);
    const candidateTokens = new Set((party + ' ' + description).split(/\s+/).filter(token => token.length >= 4));
    return targetTokens.some(token => candidateTokens.has(token));
  };
  const base = { invoiceId, invoiceDate, invoiceAmountJod: invoiceAmount, currency, currencyConfirmed: confirmedJod, toleranceJod, dateWindowDays };
  if (!invoiceAmount || !Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
    return { ...base, status: 'invalid-invoice-amount', statusLabel: 'مبلغ الفاتورة غير صالح', message: 'تعذر تفسير إجمالي الفاتورة كمبلغ موجب. صحح الحقل قبل المقارنة.', candidates: [] };
  }
  if (currency && !confirmedJod) {
    return { ...base, status: 'unsupported-currency', statusLabel: 'عملة غير مدعومة للمقارنة', message: 'دفتر الأستاذ في هذه المقارنة يعامل المبالغ كدنانير أردنية. حوّل القيم وفق مصدر موثوق أو استخدم فاتورة JOD قبل المطابقة.', candidates: [] };
  }

  const exactRows = invoiceRefKey ? rows.filter(row => normalizedInvoiceReference(row?.reference) === invoiceRefKey) : [];
  const candidates = [];
  if (exactRows.length) {
    const groups = new Map();
    for (const row of exactRows) {
      const transactionDate = normalizeInvoiceDate(row.date);
      const groupKey = transactionDate || '(تاريخ غير واضح)';
      const group = groups.get(groupKey) || [];
      group.push(row); groups.set(groupKey, group);
    }
    for (const [groupDate, groupRows] of groups) {
      const debitTotal = round(groupRows.reduce((sum, row) => sum + Math.max(0, parseJodAmount(row.debit) ?? 0), 0));
      const creditTotal = round(groupRows.reduce((sum, row) => sum + Math.max(0, parseJodAmount(row.credit) ?? 0), 0));
      const amountTotal = round(Math.max(debitTotal, creditTotal, ...groupRows.map(rowAmount)));
      const amountDifference = round(amountTotal - invoiceAmount);
      const differenceDays = dateDiff(groupDate);
      const amountOk = Math.abs(amountDifference) <= toleranceJod;
      const dateOk = differenceDays === null || Math.abs(differenceDays) <= dateWindowDays;
      candidates.push({
        method: 'exact-reference',
        rowNumbers: groupRows.map(row => row.rowNumber).filter(Number.isFinite),
        journalReference: String(groupRows[0]?.reference ?? ''),
        transactionDate: groupDate === '(تاريخ غير واضح)' ? '' : groupDate,
        accountCodes: [...new Set(groupRows.map(row => String(row.accountCode ?? '').trim()).filter(Boolean))],
        descriptions: [...new Set(groupRows.map(row => String(row.description ?? '').trim()).filter(Boolean))],
        counterpartyNames: [...new Set(groupRows.map(row => String(row.counterparty ?? '').trim()).filter(Boolean))],
        debitTotalJod: debitTotal, creditTotalJod: creditTotal, comparisonAmountJod: amountTotal,
        amountDifferenceJod: amountDifference, dateDifferenceDays: differenceDays,
        partyMatch: groupRows.some(rowPartyMatch), amountOk, dateOk,
        score: (amountOk ? 5 : 0) + (dateOk ? 2 : 0) + (groupRows.some(rowPartyMatch) ? 1 : 0),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const valid = candidates.filter(candidate => candidate.amountOk && candidate.dateOk);
    let status = valid.length === 1 ? 'reference-amount-candidate' : valid.length > 1 ? 'ambiguous-reference-candidate' : 'reference-conflict';
    let statusLabel = valid.length === 1 ? 'تطابق مرجعي ومبلغ مقترح' : valid.length > 1 ? 'أكثر من مرشح بنفس المرجع' : 'تعارض في المرجع أو المبلغ أو التاريخ';
    let message = valid.length === 1
      ? 'المرجع والمبلغ والتاريخ ضمن هامش الفحص؛ راجع المستند الأصلي والقيد قبل اعتماد المطابقة.'
      : valid.length > 1
        ? 'ظهر أكثر من تجميع مستوفٍ للمرجع والمبلغ والتاريخ؛ يلزم تحديد القيد المقصود يدويًا.'
        : 'وجد مرجع مطابق لكن المبلغ أو التاريخ خارج هامش الفحص. لا يُعتمد التطابق.';
    if (currencyUnconfirmed) { message += ' العملة في الفاتورة غير محددة، فتحقق منها يدويًا.'; statusLabel += ' · العملة غير مؤكدة'; }
    return { ...base, status, statusLabel, message, candidates: candidates.slice(0, 8), exactReferenceRows: exactRows.length };
  }

  const direct = [];
  for (const row of rows) {
    const amountJod = round(rowAmount(row));
    if (!(amountJod > 0) || Math.abs(amountJod - invoiceAmount) > toleranceJod) continue;
    const differenceDays = dateDiff(row.date);
    if (differenceDays !== null && Math.abs(differenceDays) > dateWindowDays) continue;
    const partyMatch = rowPartyMatch(row);
    const description = normText(row.description ?? '');
    const reference = String(row.reference ?? '');
    const idMentioned = invoiceRefKey && normalizedInvoiceReference(description).includes(invoiceRefKey);
    if (supplierName && row.counterparty && !partyMatch && !idMentioned) continue;
    const score = 5 + (differenceDays === null ? 0 : 2) + (partyMatch ? 4 : 0) + (idMentioned ? 5 : 0);
    direct.push({
      method: partyMatch ? 'amount-date-party' : idMentioned ? 'invoice-id-in-description' : 'amount-date-only',
      rowNumbers: [row.rowNumber].filter(Number.isFinite), journalReference: reference,
      transactionDate: normalizeInvoiceDate(row.date), accountCodes: [String(row.accountCode ?? '').trim()].filter(Boolean),
      descriptions: [String(row.description ?? '').trim()].filter(Boolean),
      counterpartyNames: [String(row.counterparty ?? '').trim()].filter(Boolean),
      debitTotalJod: round(Math.max(0, parseJodAmount(row.debit) ?? 0)),
      creditTotalJod: round(Math.max(0, parseJodAmount(row.credit) ?? 0)),
      comparisonAmountJod: amountJod, amountDifferenceJod: round(amountJod - invoiceAmount),
      dateDifferenceDays: differenceDays, partyMatch, amountOk: true, dateOk: true, score,
    });
  }
  // Try conservative one-to-many grouping only when supplier and date both identify a narrow subset.
  if (supplierName && invoiceDate) {
    for (const direction of ['debit', 'credit']) {
      const members = rows.filter(row => {
        const value = parseJodAmount(row?.[direction]);
        const other = parseJodAmount(row?.[direction === 'debit' ? 'credit' : 'debit']);
        const days = dateDiff(row.date);
        return value !== null && value > 0 && !(other !== null && other > toleranceJod) &&
          days !== null && Math.abs(days) <= dateWindowDays && rowPartyMatch(row);
      });
      if (members.length < 2) continue;
      const total = round(members.reduce((sum, row) => sum + Math.max(0, parseJodAmount(row[direction]) ?? 0), 0));
      if (Math.abs(total - invoiceAmount) > toleranceJod) continue;
      direct.push({
        method: 'supplier-date-aggregate', rowNumbers: members.map(row => row.rowNumber).filter(Number.isFinite),
        journalReference: [...new Set(members.map(row => String(row.reference ?? '').trim()).filter(Boolean))].join(', '),
        transactionDate: invoiceDate, accountCodes: [...new Set(members.map(row => String(row.accountCode ?? '').trim()).filter(Boolean))],
        descriptions: [...new Set(members.map(row => String(row.description ?? '').trim()).filter(Boolean))],
        counterpartyNames: [...new Set(members.map(row => String(row.counterparty ?? '').trim()).filter(Boolean))],
        debitTotalJod: direction === 'debit' ? total : 0, creditTotalJod: direction === 'credit' ? total : 0,
        comparisonAmountJod: total, amountDifferenceJod: round(total - invoiceAmount), dateDifferenceDays: 0,
        partyMatch: true, amountOk: true, dateOk: true, score: 8,
      });
    }
  }
  const unique = [...new Map(direct.map(candidate => [candidate.method + '|' + candidate.rowNumbers.join(',') + '|' + candidate.journalReference, candidate])).values()]
    .sort((a, b) => b.score - a.score || Math.abs(a.dateDifferenceDays ?? 0) - Math.abs(b.dateDifferenceDays ?? 0));
  let status = unique.length === 0 ? 'unmatched' : unique.length === 1 ? 'possible-match-needs-review' : 'ambiguous-candidate';
  let statusLabel = unique.length === 0 ? 'لم يُعثر على مرشح' : unique.length === 1 ? 'مرشح يحتاج مراجعة' : 'مرشحون متعددون';
  let message = unique.length === 0
    ? 'لم يُعثر على مرشح حسب المبلغ والتاريخ والطرف المقابل. تحقق من نطاق دفتر الأستاذ والمرجع والعملة.'
    : unique.length === 1
      ? 'المبلغ قريب ضمن هامش الفحص؛ لا يوجد مرجع مستند مطابق، لذا يلزم تأكيد يدوي قبل ربطه.'
      : 'يوجد أكثر من مرشح؛ لا يستطيع النظام اختيار الحركة الصحيحة تلقائيًا.';
  if (currencyUnconfirmed) { message += ' العملة في الفاتورة غير محددة، فتحقق منها يدويًا.'; statusLabel += ' · العملة غير مؤكدة'; }
  return { ...base, status, statusLabel, message, candidates: unique.slice(0, 8), exactReferenceRows: 0 };
}


/**
 * Indexes the ledger once, then returns review suggestions for each invoice.
 * No match is ever promoted to an approved reconciliation automatically.
 */
export function matchInvoiceRegisterToJournal(invoices = [], journalRows = [], options = {}) {
  const bills = Array.isArray(invoices) ? invoices : [];
  const ledger = Array.isArray(journalRows) ? journalRows : [];
  const toleranceRaw = Number(options.toleranceJod);
  const toleranceJod = Number.isFinite(toleranceRaw) && toleranceRaw >= 0 ? Math.min(toleranceRaw, 5) : 0.001;
  const windowRaw = Number(options.dateWindowDays);
  const dateWindowDays = Number.isFinite(windowRaw) ? Math.max(0, Math.min(60, Math.trunc(windowRaw))) : 3;
  const byReference = new Map();
  const byAmountFils = new Map();
  const byTokenAndDate = new Map();
  const rowAmounts = new Map();

  const pushMap = (map, key, row) => {
    if (!key) return;
    const list = map.get(key) || [];
    list.push(row); map.set(key, list);
  };
  const getAmount = row => {
    const debit = parseJodAmount(row?.debit), credit = parseJodAmount(row?.credit), amount = parseJodAmount(row?.amount);
    return Math.max(Math.abs(debit ?? 0), Math.abs(credit ?? 0), Math.abs(amount ?? 0));
  };
  for (const row of ledger) {
    const reference = normalizedInvoiceReference(row?.reference);
    if (reference) pushMap(byReference, reference, row);
    const amount = getAmount(row);
    if (Number.isFinite(amount) && amount > 0) {
      const fils = Math.round(roundJod(amount) * 1000);
      pushMap(byAmountFils, String(fils), row);
      rowAmounts.set(row, amount);
    }
    const date = normalizeInvoiceDate(row?.date);
    if (date) {
      const partyAndDescription = normText(String(row?.counterparty ?? row?.supplierName ?? '') + ' ' + String(row?.description ?? ''));
      for (const token of new Set(partyAndDescription.split(/\s+/).filter(part => part.length >= 3))) pushMap(byTokenAndDate, token + '|' + date, row);
    }
  }

  const results = bills.map(invoice => {
    const reference = normalizedInvoiceReference(invoice?.invoiceId ?? invoice?.invoiceNo ?? invoice?.reference ?? '');
    let candidates = reference ? (byReference.get(reference) || []) : [];
    if (!candidates.length) {
      const set = new Set();
      const amountRaw = invoice?.payableAmount ?? invoice?.totalJod ?? invoice?.totalAmount ?? invoice?.amount;
      const amount = amountRaw === null || amountRaw === undefined || String(amountRaw).trim() === '' ? null : parseJodAmount(amountRaw);
      if (amount !== null && amount > 0 && Number.isFinite(amount)) {
        const center = Math.round(roundJod(amount) * 1000);
        const radius = Math.ceil(toleranceJod * 1000) + 1;
        for (let delta = -radius; delta <= radius; delta += 1) {
          for (const row of byAmountFils.get(String(center + delta)) || []) {
            if (Math.abs((rowAmounts.get(row) ?? 0) - amount) <= toleranceJod + 0.000001) set.add(row);
          }
        }
      }

      const invoiceDate = normalizeInvoiceDate(invoice?.issueDate ?? invoice?.date);
      if (invoiceDate && String(invoice?.supplierName ?? '').trim()) {
        const tokens = [...new Set(normText(invoice.supplierName).split(/\s+/).filter(token => token.length >= 3))];
        const baseDate = Date.parse(invoiceDate + 'T00:00:00Z');
        for (let offset = -dateWindowDays; offset <= dateWindowDays; offset += 1) {
          const dateKey = new Date(baseDate + offset * 86400000).toISOString().slice(0, 10);
          for (const token of tokens) for (const row of byTokenAndDate.get(token + '|' + dateKey) || []) set.add(row);
        }
      }
      candidates = [...set];
    }

    const match = matchInvoiceToJournal(invoice, candidates, { toleranceJod, dateWindowDays });
    return { invoice, match };
  });
  const statusCounts = results.reduce((out, item) => {
    out[item.match.status] = (out[item.match.status] || 0) + 1;
    return out;
  }, {});
  return {
    invoiceCount: bills.length,
    journalRowCount: ledger.length,
    matchedCandidateCount: results.filter(item => item.match.candidates.length > 0 && !['invalid-invoice-amount', 'unsupported-currency', 'reference-conflict'].includes(item.match.status)).length,
    conflictCount: results.filter(item => ['reference-conflict', 'unsupported-currency', 'invalid-invoice-amount'].includes(item.match.status)).length,
    unmatchedCount: results.filter(item => item.match.status === 'unmatched').length,
    statusCounts,
    results,
    disclaimer: 'هذه مرشحات مطابقة محلية وليست إثباتًا من المورد أو اعتمادًا ضريبيًا أو تسوية تلقائية. راجع المستند الأصلي والقيد والعملات وفترة التسجيل قبل ربط الدليل أو اعتماد النتيجة.',
  };
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


/**
 * Suggest internal PBC requests from open risk descriptions.
 * Deterministic rule-based suggestions only; the auditor edits and approves the requests.
 */
export function suggestRiskPbcRequestsFromRisks(risks) {
  const data = Array.isArray(risks) ? risks : [];
  const suggestions = [];
  const rules = [
    { test: /(bank|cash|treasury|بنك|نقد|صندوق|تسهيلات|مصادقات بنكية)/, docs: ['كشف حساب بنكي كامل للفترة مع الأرصدة الافتتاحية والختامية', 'مطابقة البنك وتسوية البنود المعلقة مع مستنداتها', 'مصادقة بنك مستقلة وتفاصيل التسهيلات والضمانات'] },
    { test: /(revenue|sales|income|إيراد|ايراد|مبيعات|اعتراف)/, docs: ['عينة فواتير مبيعات مع أوامر الشراء ومستندات التسليم', 'سجل المبيعات حول نهاية الفترة ومستندات القطع المحاسبي', 'سياسة الاعتراف بالإيراد والعقود أو أوامر العملاء ذات الصلة'] },
    { test: /(inventory|stock|warehouse|مخزون|مستودع|مخزون)/, docs: ['قائمة المخزون حسب الصنف والموقع وتقرير الحركة', 'محاضر الجرد الفعلي وتسويات فروق الجرد', 'تحليل تقادم المخزون وتقييم صافي القيمة القابلة للتحقق'] },
    { test: /(receivable|customer|debtor|ذمم مدينة|عملاء|مدينون)/, docs: ['كشف أعمار الذمم المدينة ومطابقته مع دفتر الأستاذ', 'عينة فواتير ومتحصلات لاحقة وإثبات التسليم', 'مصادقات أرصدة العملاء وتحليل المبالغ المتنازع عليها'] },
    { test: /(payable|supplier|vendor|ذمم دائنة|مورد|دائنون|مشتريات)/, docs: ['كشف أعمار الذمم الدائنة وكشوف الموردين', 'فواتير الموردين والاستلامات والمدفوعات اللاحقة', 'فحص الالتزامات غير المسجلة حول نهاية الفترة'] },
    { test: /(payroll|salary|staff|رواتب|أجور|موظفين)/, docs: ['كشف الرواتب ومطابقته مع ملف الموظفين والموافقات', 'إثبات تحويل الرواتب والاستقطاعات والاشتراكات', 'تسويات مكافآت ونهاية خدمة ومستحقات الموظفين'] },
    { test: /(fixed asset|property plant|asset|أصول ثابتة|أصل ثابت|آلات|مركبات)/, docs: ['سجل الأصول الثابتة والإضافات والاستبعادات', 'فواتير شراء الأصول ومحاضر الاستلام والتصرف', 'احتساب الإهلاك وربط الأعمار الإنتاجية والسياسات'] },
    { test: /(related party|related parties|طرف ذو علاقة|أطراف ذات علاقة|طرف مرتبط)/, docs: ['سجل الأطراف ذات العلاقة والمعاملات والأرصدة', 'العقود والموافقات ومحاضر مجلس الإدارة المتعلقة بالطرف', 'مطابقات الأرصدة والإفصاحات ذات الصلة'] },
    { test: /(it|access|system|cyber|صلاحيات|نظام|تقني|معلوماتي)/, docs: ['قائمة المستخدمين والصلاحيات وموافقات منح أو إلغاء الوصول', 'سجل التغييرات والعمليات الحساسة خلال الفترة', 'تقارير النسخ الاحتياطي والاستعادة والحوادث التقنية'] },
  ];
  const seen = new Set();
  for (const risk of data) {
    const status = normText(risk?.status);
    if (['مغلق', 'مغلقة', 'مكتمل', 'closed', 'resolved'].includes(status)) continue;
    const riskTitle = String(risk?.title ?? '').trim();
    if (!riskTitle) continue;
    const context = normText([risk?.title, risk?.area].filter(Boolean).join(' '));
    const matching = rules.filter(rule => rule.test.test(context));
    const docs = matching.length
      ? [...new Set(matching.flatMap(rule => rule.docs))]
      : ['مستندات المصدر والمستندات المؤيدة للمعاملة أو الرصيد موضوع الخطر', 'تحليل تفصيلي للحساب والسجلات الداعمة للفترة', 'موافقات الإدارة والإجراءات الرقابية ذات الصلة بالخطر'];
    for (const doc of docs) {
      const title = doc + ' — متابعة الخطر: ' + riskTitle;
      const key = normText(title);
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ title, sourceRiskId: String(risk.id ?? ''), riskTitle, area: String(risk.area ?? '') });
      if (suggestions.length >= 40) return suggestions;
    }
  }
  return suggestions;
}
