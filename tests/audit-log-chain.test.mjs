import test from 'node:test';
import assert from 'node:assert/strict';
import { auditChainCsv, sealNewAuditEvents, verifyAuditChain } from '../src/lib/audit-log-chain.mjs';

const event = (id, at, action = 'create') => ({ id, at, action, entity: 'test', details: id });

test('seals local activity events in chronological SHA-256 order and verifies them', async () => {
  const initial = [event('newer', '2026-10-23T10:00:00.000Z'), event('older', '2026-10-23T09:00:00.000Z')];
  const sealed = await sealNewAuditEvents(initial, 'user-123');
  assert.equal(sealed.changed, true);
  assert.equal(sealed.events.find(row => row.id === 'older').actorId, 'user-123');
  assert.equal(sealed.events.find(row => row.id === 'older').sequence, 1);
  assert.equal(sealed.events.find(row => row.id === 'older').prevHash, '0'.repeat(64));
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


test('requires the first event to point to GENESIS', async () => {
  const sealed = await sealNewAuditEvents([event('1', '2026-10-23T09:00:00.000Z')]);
  const altered = sealed.events.map(row => ({ ...row }));
  altered[0].prevHash = 'f'.repeat(64);
  const result = await verifyAuditChain(altered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'genesis-mismatch');
});

test('appends by sequence even when a later event has an earlier workstation timestamp', async () => {
  const first = await sealNewAuditEvents([event('1', '2026-10-23T10:00:00.000Z')]);
  const second = await sealNewAuditEvents([event('2', '2020-01-01T00:00:00.000Z'), ...first.events]);
  assert.equal(second.changed, true);
  assert.equal(second.events.find(row => row.id === '2').sequence, 2);
  assert.equal(second.events.find(row => row.id === '2').prevHash, first.events[0].hash);
  assert.equal((await verifyAuditChain(second.events)).valid, true);
});

test('rejects sequence gaps or reordered sequence metadata', async () => {
  const sealed = await sealNewAuditEvents([event('1', '2026-10-23T09:00:00.000Z'), event('2', '2026-10-23T10:00:00.000Z')]);
  const altered = sealed.events.map(row => row.id === '2' ? { ...row, sequence: 3 } : row);
  const result = await verifyAuditChain(altered);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'sequence-mismatch');
});


test('audit-chain CSV export protects spreadsheet formula strings in event details', async () => {
  const malicious = event('xss-csv', '2026-10-23T10:00:00.000Z');
  malicious.details = '=HYPERLINK("https://example.invalid","open")';
  const sealed = await sealNewAuditEvents([malicious]);
  const output = await auditChainCsv(sealed.events);
  assert.ok(output.includes("'=HYPERLINK"));
  assert.ok(output.includes('""https://example.invalid""'));
});


async function hashLegacyPayload(payload) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

test('legacy hash chain follows prevHash links when historical timestamps are out of order', async () => {
  const genesis = '0'.repeat(64);
  const firstBase = {
    id: 'legacy-first',
    at: '2026-10-24T10:00:00.000Z',
    actorId: 'local-workstation',
    action: 'create',
    entity: 'test',
    details: 'legacy-first',
    engagementId: '',
    prevHash: genesis,
  };
  const first = { ...firstBase, hash: await hashLegacyPayload(firstBase) };
  const secondBase = {
    id: 'legacy-second',
    at: '2020-01-01T00:00:00.000Z',
    actorId: 'local-workstation',
    action: 'create',
    entity: 'test',
    details: 'legacy-second',
    engagementId: '',
    prevHash: first.hash,
  };
  const second = { ...secondBase, hash: await hashLegacyPayload(secondBase) };

  assert.equal((await verifyAuditChain([second, first])).valid, true);
  const appended = await sealNewAuditEvents([event('new-after-legacy', '2019-01-01T00:00:00.000Z'), second, first]);
  assert.equal(appended.tampered, false);
  assert.equal(appended.events.find(row => row.id === 'new-after-legacy').sequence, 3);
  assert.equal(appended.events.find(row => row.id === 'new-after-legacy').prevHash, second.hash);
  assert.equal((await verifyAuditChain(appended.events)).valid, true);
});
