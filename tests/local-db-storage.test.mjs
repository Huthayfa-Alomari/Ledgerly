import test from 'node:test';
import assert from 'node:assert/strict';
import { persistLocalData } from '../src/lib/local-db-storage.mjs';

test('local persistence stores JSON and does not mutate the database object', () => {
  const writes = [];
  const db = { clients: [{ id: 'c1' }], amount: 0.004 };
  const error = persistLocalData(() => ({ setItem: (key, value) => writes.push([key, value]) }), 'ledgerly', db);
  assert.equal(error, null);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'ledgerly');
  assert.deepEqual(JSON.parse(writes[0][1]), db);
  assert.equal(db.amount, 0.004);
});

test('local persistence surfaces quota errors instead of silently discarding a save', () => {
  const error = persistLocalData(() => ({ setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } }), 'ledgerly', {});
  assert.match(error, /Quota exceeded/);
});

test('local persistence catches storage-provider errors and serialization failures', () => {
  assert.match(persistLocalData(() => { throw new Error('Storage disabled'); }, 'ledgerly', {}), /Storage disabled/);
  const cyclic = {}; cyclic.self = cyclic;
  assert.match(persistLocalData(() => ({ setItem() {} }), 'ledgerly', cyclic), /circular|cyclic|serialize/i);
});
