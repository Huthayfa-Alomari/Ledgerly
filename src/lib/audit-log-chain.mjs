import { csvCell } from './csv.mjs';

const GENESIS_HASH = '0'.repeat(64);

function canonicalEvent(event) {
  const payload = {
    id: String(event.id ?? ''),
    at: String(event.at ?? ''),
    actorId: String(event.actorId ?? 'local-workstation'),
    action: String(event.action ?? ''),
    entity: String(event.entity ?? ''),
    details: String(event.details ?? ''),
    engagementId: String(event.engagementId ?? ''),
    prevHash: String(event.prevHash ?? ''),
  };
  // Omitting sequence from legacy records preserves verification of historical hashes.
  if (Number.isSafeInteger(event.sequence) && event.sequence > 0) payload.sequence = event.sequence;
  return payload;
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); }
async function digest(payload) {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('WebCrypto غير متاح للتحقق من سجل التغييرات.');
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))));
}
function byTimestamp(events) {
  return events.slice().sort((a, b) =>
    String(a.at ?? '').localeCompare(String(b.at ?? '')) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
}
function orderLegacyChainByLinks(events) {
  const legacy = events.filter(event => Boolean(event.hash));
  if (!legacy.length) return [];
  const starts = legacy.filter(event => String(event.prevHash ?? '') === GENESIS_HASH);
  // A well-formed historical chain has exactly one GENESIS successor. For malformed
  // histories, retain a deterministic fallback order so verification reports the break.
  if (starts.length !== 1) return byTimestamp(legacy);

  const ordered = [];
  const seenHashes = new Set();
  let current = starts[0];
  while (current && !seenHashes.has(String(current.hash))) {
    ordered.push(current);
    seenHashes.add(String(current.hash));
    const next = legacy.filter(event =>
      !seenHashes.has(String(event.hash)) && String(event.prevHash ?? '') === String(current.hash));
    if (next.length !== 1) break;
    current = next[0];
  }
  const leftovers = legacy.filter(event => !seenHashes.has(String(event.hash)));
  return [...ordered, ...byTimestamp(leftovers)];
}

function chainOrder(events) {
  const input = Array.isArray(events) ? events : [];
  const hashed = input.filter(event => Boolean(event.hash));
  const legacy = hashed.filter(event => !(Number.isSafeInteger(event.sequence) && event.sequence > 0));
  const sequenced = hashed.filter(event => Number.isSafeInteger(event.sequence) && event.sequence > 0)
    .sort((a, b) => a.sequence - b.sequence || String(a.id ?? '').localeCompare(String(b.id ?? '')));
  const unsealed = byTimestamp(input.filter(event => !event.hash));
  // For old records, follow authenticated prevHash links. Timestamps are presentation
  // metadata and may be wrong after clock drift; new records use explicit sequence numbers.
  return [...orderLegacyChainByLinks(legacy), ...sequenced, ...unsealed];
}
function sealingOrder(events) {
  const input = Array.isArray(events) ? events : [];
  if (!input.some(event => event.hash)) return byTimestamp(input);
  const sealed = input.filter(event => Boolean(event.hash));
  const pending = input.filter(event => !event.hash).reverse();
  return [...chainOrder(sealed), ...pending];
}

/**
 * Adds a SHA-256 hash chain to newly appended local activity events.
 * Sequence numbers stabilize ordering when workstation clocks drift. This remains
 * a local tamper-evident aid, not a server-authoritative audit log.
 */
export async function sealNewAuditEvents(events, actorId = 'local-workstation') {
  const current = Array.isArray(events) ? events : [];
  const verification = await verifyAuditChain(current);
  if (!verification.valid) return { events: current, changed: false, tampered: true, verification };

  const ordered = sealingOrder(current);
  let lastSequence = ordered.reduce((max, event) =>
    Math.max(max, Number.isSafeInteger(event.sequence) && event.sequence > 0 ? event.sequence : 0), 0);
  // Legacy events have no sequence field. Their preserved chain position establishes
  // the starting point for new sequence numbers without rewriting legacy hashes.
  lastSequence = Math.max(lastSequence, ordered.filter(event => Boolean(event.hash)).length);

  let previousHash = ordered.findLast?.(event => Boolean(event.hash))?.hash ?? null;
  if (!previousHash) previousHash = GENESIS_HASH;
  let changed = false;
  const sealed = new Map();

  for (const event of ordered) {
    if (event.hash) {
      previousHash = String(event.hash);
      sealed.set(String(event.id), event);
      continue;
    }
    const sequence = ++lastSequence;
    const base = {
      id: String(event.id ?? ''),
      at: String(event.at ?? ''),
      actorId: String(event.actorId || actorId),
      action: String(event.action ?? ''),
      entity: String(event.entity ?? ''),
      details: String(event.details ?? ''),
      engagementId: String(event.engagementId ?? ''),
      prevHash: previousHash,
      sequence,
    };
    const hash = await digest(base);
    const next = { ...event, ...base, hash };
    sealed.set(String(event.id), next);
    previousHash = hash;
    changed = true;
  }
  const resultEvents = current.map(event => sealed.get(String(event.id)) || event);
  return {
    events: resultEvents, changed, tampered: false,
    verification: await verifyAuditChain(resultEvents),
  };
}

export async function verifyAuditChain(events) {
  const all = Array.isArray(events) ? events : [];
  const ordered = chainOrder(all.filter(event => Boolean(event.hash)));
  const unsealed = all.filter(item => !item.hash).length;
  if (!ordered.length) return { valid: true, checked: 0, unsealed, brokenEventId: null, reason: 'no-sealed-events' };

  let previousStoredHash = null;
  for (let index = 0; index < ordered.length; index++) {
    const event = ordered[index];
    const base = canonicalEvent(event);
    if (index === 0 && base.prevHash !== GENESIS_HASH) {
      return { valid: false, checked: ordered.length, unsealed, brokenEventId: base.id, reason: 'genesis-mismatch' };
    }
    if (Number.isSafeInteger(event.sequence) && event.sequence !== index + 1) {
      return { valid: false, checked: ordered.length, unsealed, brokenEventId: base.id, reason: 'sequence-mismatch' };
    }
    if (previousStoredHash !== null && base.prevHash !== previousStoredHash) {
      return { valid: false, checked: ordered.length, unsealed, brokenEventId: base.id, reason: 'chain-link-mismatch' };
    }
    const expected = await digest(base);
    if (expected !== event.hash) {
      return { valid: false, checked: ordered.length, unsealed, brokenEventId: base.id, reason: 'event-hash-mismatch' };
    }
    previousStoredHash = String(event.hash);
  }
  return { valid: true, checked: ordered.length, unsealed, brokenEventId: null, reason: 'chain-valid' };
}

export async function auditChainCsv(events) {
  const verification = await verifyAuditChain(events);
  const headers = ['sequence','timestamp_utc','actor_id','action','entity','details','engagement_id','previous_hash','event_hash','verification'];
  const rows = [headers];
  for (const event of chainOrder(Array.isArray(events) ? events : [])) {
    const rowValid = event.hash ? (await digest(canonicalEvent(event))) === event.hash : false;
    rows.push([
      event.sequence ?? '', event.at, event.actorId || 'local-workstation', event.action, event.entity, event.details,
      event.engagementId || '', event.prevHash || '', event.hash || '',
      event.hash ? (rowValid ? (verification.valid ? 'hash-valid' : 'chain-invalid') : 'tampered') : 'unsealed',
    ]);
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
