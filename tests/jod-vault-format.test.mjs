import test from 'node:test';
import assert from 'node:assert/strict';
import { deserializeJodVaultPayload, serializeJodVaultPayload, usesIntegerFilsVaultFormat } from '../src/lib/jod-vault-format.mjs';

test('encrypted storage stores trial balance money as integer fils and restores runtime JOD values', () => {
  const original = {
    clients: [],
    engagements: [{ id: 'e1', feeJod: '125.005', materiality: '1000' }],
    trialBalance: [{ id: 't1', openingDebit: 12.345, openingCredit: 0, debit: 500.001, credit: 0, closingDebit: 512.346, closingCredit: 0 }],
  };
  const encoded = serializeJodVaultPayload(original);
  assert.equal(usesIntegerFilsVaultFormat(encoded), true);
  assert.equal(encoded.payload.trialBalance[0].openingDebitFils, 12345);
  assert.equal(encoded.payload.trialBalance[0].debitFils, 500001);
  assert.equal('openingDebit' in encoded.payload.trialBalance[0], false);
  assert.equal(encoded.payload.engagements[0].feeFils, 125005);
  assert.equal('feeJod' in encoded.payload.engagements[0], false);
  assert.deepEqual(deserializeJodVaultPayload(encoded), original);
});

test('vault money serializer tolerates empty and legacy values without inventing amounts', () => {
  const original = { trialBalance: [{ id: 't', debit: '', credit: null }], engagements: [{ id: 'e', feeJod: '', materiality: 'unknown' }] };
  const decoded = deserializeJodVaultPayload(serializeJodVaultPayload(original));
  assert.deepEqual(decoded, original);
  assert.equal(usesIntegerFilsVaultFormat({ old: true }), false);
});

test('invoice, timesheet rate, and comparative amounts serialize as integer fils', () => {
  const input = { operations: {
    officeInvoices: [{ id: 'i1', amountJod: 10.25, taxAmountJod: 1.538, totalJod: 11.788 }],
    timeEntries: [{ id: 't1', hourlyRateJod: 15, amountJod: 22.5 }],
    accountMappings: { 'e1::1000': { lineKey: 'asset_cash', comparativeJod: 8.125 } },
  }};
  const encoded = serializeJodVaultPayload(input);
  assert.equal(encoded.payload.operations.officeInvoices[0].amountFils, 10250);
  assert.equal(encoded.payload.operations.timeEntries[0].hourlyRateFils, 15000);
  assert.equal(encoded.payload.operations.accountMappings['e1::1000'].comparativeFils, 8125);
  assert.deepEqual(deserializeJodVaultPayload(encoded), input);
});
