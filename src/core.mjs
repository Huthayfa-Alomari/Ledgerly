import { parseJodAmount } from './lib/jod-money.mjs';

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

export function parseAmount(input, options = {}) {
  return parseJodAmount(input, {
    blankAsZero: false,
    onWarning: typeof options.onWarning === 'function' ? options.onWarning : undefined,
  });
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
    const numericWarnings = [];
    const parseCell = field => parseAmount(cell(field), {
      onWarning: warning => numericWarnings.push({ field, reason: warning.reason, rawValue: String(cell(field) ?? '') }),
    });
    const rawAmount = parseCell('amount');
    const debit = parseCell('debit');
    const credit = parseCell('credit');
    const description = cell('description') == null ? '' : String(cell('description')).trim();
    const balance = parseCell('balance');
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
      numericWarnings,
      raw: row,
    };
  });
}

export function validateRows(rows) {
  const warnings = [];
  rows.forEach((row, i) => {
    if (!row.date) warnings.push({ row: row.sourceRow ?? i + 2, field: 'date', message: 'Missing or unrecognized date' });
    for (const numericWarning of row.numericWarnings ?? []) {
      warnings.push({
        row: row.sourceRow ?? i + 2,
        field: numericWarning.field,
        message: 'Ambiguous or invalid numeric value; it was not guessed.',
        reason: numericWarning.reason,
        rawValue: numericWarning.rawValue,
      });
    }
    if (!row.description) warnings.push({ row: row.sourceRow ?? i + 2, field: 'description', message: 'Empty description' });
    if (row.debit === null && row.credit === null && !row.isOpeningBalance) warnings.push({ row: row.sourceRow ?? i + 2, field: 'amount', message: 'No debit/credit amount detected' });
    if (row.debit !== null && row.debit < 0) warnings.push({ row: row.sourceRow ?? i + 2, field: 'debit', message: 'Debit is negative; verify sign convention' });
    if (row.credit !== null && row.credit < 0) warnings.push({ row: row.sourceRow ?? i + 2, field: 'credit', message: 'Credit is negative; verify sign convention' });
  });
  return warnings;
}

/** Convert normalized debit/credit columns to a signed cash-flow amount. */
export function signedAmount(row) {
  if (row?.numericWarnings?.length || row?.invalidAmountFields?.length) return null;
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
 * Candidate indexes keep matching near O(n log n) for normal statement files rather
 * than scanning both complete files for every transaction.
 * Both sources must use the same debit/credit sign convention before matching.
 */
const MAX_CANDIDATE_DETAILS = 100;

function dateOrdinal(value) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 86400000) : null;
}

function lowerBound(values, target) {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values, target) {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function addToDateIndex(map, day, item) {
  let bucket = map.get(day);
  if (!bucket) {
    bucket = new Set();
    map.set(day, bucket);
  }
  bucket.add(item);
}

function buildCandidateIndex(items) {
  const byAmount = new Map();
  const byAmountAndDescription = new Map();
  const amountKeys = new Set();

  for (const item of items) {
    if (item.amountFils === null || item.dayOrdinal === null) continue;
    amountKeys.add(item.amountFils);
    let dateBuckets = byAmount.get(item.amountFils);
    if (!dateBuckets) {
      dateBuckets = new Map();
      byAmount.set(item.amountFils, dateBuckets);
    }
    addToDateIndex(dateBuckets, item.dayOrdinal, item);

    if (item.description) {
      let byDescription = byAmountAndDescription.get(item.amountFils);
      if (!byDescription) {
        byDescription = new Map();
        byAmountAndDescription.set(item.amountFils, byDescription);
      }
      let descriptionBuckets = byDescription.get(item.description);
      if (!descriptionBuckets) {
        descriptionBuckets = new Map();
        byDescription.set(item.description, descriptionBuckets);
      }
      addToDateIndex(descriptionBuckets, item.dayOrdinal, item);
    }
  }

  const sortDateKeys = index => {
    for (const buckets of index.values()) {
      for (const [day, set] of buckets) {
        if (set.size === 0) buckets.delete(day);
      }
    }
  };
  sortDateKeys(byAmount);
  sortDateKeys(byAmountAndDescription);

  return {
    byAmount,
    byAmountAndDescription,
    amountKeys: [...amountKeys].sort((a, b) => a - b),
  };
}

function removeFromCandidateIndex(index, item) {
  if (item.amountFils === null || item.dayOrdinal === null) return;
  index.byAmount.get(item.amountFils)?.get(item.dayOrdinal)?.delete(item);
  if (item.description) {
    index.byAmountAndDescription.get(item.amountFils)?.get(item.description)?.get(item.dayOrdinal)?.delete(item);
  }
}

/**
 * Return up to 101 candidates, enough to decide uniqueness while avoiding enormous
 * ambiguity-detail arrays. The public report lists at most 100 candidate row IDs.
 */
function queryCandidates(index, needle, toleranceInFils, dateWindowDays, requireDescription, excludeIndex = -1) {
  if (needle.amountFils === null || needle.dayOrdinal === null) return { items: [], truncated: false };
  if (requireDescription && !needle.description) return { items: [], truncated: false };

  const amountStart = lowerBound(index.amountKeys, needle.amountFils - toleranceInFils);
  const amountEnd = upperBound(index.amountKeys, needle.amountFils + toleranceInFils);
  const result = [];

  for (let amountPosition = amountStart; amountPosition < amountEnd; amountPosition++) {
    const amountKey = index.amountKeys[amountPosition];
    let dateBuckets;
    if (requireDescription) {
      dateBuckets = index.byAmountAndDescription.get(amountKey)?.get(needle.description);
    } else {
      dateBuckets = index.byAmount.get(amountKey);
    }
    if (!dateBuckets) continue;

    const dayKeys = [...dateBuckets.keys()].sort((a, b) => a - b);
    const dayStart = lowerBound(dayKeys, needle.dayOrdinal - dateWindowDays);
    const dayEnd = upperBound(dayKeys, needle.dayOrdinal + dateWindowDays);
    for (let dayPosition = dayStart; dayPosition < dayEnd; dayPosition++) {
      const set = dateBuckets.get(dayKeys[dayPosition]);
      if (!set) continue;
      for (const item of set) {
        if (item.index === excludeIndex) continue;
        result.push(item);
        if (result.length > MAX_CANDIDATE_DETAILS) {
          result.sort((a, b) => a.index - b.index);
          return { items: result.slice(0, MAX_CANDIDATE_DETAILS), truncated: true };
        }
      }
    }
  }

  result.sort((a, b) => a.index - b.index);
  return { items: result, truncated: false };
}

function asAmbiguousIndices(items, truncated = false) {
  return {
    ledgerIndices: items.slice(0, MAX_CANDIDATE_DETAILS).map(item => item.index),
    ledgerIndicesTruncated: truncated || items.length > MAX_CANDIDATE_DETAILS,
  };
}

export function matchTransactions(bankRows, ledgerRows, options = {}) {
  const rawTolerance = Number(options.amountTolerance ?? 0.001);
  const tolerance = Number.isFinite(rawTolerance) ? Math.max(0, rawTolerance) : 0.001;
  const toleranceInFils = Math.round(tolerance * 1000);
  const rawDateWindow = Number(options.dateWindowDays ?? 0);
  const dateWindowDays = Number.isFinite(rawDateWindow) ? Math.min(366, Math.max(0, Math.floor(rawDateWindow))) : 0;
  const usedBank = new Set();
  const usedLedger = new Set();
  const matches = [];
  const ambiguous = [];
  const ambiguousBank = new Set();

  const bank = bankRows.map((row, index) => {
    const amount = signedAmount(row);
    return {
      row, index, amount,
      amountFils: amount === null ? null : Math.round(amount * 1000),
      dayOrdinal: dateOrdinal(row.date),
      description: normalizedDescription(row.description),
    };
  }).filter(item => !item.row.isOpeningBalance);
  const ledger = ledgerRows.map((row, index) => {
    const amount = signedAmount(row);
    return {
      row, index, amount,
      amountFils: amount === null ? null : Math.round(amount * 1000),
      dayOrdinal: dateOrdinal(row.date),
      description: normalizedDescription(row.description),
    };
  }).filter(item => !item.row.isOpeningBalance);

  const bankIndex = buildCandidateIndex(bank);
  const ledgerIndex = buildCandidateIndex(ledger);

  // Pass 1: unique amount/date/description candidates.
  for (const b of bank) {
    if (b.amount === null || b.dayOrdinal === null) continue;
    const query = queryCandidates(ledgerIndex, b, toleranceInFils, dateWindowDays, true);
    const candidates = query.items;
    if (candidates.length === 1 && !query.truncated) {
      const l = candidates[0];
      usedBank.add(b.index); usedLedger.add(l.index);
      removeFromCandidateIndex(bankIndex, b);
      removeFromCandidateIndex(ledgerIndex, l);
      matches.push({ bankIndex: b.index, ledgerIndex: l.index, confidence: 'exact', amountDifference: roundMoney(b.amount - l.amount), dateDifferenceDays: dayDistance(b.row.date, l.row.date) });
    } else if (candidates.length > 1 || query.truncated) {
      ambiguousBank.add(b.index);
      ambiguous.push({
        bankIndex: b.index,
        ...asAmbiguousIndices(candidates, query.truncated),
        reason: 'multiple_exact_candidates',
      });
    }
  }

  // Pass 2: unique amount/date only, including reverse uniqueness across bank rows.
  for (const b of bank) {
    if (usedBank.has(b.index) || ambiguousBank.has(b.index) || b.amount === null || b.dayOrdinal === null) continue;
    const query = queryCandidates(ledgerIndex, b, toleranceInFils, dateWindowDays, false);
    const candidates = query.items;
    if (candidates.length === 1 && !query.truncated) {
      const l = candidates[0];
      const reverseQuery = queryCandidates(bankIndex, l, toleranceInFils, dateWindowDays, false, b.index);
      const reverse = reverseQuery.items;
      if (reverse.length === 0 && !reverseQuery.truncated) {
        usedBank.add(b.index); usedLedger.add(l.index);
        removeFromCandidateIndex(bankIndex, b);
        removeFromCandidateIndex(ledgerIndex, l);
        matches.push({ bankIndex: b.index, ledgerIndex: l.index, confidence: 'amount_date', amountDifference: roundMoney(b.amount - l.amount), dateDifferenceDays: dayDistance(b.row.date, l.row.date) });
      } else {
        ambiguousBank.add(b.index);
        const combined = [...new Map([...candidates, ...reverse].map(item => [item.index, item])).values()]
          .sort((a, b) => a.index - b.index);
        ambiguous.push({
          bankIndex: b.index,
          ...asAmbiguousIndices(combined, query.truncated || reverseQuery.truncated || combined.length > MAX_CANDIDATE_DETAILS),
          reason: 'non_unique_amount_date',
        });
      }
    } else if (candidates.length > 1 || query.truncated) {
      ambiguousBank.add(b.index);
      ambiguous.push({
        bankIndex: b.index,
        ...asAmbiguousIndices(candidates, query.truncated),
        reason: 'multiple_amount_date_candidates',
      });
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
