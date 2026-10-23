import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/Reconciliation.tsx', import.meta.url), 'utf8');

test('reconciliation report offers a working Excel export action', () => {
  assert.match(source, /تصدير التقرير إلى Excel/);
  assert.match(source, /onClick=\{exportReconciliationReport\}/);
  assert.match(source, /function exportReconciliationReport\(\)/);
  assert.match(source, /XLSX\.writeFile\(workbook/);
});

test('Excel report includes summary, matched, unmatched and ambiguous worksheets', () => {
  for (const sheetName of [
    'الملخص',
    'المطابقات',
    'غير مطابق - البنك',
    'غير مطابق - الأستاذ',
    'حالات ملتبسة',
  ]) {
    assert.ok(source.includes(sheetName), `export should include worksheet ${sheetName}`);
  }
  assert.match(source, /matchResult\.summary\.matchedCount/);
  assert.match(source, /matchResult\.unmatchedBank/);
  assert.match(source, /matchResult\.unmatchedLedger/);
  assert.match(source, /matchResult\.ambiguous\.map/);
  assert.match(source, /فرق التاريخ \(أيام\)/);
});
