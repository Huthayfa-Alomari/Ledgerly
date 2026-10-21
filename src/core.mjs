export const FIELD_ALIASES = {
  date: ['date', 'transaction date', 'posting date', 'value date', 'التاريخ', 'تاريخ الحركة', 'تاريخ القيد', 'تاريخ العملية', 'تاريخ الاستحقاق'],
  description: ['description', 'details', 'narration', 'particulars', 'memo', 'بيان', 'البيان', 'التفاصيل', 'الوصف', 'شرح الحركة', 'الشرح'],
  debit: ['debit', 'withdrawal', 'paid out', 'dr', 'مدين', 'المدين', 'السحب', 'المسحوبات', 'مدفوعات'],
  credit: ['credit', 'deposit', 'paid in', 'cr', 'دائن', 'الدائن', 'الإيداع', 'الايداع', 'المقبوضات'],
  amount: ['amount', 'transaction amount', 'value', 'المبلغ', 'قيمة الحركة', 'قيمة'],
  balance: ['balance', 'running balance', 'الرصيد', 'الرصيد الجاري', 'الرصيد بعد الحركة'],
};

export function normalizeDigits(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, d => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06F0 ? code - 0x06F0 : code - 0x0660);
  });
}

export function normalizeHeader(value) {
  return normalizeDigits(value).trim().toLocaleLowerCase()
    .replace(/[ـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\s_\-./\\]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .trim();
}

export function detectColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const result = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const aliasSet = new Set(aliases.map(normalizeHeader));
    let index = normalized.findIndex(h => aliasSet.has(h));
    if (index < 0) {
      index = normalized.findIndex(h => h.length >= 4 && [...aliasSet].some(a => a.length >= 4 && (h.includes(a) || a.includes(h))));
    }
    if (index >= 0) result[field] = index;
  }
  return result;
}

export function parseAmount(input) {
  if (input === null || input === undefined || input === '') return null;
  let s = normalizeDigits(input).trim();
  if (!s) return null;
  const negativeByParens = /^\(.*\)$/.test(s);
  s = s.replace(/[٬،]/g, ',').replace(/[٫]/g, '.');
  s = s.replace(/[^\d,.\-+]/g, '');
  if (s.includes(',') && s.includes('.')) {
    // Last separator is treated as the decimal separator.
    if (s.lastIndexOf('.') > s.lastIndexOf(',')) s = s.replace(/,/g, '');
    else s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    const parts = s.split(',');
    // JOD is commonly shown to three decimals. Accept 0,004 as fils while keeping 1,234 as a thousands separator.
    const zeroLeadingFils = parts.length === 2 && Number(parts[0]) === 0 && parts[1].length === 3;
    s = parts.length === 2 && (parts[1].length <= 2 || zeroLeadingFils) ? `${parts[0]}.${parts[1]}` : parts.join('');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativeByParens ? -Math.abs(n) : n;
}

export function parseDate(input) {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString().slice(0, 10);
  if (typeof input === 'number' && input > 20000 && input < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + input * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const s = normalizeDigits(input).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    // Explicitly document the common statement convention: D/M/YYYY.
    return validDate(+m[3], +m[2], +m[1]);
  }
  return null;
}

function validDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

export function normalizeRows(rows, mapping) {
  return rows.map((row, index) => {
    const cell = field => {
      if (mapping[field] === undefined) return null;
      return Array.isArray(row) ? row[mapping[field]] : Object.values(row)[mapping[field]];
    };
    const rawAmount = parseAmount(cell('amount'));
    const debit = parseAmount(cell('debit'));
    const credit = parseAmount(cell('credit'));
    const description = cell('description') == null ? '' : String(cell('description')).trim();
    const balance = parseAmount(cell('balance'));
    const date = parseDate(cell('date'));
    const openingBalanceLabel = /^(opening(?: balance)?|beginning(?: balance)?|initial balance|b\s*\/\s*f|b f|brought forward|balance brought forward|رصيد افتتاحي|الرصيد الافتتاحي|رصيد مرحل|رصيد اول المدة|رصيد سابق)$/i.test(normalizeHeader(description));
    const noMovement = debit === null && credit === null && rawAmount === null;
    const isOpeningBalance = noMovement && balance !== null && (openingBalanceLabel || !description);
    return {
      sourceRow: index + 2,
      date,
      description,
      debit: debit === null && rawAmount !== null && rawAmount < 0 ? Math.abs(rawAmount) : debit,
      credit: credit === null && rawAmount !== null && rawAmount >= 0 ? rawAmount : credit,
      balance,
      isOpeningBalance,
      raw: row,
    };
  });
}

export function validateRows(rows) {
  const warnings = [];
  rows.forEach((row, i) => {
    if (!row.date) warnings.push({ row: row.sourceRow ?? i + 2, field: 'date', message: 'Missing or unrecognized date' });
    if (!row.description) warnings.push({ row: row.sourceRow ?? i + 2, field: 'description', message: 'Empty description' });
    if (row.debit === null && row.credit === null && !row.isOpeningBalance) warnings.push({ row: row.sourceRow ?? i + 2, field: 'amount', message: 'No debit/credit amount detected' });
    if (row.debit !== null && row.debit < 0) warnings.push({ row: row.sourceRow ?? i + 2, field: 'debit', message: 'Debit is negative; verify sign convention' });
    if (row.credit !== null && row.credit < 0) warnings.push({ row: row.sourceRow ?? i + 2, field: 'credit', message: 'Credit is negative; verify sign convention' });
  });
  return warnings;
}

/** Convert normalized debit/credit columns to a signed cash-flow amount. */
export function signedAmount(row) {
  const debit = typeof row.debit === 'number' && Number.isFinite(row.debit) ? row.debit : 0;
  const credit = typeof row.credit === 'number' && Number.isFinite(row.credit) ? row.credit : 0;
  if (row.debit == null && row.credit == null) return null;
  return (toFils(credit) - toFils(debit)) / 1000;
}

function toFils(value) {
  const scaled = value * 1000;
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON);
}

function roundMoney(value) {
  return toFils(value) / 1000;
}

function normalizedDescription(value) {
  return normalizeHeader(value ?? '').replace(/\s+/g, ' ').trim();
}

function dayDistance(a, b) {
  if (!a || !b) return null;
  const aa = Date.parse(`${a}T00:00:00Z`);
  const bb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(aa) || !Number.isFinite(bb)) return null;
  return Math.round(Math.abs(aa - bb) / 86400000);
}

/**
 * Conservative one-to-one matcher. It never force-matches ambiguous candidates.
 * Both sources must use the same debit/credit sign convention before matching.
 */
export function matchTransactions(bankRows, ledgerRows, options = {}) {
  const tolerance = Math.max(0, Number(options.amountTolerance ?? 0.001));
  const dateWindowDays = Math.max(0, Math.floor(Number(options.dateWindowDays ?? 0)));
  const usedBank = new Set();
  const usedLedger = new Set();
  const matches = [];
  const ambiguous = [];
  const ambiguousBank = new Set();

  const bank = bankRows.map((row, index) => ({ row, index, amount: signedAmount(row), description: normalizedDescription(row.description) })).filter(item => !item.row.isOpeningBalance);
  const ledger = ledgerRows.map((row, index) => ({ row, index, amount: signedAmount(row), description: normalizedDescription(row.description) })).filter(item => !item.row.isOpeningBalance);
  const toleranceInFils = Math.round(tolerance * 1000);
  const amountEqual = (a, b) => a !== null && b !== null && Math.abs(Math.round(a * 1000) - Math.round(b * 1000)) <= toleranceInFils;
  const candidatesFor = (b, requireDescription) => ledger.filter(l => !usedLedger.has(l.index)
    && amountEqual(b.amount, l.amount)
    && dayDistance(b.row.date, l.row.date) !== null
    && dayDistance(b.row.date, l.row.date) <= dateWindowDays
    && (!requireDescription || (b.description && l.description && b.description === l.description)));

  // Pass 1: exact amount, date, and normalized description.
  for (const b of bank) {
    if (b.amount === null || !b.row.date) continue;
    const candidates = candidatesFor(b, true);
    if (candidates.length === 1) {
      const l = candidates[0];
      usedBank.add(b.index); usedLedger.add(l.index);
      matches.push({ bankIndex: b.index, ledgerIndex: l.index, confidence: 'exact', amountDifference: roundMoney(b.amount - l.amount), dateDifferenceDays: dayDistance(b.row.date, l.row.date) });
    } else if (candidates.length > 1) {
      ambiguousBank.add(b.index);
      ambiguous.push({ bankIndex: b.index, ledgerIndices: candidates.map(c => c.index), reason: 'multiple_exact_candidates' });
    }
  }

  // Pass 2: unique amount/date candidate only. Ambiguity is surfaced, never guessed.
  for (const b of bank) {
    if (usedBank.has(b.index) || ambiguousBank.has(b.index) || b.amount === null || !b.row.date) continue;
    const candidates = candidatesFor(b, false);
    if (candidates.length === 1) {
      const l = candidates[0];
      // Require uniqueness in both directions to avoid consuming a ledger row that
      // could plausibly belong to another bank transaction.
      const reverse = bank.filter(other => !usedBank.has(other.index) && other.index !== b.index
        && amountEqual(other.amount, l.amount)
        && dayDistance(other.row.date, l.row.date) !== null
        && dayDistance(other.row.date, l.row.date) <= dateWindowDays);
      if (reverse.length === 0) {
        usedBank.add(b.index); usedLedger.add(l.index);
        matches.push({ bankIndex: b.index, ledgerIndex: l.index, confidence: 'amount_date', amountDifference: roundMoney(b.amount - l.amount), dateDifferenceDays: dayDistance(b.row.date, l.row.date) });
      } else {
        ambiguousBank.add(b.index);
        ambiguous.push({ bankIndex: b.index, ledgerIndices: [...new Set([...candidates.map(c => c.index), ...reverse.map(r => r.index)])], reason: 'non_unique_amount_date' });
      }
    } else if (candidates.length > 1) {
      ambiguousBank.add(b.index);
      ambiguous.push({ bankIndex: b.index, ledgerIndices: candidates.map(c => c.index), reason: 'multiple_amount_date_candidates' });
    }
  }

  const matchedBank = new Set(matches.map(m => m.bankIndex));
  const matchedLedger = new Set(matches.map(m => m.ledgerIndex));
  return {
    matches: matches.sort((a, b) => a.bankIndex - b.bankIndex),
    ambiguous,
    unmatchedBank: bank.filter(r => !matchedBank.has(r.index)).map(r => r.index),
    unmatchedLedger: ledger.filter(r => !matchedLedger.has(r.index)).map(r => r.index),
    summary: {
      bankCount: bank.length,
      ledgerCount: ledger.length,
      matchedCount: matches.length,
      ambiguousCount: ambiguous.length,
      unmatchedBankCount: bank.length - matchedBank.size,
      unmatchedLedgerCount: ledger.length - matchedLedger.size,
    },
  };
}
