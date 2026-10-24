import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeJournalEntries,
  evaluateEngagementClosure,
  fingerprintTrialBalanceRows,
  fingerprintAccountMappings,
  fingerprintReportConfiguration,
  buildEvidenceLineage,
  buildAuditEvidenceGraph,
  summarizeTrialBalanceForCopilot,
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


test('date normalization preserves DMY dates with a time suffix without timezone-day drift', () => {
  const result = normalizeJournalRows([
    { 'Posting Date': '23/10/2026 15:30:00', Description: 'Phone bill', Account: '6100', Debit: '12.345', Credit: '0' },
  ]);
  assert.equal(result.rows[0].date, '2026-10-23');
  assert.equal(result.rows[0].debit, 12.345);
});

test('invalid non-empty numeric cells are retained as explicit journal exceptions', () => {
  const result = normalizeJournalRows([
    { Date: '2026-10-23', Description: 'Invalid debit', Account: '5100', Debit: 'not-a-number', Credit: '0' },
  ]);
  assert.deepEqual(result.rows[0].invalidAmountFields, ['debit']);
  assert.equal(result.rows[0].classification, 'invalid-amount');
  assert.ok(analyzeJournalEntries(result.rows).issues.some(item => item.id === 'journal-invalid-amount'));
});

test('trial balance trust gate checks opening, movement and closing totals at three-decimal JOD precision', () => {
  const rows = [
    tbRow({ code: '1000', name: 'Cash', openingDebit: 1.234, openingCredit: 0, debit: 0.001, credit: 0, closingDebit: 1.235, closingCredit: 0 }),
    tbRow({ id: 'tb-2', code: '3000', name: 'Equity', openingDebit: 0, openingCredit: 1.234, debit: 0, credit: 0.001, closingDebit: 0, closingCredit: 1.235 }),
  ];
  const result = runDataTrustChecks(rows);
  assert.equal(result.openingDifference, 0);
  assert.equal(result.movementDifference, 0);
  assert.equal(result.closingDifference, 0);
  assert.equal(result.totals.closingDebit, 1.235);
  assert.equal(result.totals.closingCredit, 1.235);
  assert.equal(result.pass, true);
});

test('trial balance gate never treats a missing financial field as a verified zero', () => {
  const result = runDataTrustChecks([tbRow({ debit: null })]);
  const missing = result.issues.find(item => item.id === 'tb-missing-financial-fields');
  assert.ok(missing);
  assert.ok(missing.rowNumbers.includes(2));
});

test('optional approval threshold screening identifies grouped below-threshold transactions', () => {
  const normalized = normalizeJournalRows([
    { Date: '2026-10-20', Description: 'Supplier expense', Account: '5100', Supplier: 'Acme Ltd', Debit: '400', Credit: '0', Reference: 'A' },
    { Date: '2026-10-21', Description: 'Supplier expense', Account: '5100', Supplier: 'Acme Ltd', Debit: '400', Credit: '0', Reference: 'B' },
    { Date: '2026-10-21', Description: 'Supplier expense', Account: '5100', Supplier: 'Acme Ltd', Debit: '400', Credit: '0', Reference: 'C' },
  ]);
  const withoutThreshold = analyzeJournalEntries(normalized.rows);
  assert.ok(!withoutThreshold.issues.some(item => item.id === 'journal-possible-split-transactions'));
  const result = analyzeJournalEntries(normalized.rows, { approvalThreshold: 1000, splitWindowDays: 1 });
  const split = result.issues.find(item => item.id === 'journal-possible-split-transactions');
  assert.ok(split);
  assert.ok(split.rowNumbers.includes(2) && split.rowNumbers.includes(3) && split.rowNumbers.includes(4));
});

test('evidence lineage does not arbitrarily attach evidence to duplicate workpaper references', () => {
  const lineage = buildEvidenceLineage(
    [{ id: 'wp-a', ref: 'WP-100' }, { id: 'wp-b', ref: ' wp-100 ' }],
    [{ id: 'evidence-1', workpaperRef: 'WP-100' }],
  );
  assert.equal(lineage.duplicateWorkpaperReferences.length, 1);
  assert.equal(lineage.ambiguousReferenceCount, 1);
  assert.equal(lineage.links[0].reason, 'ambiguous-reference');
  assert.equal(lineage.links[0].linked, false);
  assert.equal(lineage.linkedEvidenceCount, 0);
});

test('quality shield flags stale workpaper source snapshots after trial balance changes', () => {
  const sourceRows = [tbRow({ code: '1000', name: 'Cash' })];
  const currentFingerprint = fingerprintTrialBalanceRows(sourceRows);
  assert.ok(currentFingerprint);
  assert.equal(fingerprintTrialBalanceRows([...sourceRows]), currentFingerprint);
  assert.notEqual(fingerprintTrialBalanceRows([tbRow({ code: '1000', name: 'Cash', debit: 999 })]), currentFingerprint);
  const quality = buildQualityShield({
    workpapers: [{ id: 'wp-1', ref: 'WP-1', status: 'معتمد', procedure: 'إجراء', conclusion: 'نتيجة', sourceFingerprint: 'tb-fnv1a64:stale' }],
    evidence: [], findings: [], risks: [], trialBalance: sourceRows, currentSourceFingerprint: currentFingerprint,
  });
  assert.equal(quality.checks.find(item => item.id === 'quality-stale-workpaper')?.count, 1);
});

test('source import row-count and control-total mismatches are explicit high-severity checks', () => {
  const result = runDataTrustChecks([
    tbRow({ openingDebit: 0, openingCredit: 0, debit: 100, credit: 100, closingDebit: 0, closingCredit: 0 }),
  ], { expectedRowCount: 2, sourceTotals: { debit: 99 } });
  assert.ok(result.issues.some(item => item.id === 'tb-source-row-count'));
  assert.ok(result.issues.some(item => item.id === 'tb-source-totals-mismatch'));
});


test('source column mapping metadata prevents a missing mapped value from passing as zero', () => {
  const result = runDataTrustChecks([tbRow({
    debit: null,
    sourceFinancialFields: ['openingDebit', 'openingCredit', 'debit', 'credit', 'closingDebit', 'closingCredit'],
  })]);
  assert.ok(result.issues.some(item => item.id === 'tb-missing-financial-fields'));
});

test('movement-only trial balances do not pretend omitted opening and closing columns are zero', () => {
  const result = runDataTrustChecks([tbRow({
    sourceFinancialFields: ['debit', 'credit'],
  })]);
  assert.deepEqual(result.availableFields, ['debit', 'credit']);
  assert.equal(result.openingDifference, null);
  assert.equal(result.closingDifference, null);
  assert.ok(!result.issues.some(item => item.id === 'tb-missing-financial-fields'));
  assert.ok(result.issues.some(item => item.id === 'tb-source-field-coverage'));
});


test('partner portfolio reports overdue client requests, workload and billed invoice values', () => {
  const portfolio = buildPartnerDashboard(
    [{ id: 'e1', clientId: 'c1', budgetHours: '6', feeJod: '1000', status: 'العمل الميداني' }],
    [{ id: 'c1', name: 'Client One' }],
    { workpapers: [], evidence: [], findings: [], risks: [], trialBalance: [] },
    {
      clientRequests: [
        { id: 'r1', engagementId: 'e1', done: false, dueDate: '2026-10-20' },
        { id: 'r2', engagementId: 'e1', done: false, dueDate: '2026-10-30' },
        { id: 'r3', engagementId: 'e1', done: true, dueDate: '2026-10-10' },
      ],
      timeEntries: [
        { engagementId: 'e1', hours: '5', hourlyRateJod: '20' },
        { engagementId: 'e1', hours: '2', hourlyRateJod: '30' },
      ],
      officeInvoices: [{ engagementId: 'e1', totalJod: '100.123' }],
    },
    { asOfDate: '2026-10-23' },
  );
  assert.equal(portfolio.length, 1);
  assert.equal(portfolio[0].outstandingRequests, 2);
  assert.equal(portfolio[0].overdueRequests, 1);
  assert.equal(portfolio[0].loggedHours, 7);
  assert.equal(portfolio[0].budgetHours, 6);
  assert.equal(portfolio[0].hoursBudgetVariance, -1);
  assert.equal(portfolio[0].actualLaborCostJod, 160);
  assert.equal(portfolio[0].invoiceValueJod, 100.123);
});


test('journal normalization preserves the original worksheet row number across blank rows', () => {
  const first = { Date: '2026-10-20', Description: 'First', Account: '5100', Debit: '1', Credit: '0' };
  const fourth = { Date: '2026-10-23', Description: 'Fourth', Account: '5100', Debit: '2', Credit: '0' };
  Object.defineProperty(first, '__sourceRowNumber', { value: 2, enumerable: false });
  Object.defineProperty(fourth, '__sourceRowNumber', { value: 5, enumerable: false });
  const result = normalizeJournalRows([first, {}, {}, fourth]);
  assert.deepEqual(result.rows.map(row => row.rowNumber), [2, 5]);
});

test('finding evidence lineage validates the finding, workpaper and evidence chain', () => {
  const workpapers = [{ id: 'wp-1', ref: 'WP-1', title: 'Revenue test' }];
  const evidence = [{ id: 'ev-1', title: 'Invoice', reference: 'INV-1', workpaperRef: 'WP-1' }];
  const findings = [
    { id: 'f-1', title: 'Supported finding', workpaperRef: 'WP-1', evidenceIds: ['ev-1'] },
    { id: 'f-2', title: 'Unlinked finding', workpaperRef: '', evidenceIds: [] },
  ];
  const lineage = buildEvidenceLineage(workpapers, evidence, findings);
  assert.equal(lineage.findingsCount, 2);
  assert.equal(lineage.fullyLinkedFindings, 1);
  assert.equal(lineage.findingsWithoutWorkpaper, 1);
  assert.equal(lineage.findingsWithoutEvidence, 1);
  assert.equal(lineage.findingLinks[0].linked, true);
  assert.equal(lineage.findingLinks[1].linked, false);
});

test('closure gate blocks unresolved finding-to-workpaper/evidence links', () => {
  const workpapers = [{ id: 'wp-1', engagementId: 'e1', ref: 'WP-1', status: 'معتمد', procedure: 'Procedure', conclusion: 'Conclusion' }];
  const evidence = [{ id: 'ev-1', engagementId: 'e1', workpaperRef: 'WP-1', title: 'Invoice' }];
  const findings = [{ id: 'f-1', engagementId: 'e1', status: 'مغلقة', title: 'Finding', workpaperRef: '', evidenceIds: [] }];
  const balancedTB = [
    tbRow({ id: 'tb-cash', engagementId: 'e1', code: '1000', name: 'Cash', openingDebit: 100, openingCredit: 0, debit: 50, credit: 20, closingDebit: 130, closingCredit: 0 }),
    tbRow({ id: 'tb-equity', engagementId: 'e1', code: '3000', name: 'Equity', openingDebit: 0, openingCredit: 100, debit: 20, credit: 50, closingDebit: 0, closingCredit: 130 }),
  ];
  const result = evaluateEngagementClosure({
    engagementId: 'e1', workpapers, evidence, findings, risks: [], trialBalance: balancedTB, operations: {},
    currentSourceFingerprint: fingerprintTrialBalanceRows(balancedTB),
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some(item => item.id === 'close-findings-no-workpaper'));
  assert.ok(result.blockers.some(item => item.id === 'close-findings-no-evidence'));
});

test('closure gate can pass a complete administrative evidence chain while retaining professional-review caveats', () => {
  const balancedTB = [
    tbRow({ id: 'tb-cash', engagementId: 'e1', code: '1000', name: 'Cash', openingDebit: 100, openingCredit: 0, debit: 50, credit: 20, closingDebit: 130, closingCredit: 0 }),
    tbRow({ id: 'tb-equity', engagementId: 'e1', code: '3000', name: 'Equity', openingDebit: 0, openingCredit: 100, debit: 20, credit: 50, closingDebit: 0, closingCredit: 130 }),
  ];
  const currentFingerprint = fingerprintTrialBalanceRows(balancedTB);
  const workpapers = [{ id: 'wp-1', engagementId: 'e1', ref: 'WP-1', status: 'معتمد', procedure: 'Procedure', conclusion: 'Conclusion', sourceFingerprint: currentFingerprint }];
  const evidence = [{ id: 'ev-1', engagementId: 'e1', workpaperRef: 'WP-1', title: 'Invoice' }];
  const findings = [{ id: 'f-1', engagementId: 'e1', status: 'مغلقة', title: 'Finding', criteria: 'Criteria', condition: 'Condition', effect: 'Effect', recommendation: 'Recommendation', workpaperRef: 'WP-1', evidenceIds: ['ev-1'] }];
  const result = evaluateEngagementClosure({
    engagementId: 'e1', workpapers, evidence, findings, risks: [], trialBalance: balancedTB, operations: { accountMappings: { 'e1::1000': { lineKey: 'assets.cash' }, 'e1::3000': { lineKey: 'equity' } } },
    currentSourceFingerprint: currentFingerprint,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
});


test('quality shield flags exported reports based on a prior trial-balance snapshot', () => {
  const trialBalance = [tbRow({ source: 'current.csv' })];
  const currentFingerprint = fingerprintTrialBalanceRows(trialBalance);
  const quality = buildQualityShield({
    workpapers: [], evidence: [], findings: [], risks: [], trialBalance, currentSourceFingerprint: currentFingerprint,
    reportDrafts: [{ engagementId: 'e1', firmName: 'Example Firm', lastExportSnapshot: { kind: 'financial-statements', sourceFingerprint: 'tb-fnv1a64:old', generatedAt: '2026-01-01T00:00:00.000Z' } }],
  });
  assert.equal(quality.checks.find(item => item.id === 'quality-report-stale-source')?.count, 1);
});

test('quality shield flags report configuration that has not been exported', () => {
  const quality = buildQualityShield({
    workpapers: [], evidence: [], findings: [], risks: [], trialBalance: [tbRow()],
    reportDrafts: [{ engagementId: 'e1', firmName: 'Example Firm', opinion: 'مسودة' }],
  });
  assert.equal(quality.checks.find(item => item.id === 'quality-report-not-exported')?.count, 1);
});


test('data trust reports unclassified account codes with original source rows', () => {
  const result = runDataTrustChecks([
    tbRow({ code: '1000', sourceRowNumber: 12 }),
    tbRow({ id: 'tb-2', code: '2000', sourceRowNumber: 14 }),
  ], { unmappedAccountCodes: ['2000'] });
  const issue = result.issues.find(item => item.id === 'tb-unmapped-accounts');
  assert.ok(issue);
  assert.deepEqual(issue.rowNumbers, [14]);
  assert.equal(issue.count, 1);
});

test('closure gate blocks unclassified accounts by default and supports explicit policy override', () => {
  const tb = [
    tbRow({ id: 'tb-cash', engagementId: 'e1', code: '1000', name: 'Cash', openingDebit: 100, openingCredit: 0, debit: 50, credit: 20, closingDebit: 130, closingCredit: 0 }),
    tbRow({ id: 'tb-equity', engagementId: 'e1', code: '3000', name: 'Equity', openingDebit: 0, openingCredit: 100, debit: 20, credit: 50, closingDebit: 0, closingCredit: 130 }),
  ];
  const currentFingerprint = fingerprintTrialBalanceRows(tb);
  const workpapers = [{ id: 'wp', engagementId: 'e1', ref: 'WP-1', status: 'معتمد', procedure: 'Procedure', conclusion: 'Conclusion', sourceFingerprint: currentFingerprint }];
  const evidence = [{ id: 'ev', engagementId: 'e1', workpaperRef: 'WP-1' }];
  const findings = [{ id: 'f', engagementId: 'e1', status: 'مغلقة', workpaperRef: 'WP-1', evidenceIds: ['ev'], criteria: 'C', condition: 'X', effect: 'Y', recommendation: 'Z' }];
  const input = { engagementId: 'e1', workpapers, evidence, findings, risks: [], trialBalance: tb, operations: { accountMappings: { 'e1::1000': { lineKey: 'assets.cash' } } }, currentSourceFingerprint: currentFingerprint };
  const blocked = evaluateEngagementClosure(input);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.some(item => item.id === 'close-unmapped-accounts'));
  const allowed = evaluateEngagementClosure(input, { requireAccountClassification: false });
  assert.ok(!allowed.blockers.some(item => item.id === 'close-unmapped-accounts'));
});


test('account mapping fingerprints change when classification or comparative values change', () => {
  const mappings = {
    'e1::1000': { lineKey: 'assets.cash', comparativeJod: '125.000' },
    'e1::2000': { lineKey: 'liabilities.payables', comparativeJod: '30.000' },
    'e2::1000': { lineKey: 'unrelated.scope', comparativeJod: '999.000' },
  };
  const original = fingerprintAccountMappings(mappings, 'e1');
  assert.equal(fingerprintAccountMappings({ ...mappings, 'e1::2000': { comparativeJod: '30.000', lineKey: 'liabilities.payables' } }, 'e1'), original);
  assert.notEqual(fingerprintAccountMappings({ ...mappings, 'e1::2000': { ...mappings['e1::2000'], lineKey: 'assets.cash' } }, 'e1'), original);
  assert.notEqual(fingerprintAccountMappings({ ...mappings, 'e1::2000': { ...mappings['e1::2000'], comparativeJod: '31.000' } }, 'e1'), original);
  assert.notEqual(fingerprintAccountMappings(mappings, 'e2'), original);
});

test('quality shield marks report stale if account classifications change even when trial balance is unchanged', () => {
  const trialBalance = [
    tbRow({ id: 'tb-1', engagementId: 'e1', code: '1000', name: 'Cash' }),
  ];
  const currentMap = { 'e1::1000': { lineKey: 'assets.cash', comparativeJod: '10.000' } };
  const reportDrafts = [{
    engagementId: 'e1', firmName: 'Firm',
    lastExportSnapshot: {
      sourceFingerprint: fingerprintTrialBalanceRows(trialBalance),
      accountMappingFingerprint: fingerprintAccountMappings({ 'e1::1000': { lineKey: 'assets.cash', comparativeJod: '9.000' } }, 'e1'),
      generatedAt: '2026-10-23T10:00:00.000Z',
    },
  }];
  const quality = buildQualityShield({
    workpapers: [], evidence: [], findings: [], risks: [], trialBalance,
    currentSourceFingerprint: fingerprintTrialBalanceRows(trialBalance),
    reportDrafts, accountMappings: currentMap, engagementId: 'e1',
  });
  assert.equal(quality.checks.find(item => item.id === 'quality-report-stale-source')?.count, 1);
});


test('external control totals are not compared against source columns that were not imported', () => {
  const result = runDataTrustChecks([tbRow({
    sourceFinancialFields: ['debit', 'credit'],
  })], { sourceTotals: { openingDebit: 500, closingCredit: 250, debit: 50 } });
  const mismatch = result.issues.find(item => item.id === 'tb-source-totals-mismatch');
  assert.ok(!mismatch);
  assert.equal(result.openingDifference, null);
  assert.equal(result.closingDifference, null);
});


test('report metadata fingerprint changes when period, auditor or opinion changes', () => {
  const metadata = { firmName: 'Firm A', auditorName: 'Auditor A', periodEnd: '2026-12-31', opinion: 'Unmodified' };
  const fingerprint = fingerprintReportConfiguration(metadata);
  assert.equal(fingerprintReportConfiguration({ ...metadata }), fingerprint);
  assert.notEqual(fingerprintReportConfiguration({ ...metadata, opinion: 'Qualified' }), fingerprint);
  assert.notEqual(fingerprintReportConfiguration({ ...metadata, periodEnd: '2026-09-30' }), fingerprint);
  assert.notEqual(fingerprintReportConfiguration({ ...metadata, auditorName: 'Auditor B' }), fingerprint);
});

test('quality shield marks a previously exported report stale after report metadata changes', () => {
  const trialBalance = [tbRow({ id: 'tb-report', engagementId: 'e1', code: '1000', name: 'Cash' })];
  const currentConfig = { firmName: 'Firm', auditorName: 'Auditor', periodEnd: '2026-12-31', opinion: 'Qualified' };
  const snapshotConfig = { ...currentConfig, opinion: 'Unmodified' };
  const accountMappings = { 'e1::1000': { lineKey: 'assets.cash', comparativeJod: '1.000' } };
  const quality = buildQualityShield({
    workpapers: [], evidence: [], findings: [], risks: [], trialBalance,
    engagementId: 'e1', accountMappings, currentSourceFingerprint: fingerprintTrialBalanceRows(trialBalance),
    reportDrafts: [{
      engagementId: 'e1', ...currentConfig,
      lastExportSnapshot: {
        sourceFingerprint: fingerprintTrialBalanceRows(trialBalance),
        accountMappingFingerprint: fingerprintAccountMappings(accountMappings, 'e1'),
        reportConfigurationFingerprint: fingerprintReportConfiguration(snapshotConfig),
        generatedAt: '2026-10-23T10:00:00.000Z',
      },
    }],
  });
  assert.equal(quality.checks.find(item => item.id === 'quality-report-stale-source')?.count, 1);
});


test('journal screening detects a duplicate document reference at the same account, direction and amount', () => {
  const normalized = normalizeJournalRows([
    { Date: '2026-01-03', Description: 'Supplier invoice INV-88', Account: '5100', Reference: 'INV-88', Supplier: 'Acme', Debit: '275.000', Credit: '0' },
    { Date: '2026-01-18', Description: 'Supplier invoice reposted INV-88', Account: '5100', Reference: 'INV-88', Supplier: 'Acme', Debit: '275.000', Credit: '0' },
  ]);
  const result = analyzeJournalEntries(normalized.rows);
  const issue = result.issues.find(item => item.id === 'journal-duplicate-document-reference');
  assert.ok(issue);
  assert.deepEqual(issue.rowNumbers.sort((a,b)=>a-b), [2,3]);
});

test('journal screening detects an opposite-side candidate for the same referenced posting', () => {
  const normalized = normalizeJournalRows([
    { Date: '2026-01-03', Description: 'Supplier invoice INV-88', Account: '5100', Reference: 'INV-88', Supplier: 'Acme', Debit: '275.000', Credit: '0' },
    { Date: '2026-01-18', Description: 'Reversal INV-88', Account: '5100', Reference: 'INV-88', Supplier: 'Acme', Debit: '0', Credit: '275.000' },
  ]);
  const result = analyzeJournalEntries(normalized.rows);
  const issue = result.issues.find(item => item.id === 'journal-possible-reversal-pair');
  assert.ok(issue);
  assert.deepEqual(issue.rowNumbers.sort((a,b)=>a-b), [2,3]);
  assert.equal(issue.pairs[0].daysBetween, 15);
});

test('audit evidence graph links journal row to test result, exact evidence reference, workpaper, finding and reviewer history', () => {
  const journalRows = [{ rowNumber: 2, date: '2026-01-03', description: 'Supplier invoice INV-88', accountCode: '5100', reference: 'INV-88', counterparty: 'Acme', debit: 275, credit: 0, amount: null, classification: 'debit-credit-columns', raw: {} }];
  const journalAnalysis = { issues: [{ id: 'journal-duplicate-line', title: 'Duplicate', severity: 'high', detail: 'Two row records', action: 'Check source', rowNumbers: [2] }] };
  const workpapers = [{ id: 'wp-1', ref: 'WP-AP-1', title: 'AP invoice test', status: 'معتمد', reviewer: 'Reviewer', history: [{ status: 'معتمد', action: 'تغيير الحالة إلى معتمد' }] }];
  const evidence = [{ id: 'ev-1', title: 'Invoice INV-88', reference: 'inv-88', workpaperRef: 'WP-AP-1' }];
  const findings = [{ id: 'f-1', title: 'Invoice exception', workpaperRef: 'WP-AP-1', evidenceIds: ['ev-1'] }];
  const graph = buildAuditEvidenceGraph({ sourceName: 'journal.csv', journalRows, journalAnalysis, workpapers, evidence, findings });
  assert.equal(graph.sourceRowCount, 1);
  assert.equal(graph.issuesWithEvidenceCount, 1);
  assert.equal(graph.issuesWithoutEvidenceCount, 0);
  assert.equal(graph.issueNodes[0].linkedWorkpapers[0].ref, 'WP-AP-1');
  assert.equal(graph.issueNodes[0].linkedFindings[0].id, 'f-1');
  assert.equal(graph.issueNodes[0].traceStatus, 'trace-with-review-history');
});

test('Copilot account summaries disclose current/comparative variance and exact TB source row', () => {
  const rows = [
    tbRow({ code: '6200', name: 'Maintenance expense', sourceRowNumber: 27, openingDebit: 0, openingCredit: 0, debit: 12000, credit: 0, closingDebit: 12000, closingCredit: 0 }),
  ];
  const summaries = summarizeTrialBalanceForCopilot(rows, { 'e1::6200': { comparativeJod: '9000', lineKey: 'expenses.maintenance' } }, 'e1');
  assert.equal(summaries[0].ref, 'ACC-001');
  assert.equal(summaries[0].accountName, 'Maintenance expense');
  assert.equal(summaries[0].sourceRowNumber, 27);
  assert.equal(summaries[0].closingNetJod, 12000);
  assert.equal(summaries[0].comparativeNetJod, 9000);
  assert.equal(summaries[0].varianceJod, 3000);
  assert.equal(summaries[0].variancePercent, 33.333);
});
