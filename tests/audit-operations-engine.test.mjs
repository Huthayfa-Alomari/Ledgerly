import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDraftFinancialStatements, buildWhatsappReminder, calculateOfficeMetrics,
  inferBankColumns, parseUblInvoiceXml, rollForwardWorkpapers, runAdvancedJournalTests,
  selectAuditSample, validateLocalWorkpaperTransition, suggestRiskPbcRequestsFromRisks,
} from '../src/lib/audit-operations-engine.mjs';

const journal = (overrides = {}) => ({
  rowNumber: 2, date: '2026-10-23', dateRaw: '2026-10-23 23:10:00',
  description: 'Manual adjustment', accountCode: '1000', reference: 'JV-1',
  debit: 5000, credit: 0, amount: 5000, classification: 'debit-credit-columns', ...overrides,
});

test('journal screening flags weekend, after-hours, rounded amounts and documents Benford limits', () => {
  const result = runAdvancedJournalTests(Array.from({ length: 12 }, (_, i) => journal({
    rowNumber: i + 2, date: i === 0 ? '2026-10-23' : '2026-10-22',
    debit: i === 0 ? 5000 : 100 + i, amount: i === 0 ? 5000 : 100 + i,
  })));
  assert.ok(result.issues.some(item => item.id === 'journal-weekend'));
  assert.ok(result.issues.some(item => item.id === 'journal-after-hours'));
  assert.ok(result.issues.some(item => item.id === 'journal-rounded-amount'));
  assert.equal(result.benford.interpretable, false);
});

test('random and systematic samples reproduce the same result from a fixed seed', () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: 'row-' + i, debit: i + 1, credit: 0 }));
  const a = selectAuditSample(rows, { method: 'random', sampleSize: 10, seed: 42 });
  const b = selectAuditSample(rows, { method: 'random', sampleSize: 10, seed: 42 });
  assert.deepEqual(a.selections.map(item => item.row.id), b.selections.map(item => item.row.id));
  const s1 = selectAuditSample(rows, { method: 'systematic', sampleSize: 10, seed: 42 });
  const s2 = selectAuditSample(rows, { method: 'systematic', sampleSize: 10, seed: 42 });
  assert.deepEqual(s1.selections.map(item => item.row.id), s2.selections.map(item => item.row.id));
});

test('MUS keeps monetary hit count and exposes population/interval metadata', () => {
  const rows = [{ id: 'small', amount: 1 }, { id: 'large', amount: 99 }];
  const result = selectAuditSample(rows, { method: 'mus', sampleSize: 10, seed: 3, amountOf: row => row.amount });
  assert.equal(result.populationTotal, 100);
  assert.equal(result.interval, 10);
  assert.equal(result.selections.reduce((sum, item) => sum + item.hits.length, 0), 10);
});

test('financial statement draft only includes explicitly mapped accounts', () => {
  const tb = [
    { code: '1000', closingDebit: 100, closingCredit: 0 },
    { code: '2000', closingDebit: 0, closingCredit: 40 },
    { code: '3000', closingDebit: 0, closingCredit: 90 },
    { code: '4999', closingDebit: 15, closingCredit: 0 },
  ];
  const result = buildDraftFinancialStatements(tb, {
    '1000': { lineKey: 'cash', comparativeJod: 80 },
    '2000': { lineKey: 'payables', comparativeJod: 20 },
    '3000': { lineKey: 'revenue', comparativeJod: 70 },
  });
  assert.equal(result.current.assets, 100);
  assert.equal(result.current.liabilities, 40);
  assert.equal(result.current.income, 90);
  assert.equal(result.current.profit, 90);
  assert.equal(result.unmapped.length, 1);
});

test('UBL XML parser rejects entity declarations and reads draft invoice fields locally', () => {
  assert.throws(() => parseUblInvoiceXml('<!DOCTYPE Invoice [<!ENTITY x "bad">]><Invoice/>'), /DOCTYPE/);
  const xml = '<Invoice><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:ID>INV-77</cbc:ID><cbc:IssueDate>2026-09-30</cbc:IssueDate><cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Demo Supplier</cbc:Name></cac:PartyName><cac:PartyTaxScheme><cbc:CompanyID>123456789</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty><cbc:DocumentCurrencyCode>JOD</cbc:DocumentCurrencyCode><cac:LegalMonetaryTotal><cbc:LineExtensionAmount>12.500</cbc:LineExtensionAmount><cbc:PayableAmount>14.375</cbc:PayableAmount></cac:LegalMonetaryTotal><cac:TaxTotal><cbc:TaxAmount>1.875</cbc:TaxAmount></cac:TaxTotal></Invoice>';
  const result = parseUblInvoiceXml(xml);
  assert.equal(result.invoiceId, 'INV-77');
  assert.equal(result.issueDate, '2026-09-30');
  assert.equal(result.payableAmount, 14.375);
  assert.equal(result.validation.isUbl21, true);
});

test('office metrics use three-decimal JOD and WhatsApp remains an explicit click-through', () => {
  const reminder = buildWhatsappReminder({ phone: '+962 79 123 4567', clientName: 'عميل تجريبي', requestTitle: 'كشف البنك', dueDate: '2026-10-30' });
  assert.match(reminder.url, /^https:\/\/wa\.me\/962791234567\?text=/);
  const metrics = calculateOfficeMetrics([{ feeJod: '100.125' }], [{ hours: 2, hourlyRateJod: 15.125 }], [{ totalJod: '50.555', status: 'مفتوحة' }]);
  assert.equal(metrics.actualCost, 30.25);
  assert.equal(metrics.billed, 50.555);
  assert.equal(metrics.outstanding, 50.555);
});

test('local approval requires a distinct preparer and reviewer identity', () => {
  const paper = { status: 'بانتظار المراجعة', preparer: 'reviewer A', reviewer: '' };
  assert.equal(validateLocalWorkpaperTransition(paper, 'معتمد', '').valid, false);
  assert.equal(validateLocalWorkpaperTransition(paper, 'معتمد', 'reviewer A').valid, false);
  assert.equal(validateLocalWorkpaperTransition(paper, 'معتمد', 'partner B').valid, true);
  assert.equal(validateLocalWorkpaperTransition({ status: 'معتمد', preparer: 'A' }, 'قيد التنفيذ', 'B').valid, false);
});

test('year roll-forward resets approvals and evidence while preserving the paper skeleton', () => {
  const papers = rollForwardWorkpapers([{ id: 'old', engagementId: 'e1', ref: 'A1', title: 'Cash', status: 'معتمد', conclusion: 'Old conclusion', evidenceIds: ['evidence-old'] }], 'e2', () => 'new');
  assert.equal(papers[0].id, 'new');
  assert.equal(papers[0].status, 'مسودة');
  assert.equal(papers[0].conclusion, '');
  assert.deepEqual(papers[0].history, []);
  assert.deepEqual(papers[0].evidenceIds, []);
  assert.equal(papers[0].engagementId, 'e2');
});

test('bank column learning can reuse only a matching normalized header signature', () => {
  const headers = ['Date', 'Description', 'Debit', 'Credit', 'Balance'];
  const saved = [{ name: 'Bank A', headers, mapping: { date: 'Date', amountDebit: 'Debit' } }];
  const result = inferBankColumns(headers, saved);
  assert.equal(result.matchedSavedProfile, 'Bank A');
  assert.equal(result.mapping.amountDebit, 'Debit');
});


test('risk-based PBC requests produce traceable suggestions and ignore closed risks', () => {
  const suggestions = suggestRiskPbcRequestsFromRisks([
    { id: 'risk-revenue', area: 'الإيرادات', title: 'الاعتراف بالإيراد قرب نهاية الفترة', status: 'مفتوح' },
    { id: 'risk-bank', area: 'Cash and bank', title: 'Bank reconciliation differences', status: 'open' },
    { id: 'risk-closed', area: 'inventory', title: 'Closed count issue', status: 'مغلقة' },
    { id: 'risk-empty', area: 'General', title: '   ', status: 'open' },
  ]);
  assert.ok(suggestions.length > 0);
  assert.ok(suggestions.every(item => item.title.includes('متابعة الخطر:')));
  assert.ok(suggestions.some(item => item.sourceRiskId === 'risk-revenue' && /فواتير مبيعات|المبيعات/.test(item.title)));
  assert.ok(suggestions.some(item => item.sourceRiskId === 'risk-bank' && /بنكي|مطابقة البنك|مصادقة بنك/.test(item.title)));
  assert.ok(!suggestions.some(item => item.sourceRiskId === 'risk-closed'));
});
