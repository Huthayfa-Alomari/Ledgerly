const TOLERANCE = 0.01;

function cleanText(value) {
  return String(value ?? '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/ـ/g, '').toLowerCase().trim();
}

function normalizedHeader(value) {
  return cleanText(value).replace(/[\s_\-./\\()[\]{}:،,;]+/g, '');
}

function firstMatch(headers, aliases) {
  const normalized = headers.map(h => ({ header: h, key: normalizedHeader(h) }));
  const keys = aliases.map(normalizedHeader);
  for (const key of keys) {
    const exact = normalized.find(h => h.key === key);
    if (exact) return exact.header;
  }
  for (const key of keys) {
    const contains = normalized.find(h => h.key.includes(key) || key.includes(h.key));
    if (contains && contains.key.length > 2) return contains.header;
  }
  return undefined;
}

export function parseAuditAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (input === null || input === undefined || String(input).trim() === '') return null;
  let value = String(input).replace(/\u066C/g, ',').replace(/\u066B/g, '.').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).trim();
  const negative = /^\s*\(.*\)\s*$/.test(value) || /-$/.test(value);
  value = value.replace(/[()]/g, '').replace(/-/g, '').replace(/[^\d,.\s]/g, '').replace(/\s/g, '');
  if (!value) return null;
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) value = value.replace(/\./g, '').replace(',', '.');
    else value = value.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = value.length - lastComma - 1;
    value = decimals > 0 && decimals <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else {
    const dots = (value.match(/\./g) || []).length;
    if (dots > 1) {
      const last = value.lastIndexOf('.');
      value = value.slice(0, last).replace(/\./g, '') + value.slice(last);
    }
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return negative ? -Math.abs(amount) : amount;
}

function parseDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = cleanText(value);
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (d.getFullYear() === Number(iso[1]) && d.getMonth() === Number(iso[2]) - 1 && d.getDate() === Number(iso[3])) return d.toISOString().slice(0, 10);
    return '';
  }
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? (Number(dmy[3]) < 70 ? 2000 + Number(dmy[3]) : 1900 + Number(dmy[3])) : Number(dmy[3]);
    const d = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    if (d.getFullYear() === year && d.getMonth() === Number(dmy[2]) - 1 && d.getDate() === Number(dmy[1])) return d.toISOString().slice(0, 10);
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : '';
}

/**
 * Convert rows read from a CSV/XLSX worksheet into a canonical journal format.
 * Ambiguous single-amount rows are deliberately not assigned to debit or credit.
 * @param {Array<Record<string, any>>} records
 */
export function normalizeJournalRows(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { rows: [], sourceCount: 0, fieldsDetected: [], warnings: ['الملف لا يحتوي على صفوف بيانات.'] };
  }
  const headers = Array.from(new Set(records.flatMap(row => Object.keys(row || {}))));
  const dateH = firstMatch(headers, ['date', 'posting date', 'transaction date', 'document date', 'التاريخ', 'تاريخ القيد', 'تاريخ الحركة', 'تاريخ المستند']);
  const descriptionH = firstMatch(headers, ['description', 'details', 'memo', 'narration', 'البيان', 'الوصف', 'تفاصيل', 'شرح القيد']);
  const accountH = firstMatch(headers, ['account code', 'account number', 'account', 'gl code', 'رقم الحساب', 'رمز الحساب', 'الحساب', 'كود الحساب']);
  const referenceH = firstMatch(headers, ['reference', 'document no', 'document number', 'voucher no', 'entry id', 'رقم المرجع', 'رقم المستند', 'رقم القيد', 'رقم السند']);
  const debitH = firstMatch(headers, ['debit', 'debit amount', 'dr', 'مدين', 'مبلغ مدين', 'المدين']);
  const creditH = firstMatch(headers, ['credit', 'credit amount', 'cr', 'دائن', 'مبلغ دائن', 'الدائن']);
  const amountH = firstMatch(headers, ['amount', 'transaction amount', 'value', 'المبلغ', 'قيمة الحركة', 'قيمة']);
  const directionH = firstMatch(headers, ['direction', 'type', 'dc flag', 'debit credit', 'nature', 'نوع الحركة', 'الطبيعة', 'مدين دائن']);
  const warnings = [];
  if (!dateH) warnings.push('لم يُكتشف عمود تاريخ واضح.');
  if (!descriptionH) warnings.push('لم يُكتشف عمود بيان أو وصف واضح.');
  if (!accountH) warnings.push('لم يُكتشف عمود رقم/رمز حساب واضح.');
  if (!debitH && !creditH && amountH && !directionH) warnings.push('الملف يحتوي عمود مبلغ واحد دون نوع الحركة؛ لن نفترض أنه مدين أو دائن.');
  if (!debitH && !creditH && !amountH) warnings.push('لم يُكتشف عمود مبلغ أو أعمدة مدين/دائن.');

  const rows = records.map((raw, index) => {
    const get = h => h ? raw?.[h] : undefined;
    let debit = debitH ? parseAuditAmount(get(debitH)) : null;
    let credit = creditH ? parseAuditAmount(get(creditH)) : null;
    const amount = amountH ? parseAuditAmount(get(amountH)) : null;
    let classification = 'debit-credit-columns';
    if (!debitH && !creditH && amountH && directionH) {
      const direction = cleanText(get(directionH));
      if (/(دائن|credit|\bcr\b|كريديت)/i.test(direction)) { debit = 0; credit = amount; classification = 'direction-column'; }
      else if (/(مدين|debit|\bdr\b)/i.test(direction)) { debit = amount; credit = 0; classification = 'direction-column'; }
      else { debit = null; credit = null; classification = 'ambiguous-amount'; }
    } else {
      if (!debitH && creditH) debit = 0;
      if (!creditH && debitH) credit = 0;
    }
    return {
      rowNumber: index + 2,
      date: parseDate(get(dateH)),
      dateRaw: String(get(dateH) ?? ''),
      description: String(get(descriptionH) ?? '').trim(),
      accountCode: String(get(accountH) ?? '').trim(),
      reference: String(get(referenceH) ?? '').trim(),
      debit,
      credit,
      amount,
      classification,
      raw: { ...raw },
    };
  }).filter(row => Object.values(row.raw).some(value => String(value ?? '').trim() !== ''));
  return {
    rows,
    sourceCount: rows.length,
    fieldsDetected: [dateH, descriptionH, accountH, debitH, creditH, amountH, directionH, referenceH].filter(Boolean),
    warnings,
  };
}

function amountOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function round2(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function issue(id, severity, title, count, detail, action) {
  return { id, severity, title, count, detail, action };
}

/**
 * Runs explainable consistency checks against the imported TB.
 * Does not determine accounting correctness or form an audit conclusion.
 * @param {Array<Record<string, any>>} rows
 */
export function runDataTrustChecks(rows) {
  const data = Array.isArray(rows) ? rows : [];
  const issues = [];
  if (!data.length) {
    issues.push(issue('tb-empty', 'high', 'لا يوجد ميزان مراجعة', 1, 'لم يتم العثور على صفوف ميزان مراجعة مرتبطة بالمهمة الحالية.', 'استورد ملفًا وتحقق من تعيين الأعمدة قبل بدء التحليل.'));
    return { rowCount: 0, totals: { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 }, closingDifference: 0, issues, pass: false };
  }
  const seenCodes = new Map();
  const duplicateCodes = [];
  const missingIdentity = [];
  const negatives = [];
  const bothClosingSides = [];
  const bridgeVariances = [];
  let openingDebit = 0, openingCredit = 0, debit = 0, credit = 0, closingDebit = 0, closingCredit = 0;
  for (const row of data) {
    const code = String(row.code ?? '').trim();
    const name = String(row.name ?? '').trim();
    if (!code || !name) missingIdentity.push(code || name || '(بدون رمز أو اسم)');
    if (code) {
      if (seenCodes.has(code)) duplicateCodes.push(code);
      else seenCodes.set(code, true);
    }
    for (const field of ['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit']) {
      if (row[field] !== undefined && row[field] !== null && row[field] !== '' && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)) negatives.push({ code, field, value: row[field] });
    }
    const od = amountOf(row.openingDebit), oc = amountOf(row.openingCredit), dr = amountOf(row.debit), cr = amountOf(row.credit);
    const cd = amountOf(row.closingDebit), cc = amountOf(row.closingCredit);
    openingDebit += od; openingCredit += oc; debit += dr; credit += cr; closingDebit += cd; closingCredit += cc;
    if (cd > TOLERANCE && cc > TOLERANCE) bothClosingSides.push(code || name || '(بدون حساب)');
    const present = ['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'].every(field => row[field] !== undefined && row[field] !== null && row[field] !== '');
    if (present) {
      const expectedNet = (od - oc) + (dr - cr);
      const actualNet = cd - cc;
      const variance = round2(expectedNet - actualNet);
      if (Math.abs(variance) > TOLERANCE) bridgeVariances.push({ code: code || name, variance });
    }
  }
  const closingDifference = round2(closingDebit - closingCredit);
  if (missingIdentity.length) issues.push(issue('tb-identity', 'medium', 'حسابات ناقصة التعريف', missingIdentity.length, 'بعض الصفوف تفتقد رمز الحساب أو اسمه؛ قد تتأثر المطابقة والتجميع.', 'صحّح الأعمدة أو بيانات المصدر، ثم أعد تشغيل الفحص.'));
  if (duplicateCodes.length) issues.push(issue('tb-duplicate-code', 'medium', 'رموز حسابات مكررة', duplicateCodes.length, 'وجدت رموز حساب متكررة. قد يكون التكرار صحيحًا عند وجود أكثر من بُعد أو مركز تكلفة؛ راجع مفتاح الحساب قبل الدمج.', 'تحقق من رمز الحساب ومركز التكلفة والفترة قبل اعتبارها سجلات مكررة.'));
  if (negatives.length) issues.push(issue('tb-negative', 'medium', 'قيم سالبة أو غير رقمية', negatives.length, 'هناك حقول مالية سالبة أو غير رقمية في ميزان المراجعة، وقد تكون إشارة إلى خطأ في تعيين الأعمدة أو اصطلاح الإشارة.', 'راجع طريقة تمثيل المدين والدائن في ملف المصدر.'));
  if (bothClosingSides.length) issues.push(issue('tb-both-sides', 'low', 'حسابات لها مدين ودائن ختامي معًا', bothClosingSides.length, 'رُصدت أرصدة مدين ودائن معًا في الصف نفسه؛ قد يكون ذلك مسموحًا في المصدر لكنه يحتاج تفسيرًا.', 'افحص تصميم الميزان وسياسة عرض الأرصدة قبل إعادة التصنيف.'));
  if (Math.abs(closingDifference) > TOLERANCE) issues.push(issue('tb-unbalanced', 'high', 'إجمالي الميزان الختامي غير متوازن', 1, 'صافي المدين الختامي لا يساوي صافي الدائن الختامي بفارق ' + closingDifference.toFixed(2) + ' د.أ.', 'تأكد من اكتمال الحسابات، وتعيين الأعمدة، والفترة المحاسبية.'));
  if (bridgeVariances.length) issues.push(issue('tb-rollforward', 'medium', 'اختلاف بين حركة الفترة والرصيد الختامي', bridgeVariances.length, 'الرصيد الختامي لبعض الحسابات لا يساوي الرصيد الافتتاحي مضافًا إليه الحركة الصافية؛ قد يكون نطاق البيانات جزئيًا أو أن الأعمدة لا تمثل حركة الفترة كاملة.', 'تأكد أن الأعمدة تغطي الفترة نفسها وأن الرصيد الختامي مبني على الحركة المستوردة.'));
  return {
    rowCount: data.length,
    totals: { openingDebit: round2(openingDebit), openingCredit: round2(openingCredit), debit: round2(debit), credit: round2(credit), closingDebit: round2(closingDebit), closingCredit: round2(closingCredit) },
    closingDifference,
    issues,
    pass: issues.length === 0,
  };
}

/**
 * Run transparent rule-based screening over every imported journal row.
 * Results are risk indicators for auditor review, never findings of fraud.
 * @param {Array<Record<string, any>>} rows
 */
export function analyzeJournalEntries(rows) {
  const data = Array.isArray(rows) ? rows : [];
  const issues = [];
  const pushGroup = (id, severity, title, offending, detail, action) => {
    if (offending.length) issues.push({ id, severity, title, count: offending.length, rowNumbers: offending.map(row => row.rowNumber), examples: offending.slice(0, 10), detail, action });
  };
  pushGroup('journal-missing-date', 'medium', 'تاريخ مفقود أو غير مفهوم', data.filter(row => !row.date), 'تعذر استخراج تاريخ موحد من بعض الصفوف؛ قد لا يمكن اختبار الفترة أو التسلسل الزمني.', 'راجع تنسيق التاريخ ومطابقة عمود التاريخ.');
  pushGroup('journal-missing-description', 'low', 'وصف القيد فارغ', data.filter(row => !String(row.description ?? '').trim()), 'بعض القيود لا تحمل وصفًا يساعد على فهم طبيعتها.', 'راجع وصف القيد أو المستند المصدر.');
  pushGroup('journal-missing-account', 'medium', 'رمز الحساب مفقود', data.filter(row => !String(row.accountCode ?? '').trim()), 'بعض الصفوف لا تحمل رمز حساب قابلًا للتجميع.', 'راجع عمود الحساب في المصدر.');
  pushGroup('journal-ambiguous-amount', 'high', 'المبلغ لا يحدد جهة الحركة', data.filter(row => row.classification === 'ambiguous-amount' || (row.debit === null && row.credit === null)), 'يوجد مبلغ منفرد دون عمود مدين/دائن أو مؤشر موثوق للجهة؛ لم يخمّن Ledgerly جهة القيد.', 'أضف عمودَي المدين والدائن أو عمود نوع الحركة قبل الاعتماد على التحليل.');
  pushGroup('journal-invalid-amount', 'high', 'مبلغ غير صالح أو سطر على الجانبين', data.filter(row => {
    const dr = row.debit, cr = row.credit;
    return (dr !== null && dr !== undefined && !Number.isFinite(Number(dr))) ||
      (cr !== null && cr !== undefined && !Number.isFinite(Number(cr))) ||
      (dr !== null && cr !== null && Number(dr) < 0) || (cr !== null && Number(cr) < 0) ||
      (dr !== null && cr !== null && Number(dr) > TOLERANCE && Number(cr) > TOLERANCE);
  }), 'تحتوي بعض الأسطر على قيم سالبة أو غير رقمية أو على جهتي المدين والدائن في السطر نفسه.', 'تحقق من اصطلاح الإشارة، وتعيين الأعمدة، ومستوى تفصيل القيود.');
  pushGroup('journal-zero-amount', 'low', 'سطر بلا مبلغ واضح', data.filter(row => row.debit === 0 && row.credit === 0 && (row.amount === null || row.amount === undefined || row.amount === 0)), 'بعض الصفوف لا يظهر فيها مبلغ مدين أو دائن.', 'تحقق إن كانت الصفوف عناوين أو إجماليات أو قيودًا غير مكتملة.');
  const signatureMap = new Map();
  for (const row of data) {
    const signature = [row.date, cleanText(row.accountCode), cleanText(row.description), String(row.debit ?? ''), String(row.credit ?? ''), cleanText(row.reference)].join('|');
    if (!signature.replace(/\|/g, '').trim()) continue;
    const list = signatureMap.get(signature) || [];
    list.push(row);
    signatureMap.set(signature, list);
  }
  const duplicateRows = [];
  for (const entries of signatureMap.values()) if (entries.length > 1) duplicateRows.push(...entries);
  pushGroup('journal-duplicate-line', 'high', 'أسطر متطابقة تستحق التحقق', duplicateRows, 'وجد النظام صفوفًا متطابقة في التاريخ والحساب والوصف والمبلغ والمرجع. التطابق لا يثبت التكرار غير المشروع؛ قد تكون نسخة مكررة من ملف المصدر.', 'قارن مع دفتر الأستاذ والمستند الأصلي قبل حذف أو استبعاد أي صف.');
  const datedRows = data.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(String(row.date ?? '')));
  const monthEndRows = datedRows.filter(row => {
    const d = new Date(row.date + 'T12:00:00Z');
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return d.getUTCDate() >= lastDay - 2;
  });
  pushGroup('journal-month-end', 'low', 'قيود في آخر ثلاثة أيام من الشهر', monthEndRows, 'القيود قرب نهاية الشهر قد تكون طبيعية، لكنها قد تستحق الفحص ضمن إجراءات الإقفال بحسب المخاطر.', 'اربط عينة القيود بالمستندات، وتوقيت الاعتماد، وأي عكس لاحق.');
  const magnitudes = data.map(row => Math.max(Math.abs(Number(row.debit) || 0), Math.abs(Number(row.credit) || 0))).filter(x => x > 0).sort((a, b) => a - b);
  let largeRows = [];
  if (magnitudes.length >= 10) {
    const median = magnitudes[Math.floor((magnitudes.length - 1) / 2)];
    const threshold = median * 5;
    if (threshold > 0) largeRows = data.filter(row => Math.max(Math.abs(Number(row.debit) || 0), Math.abs(Number(row.credit) || 0)) > threshold);
  }
  pushGroup('journal-large-amount', 'medium', 'مبالغ أكبر بكثير من الوسيط', largeRows, 'وجد النظام مبالغ تتجاوز خمسة أضعاف وسيط القيم غير الصفرية في الملف. هذه مقارنة داخلية فقط وقد لا تعكس الأهمية النسبية المهنية.', 'قارن القيم بالحدود المعتمدة للأهمية النسبية وطبيعة النشاط.');
  const counts = issues.reduce((out, item) => { out[item.severity] = (out[item.severity] || 0) + item.count; return out; }, {});
  return { scannedCount: data.length, issueCount: issues.reduce((sum, item) => sum + item.count, 0), counts, issues, monthEndSignals: monthEndRows.length, hasRows: data.length > 0 };
}

/**
 * Build traceability links from the engagement's workpapers and evidence.
 * @param {Array<Record<string, any>>} workpapers
 * @param {Array<Record<string, any>>} evidence
 */
export function buildEvidenceLineage(workpapers, evidence) {
  const papers = Array.isArray(workpapers) ? workpapers : [];
  const items = Array.isArray(evidence) ? evidence : [];
  const byRef = new Map(papers.map(p => [String(p.ref ?? '').trim(), p]).filter(([ref]) => Boolean(ref)));
  const links = items.map(item => {
    const ref = String(item.workpaperRef ?? '').trim();
    const workpaper = ref ? byRef.get(ref) : undefined;
    return { evidence: item, workpaper, linked: Boolean(workpaper), reason: !ref ? 'missing-reference' : !workpaper ? 'unknown-reference' : 'linked' };
  });
  const workpaperRows = papers.map(workpaper => {
    const linkedEvidence = items.filter(item => String(item.workpaperRef ?? '').trim() === String(workpaper.ref ?? '').trim());
    return { workpaper, evidenceCount: linkedEvidence.length, evidence: linkedEvidence };
  });
  return {
    workpaperCount: papers.length,
    evidenceCount: items.length,
    linkedEvidenceCount: links.filter(link => link.linked).length,
    unlinkedEvidenceCount: links.filter(link => !link.linked).length,
    workpapersWithoutEvidence: workpaperRows.filter(row => row.evidenceCount === 0).length,
    links,
    workpapers: workpaperRows,
  };
}

/**
 * Checks administrative completeness, not evidence sufficiency or audit quality.
 * @param {object} input
 * @param {Array<Record<string, any>>} input.workpapers
 * @param {Array<Record<string, any>>} input.evidence
 * @param {Array<Record<string, any>>} input.findings
 * @param {Array<Record<string, any>>} input.risks
 * @param {Array<Record<string, any>>} input.trialBalance
 */
export function buildQualityShield(input) {
  const workpapers = input.workpapers || [];
  const evidence = input.evidence || [];
  const findings = input.findings || [];
  const risks = input.risks || [];
  const tb = runDataTrustChecks(input.trialBalance || []);
  const lineage = buildEvidenceLineage(workpapers, evidence);
  const checks = [];
  const add = (id, severity, title, count, detail, action) => {
    checks.push({ id, severity, title, count, detail, action, state: count > 0 ? 'needs-attention' : 'clear' });
  };
  add('quality-tb', 'high', 'تنبيهات جودة ميزان المراجعة', tb.issues.length, 'عدد أنواع فحوص الميزان التي تحتاج مراجعة: ' + tb.issues.length + '.', 'راجع كل فحص على حدة ولا تعتمد الإجماليات قبل فهم الاستثناءات.');
  add('quality-workpaper-status', 'medium', 'أوراق عمل غير معتمدة', workpapers.filter(row => row.status !== 'معتمد').length, 'اعتُبرت الورقة معتمدة فقط عندما تكون حالتها المسجلة "معتمد".', 'راجع الإجراء والاستنتاج والأدلة، ثم أكمل الاعتماد وفق صلاحيات المكتب.');
  add('quality-workpaper-procedure', 'medium', 'أوراق بلا إجراء موثق', workpapers.filter(row => !String(row.procedure ?? '').trim()).length, 'بعض أوراق العمل لا تحتوي نصًا في حقل الإجراء.', 'وثّق طبيعة الإجراء ونطاقه وتنفيذه؛ لا تملأ الحقل شكليًا دون تنفيذ.');
  add('quality-workpaper-conclusion', 'medium', 'أوراق بلا استنتاج موثق', workpapers.filter(row => !String(row.conclusion ?? '').trim()).length, 'بعض أوراق العمل لا تحتوي استنتاجًا مسجلًا.', 'سجّل استنتاج المدقق المدعوم بالأدلة المناسبة.');
  add('quality-evidence-link', 'medium', 'أدلة بلا ربط بورقة عمل', lineage.unlinkedEvidenceCount, 'الارتباط المرجعي وحده لا يثبت كفاية الدليل أو ملاءمته.', 'اربط كل دليل بورقة العمل المقصودة وتحقق من محتواه وصلاحيته.');
  add('quality-paper-no-evidence', 'low', 'أوراق بلا أدلة مفهرسة', lineage.workpapersWithoutEvidence, 'قد لا تحتاج كل ورقة إلى مرفق مستقل بحسب طبيعة الإجراء، لذلك هذه إشارة وليست قاعدة منع مطلقة.', 'راجع ما إذا كان الدليل محفوظًا أو إذا كان الإجراء لا يتطلب مرفقًا.');
  add('quality-finding-documentation', 'medium', 'ملاحظات ناقصة عناصر التوثيق', findings.filter(row => ['criteria', 'condition', 'effect', 'recommendation'].some(field => !String(row[field] ?? '').trim())).length, 'تفتقد بعض الملاحظات معيارًا أو حالة أو أثرًا أو توصية.', 'أكمل العناصر ذات الصلة وفق منهجية المكتب قبل اعتماد الملاحظة.');
  add('quality-open-findings', 'medium', 'ملاحظات غير مغلقة', findings.filter(row => !['مغلقة', 'مغلق', 'مكتمل'].includes(String(row.status ?? ''))).length, 'هذه الملاحظات لم تُسجل كإغلاق إداري.', 'راجع رد الإدارة والأدلة والإجراءات المطلوبة قبل الإغلاق.');
  add('quality-high-risks', 'high', 'مخاطر عالية مسجلة', risks.filter(row => ['مرتفع', 'عالي', 'high'].includes(cleanText(row.impact)) || ['مرتفع', 'عالي', 'high'].includes(cleanText(row.likelihood))).length, 'وجود خطر مرتفع لا يعني وجود تحريف مؤكد؛ يجب ربطه باستجابة تدقيق مناسبة.', 'تأكد من أن استجابة التدقيق موثقة ومتناسبة مع تقييم الخطر.');
  const blockers = checks.filter(row => row.count > 0 && row.severity === 'high').length;
  const attentionCount = checks.filter(row => row.count > 0).length;
  return { checks, blockers, attentionCount, passed: attentionCount === 0, tb, lineage, summary: { workpapers: workpapers.length, evidence: evidence.length, findings: findings.length, risks: risks.length } };
}

/**
 * Create a portfolio view for partner review, including one quality snapshot per engagement.
 * @param {Array<Record<string, any>>} engagements
 * @param {Array<Record<string, any>>} clients
 * @param {Record<string, any>} database
 */
export function buildPartnerDashboard(engagements, clients, database) {
  return (engagements || []).map(engagement => {
    const id = engagement.id;
    const scoped = rows => (rows || []).filter(row => row.engagementId === id);
    const papers = scoped(database.workpapers);
    const evidence = scoped(database.evidence);
    const findings = scoped(database.findings);
    const risks = scoped(database.risks);
    const tbRows = scoped(database.trialBalance);
    const quality = buildQualityShield({ workpapers: papers, evidence, findings, risks, trialBalance: tbRows });
    return {
      engagement,
      client: (clients || []).find(client => client.id === engagement.clientId),
      workpaperCount: papers.length,
      pendingWorkpapers: papers.filter(p => p.status !== 'معتمد').length,
      unlinkedEvidence: quality.lineage.unlinkedEvidenceCount,
      openFindings: findings.filter(f => !['مغلقة', 'مغلق', 'مكتمل'].includes(String(f.status ?? ''))).length,
      highRisks: risks.filter(r => ['مرتفع', 'عالي', 'high'].includes(cleanText(r.impact)) || ['مرتفع', 'عالي', 'high'].includes(cleanText(r.likelihood))).length,
      qualityAttention: quality.attentionCount,
      state: String(engagement.status ?? ''),
    };
  }).sort((a, b) => (b.qualityAttention - a.qualityAttention) || (b.openFindings - a.openFindings) || String(a.client?.name ?? '').localeCompare(String(b.client?.name ?? ''));
}

/** @param {Array<Record<string, any>>} items */
export function summarizeFindingsForAssistant(items) {
  const issues = Array.isArray(items) ? items : [];
  if (!issues.length) return ['لم تظهر استثناءات وفق قواعد الفحص الحالية. هذا لا يثبت خلو الملف من الأخطاء؛ راجع إجراءات التدقيق المناسبة.'];
  return issues.slice(0, 8).map(item => ({
    id: item.id,
    priority: item.severity === 'high' ? 'أولوية عالية' : item.severity === 'medium' ? 'أولوية متوسطة' : 'إشارة للمراجعة',
    title: item.title,
    action: item.action,
    source: item.count + ' صف/حالة وفق الفحص المحلي',
  }));
}
