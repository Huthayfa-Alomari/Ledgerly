const TOLERANCE = 0.001; // JOD is carried to three decimal places (fils).

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
    if (key.length < 4) continue;
    const contains = normalized.find(h => h.key.length >= 4 && h.key.includes(key));
    if (contains) return contains.header;
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
  const formatParts = (year, month, day) => {
    if (![year, month, day].every(Number.isInteger) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const check = new Date(0);
    check.setUTCHours(0, 0, 0, 0);
    check.setUTCFullYear(year, month - 1, day);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  };
  if (value instanceof Date && Number.isFinite(value.getTime())) return formatParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  const raw = cleanText(value);
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[t\s])/i);
  if (iso) return formatParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:$|[t\s])/i);
  if (dmy) {
    const shortYear = Number(dmy[3]);
    const year = dmy[3].length < 3 ? (shortYear < 70 ? 2000 + shortYear : 1900 + shortYear) : shortYear;
    return formatParts(year, Number(dmy[2]), Number(dmy[1]));
  }
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) return '';
  return formatParts(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
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
  const counterpartyH = firstMatch(headers, ['counterparty', 'vendor', 'supplier', 'payee', 'beneficiary', 'party name', 'اسم المورد', 'اسم المستفيد', 'المستفيد', 'المورد', 'اسم الطرف']);
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
    const invalidAmountFields = [];
    const hasRawValue = header => Boolean(header) && get(header) !== undefined && get(header) !== null && String(get(header)).trim() !== '';
    if (debitH && hasRawValue(debitH) && debit === null) invalidAmountFields.push('debit');
    if (creditH && hasRawValue(creditH) && credit === null) invalidAmountFields.push('credit');
    if (amountH && hasRawValue(amountH) && amount === null) invalidAmountFields.push('amount');
    if (debitH && creditH) {
      if (get(debitH) === null || get(debitH) === undefined || String(get(debitH)).trim() === '') debit = 0;
      if (get(creditH) === null || get(creditH) === undefined || String(get(creditH)).trim() === '') credit = 0;
    }
    let classification = 'debit-credit-columns';
    if (!debitH && !creditH && amountH) {
      if (directionH) {
        const direction = cleanText(get(directionH));
        if (/(دائن|credit|\bcr\b|كريديت)/i.test(direction)) { debit = 0; credit = amount; classification = 'direction-column'; }
        else if (/(مدين|debit|\bdr\b)/i.test(direction)) { debit = amount; credit = 0; classification = 'direction-column'; }
        else { debit = null; credit = null; classification = 'ambiguous-amount'; }
      } else {
        debit = null; credit = null; classification = 'ambiguous-amount';
      }
    } else {
      if (!debitH && creditH) debit = 0;
      if (!creditH && debitH) credit = 0;
    }
    if (invalidAmountFields.length) classification = 'invalid-amount';
    return {
      rowNumber: Number.isFinite(Number(raw.__sourceRowNumber)) ? Number(raw.__sourceRowNumber) : index + 2,
      date: parseDate(get(dateH)),
      dateRaw: String(get(dateH) ?? ''),
      description: String(get(descriptionH) ?? '').trim(),
      accountCode: String(get(accountH) ?? '').trim(),
      reference: String(get(referenceH) ?? '').trim(),
      counterparty: String(get(counterpartyH) ?? '').trim(),
      debit,
      credit,
      amount,
      invalidAmountFields,
      classification,
      raw: { ...raw },
    };
  }).filter(row => Object.values(row.raw).some(value => String(value ?? '').trim() !== ''));
  return {
    rows,
    sourceCount: rows.length,
    fieldsDetected: [dateH, descriptionH, accountH, debitH, creditH, amountH, directionH, referenceH, counterpartyH].filter(Boolean),
    warnings,
  };
}

function amountOf(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function roundMoney(value) { return Math.round((value + Number.EPSILON) * 1000) / 1000; }
function localIsoDate(date = new Date()) { return String(date.getFullYear()).padStart(4, '0') + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
function issue(id, severity, title, count, detail, action) {
  return { id, severity, title, count, detail, action };
}

/**
 * Runs explainable consistency checks against the imported TB.
 * Does not determine accounting correctness or form an audit conclusion.
 * @param {Array<Record<string, any>>} rows
 */
export function runDataTrustChecks(rows, options = {}) {
  const data = Array.isArray(rows) ? rows : [];
  const issues = [];
  const fields = ['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'];
  const zeroTotals = { openingDebit: 0, openingCredit: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 };
  if (!data.length) {
    issues.push(issue('tb-empty', 'high', 'لا يوجد ميزان مراجعة', 1, 'لم يتم العثور على صفوف ميزان مراجعة مرتبطة بالمهمة الحالية.', 'استورد الملف وتحقق من تعيين الأعمدة قبل بدء التحليل.'));
    return { rowCount: 0, totals: zeroTotals, availableFields: [], unmappedFields: fields, openingDifference: null, movementDifference: null, closingDifference: null, issues, pass: false };
  }
  const seenCodes = new Map(), duplicateCodes = [], missingIdentity = [], missingFinancial = [], invalidNumeric = [], negativeValues = [], bothClosingSides = [], bridgeVariances = [], duplicateRecords = [], signatureMap = new Map();
  const availableFields = fields.filter(field => data.every(row => !Array.isArray(row.sourceFinancialFields) || row.sourceFinancialFields.includes(field)));
  const unmappedFields = fields.filter(field => !availableFields.includes(field));
  const totals = { ...zeroTotals };
  data.forEach((row, index) => {
    const code = String(row.code ?? '').trim(), name = String(row.name ?? '').trim();
    const rowNumber = Number.isFinite(Number(row.rowNumber)) ? Number(row.rowNumber) : Number.isFinite(Number(row.sourceRowNumber)) ? Number(row.sourceRowNumber) : index + 2;
    if (!code || !name) missingIdentity.push({ code, name, rowNumber });
    if (code) { if (seenCodes.has(code)) duplicateCodes.push({ code, rowNumber }); else seenCodes.set(code, rowNumber); }
    for (const field of fields) {
      const raw = row[field];
      const mapped = !Array.isArray(row.sourceFinancialFields) || row.sourceFinancialFields.includes(field);
      if (!mapped) continue; // Outside this source export's schema; disclose coverage separately.
      const present = raw !== undefined && raw !== null && String(raw).trim() !== '';
      if (!present) { missingFinancial.push({ code: code || name || '(بدون حساب)', field, rowNumber }); continue; }
      const value = Number(raw);
      if (!Number.isFinite(value)) { invalidNumeric.push({ code: code || name || '(بدون حساب)', field, value: raw, rowNumber }); continue; }
      if (value < 0) negativeValues.push({ code: code || name || '(بدون حساب)', field, value, rowNumber });
      totals[field] += value;
    }
    const cd = Number(row.closingDebit), cc = Number(row.closingCredit);
    if (Number.isFinite(cd) && Number.isFinite(cc) && cd > TOLERANCE && cc > TOLERANCE) bothClosingSides.push({ code: code || name || '(بدون حساب)', rowNumber });
    const complete = fields.every(field => (!Array.isArray(row.sourceFinancialFields) || row.sourceFinancialFields.includes(field)) && row[field] !== undefined && row[field] !== null && String(row[field]).trim() !== '' && Number.isFinite(Number(row[field])));
    if (complete) {
      const expectedNet = (Number(row.openingDebit) - Number(row.openingCredit)) + (Number(row.debit) - Number(row.credit));
      const variance = roundMoney(expectedNet - (cd - cc));
      if (Number.isFinite(variance) && Math.abs(variance) >= TOLERANCE) bridgeVariances.push({ code: code || name, variance, rowNumber });
    }
    const signature = JSON.stringify([code, cleanText(name), ...fields.map(field => row[field] === undefined || row[field] === null ? '' : String(row[field]).trim())]);
    const matching = signatureMap.get(signature) || [];
    matching.push(rowNumber); signatureMap.set(signature, matching);
  });
  for (const rowNumbers of signatureMap.values()) if (rowNumbers.length > 1) duplicateRecords.push(...rowNumbers.slice(1).map(rowNumber => ({ rowNumber, firstRowNumber: rowNumbers[0] })));
  for (const key of Object.keys(totals)) totals[key] = roundMoney(totals[key]);
  const openingDifference = availableFields.includes('openingDebit') && availableFields.includes('openingCredit') ? roundMoney(totals.openingDebit - totals.openingCredit) : null;
  const movementDifference = availableFields.includes('debit') && availableFields.includes('credit') ? roundMoney(totals.debit - totals.credit) : null;
  const closingDifference = availableFields.includes('closingDebit') && availableFields.includes('closingCredit') ? roundMoney(totals.closingDebit - totals.closingCredit) : null;
  if (missingIdentity.length) issues.push({ ...issue('tb-identity', 'medium', 'حسابات ناقصة التعريف', missingIdentity.length, 'بعض الصفوف تفتقد رمز الحساب أو اسمه؛ قد تتأثر المطابقة والتجميع.', 'صحّح الأعمدة أو بيانات المصدر، ثم أعد تشغيل الفحص.'), rowNumbers: missingIdentity.map(row => row.rowNumber) });
  if (missingFinancial.length) issues.push({ ...issue('tb-missing-financial-fields', 'high', 'حقول مالية ناقصة', missingFinancial.length, 'هناك حقول افتتاحية أو حركة أو ختامية فارغة. لا تُعامل الفراغات كصفر قبل التحقق من تنسيق ملف المصدر.', 'راجع تعيين الأعمدة؛ ميّز الصفر الصريح عن الخانة الفارغة، ثم أعد الاستيراد.'), rowNumbers: [...new Set(missingFinancial.map(row => row.rowNumber))], examples: missingFinancial.slice(0, 10) });
  if (invalidNumeric.length) issues.push({ ...issue('tb-invalid-numeric', 'high', 'قيم مالية غير رقمية', invalidNumeric.length, 'تعذر تفسير بعض القيم المالية كأرقام؛ استبعادها من الإجماليات قد يجعل نتائج الاتزان مضللة.', 'صحّح القيم أو إعدادات الفواصل العشرية في المصدر وأعد الاستيراد.'), rowNumbers: [...new Set(invalidNumeric.map(row => row.rowNumber))], examples: invalidNumeric.slice(0, 10) });
  if (negativeValues.length) issues.push({ ...issue('tb-negative', 'medium', 'قيم مالية سالبة', negativeValues.length, 'تحتوي بعض الحقول المالية على قيم سالبة. قد يكون ذلك اصطلاحًا مشروعًا، لكنه يحتاج مطابقة مع طريقة عرض المصدر.', 'راجع اصطلاح الإشارة قبل تعديل أي قيمة.'), rowNumbers: [...new Set(negativeValues.map(row => row.rowNumber))], examples: negativeValues.slice(0, 10) });
  if (duplicateCodes.length) issues.push({ ...issue('tb-duplicate-code', 'medium', 'رموز حسابات مكررة', duplicateCodes.length, 'وجدت رموز حساب متكررة. قد يكون ذلك صحيحًا عند وجود أبعاد أو مراكز تكلفة؛ راجع مفتاح الحساب قبل الدمج.', 'تحقق من رمز الحساب ومركز التكلفة والفترة قبل اعتبارها سجلات مكررة.'), rowNumbers: duplicateCodes.map(row => row.rowNumber), examples: duplicateCodes.slice(0, 10) });
  if (duplicateRecords.length) issues.push({ ...issue('tb-duplicate-row', 'medium', 'صفوف ميزان مكررة بالكامل', duplicateRecords.length, 'توجد صفوف متطابقة في الحساب والاسم وجميع القيم المالية؛ قد يؤدي تكرار الاستيراد أو الصف إلى تضخيم الإجماليات.', 'قارنها بالمصدر وحدد إن كانت تكرارًا غير مقصود؛ لا تحذف صفًا تلقائيًا.'), rowNumbers: duplicateRecords.map(row => row.rowNumber), examples: duplicateRecords.slice(0, 10) });
  if (bothClosingSides.length) issues.push({ ...issue('tb-both-sides', 'low', 'حسابات لها مدين ودائن ختامي معًا', bothClosingSides.length, 'رُصدت أرصدة مدين ودائن معًا في الصف نفسه؛ قد يكون ذلك مسموحًا في المصدر لكنه يحتاج تفسيرًا.', 'افحص تصميم الميزان وسياسة عرض الأرصدة قبل إعادة التصنيف.'), rowNumbers: bothClosingSides.map(row => row.rowNumber) });
  if (openingDifference !== null && Math.abs(openingDifference) > TOLERANCE) issues.push(issue('tb-opening-unbalanced', 'high', 'إجمالي الأرصدة الافتتاحية غير متوازن', 1, 'فرق المدين والدائن الافتتاحي: ' + openingDifference.toFixed(3) + ' د.أ.', 'تحقق من اكتمال أرصدة أول المدة ومن تعيين أعمدة المدين والدائن.'));
  if (movementDifference !== null && Math.abs(movementDifference) > TOLERANCE) issues.push(issue('tb-movement-unbalanced', 'high', 'إجمالي حركة الفترة غير متوازن', 1, 'فرق المدين والدائن لحركة الفترة: ' + movementDifference.toFixed(3) + ' د.أ.', 'تأكد أن دفتر الأستاذ كامل للفترة وأن الأعمدة تمثل الحركة المدينة والدائنة الصحيحة.'));
  if (closingDifference !== null && Math.abs(closingDifference) > TOLERANCE) issues.push(issue('tb-unbalanced', 'high', 'إجمالي الميزان الختامي غير متوازن', 1, 'فرق المدين والدائن الختامي: ' + closingDifference.toFixed(3) + ' د.أ.', 'تأكد من اكتمال الحسابات، وتعيين الأعمدة، والفترة المحاسبية.'));
  if (unmappedFields.length) issues.push(issue('tb-source-field-coverage', 'low', 'حقول خارج نطاق ملف المصدر', unmappedFields.length, 'هذه الحقول غير موجودة في صيغة التصدير الحالية ولذلك تخطّى Ledgerly اختبارات الرصيد أو الحركة التي تحتاجها: ' + unmappedFields.join('، ') + '.', 'إذا كانت هذه الاختبارات مطلوبة للمهمة، أعد التصدير متضمنًا الحقول الناقصة أو وثّق سبب عدم انطباقها.'));
  if (bridgeVariances.length) issues.push({ ...issue('tb-rollforward', 'medium', 'اختلاف بين حركة الفترة والرصيد الختامي', bridgeVariances.length, 'الرصيد الختامي لبعض الحسابات لا يساوي الرصيد الافتتاحي مضافًا إليه الحركة الصافية؛ قد يكون نطاق البيانات جزئيًا أو أن الأعمدة لا تمثل حركة الفترة كاملة.', 'تأكد أن الأعمدة تغطي الفترة نفسها وأن الرصيد الختامي مبني على الحركة المستوردة.'), rowNumbers: bridgeVariances.map(row => row.rowNumber), examples: bridgeVariances.slice(0, 10) });
  const expectedRowCount = Number(options?.expectedRowCount);
  if (Number.isFinite(expectedRowCount) && expectedRowCount >= 0 && expectedRowCount !== data.length) issues.push(issue('tb-source-row-count', 'high', 'عدد الصفوف لا يطابق المصدر', 1, 'المستورد ' + data.length + ' صفًا بينما يتوقع المصدر ' + expectedRowCount + '.', 'تحقق من الفلاتر والصفوف المخفية والورقة الصحيحة قبل الاعتماد.'));
  const expectedTotals = options?.sourceTotals;
  if (expectedTotals && typeof expectedTotals === 'object') {
    const mismatches = fields.filter(field => availableFields.includes(field) && expectedTotals[field] !== undefined && Number.isFinite(Number(expectedTotals[field])) && Math.abs(totals[field] - Number(expectedTotals[field])) >= TOLERANCE);
    if (mismatches.length) issues.push({ ...issue('tb-source-totals-mismatch', 'high', 'إجماليات المصدر لا تطابق البيانات المستوردة', mismatches.length, 'تختلف الحقول التالية عن إجماليات المصدر المعلنة: ' + mismatches.join('، ') + '.', 'أعد مراجعة نطاق التصدير وتعيين الأعمدة والفلاتر؛ لا تبدأ التحليل قبل تفسير الفروق.'), fields: mismatches });
  }
  const unmappedCodes = [...new Set(Array.isArray(options?.unmappedAccountCodes) ? options.unmappedAccountCodes.map(value => String(value).trim()).filter(Boolean) : [])];
  if (unmappedCodes.length) {
    const unmappedRows = data.flatMap((row, index) => unmappedCodes.includes(String(row.code ?? '').trim()) ? [{ code: String(row.code ?? '').trim(), name: String(row.name ?? '').trim(), rowNumber: Number.isFinite(Number(row.sourceRowNumber)) ? Number(row.sourceRowNumber) : index + 2 }] : []);
    issues.push({ ...issue('tb-unmapped-accounts', 'medium', 'حسابات لم يتم تصنيفها', unmappedCodes.length, 'توجد حسابات لم يؤكد المدقق ربطها ببنود أو تصنيفات التقارير: ' + unmappedCodes.slice(0, 15).join('، ') + '.', 'راجع خريطة الحسابات وصادق على التصنيف يدويًا قبل إعداد القوائم.'), rowNumbers: unmappedRows.map(row => row.rowNumber), examples: unmappedRows.slice(0, 15) });
  }
  return { rowCount: data.length, totals, availableFields, unmappedFields, openingDifference, movementDifference, closingDifference, issues, pass: issues.length === 0 };
}

/**
 * Run transparent rule-based screening over every imported journal row.
 * Results are risk indicators for auditor review, never findings of fraud.
 * @param {Array<Record<string, any>>} rows
 */
export function analyzeJournalEntries(rows, options = {}) {
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
    return (Array.isArray(row.invalidAmountFields) && row.invalidAmountFields.length > 0) ||
      (dr !== null && dr !== undefined && !Number.isFinite(Number(dr))) || (cr !== null && cr !== undefined && !Number.isFinite(Number(cr))) ||
      (dr !== null && dr !== undefined && Number(dr) < 0) || (cr !== null && cr !== undefined && Number(cr) < 0) ||
      (dr !== null && dr !== undefined && cr !== null && cr !== undefined && Number(dr) > TOLERANCE && Number(cr) > TOLERANCE);
  }), 'تحتوي بعض الأسطر على قيم سالبة أو غير رقمية أو على جهتي المدين والدائن في السطر نفسه. تُرفع القيم النصية التي لم تُفسَّر كأرقام حتى إن لم تُدخل في الإجماليات.', 'تحقق من اصطلاح الإشارة، وتعيين الأعمدة، ومستوى تفصيل القيود.');
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

  const reversalWords = /(reversal|reversed|reverse|voided|cancelled|canceled|عكس|عكس قيد|الغاء|إلغاء|مرتجع|استرجاع|رد قيد)/i;
  pushGroup('journal-reversal-wording', 'medium', 'وصف يشير إلى عكس أو إلغاء', data.filter(row => reversalWords.test(String(row.description ?? ''))), 'يشير الوصف إلى عكس أو إلغاء أو استرجاع؛ يلزم ربط الحركة بالقيد الأصلي وسببها.', 'تحقق من مرجع القيد الأصلي والموافقة وتوقيت العكس؛ لا تعتبر الوصف دليلًا على مخالفة وحده.');
  const referenceParties = new Map();
  for (const row of data) {
    const reference = cleanText(row.reference), party = cleanText(row.counterparty);
    if (!reference || !party) continue;
    const list = referenceParties.get(reference) || [];
    list.push(row); referenceParties.set(reference, list);
  }
  const partyConflictRows = [];
  for (const list of referenceParties.values()) if (new Set(list.map(row => cleanText(row.counterparty)).filter(Boolean)).size > 1) partyConflictRows.push(...list);
  pushGroup('journal-reference-party-conflict', 'medium', 'مرجع واحد مرتبط بأطراف متعددة', partyConflictRows, 'تظهر أسماء موردين أو مستفيدين مختلفة تحت المرجع نفسه. قد يكون ذلك مشروعًا بحسب طريقة ترقيم النظام، لكنه يستحق التحقق من المستندات الأصلية.', 'راجع مرجع المستند أو القيد وبيانات الطرف المقابل قبل تعديل أي سجل.');
  const approvalThreshold = Number(options?.approvalThreshold);
  const splitWindowRaw = Number(options?.splitWindowDays);
  const splitWindowDays = Number.isFinite(splitWindowRaw) ? Math.max(0, Math.min(30, Math.trunc(splitWindowRaw))) : 1;
  if (Number.isFinite(approvalThreshold) && approvalThreshold > 0) {
    const groups = new Map();
    for (const row of data) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date ?? ''))) continue;
      const debit = Number(row.debit), credit = Number(row.credit);
      const isDebit = Number.isFinite(debit) && debit > TOLERANCE && !(Number.isFinite(credit) && credit > TOLERANCE);
      const isCredit = Number.isFinite(credit) && credit > TOLERANCE && !(Number.isFinite(debit) && debit > TOLERANCE);
      if (!isDebit && !isCredit) continue;
      const amount = isDebit ? debit : credit;
      if (!(amount > 0 && amount < approvalThreshold)) continue;
      const account = cleanText(row.accountCode), partyOrDescription = cleanText(row.counterparty) || cleanText(row.description);
      if (!account || partyOrDescription.length < 3) continue;
      const key = [account, isDebit ? 'debit' : 'credit', partyOrDescription].join('|');
      const list = groups.get(key) || [];
      list.push({ row, amount, time: Date.parse(String(row.date) + 'T00:00:00Z') }); groups.set(key, list);
    }
    const splitRows = new Map(), splitClusters = [];
    for (const items of groups.values()) {
      items.sort((a, b) => a.time - b.time || Number(a.row.rowNumber) - Number(b.row.rowNumber));
      let left = 0, sum = 0;
      for (let right = 0; right < items.length; right += 1) {
        sum += items[right].amount;
        while (left < right && (items[right].time - items[left].time) / 86400000 > splitWindowDays) { sum -= items[left].amount; left += 1; }
        while (left < right && sum - items[left].amount >= approvalThreshold) { sum -= items[left].amount; left += 1; }
        if (right - left + 1 >= 2 && sum >= approvalThreshold) {
          const clusterItems = items.slice(left, right + 1);
          const rowNumbers = clusterItems.map(item => Number(item.row.rowNumber)).filter(Number.isFinite);
          const signature = [...rowNumbers].sort((a, b) => a - b).join(',');
          if (!splitClusters.some(cluster => cluster.signature === signature)) splitClusters.push({ signature, accountCode: clusterItems[0].row.accountCode, partyOrDescription: clusterItems[0].row.counterparty || clusterItems[0].row.description, totalAmount: roundMoney(sum), rowNumbers });
          for (const item of clusterItems) if (Number.isFinite(Number(item.row.rowNumber))) splitRows.set(Number(item.row.rowNumber), item.row);
        }
      }
    }
    if (splitRows.size) issues.push({
      id: 'journal-possible-split-transactions', severity: 'high', title: 'معاملات متقاربة قد تتجاوز حد الموافقة عند جمعها',
      count: splitRows.size, rowNumbers: [...splitRows.keys()].sort((a, b) => a - b),
      examples: [...splitRows.values()].slice(0, 10),
      clusters: splitClusters.map(({ signature, ...cluster }) => cluster),
      detail: 'رُصدت معاملات منفردة تقل عن حد ' + approvalThreshold.toFixed(3) + ' د.أ. ويبلغ مجموع بعض مجموعاتها هذا الحد أو يتجاوزه خلال ' + splitWindowDays + ' يومًا. هذه إشارة أولية تعتمد على الحساب والبيان/الطرف المقابل.',
      action: 'تحقق من حدود الصلاحيات الفعلية وتوقيت المعاملات والمستندات والموافقات؛ لا تستنتج التجزئة المتعمدة من المبلغ وحده.',
    });
  }
  const counts = issues.reduce((out, item) => { out[item.severity] = (out[item.severity] || 0) + item.count; return out; }, {});
  return { scannedCount: data.length, issueCount: issues.reduce((sum, item) => sum + item.count, 0), counts, issues, monthEndSignals: monthEndRows.length, hasRows: data.length > 0 };
}

/**
 * Build traceability links from the engagement's workpapers and evidence.
 * @param {Array<Record<string, any>>} workpapers
 * @param {Array<Record<string, any>>} evidence
 */
export function buildEvidenceLineage(workpapers, evidence, findings = []) {
  const papers = Array.isArray(workpapers) ? workpapers : [];
  const items = Array.isArray(evidence) ? evidence : [];
  const findingRows = Array.isArray(findings) ? findings : [];
  const byRef = new Map();
  const evidenceById = new Map(items.map(item => [String(item.id ?? ''), item]).filter(([id]) => Boolean(id)));
  for (const paper of papers) {
    const key = cleanText(paper.ref);
    if (!key) continue;
    const list = byRef.get(key) || [];
    list.push(paper);
    byRef.set(key, list);
  }
  const duplicateWorkpaperReferences = [...byRef.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([reference, list]) => ({ reference, count: list.length, workpaperIds: list.map(paper => paper.id) }));

  const links = items.map(item => {
    const ref = cleanText(item.workpaperRef), candidates = ref ? (byRef.get(ref) || []) : [];
    const workpaper = candidates.length === 1 ? candidates[0] : undefined;
    const reason = !ref ? 'missing-reference' : candidates.length === 0 ? 'unknown-reference' : candidates.length > 1 ? 'ambiguous-reference' : 'linked';
    return { evidence: item, workpaper, linked: Boolean(workpaper), reason };
  });
  const workpaperRows = papers.map(workpaper => {
    const ref = cleanText(workpaper.ref), candidates = ref ? (byRef.get(ref) || []) : [];
    const linkedEvidence = candidates.length === 1 ? items.filter(item => cleanText(item.workpaperRef) === ref) : [];
    return { workpaper, evidenceCount: linkedEvidence.length, evidence: linkedEvidence };
  });
  const findingLinks = findingRows.map(finding => {
    const workpaperRef = cleanText(finding.workpaperRef);
    const candidates = workpaperRef ? (byRef.get(workpaperRef) || []) : [];
    const workpaper = candidates.length === 1 ? candidates[0] : undefined;
    const rawIds = Array.isArray(finding.evidenceIds) ? finding.evidenceIds : finding.evidenceId ? [finding.evidenceId] : [];
    const evidenceIds = [...new Set(rawIds.map(value => String(value ?? '').trim()).filter(Boolean))];
    const linkedEvidence = evidenceIds.map(id => evidenceById.get(id)).filter(Boolean);
    const missingEvidenceIds = evidenceIds.filter(id => !evidenceById.has(id));
    const evidenceMatchesWorkpaper = Boolean(workpaper) && linkedEvidence.length > 0 &&
      linkedEvidence.every(item => cleanText(item.workpaperRef) === workpaperRef);
    const workpaperReason = !workpaperRef ? 'missing-workpaper-reference' : candidates.length === 0 ? 'unknown-workpaper-reference' : candidates.length > 1 ? 'ambiguous-workpaper-reference' : 'linked';
    const evidenceReason = !evidenceIds.length ? 'missing-evidence-reference' : missingEvidenceIds.length ? 'unknown-evidence-reference' : !evidenceMatchesWorkpaper ? 'evidence-workpaper-mismatch' : 'linked';
    return {
      finding,
      workpaper,
      linkedEvidence,
      evidenceIds,
      missingEvidenceIds,
      workpaperLinked: Boolean(workpaper),
      evidenceLinked: evidenceIds.length > 0 && missingEvidenceIds.length === 0 && linkedEvidence.length === evidenceIds.length,
      evidenceMatchesWorkpaper,
      linked: Boolean(workpaper) && evidenceIds.length > 0 && missingEvidenceIds.length === 0 && evidenceMatchesWorkpaper,
      workpaperReason,
      evidenceReason,
    };
  });

  return {
    workpaperCount: papers.length,
    evidenceCount: items.length,
    linkedEvidenceCount: links.filter(link => link.linked).length,
    unlinkedEvidenceCount: links.filter(link => !link.linked).length,
    workpapersWithoutEvidence: workpaperRows.filter(row => row.evidenceCount === 0).length,
    duplicateWorkpaperReferences,
    ambiguousReferenceCount: links.filter(link => link.reason === 'ambiguous-reference').length,
    findingsCount: findingRows.length,
    findingLinks,
    findingsWithoutWorkpaper: findingLinks.filter(link => !link.workpaperLinked).length,
    findingsWithoutEvidence: findingLinks.filter(link => !link.evidenceLinked).length,
    findingEvidenceMismatches: findingLinks.filter(link => link.workpaperLinked && link.evidenceLinked && !link.evidenceMatchesWorkpaper).length,
    fullyLinkedFindings: findingLinks.filter(link => link.linked).length,
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

/** Deterministic change detection only; this is not a cryptographic integrity control. */
export function fingerprintTrialBalanceRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const canonicalRows = rows.map(row => ({
    code: String(row.code ?? '').trim(),
    name: String(row.name ?? '').trim(),
    sourceFinancialFields: Array.isArray(row.sourceFinancialFields) ? [...row.sourceFinancialFields].sort() : null,
    openingDebit: row.openingDebit ?? null,
    openingCredit: row.openingCredit ?? null,
    debit: row.debit ?? null,
    credit: row.credit ?? null,
    closingDebit: row.closingDebit ?? null,
    closingCredit: row.closingCredit ?? null,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalRows));
  let hash = 14695981039346656037n; const mask = (1n << 64n) - 1n;
  for (const byte of bytes) { hash ^= BigInt(byte); hash = (hash * 1099511628211n) & mask; }
  return 'tb-fnv1a64:' + hash.toString(16).padStart(16, '0');
}

/**
 * Fingerprints account-to-statement mappings used to render draft statements.
 * Change detection only; not a cryptographic integrity seal.
 */
export function fingerprintAccountMappings(accountMappings, engagementId) {
  const mappings = accountMappings && typeof accountMappings === 'object' ? accountMappings : {};
  const prefix = String(engagementId ?? '') + '::';
  const canonical = Object.entries(mappings)
    .filter(([key, value]) => key.startsWith(prefix) && value && typeof value === 'object')
    .map(([key, value]) => ({
      accountCode: key.slice(prefix.length),
      lineKey: String(value.lineKey ?? '').trim(),
      comparativeJod: value.comparativeJod === undefined || value.comparativeJod === null ? '' : String(value.comparativeJod).trim(),
    }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  let hash = 14695981039346656037n;
  const mask = (1n << 64n) - 1n;
  for (const byte of bytes) { hash ^= BigInt(byte); hash = (hash * 1099511628211n) & mask; }
  return 'account-map-fnv1a64:' + hash.toString(16).padStart(16, '0');
}

export function buildQualityShield(input) {
  const workpapers = input.workpapers || [];
  const evidence = input.evidence || [];
  const findings = input.findings || [];
  const risks = input.risks || [];
  const reportDrafts = Array.isArray(input.reportDrafts) ? input.reportDrafts : [];
  const accountMappings = input.accountMappings && typeof input.accountMappings === 'object' ? input.accountMappings : {};
  const engagementId = String(input.engagementId || (Array.isArray(input.trialBalance) ? input.trialBalance[0]?.engagementId : '') || '');
  const tbRowsForTrust = Array.isArray(input.trialBalance) ? input.trialBalance : [];
  const derivedUnmappedCodes = tbRowsForTrust.filter(row => {
    const key = String(engagementId || row.engagementId || '') + '::' + String(row.code ?? '');
    return !String(accountMappings[key]?.lineKey ?? '').trim();
  }).map(row => String(row.code ?? '').trim()).filter(Boolean);
  const dataTrustOptions = { ...(input.dataTrustOptions || {}), unmappedAccountCodes: input.dataTrustOptions?.unmappedAccountCodes ?? derivedUnmappedCodes };
  const tb = runDataTrustChecks(tbRowsForTrust, dataTrustOptions);
  const lineage = buildEvidenceLineage(workpapers, evidence, findings);
  const currentSourceFingerprint = String(input.currentSourceFingerprint || fingerprintTrialBalanceRows(input.trialBalance || []));
  const staleWorkpapers = currentSourceFingerprint ? workpapers.filter(row => row.sourceFingerprint && row.sourceFingerprint !== currentSourceFingerprint) : [];
  const workpapersWithoutSnapshot = currentSourceFingerprint ? workpapers.filter(row => !row.sourceFingerprint) : [];
  const reviewNotesOpen = workpapers.filter(row => String(row.reviewNotes ?? '').trim() && !['مغلق', 'مغلقة', 'تمت المعالجة', 'resolved'].includes(cleanText(row.reviewNotesStatus)));
  const configuredReportDrafts = reportDrafts.filter(row => Boolean(row.lastExportSnapshot) || ['firmName', 'auditorName', 'periodEnd', 'opinion'].some(field => String(row[field] ?? '').trim()));
  const exportedReportDrafts = configuredReportDrafts.filter(row => row.lastExportSnapshot && typeof row.lastExportSnapshot === 'object');
  const currentAccountMappingFingerprint = fingerprintAccountMappings(accountMappings, engagementId);
  const staleReportSnapshots = currentSourceFingerprint ? exportedReportDrafts.filter(row =>
    (row.lastExportSnapshot.sourceFingerprint && row.lastExportSnapshot.sourceFingerprint !== currentSourceFingerprint) ||
    (row.lastExportSnapshot.accountMappingFingerprint && row.lastExportSnapshot.accountMappingFingerprint !== currentAccountMappingFingerprint)
  ) : [];
  const reportDraftsWithoutExport = configuredReportDrafts.filter(row => !row.lastExportSnapshot);
  const reportSnapshotsWithoutSource = currentSourceFingerprint ? exportedReportDrafts.filter(row =>
    !row.lastExportSnapshot.sourceFingerprint || !row.lastExportSnapshot.accountMappingFingerprint
  ) : [];
  const checks = [];
  const add = (id, severity, title, count, detail, action) => {
    checks.push({ id, severity, title, count, detail, action, state: count > 0 ? 'needs-attention' : 'clear' });
  };
  const tbSeverity = tb.issues.some(row => row.severity === 'high') ? 'high' : tb.issues.some(row => row.severity === 'medium') ? 'medium' : 'low';
  add('quality-tb', tbSeverity, 'تنبيهات جودة ميزان المراجعة', tb.issues.length, 'عدد أنواع فحوص الميزان التي تحتاج مراجعة: ' + tb.issues.length + '.', 'راجع كل فحص على حدة ولا تعتمد الإجماليات قبل فهم الاستثناءات.');
  add('quality-workpaper-status', 'medium', 'أوراق عمل غير معتمدة', workpapers.filter(row => row.status !== 'معتمد').length, 'اعتُبرت الورقة معتمدة فقط عندما تكون حالتها المسجلة "معتمد".', 'راجع الإجراء والاستنتاج والأدلة، ثم أكمل الاعتماد وفق صلاحيات المكتب.');
  add('quality-workpaper-procedure', 'medium', 'أوراق بلا إجراء موثق', workpapers.filter(row => !String(row.procedure ?? '').trim()).length, 'بعض أوراق العمل لا تحتوي نصًا في حقل الإجراء.', 'وثّق طبيعة الإجراء ونطاقه وتنفيذه؛ لا تملأ الحقل شكليًا دون تنفيذ.');
  add('quality-workpaper-conclusion', 'medium', 'أوراق بلا استنتاج موثق', workpapers.filter(row => !String(row.conclusion ?? '').trim()).length, 'بعض أوراق العمل لا تحتوي استنتاجًا مسجلًا.', 'سجّل استنتاج المدقق المدعوم بالأدلة المناسبة.');
  add('quality-evidence-link', 'medium', 'أدلة بلا ربط بورقة عمل', lineage.unlinkedEvidenceCount, 'الارتباط المرجعي وحده لا يثبت كفاية الدليل أو ملاءمته.', 'اربط كل دليل بورقة العمل المقصودة وتحقق من محتواه وصلاحيته.');
  add('quality-finding-workpaper-link', 'medium', 'ملاحظات بلا ورقة عمل مرتبطة', lineage.findingsWithoutWorkpaper, 'لا يمكن تتبّع بعض ملاحظات التدقيق إلى إجراء موثق أو مرجع ورقة عمل فريد.', 'اربط الملاحظة بورقة العمل التي أدت إليها؛ صحّح المراجع غير المعروفة أو المكررة.');
  add('quality-finding-evidence-link', 'medium', 'ملاحظات بلا دليل مرتبط', lineage.findingsWithoutEvidence, 'بعض الملاحظات لا تتضمن مرجعًا إلى دليل مفهرس في الملف الحالي.', 'اربط الملاحظة بالمستند أو السجل الذي يدعمها، ثم راجع كفاية الدليل بصورة مهنية.');
  add('quality-finding-evidence-mismatch', 'high', 'الدليل لا يتبع ورقة العمل المرتبطة بالملاحظة', lineage.findingEvidenceMismatches, 'الدليل المرتبط بالملاحظة يشير إلى ورقة عمل مختلفة عن المرجع المختار للملاحظة.', 'تحقق من سلسلة التوثيق وحدد ورقة العمل الصحيحة قبل الإقفال.');
  add('quality-workpaper-duplicate-ref', 'high', 'مراجع أوراق عمل مكررة', lineage.duplicateWorkpaperReferences.length, 'مراجع غير فريدة تمنع ربط الأدلة بثقة؛ لا يختار النظام إحدى الأوراق بصمت.', 'اجعل مرجع كل ورقة فريدًا داخل ملف التدقيق ثم أعد فحص الروابط.');
  add('quality-ambiguous-evidence-link', 'high', 'أدلة مرتبطة بمرجع ملتبس', lineage.ambiguousReferenceCount, 'بعض الأدلة تشير إلى مرجع تستخدمه أكثر من ورقة عمل.', 'صحّح مرجع الدليل بعد تحديد ورقة العمل المقصودة.');
  add('quality-stale-workpaper', 'high', 'أوراق عمل تعتمد على نسخة أقدم من البيانات', staleWorkpapers.length, 'تغيّرت بصمة مجموعة البيانات المصدرية منذ حفظ لقطة ورقة العمل. هذا لا يؤكد وقوع خطأ، لكنه يعني أن نتائجها تحتاج مراجعة.', 'أعد تنفيذ الإجراءات المتأثرة وقارن الاستنتاجات بالمصدر الحالي، ثم حدّث لقطة البيانات بعد المراجعة.');
  add('quality-source-snapshot-missing', 'medium', 'أوراق عمل بلا لقطة بيانات مصدرية', workpapersWithoutSnapshot.length, 'لا تحمل بعض أوراق العمل بصمة للميزان الذي استندت إليه؛ لا يمكن للنظام تحديد ما إذا تغير المصدر منذ إعدادها.', 'راجع الورقة على ضوء البيانات الحالية، ثم أكّد المراجعة المستقلة لتسجيل لقطة المصدر الحالية.');
  add('quality-report-stale-source', 'high', 'مخرجات تقرير تعتمد على نسخة أقدم من البيانات', staleReportSnapshots.length, 'بصمة المصدر المسجلة وقت تصدير التقرير لا تطابق بصمة ميزان المراجعة الحالي. قد تكون أرقام النسخة التي تم تنزيلها قديمة.', 'أعد تصدير المسودة بعد مراجعة القوائم والربط المحاسبي، ثم احتفظ ببصمة وتاريخ النسخة الجديدة.');
  add('quality-report-not-exported', 'medium', 'مسودة تقرير لم تُنشأ لها نسخة تصدير مسجلة', reportDraftsWithoutExport.length, 'توجد إعدادات مسودة تقرير ولكن لا توجد لقطة تصدير محلية مسجلة لها.', 'ولّد المسودة بعد تحديث المصدر وافحصها مهنيًا قبل إصدارها.');
  add('quality-report-source-missing', 'medium', 'نسخة التقرير لا تحمل بصمة مصدر', reportSnapshotsWithoutSource.length, 'لا يمكن التحقق من حداثة بعض نسخ التصدير لعدم توفر بصمة ميزان المراجعة وقت إنشائها.', 'أعد تصدير النسخة من بيانات حالية واحفظ سجل المصدر.');
  add('quality-review-notes', 'medium', 'أوراق تحمل ملاحظات مراجعة غير محسومة', reviewNotesOpen.length, 'تحتوي بعض أوراق العمل على ملاحظات مراجعة لا تحمل حالة معالجة صريحة.', 'تحقق من كل ملاحظة؛ بعد معالجتها سجّل حالتها بوضوح بدل حذف أثر المراجعة.');
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

/**
 * Evaluate administrative close readiness using an explicit policy.
 * This is a workflow gate, not a professional audit opinion or regulatory-compliance certification.
 */
export function evaluateEngagementClosure(input = {}, policy = {}) {
  const workpapers = Array.isArray(input.workpapers) ? input.workpapers : [];
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const risks = Array.isArray(input.risks) ? input.risks : [];
  const trialBalance = Array.isArray(input.trialBalance) ? input.trialBalance : [];
  const operations = input.operations && typeof input.operations === 'object' ? input.operations : {};
  const scopedReportDrafts = (Array.isArray(operations.reportDrafts) ? operations.reportDrafts : []).filter(row => row.engagementId === input.engagementId);
  const quality = buildQualityShield({
    workpapers, evidence, findings, risks, trialBalance, reportDrafts: scopedReportDrafts, accountMappings: operations.accountMappings || {}, engagementId: input.engagementId,
    currentSourceFingerprint: input.currentSourceFingerprint || fingerprintTrialBalanceRows(trialBalance),
    dataTrustOptions: input.dataTrustOptions || {},
  });
  const blockers = [];
  const warnings = [];
  const addBlocker = (id, title, count, detail) => {
    if (count > 0) blockers.push({ id, title, count, detail });
  };

  if (policy.requireTrialBalance !== false && trialBalance.length === 0) {
    addBlocker('close-missing-trial-balance', 'لا يوجد ميزان مراجعة', 1, 'استورد ميزان المراجعة وتحقق من نطاق الفترة قبل إقفال الملف.');
  }

  if (policy.blockCriticalDataIssues !== false) {
    const critical = quality.tb.issues.filter(row => row.severity === 'high');
    addBlocker('close-critical-data-quality', 'فحوص جودة بيانات عالية الأهمية', critical.length, critical.map(row => row.title).join('، '));
  }

  if (policy.requireAccountClassification !== false) {
    const unmapped = quality.tb.issues.find(row => row.id === 'tb-unmapped-accounts');
    addBlocker('close-unmapped-accounts', 'حسابات بلا تصنيف مؤكد', unmapped?.count || 0, 'راجع خريطة الحسابات وحدد بند العرض أو وثّق سبب عدم التصنيف وفق سياسة المكتب.');
  }

  if (policy.requireApprovedWorkpapers !== false) {
    const pending = workpapers.filter(row => row.status !== 'معتمد');
    addBlocker('close-workpapers-pending', 'أوراق عمل غير معتمدة', pending.length, 'يجب إكمال مراجعة أوراق العمل واعتمادها بواسطة المراجع المحدد في سير العمل.');
    if (!workpapers.length) addBlocker('close-no-workpapers', 'لا توجد أوراق عمل', 1, 'أضف أوراق العمل اللازمة للمهمة قبل الإقفال.');
  }

  if (policy.requireEvidenceLinked !== false) {
    addBlocker('close-evidence-unlinked', 'أدلة بلا ربط فريد', quality.lineage.unlinkedEvidenceCount, 'اربط الأدلة بورقة عمل ذات مرجع فريد. لا يختار النظام بين مراجع مكررة.');
    addBlocker('close-duplicate-workpaper-refs', 'مراجع أوراق عمل مكررة', quality.lineage.duplicateWorkpaperReferences.length, 'صحّح المراجع المكررة قبل الإقفال.');
  }

  if (policy.requireFindingLineage !== false) {
    addBlocker('close-findings-no-workpaper', 'ملاحظات بلا ورقة عمل', quality.lineage.findingsWithoutWorkpaper, 'اربط كل ملاحظة بورقة عمل ذات مرجع فريد قبل الإقفال.');
    addBlocker('close-findings-no-evidence', 'ملاحظات بلا دليل مفهرس', quality.lineage.findingsWithoutEvidence, 'اربط كل ملاحظة بالدليل ذي الصلة قبل الإقفال.');
    addBlocker('close-findings-evidence-mismatch', 'تعارض في سلسلة دليل الملاحظة', quality.lineage.findingEvidenceMismatches, 'صحّح اختلاف المرجع بين الدليل وورقة العمل المرتبطة بالملاحظة.');
  }

  if (policy.requireReviewNotesResolved !== false) {
    const openNotes = workpapers.filter(row =>
      String(row.reviewNotes ?? '').trim() &&
      !['مغلق', 'مغلقة', 'تمت المعالجة', 'resolved'].includes(cleanText(row.reviewNotesStatus))
    );
    addBlocker('close-review-notes', 'ملاحظات مراجعة غير محسومة', openNotes.length, 'عالج ملاحظات المراجع وسجّل حالتها؛ لا تمسح أثر المراجعة لمجرد إخفاء التنبيه.');
  }

  if (policy.requireFindingsResolved !== false) {
    const open = findings.filter(row => !['مغلقة', 'مغلق', 'مكتمل', 'resolved'].includes(cleanText(row.status)));
    addBlocker('close-findings-open', 'ملاحظات تدقيق غير مغلقة إداريًا', open.length, 'وثّق الرد والمعالجة وحالة الملاحظة وفق سياسة المكتب قبل الإقفال.');
  }

  if (policy.blockStaleWorkpapers !== false) {
    const stale = quality.checks.find(row => row.id === 'quality-stale-workpaper');
    const missing = quality.checks.find(row => row.id === 'quality-source-snapshot-missing');
    addBlocker('close-stale-workpapers', 'أوراق عمل تحتاج إعادة مراجعة المصدر', (stale?.count || 0) + (missing?.count || 0), 'أعد فحص البيانات التي استندت إليها الورقة ثم حدّث لقطة المصدر من خلال مراجعة صريحة.');
  }

  if (policy.blockStaleReports !== false) {
    const stale = quality.checks.find(row => row.id === 'quality-report-stale-source');
    const missingSource = quality.checks.find(row => row.id === 'quality-report-source-missing');
    const notExported = quality.checks.find(row => row.id === 'quality-report-not-exported');
    addBlocker('close-stale-report-snapshot', 'نسخة تقرير قديمة أو بلا مصدر قابل للتحقق', (stale?.count || 0) + (missingSource?.count || 0), 'أعد تصدير مسودة التقرير بعد تحديث بيانات المصدر، أو تحقق من البصمة المسجلة.');
    addBlocker('close-report-not-exported', 'مسودة تقرير لم يتم تصديرها', notExported?.count || 0, 'صدّر المسودة المطلوبة وافحص النسخة الناتجة قبل إقفال الملف.');
  }

  const requests = Array.isArray(operations.clientRequests) ? operations.clientRequests : [];
  const requiredRequests = requests.filter(row => row.engagementId === input.engagementId && row.requiredForClosure && !row.done);
  addBlocker('close-required-client-documents', 'مستندات إلزامية للإقفال لم تُستلم', requiredRequests.length, 'استلم المستندات المحددة كإلزامية أو عدّل سياسة الطلب وفق موافقة موثقة.');
  const overdue = requests.filter(row => row.engagementId === input.engagementId && !row.done && /^\d{4}-\d{2}-\d{2}$/.test(String(row.dueDate ?? '')) && String(row.dueDate) < (input.asOfDate || localIsoDate()));
  if (overdue.length) warnings.push({ id: 'close-overdue-client-documents', title: 'طلبات مستندات متأخرة', count: overdue.length, detail: 'طلبات متأخرة لم تُعلّم كإلزامية للإقفال؛ راجع أثرها قبل الإغلاق.' });

  const highRisks = risks.filter(row =>
    (['مرتفع', 'عالي', 'high'].includes(cleanText(row.impact)) || ['مرتفع', 'عالي', 'high'].includes(cleanText(row.likelihood))) &&
    !['مغلق', 'مغلقة', 'مكتمل', 'resolved'].includes(cleanText(row.status))
  );
  if (highRisks.length) warnings.push({ id: 'close-high-risks', title: 'مخاطر عالية تحتاج تأكيد الاستجابة', count: highRisks.length, detail: 'الخطر العالي ليس منعًا آليًا للإقفال إذا كانت الاستجابة المهنية موثقة ومقبولة.' });

  return { allowed: blockers.length === 0, blockers, warnings, quality };
}

export function buildPartnerDashboard(engagements, clients, database, operations = {}, options = {}) {
  const operationRows = key => Array.isArray(operations?.[key]) ? operations[key] : [];
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.asOfDate ?? ''))
    ? String(options.asOfDate)
    : localIsoDate();
  const numeric = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const sum = values => roundMoney(values.reduce((total, value) => total + value, 0));

  return (engagements || []).map(engagement => {
    const id = engagement.id;
    const scoped = rows => (rows || []).filter(row => row.engagementId === id);
    const papers = scoped(database.workpapers);
    const evidence = scoped(database.evidence);
    const findings = scoped(database.findings);
    const risks = scoped(database.risks);
    const tbRows = scoped(database.trialBalance);
    const reportDrafts = operationRows('reportDrafts').filter(row => row.engagementId === id);
    const currentSourceFingerprint = fingerprintTrialBalanceRows(tbRows);
    const quality = buildQualityShield({ workpapers: papers, evidence, findings, risks, trialBalance: tbRows, reportDrafts, accountMappings: operations.accountMappings || {}, engagementId: id, currentSourceFingerprint });
    const closure = evaluateEngagementClosure({ engagementId: id, workpapers: papers, evidence, findings, risks, trialBalance: tbRows, operations, currentSourceFingerprint });
    const requests = scoped(operationRows('clientRequests'));
    const outstandingRequests = requests.filter(row => !row.done && !['مستلم للمراجعة', 'مكتمل', 'مغلقة', 'مغلق'].includes(String(row.status ?? '')));
    const overdueRequests = outstandingRequests.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(String(row.dueDate ?? '')) && String(row.dueDate) < asOfDate);
    const entries = scoped(operationRows('timeEntries'));
    const loggedHours = sum(entries.map(row => Math.max(0, numeric(row.hours) ?? 0)));
    const ratedEntries = entries.filter(row => numeric(row.hours) !== null && numeric(row.hourlyRateJod) !== null);
    const actualLaborCostJod = sum(ratedEntries.map(row => Math.max(0, Number(row.hours)) * Math.max(0, Number(row.hourlyRateJod))));
    const budgetHours = numeric(engagement.budgetHours ?? engagement.plannedHours);
    const hoursBudgetVariance = budgetHours === null ? null : roundMoney(budgetHours - loggedHours);
    const contractualFeeJod = numeric(engagement.feeJod);
    const feeLessRecordedLaborCostJod = contractualFeeJod === null ? null : roundMoney(contractualFeeJod - actualLaborCostJod);
    const invoices = scoped(operationRows('officeInvoices'));
    const invoiceValueJod = sum(invoices.map(row => Math.max(0, numeric(row.totalJod) ?? 0)));
    const recordedInvoiceCount = invoices.length;

    return {
      engagement,
      client: (clients || []).find(client => client.id === engagement.clientId),
      workpaperCount: papers.length,
      pendingWorkpapers: papers.filter(p => p.status !== 'معتمد').length,
      unlinkedEvidence: quality.lineage.unlinkedEvidenceCount,
      openFindings: findings.filter(f => !['مغلقة', 'مغلق', 'مكتمل'].includes(String(f.status ?? ''))).length,
      highRisks: risks.filter(r => ['مرتفع', 'عالي', 'high'].includes(cleanText(r.impact)) || ['مرتفع', 'عالي', 'high'].includes(cleanText(r.likelihood))).length,
      qualityAttention: quality.attentionCount,
      qualityBlockers: quality.blockers,
      closureBlockerCount: closure.blockers.length,
      closureWarningCount: closure.warnings.length,
      closureBlockers: closure.blockers,
      outstandingRequests: outstandingRequests.length,
      overdueRequests: overdueRequests.length,
      loggedHours,
      budgetHours,
      hoursBudgetVariance,
      actualLaborCostJod,
      contractualFeeJod,
      feeLessRecordedLaborCostJod,
      invoiceValueJod,
      recordedInvoiceCount,
      state: String(engagement.status ?? ''),
    };
  }).sort((a, b) =>
    (b.overdueRequests - a.overdueRequests) ||
    (b.qualityBlockers - a.qualityBlockers) ||
    (b.qualityAttention - a.qualityAttention) ||
    (b.openFindings - a.openFindings) ||
    String(a.client?.name ?? '').localeCompare(String(b.client?.name ?? ''))
  );
}

/** @param {Array<Record<string, any>>} items */
export function summarizeFindingsForAssistant(items) {
  const issues = Array.isArray(items) ? items : [];
  if (!issues.length) return ['لم تظهر استثناءات وفق قواعد الفحص الحالية. هذا لا يثبت خلو الملف من الأخطاء؛ راجع إجراءات التدقيق المناسبة.'];
  return issues.slice(0, 8).map(item => {
    const rowNumbers = Array.isArray(item.rowNumbers) ? item.rowNumbers.map(Number).filter(value => Number.isInteger(value) && value > 0) : [];
    const accountCode = String(item.accountCode ?? item.code ?? '').trim();
    const sourceFile = String(item.sourceFile ?? '').trim();
    const sourceSheet = String(item.sourceSheet ?? '').trim();
    const sourceParts = [
      item.count + ' صف/حالة وفق الفحص المحلي',
      sourceFile ? 'الملف: ' + sourceFile : '',
      sourceSheet ? 'الورقة: ' + sourceSheet : '',
      accountCode ? 'الحساب: ' + accountCode : '',
      rowNumbers.length ? 'صفوف المصدر: ' + [...new Set(rowNumbers)].slice(0, 15).join('، ') : '',
    ].filter(Boolean);
    return {
      id: item.id,
      priority: item.severity === 'high' ? 'أولوية عالية' : item.severity === 'medium' ? 'أولوية متوسطة' : 'إشارة للمراجعة',
      title: item.title,
      action: item.action,
      source: sourceParts.join(' · '),
    };
  });
}
