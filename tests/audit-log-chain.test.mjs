import test from 'node:test';
import assert from 'node:assert/strict';
import { auditChainCsv, sealNewAuditEvents, verifyAuditChain } from '../src/lib/audit-log-chain.mjs';

const event = (id, at, action = 'create') => ({ id, at, action, entity: 'test', details: id });

test('seals local activity events in chronological SHA-256 order and verifies them', async () => {
  const initial = [event('newer', '2026-10-23T10:00:00.000Z'), event('older', '2026-10-23T09:00:00.000Z')];
  const sealed = await sealNewAuditEvents(initial, 'user-123');
  assert.equal(sealed.changed, true);
  assert.equal(sealed.events.find(row => row.id === 'older').actorId, 'user-123');
  assert.equal((await verifyAuditChain(sealed.events)).valid, true);
});

test('identifies modifications to previously sealed event details and does not silently reseal', async () => {
  const first = await sealNewAuditEvents([event('1', '2026-10-23T09:00:00.000Z')]);
  const edited = first.events.map(row => ({ ...row, details: 'modified' }));
  const second = await sealNewAuditEvents(edited);
  assert.equal(second.tampered, true);
  assert.equal(second.changed, false);
  assert.equal((await verifyAuditChain(edited)).valid, false);
});

test('appending a new event preserves prior hashes and chains the new event', async () => {
  const one = await sealNewAuditEvents([event('1', '2026-10-23T09:00:00.000Z')]);
  const two = await sealNewAuditEvents([event('2', '2026-10-23T10:00:00.000Z'), ...one.events]);
  assert.equal(two.events.find(row => row.id === '1').hash, one.events[0].hash);
  assert.equal((await verifyAuditChain(two.events)).valid, true);
  assert.match(await auditChainCsv(two.events), /event_hash/);
});
