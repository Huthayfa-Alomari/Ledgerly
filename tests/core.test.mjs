import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDigits, normalizeHeader, detectColumns, parseAmount, parseDate, normalizeRows, validateRows } from '../src/core.mjs';

test('normalizes Arabic and Persian digits', () => {
  assert.equal(normalizeDigits('١٢٣٫٤٥'), '123٫45');
  assert.equal(normalizeDigits('۱۲۳'), '123');
});

test('normalizes Arabic headers and punctuation', () => {
  assert.equal(normalizeHeader('تَارِيخ الحركة'), 'تاريخ الحركة');
  assert.equal(normalizeHeader('Posting_Date'), 'posting date');
});

test('detects Arabic and English statement columns', () => {
  assert.deepEqual(detectColumns(['تاريخ الحركة', 'البيان', 'مدين', 'دائن', 'الرصيد']), {
    date: 0, description: 1, debit: 2, credit: 3, balance: 4
  });
  assert.deepEqual(detectColumns(['Transaction Date', 'Description', 'Debit', 'Credit', 'Balance']), {
    date: 0, description: 1, debit: 2, credit: 3, balance: 4
  });
});

test('parses amount formats with commas, decimals, parentheses and Arabic digits', () => {
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), null, 'European separator format is rejected until the source locale is explicit');
  assert.equal(parseAmount('(125.50)'), -125.5);
  assert.equal(parseAmount('١٢٣٫٤٥'), 123.45);
  assert.equal(parseAmount('not-a-number'), null);
});

test('parses ISO, day/month/year and Excel serial dates', () => {
  assert.equal(parseDate('2026-10-14'), '2026-10-14');
  assert.equal(parseDate('14/10/2026'), '2026-10-14');
  assert.equal(parseDate(46309), '2026-10-14');
  assert.equal(parseDate('31/02/2026'), null);
});

test('normalizes ledger rows and keeps unparseable values visible for validation', () => {
  const rows = [{ Date: '14/10/2026', Description: 'Bank fee', Debit: '2.5', Credit: '', Balance: '500.00' },
    { Date: 'bad date', Description: '', Debit: '', Credit: '', Balance: '' }];
  const mapped = normalizeRows(rows, { date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
  assert.equal(mapped[0].date, '2026-10-14'); // object column order follows imported headers
  const objectRows = [
    { date: '14/10/2026', description: 'Bank fee', debit: '2.5', credit: '', balance: '500.00' },
    { date: 'bad date', description: '', debit: '', credit: '', balance: '' }
  ];
  const normalized = objectRows.map((r, i) => ({ sourceRow: i + 2, date: parseDate(r.date), description: r.description, debit: parseAmount(r.debit), credit: parseAmount(r.credit), balance: parseAmount(r.balance) }));
  assert.equal(normalized[0].debit, 2.5);
  assert.equal(normalized[0].date, '2026-10-14');
  assert.ok(validateRows(normalized).length >= 3);
});

test('handles missing columns without throwing', () => {
  const result = normalizeRows([{ a: 'x' }], {});
  assert.equal(result.length, 1);
  assert.equal(result[0].date, null);
  assert.ok(validateRows(result).length >= 2);
});


test('supports array rows and signed amount-only statements', () => {
  const rows = normalizeRows([
    ['14/10/2026', 'Incoming transfer', '250.00', '900.00'],
    ['15/10/2026', 'Outgoing transfer', '-75.50', '824.50']
  ], { date: 0, description: 1, amount: 2, balance: 3 });
  assert.equal(rows[0].credit, 250);
  assert.equal(rows[0].debit, null);
  assert.equal(rows[1].debit, 75.5);
  assert.equal(rows[1].credit, null);
  assert.equal(rows[1].balance, 824.5);
});

test('preserves zero-valued transactions as valid numeric values', () => {
  const rows = normalizeRows([['2026-10-14', 'Adjustment', '0']], { date: 0, description: 1, amount: 2 });
  assert.equal(rows[0].credit, 0);
  assert.equal(rows[0].date, '2026-10-14');
});

import { matchTransactions, signedAmount } from '../src/core.mjs';

test('converts debit/credit rows to signed cash flow', () => {
  assert.equal(signedAmount({ debit: 12.5, credit: null }), -12.5);
  assert.equal(signedAmount({ debit: null, credit: 12.5 }), 12.5);
  assert.equal(signedAmount({ debit: null, credit: null }), null);
});

test('matches exact amount, date and description one-to-one', () => {
  const bank = [
    { date: '2026-10-14', description: 'Monthly Service Fee', debit: 5, credit: null },
    { date: '2026-10-14', description: 'Customer payment', debit: null, credit: 125 },
  ];
  const ledger = [
    { date: '2026-10-14', description: 'monthly service fee', debit: 5, credit: null },
    { date: '2026-10-14', description: 'Customer payment', debit: null, credit: 125 },
  ];
  const result = matchTransactions(bank, ledger);
  assert.equal(result.summary.matchedCount, 2);
  assert.deepEqual(result.matches.map(m => m.confidence), ['exact', 'exact']);
  assert.deepEqual(result.unmatchedBank, []);
  assert.deepEqual(result.unmatchedLedger, []);
});

test('rounds negative and positive sub-fils symmetrically in signed amount calculations', () => {
  assert.equal(signedAmount({ debit: 0.0005, credit: null }), -0.001);
  assert.equal(signedAmount({ debit: null, credit: 0.0005 }), 0.001);
});

test('parses three-decimal Jordanian fils without treating a 0.004 difference as a match', () => {
  assert.equal(parseAmount('0,004'), 0.004);
  const result = matchTransactions(
    [{ date: '2026-10-14', description: 'Bank receipt', debit: null, credit: 10.004 }],
    [{ date: '2026-10-14', description: 'Ledger receipt', debit: null, credit: 10.000 }]
  );
  assert.equal(result.matches.length, 0);
  assert.deepEqual(result.unmatchedBank, [0]);
  assert.deepEqual(result.unmatchedLedger, [0]);
});

test('allows unique amount/date match inside configured date window', () => {
  const result = matchTransactions(
    [{ date: '2026-10-14', description: 'Bank wording', debit: null, credit: 80 }],
    [{ date: '2026-10-15', description: 'Ledger wording', debit: null, credit: 80 }],
    { dateWindowDays: 1 }
  );
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].confidence, 'amount_date');
  assert.equal(result.matches[0].dateDifferenceDays, 1);
});

test('does not auto-match ambiguous duplicate transactions', () => {
  const bank = [{ date: '2026-10-14', description: 'Transfer', debit: null, credit: 50 }];
  const ledger = [
    { date: '2026-10-14', description: 'Transfer', debit: null, credit: 50 },
    { date: '2026-10-14', description: 'Transfer', debit: null, credit: 50 },
  ];
  const result = matchTransactions(bank, ledger);
  assert.equal(result.summary.matchedCount, 0);
  assert.equal(result.summary.ambiguousCount, 1);
  assert.deepEqual(result.unmatchedLedger, [0, 1]);
});

test('leaves transactions unmatched when amount signs differ', () => {
  const result = matchTransactions(
    [{ date: '2026-10-14', description: 'Transfer', debit: 30, credit: null }],
    [{ date: '2026-10-14', description: 'Transfer', debit: null, credit: 30 }]
  );
  assert.equal(result.summary.matchedCount, 0);
  assert.deepEqual(result.unmatchedBank, [0]);
  assert.deepEqual(result.unmatchedLedger, [0]);
});

test('does not assign blank headers during fuzzy column detection', () => {
  assert.deepEqual(detectColumns(['', 'عمود غير معروف', 'تاريخ القيد', 'البيان', 'مدين', 'دائن']), {
    date: 2, description: 3, debit: 4, credit: 5
  });
});

test('recognizes an opening balance and does not warn that it lacks a transaction amount', () => {
  const rows = normalizeRows([
    ['2026-01-01', 'رصيد افتتاحي', '', '', '1500.00'],
    ['2026-01-02', 'حوالة عميل', '', '250.00', '1750.00']
  ], { date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
  assert.equal(rows[0].isOpeningBalance, true);
  assert.equal(rows[1].isOpeningBalance, false);
  assert.equal(validateRows(rows).some(w => w.row === 2 && w.field === 'amount'), false);
});

test('excludes opening balance rows from reconciliation counts and matching', () => {
  const bank = [
    { date: '2026-01-01', description: 'Opening balance', debit: null, credit: null, balance: 1500, isOpeningBalance: true },
    { date: '2026-01-02', description: 'Customer transfer', debit: null, credit: 250 }
  ];
  const ledger = [
    { date: '2026-01-01', description: 'Opening balance', debit: null, credit: null, balance: 1500, isOpeningBalance: true },
    { date: '2026-01-02', description: 'Customer transfer', debit: null, credit: 250 }
  ];
  const result = matchTransactions(bank, ledger);
  assert.equal(result.summary.bankCount, 1);
  assert.equal(result.summary.ledgerCount, 1);
  assert.equal(result.summary.matchedCount, 1);
  assert.deepEqual(result.unmatchedBank, []);
  assert.deepEqual(result.unmatchedLedger, []);
});

test('recognizes English opening balance labels too', () => {
  const rows = normalizeRows([
    ['2026-10-01', 'Opening balance', '', '', '1500.00'],
    ['2026-10-02', 'Customer transfer', '', '250.00', '1750.00']
  ], { date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
  assert.equal(rows[0].isOpeningBalance, true);
  assert.equal(rows[1].isOpeningBalance, false);
  assert.equal(validateRows(rows).some(w => w.row === 2 && w.field === 'amount'), false);
});

test('detects all sample columns and reconciles the three actual transactions only', () => {
  const bankRows = normalizeRows([
    ['2026-10-01', 'Opening balance', '', '', '1500.00'],
    ['2026-10-02', 'Customer transfer', '', '250.00', '1750.00'],
    ['2026-10-03', 'Bank fee', '2.50', '', '1747.50'],
    ['2026-10-04', 'Utility payment', '75.00', '', '1672.50'],
  ], detectColumns(['Date', 'Description', 'Debit', 'Credit', 'Balance']));
  const ledgerRows = normalizeRows([
    ['01/10/2026', 'رصيد افتتاحي', '', '', '1500.00'],
    ['02/10/2026', 'حوالة عميل', '', '250.00', '1750.00'],
    ['03/10/2026', 'عمولة بنكية', '2.50', '', '1747.50'],
    ['04/10/2026', 'دفعة خدمات', '75.00', '', '1672.50'],
  ], detectColumns(['تاريخ القيد', 'البيان', 'مدين', 'دائن', 'الرصيد']));
  assert.deepEqual(detectColumns(['Date', 'Description', 'Debit', 'Credit', 'Balance']), { date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
  assert.equal(validateRows(bankRows).length, 0);
  assert.equal(validateRows(ledgerRows).length, 0);
  const result = matchTransactions(bankRows, ledgerRows, { dateWindowDays: 0 });
  assert.equal(result.summary.bankCount, 3);
  assert.equal(result.summary.ledgerCount, 3);
  assert.equal(result.summary.matchedCount, 3);
});

test('bounds ambiguous candidate detail while preserving conservative unmatched results', () => {
  const bank = [{ date: '2026-10-14', description: 'Same transfer', debit: null, credit: 75 }];
  const ledger = Array.from({ length: 250 }, (_, i) => ({
    date: '2026-10-14', description: 'Same transfer', debit: null, credit: 75,
  }));
  const result = matchTransactions(bank, ledger);
  assert.equal(result.summary.matchedCount, 0);
  assert.equal(result.summary.ambiguousCount, 1);
  assert.equal(result.ambiguous[0].ledgerIndices.length, 100);
  assert.equal(result.ambiguous[0].ledgerIndicesTruncated, true);
  assert.equal(result.unmatchedLedger.length, 250);
});

test('indexed matching handles a large set of unique same-date transactions', () => {
  const bank = Array.from({ length: 5000 }, (_, i) => ({
    date: '2026-10-14', description: 'Transaction ' + i, debit: null, credit: i + 1,
  }));
  const ledger = bank.map(row => ({ ...row, description: row.description.toUpperCase() }));
  const result = matchTransactions(bank, ledger);
  assert.equal(result.summary.matchedCount, 5000);
  assert.equal(result.summary.ambiguousCount, 0);
  assert.equal(result.unmatchedBank.length, 0);
});


test('strict shared amount parser rejects ambiguous separators and unknown suffixes', () => {
  const warnings = [];
  assert.equal(parseAmount('1,5', { onWarning: warning => warnings.push(warning) }), null);
  assert.equal(parseAmount('1.234,567', { onWarning: warning => warnings.push(warning) }), null);
  assert.equal(parseAmount('100 CR', { onWarning: warning => warnings.push(warning) }), null);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every(warning => warning.reason === 'ambiguous-or-malformed-number'));
  assert.equal(parseAmount('1,234.567'), 1234.567);
  assert.equal(parseAmount('12.004'), 12.004);
  assert.equal(parseAmount('0,004'), null);
});
