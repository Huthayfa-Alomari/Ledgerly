import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reconciliation = readFileSync(new URL('../src/Reconciliation.tsx', import.meta.url), 'utf8');

test('bank reconciliation exposes details for matched bank and ledger rows', () => {
  for (const label of [
    'تفاصيل المطابقات المقترحة',
    'تاريخ وبيان البنك',
    'حركة البنك',
    'رصيد البنك',
    'تاريخ وبيان الأستاذ',
    'حركة الأستاذ',
    'رصيد الأستاذ',
    'فرق المبلغ',
    'فرق التاريخ (أيام)',
  ]) {
    assert.ok(reconciliation.includes(label), `reconciliation details should include ${label}`);
  }
  assert.match(reconciliation, /matchResult\.matches\.map/);
});

test('bank reconciliation lists full details of unmatched transactions from both sources', () => {
  assert.match(reconciliation, /حركات غير مطابقة — كشف البنك/);
  assert.match(reconciliation, /matchResult\.unmatchedBank\.map/);
  assert.match(reconciliation, /حركات غير مطابقة — دفتر الأستاذ/);
  assert.match(reconciliation, /matchResult\.unmatchedLedger\.map/);
  assert.match(reconciliation, /formatMoney\(m\.amountDifference\)/);
});
