import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeJournalEntries,
  buildEvidenceLineage,
  buildPartnerDashboard,
  buildQualityShield,
  normalizeJournalRows,
  parseAuditAmount,
  runDataTrustChecks,
} from '../src/lib/audit-intelligence.mjs';

const tbRow = (overrides = {}) => ({
  id: 'tb-1', engagementId: 'e1', code: '1000', name: 'Cash',
  openingDebit: 100, openingCredit: 0, debit: 50, credit: 20,
  closingDebit: 130, closingCredit: 0, source: 'test.csv',
  ...overrides,
});

test('parses Arabic digits and common JOD amount formats safely', () => {
  assert.equal(parseAuditAmount('١٬٢٣٤٫٥٠'), 1234.5);
  assert.equal(parseAuditAmount('1,234.50'), 1234.5);
  assert.equal(parseAuditAmount('1.234,50'), 1234.5);
  assert.equal(parseAuditAmount('(250.00)'), -250);
  assert.equal(parseAuditAmount('not-a-number'), null);
});

test('normalizes Arabic journal headers and Arabic/Persian numerals', () => {
  const result = normalizeJournalRows([
    { 'تاريخ القيد': '٢٣/١٠/٢٠٢٦', 'الوصف': 'شراء مواد', 'رمز الحساب': '٥٠٠٠', 'مدين': '١٢٥٫٥٠', 'دائن': '0', 'رقم القيد': 'JV-1' },
  ]);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.rows[0].date, '2026-10-23');
  assert.equal(result.rows[0].debit, 125.5);
  assert.equal(result.rows[0].credit, 0);
  assert.equal(result.rows[0].accountCode, '٥٠٠٠');
  assert.deepEqual(result.warnings, []);
});

test('blank side in paired debit-credit columns is normalized as zero', () => {
  const result = normalizeJournalRows([{ Date: '2026-01-01', Account: '100', Description: 'Test', Debit: '125', Credit: '' }]);
  assert.equal(result.rows[0].debit, 125);
  assert.equal(result.rows[0].credit, 0);
  assert.equal(result.rows[0].classification, 'debit-credit-columns');
});

test('does not guess debit or credit for ambiguous amount-only files', () => {
  const result = normalizeJournalRows([{ Date: '2026-01-01', Account: '100', Description: 'Test', Amount: '500' }]);
  assert.equal(result.rows[0].classification, 'ambiguous-amount');
  assert.equal(result.rows[0].debit, null);
  assert.equal(result.rows[0].credit, null);
  assert.match(result.warnings.join(' '), /لن نفترض/);
  const analysis = analyzeJournalEntries(result.rows);
  assert.ok(analysis.issues.some(issue => issue.id === 'journal-ambiguous-amount'));
});

test('trial balance gate flags aggregate imbalance and missing account identity', () => {
  const result = runDataTrustChecks([
    tbRow({ code: '1000', closingDebit: 200, closingCredit: 0 }),
    tbRow({ id: 'tb-2', code: '', name: '', closingDebit: 0, closingCredit: 100, openingDebit: 0, debit: 0, credit: 100 }),
  ]);
  assert.equal(result.rowCount, 2);
  assert.ok(result.issues.some(issue => issue.id === 'tb-unbalanced'));
  assert.ok(result.issues.some(issue => issue.id === 'tb-identity'));
});

test('trial balance gate checks duplicate account codes and rollforward differences', () => {
  const result = runDataTrustChecks([
    tbRow({ code: '1000', closingDebit: 131 }),
    tbRow({ id: 'tb-2', code: '1000', name: 'Cash alt', closingDebit: 1, closingCredit: 0, openingDebit: 0, openingCredit: 0, debit: 0, credit: 0 }),
  ]);
  assert.ok(result.issues.some(issue => issue.id === 'tb-duplicate-code'));
  assert.ok(result.issues.some(issue => issue.id === 'tb-rollforward'));
});

test('journal analytics detect identical lines but do not flag shared voucher references alone', () => {
  const normalized = normalizeJournalRows([
    { Date: '2026-01-10', Description: 'Purchase', Account: '5100', Debit: '100', Credit: '0', Reference: 'JV-10' },
    { Date: '2026-01-10', Description: 'Purchase', Account: '5100', Debit: '100', Credit: '0', Reference: 'JV-10' },
    { Date: '2026-01-10', Description: 'Payable', Account: '2100', Debit: '0', Credit: '100', Reference: 'JV-10' },
  ]);
  const result = analyzeJournalEntries(normalized.rows);
  const duplicate = result.issues.find(issue => issue.id === 'journal-duplicate-line');
  assert.ok(duplicate);
  assert.equal(duplicate.count, 2);
  assert.equal(result.scannedCount, 3);
});

test('journal analytics scans all supplied rows and surfaces month-end as a signal', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    rowNumber: index + 2, date: index === 0 ? '2026-01-31' : '2026-01-15',
    description: 'Entry ' + index, accountCode: '1000', reference: 'R' + index,
    debit: index === 9 ? 10000 : 100, credit: 0, amount: null, classification: 'debit-credit-columns',
  }));
  const result = analyzeJournalEntries(rows);
  assert.equal(result.scannedCount, 10);
  assert.equal(result.monthEndSignals, 1);
  assert.ok(result.issues.some(issue => issue.id === 'journal-large-amount'));
  assert.ok(result.issues.some(issue => issue.id === 'journal-month-end'));
});

test('evidence lineage identifies missing and unmatched workpaper references', () => {
  const lineage = buildEvidenceLineage(
    [{ id: 'wp1', engagementId: 'e1', ref: 'A-100', title: 'Cash', status: 'معتمد' }, { id: 'wp2', ref: 'A-200', title: 'Revenue' }],
    [{ id: 'ev1', workpaperRef: 'A-100' }, { id: 'ev2', workpaperRef: '' }, { id: 'ev3', workpaperRef: 'A-999' }],
  );
  assert.equal(lineage.linkedEvidenceCount, 1);
  assert.equal(lineage.unlinkedEvidenceCount, 2);
  assert.equal(lineage.workpapersWithoutEvidence, 1);
});

test('quality shield and partner dashboard report review gaps without claiming audit assurance', () => {
  const quality = buildQualityShield({
    workpapers: [{ id: 'wp1', ref: 'A-1', status: 'مسودة', procedure: '', conclusion: '' }],
    evidence: [{ id: 'ev1', workpaperRef: 'unknown' }],
    findings: [{ id: 'f1', criteria: '', condition: 'x', effect: '', recommendation: '' , status: 'مفتوحة' }],
    risks: [{ id: 'r1', likelihood: 'مرتفع', impact: 'مرتفع' }],
    trialBalance: [tbRow({ closingDebit: 200 })],
  });
  assert.ok(quality.attentionCount >= 5);
  assert.ok(quality.checks.some(item => item.id === 'quality-finding-documentation'));

  const dashboard = buildPartnerDashboard(
    [{ id: 'e1', clientId: 'c1', year: '2026', status: 'مفتوح' }],
    [{ id: 'c1', name: 'Demo Client' }],
    { workpapers: [{ engagementId: 'e1', status: 'مسودة' }], evidence: [], findings: [{ engagementId: 'e1', status: 'مفتوحة' }], risks: [], trialBalance: [tbRow({ engagementId: 'e1', closingDebit: 200 })] },
  );
  assert.equal(dashboard[0].client.name, 'Demo Client');
  assert.equal(dashboard[0].pendingWorkpapers, 1);
  assert.equal(dashboard[0].openFindings, 1);
});
