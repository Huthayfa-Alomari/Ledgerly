import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTrialBalance } from '../src/lib/trial-balance-analytics.mjs';

const row = (overrides = {}) => ({
  id: '1', code: '1000', name: 'Cash',
  openingDebit: 100, openingCredit: 0,
  debit: 50, credit: 20,
  closingDebit: 130, closingCredit: 0,
  ...overrides,
});

test('balanced trial balance reports totals and no aggregate imbalance', () => {
  const result = analyzeTrialBalance([
    row({ id: '1', code: '1000', openingDebit: 100, debit: 50, credit: 20, closingDebit: 130 }),
    row({ id: '2', code: '2000', name: 'Payables', openingDebit: 0, openingCredit: 100, debit: 20, credit: 50, closingDebit: 0, closingCredit: 130 }),
  ]);
  assert.equal(result.accountCount, 2);
  assert.equal(result.balanced, true);
  assert.deepEqual(result.differences, { opening: 0, movement: 0, closing: 0 });
  assert.equal(result.counts.error, 0);
});

test('detects movement and closing imbalance with explicit differences', () => {
  const result = analyzeTrialBalance([row({ debit: 500, closingDebit: 600 })]);
  assert.equal(result.balanced, false);
  assert.equal(result.differences.movement, 480);
  assert.equal(result.differences.closing, 600);
  assert.ok(result.issues.some(issue => issue.category === 'unbalanced-movement'));
  assert.ok(result.issues.some(issue => issue.category === 'unbalanced-closing'));
});

test('flags duplicate account codes on each affected row', () => {
  const result = analyzeTrialBalance([
    row({ id: 'a', code: '1000' }),
    row({ id: 'b', code: '1000', name: 'Cash copy' }),
  ]);
  assert.equal(result.issues.filter(issue => issue.category === 'duplicate-account-code').length, 2);
});

test('flags non-numeric, negative and dual-sided closing amounts without crashing', () => {
  const result = analyzeTrialBalance([
    row({ id: 'bad', debit: Number.NaN, credit: -2, closingDebit: 20, closingCredit: 30 }),
  ]);
  assert.ok(result.issues.some(issue => issue.category === 'invalid-data'));
  assert.ok(result.issues.some(issue => issue.category === 'negative-amount'));
  assert.ok(result.issues.some(issue => issue.category === 'dual-sided-closing-balance'));
});

test('materiality creates traceable prioritization indicators, not audit conclusions', () => {
  const result = analyzeTrialBalance([row({ closingDebit: 2500, debit: 2500 })], { materiality: 1000 });
  assert.ok(result.issues.some(issue => issue.category === 'material-closing-balance' && issue.amount === 2500));
  assert.ok(result.issues.some(issue => issue.category === 'material-movement'));
  assert.match(result.issues.find(issue => issue.category === 'material-closing-balance').detail, /ليس حكمًا على التحريف/);
});

test('tolerance boundary and invalid materiality are handled predictably', () => {
  const result = analyzeTrialBalance([row({ openingDebit: 0, openingCredit: 0, debit: 100.005, credit: 100, closingDebit: 0, closingCredit: 0 })], { tolerance: 0.01, materiality: -1 });
  assert.equal(result.materiality, 0);
  assert.equal(result.balanced, true);
});

test('missing account identifiers and empty input are reported safely', () => {
  const result = analyzeTrialBalance([row({ id: 'missing', code: '', name: '' })]);
  assert.ok(result.issues.some(issue => issue.category === 'missing-code'));
  assert.ok(result.issues.some(issue => issue.category === 'missing-name'));
  assert.equal(analyzeTrialBalance([]).balanced, true);
});
