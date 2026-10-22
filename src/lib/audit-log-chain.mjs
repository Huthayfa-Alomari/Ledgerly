const GENESIS_HASH = '0'.repeat(64);

function canonicalEvent(event) {
  return {
    id: String(event.id ?? ''),
    at: String(event.at ?? ''),
    actorId: String(event.actorId ?? 'local-workstation'),
    action: String(event.action ?? ''),
    entity: String(event.entity ?? ''),
    details: String(event.details ?? ''),
    engagementId: String(event.engagementId ?? ''),
    prevHash: String(event.prevHash ?? GENESIS_HASH),
  };
}
function hex(bytes) { return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''); }
async function digest(payload) {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('WebCrypto غير متاح للتحقق من سجل التغييرات.');
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))));
}
function chronological(events) {
  return (Array.isArray(events) ? events : []).slice().sort((a, b) =>
    String(a.at ?? '').localeCompare(String(b.at ?? '')) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

/**
 * Adds a SHA-256 hash chain to newly appended local activity events.
 * This is tamper-evident within the stored chain, not a server-authoritative audit log.
 */
export async function sealNewAuditEvents(events, actorId = 'local-workstation') {
  const current = Array.isArray(events) ? events : [];
  const verification = await verifyAuditChain(current);
  if (!verification.valid) return { events: current, changed: false, tampered: true, verification };

  const ordered = chronological(current);
  const firstHashedIndex = ordered.findIndex(event => Boolean(event.hash));
  if (firstHashedIndex > 0) {
    return {
      events: current, changed: false, tampered: false,
      verification: { ...verification, valid: false, reason: 'unsealed-event-before-sealed-history' },
    };
  }

  let previousHash = firstHashedIndex === 0
    ? String(ordered[0]?.prevHash || GENESIS_HASH)
    : GENESIS_HASH;
  let changed = false;
  const sealed = new Map();
  for (const event of ordered) {
    if (event.hash) {
      previousHash = String(event.hash);
      sealed.set(String(event.id), event);
      continue;
    }
    const base = {
      id: String(event.id ?? ''),
      at: String(event.at ?? ''),
      actorId: String(event.actorId || actorId),
      action: String(event.action ?? ''),
      entity: String(event.entity ?? ''),
      details: String(event.details ?? ''),
      engagementId: String(event.engagementId ?? ''),
      prevHash: previousHash,
    };
    const hash = await digest(base);
    const next = { ...event, ...base, hash };
    sealed.set(String(event.id), next);
    previousHash = hash;
    changed = true;
  }
  return {
    events: current.map(event => sealed.get(String(event.id)) || event),
    changed, tampered: false,
    verification: await verifyAuditChain([...sealed.values()]),
  };
}

export async function verifyAuditChain(events) {
  const ordered = chronological((Array.isArray(events) ? events : []).filter(event => Boolean(event.hash)));
  if (!ordered.length) return { valid: true, checked: 0, unsealed: (events || []).length, brokenEventId: null, reason: 'no-sealed-events' };
  let previousStoredHash = null;
  for (const event of ordered) {
    const base = canonicalEvent(event);
    if (previousStoredHash !== null && base.prevHash !== previousStoredHash) {
      return { valid: false, checked: ordered.length, unsealed: (events || []).filter(item => !item.hash).length, brokenEventId: base.id, reason: 'chain-link-mismatch' };
    }
    const expected = await digest(base);
    if (expected !== event.hash) {
      return { valid: false, checked: ordered.length, unsealed: (events || []).filter(item => !item.hash).length, brokenEventId: base.id, reason: 'event-hash-mismatch' };
    }
    previousStoredHash = String(event.hash);
  }
  return { valid: true, checked: ordered.length, unsealed: (events || []).filter(item => !item.hash).length, brokenEventId: null, reason: 'chain-valid' };
}

export async function auditChainCsv(events) {
  const verification = await verifyAuditChain(events);
  const headers = ['timestamp_utc','actor_id','action','entity','details','engagement_id','previous_hash','event_hash','verification'];
  const lines = [headers];
  const sorted = chronological(events);
  for (const event of sorted) {
    const rowValid = event.hash ? (await digest(canonicalEvent(event))) === event.hash : false;
    lines.push([
      event.at, event.actorId || 'local-workstation', event.action, event.entity, event.details,
      event.engagementId || '', event.prevHash || '', event.hash || '',
      event.hash ? (rowValid ? (verification.valid ? 'hash-valid' : 'chain-invalid') : 'tampered') : 'unsealed',
    ]);
  }
  return '\uFEFF' + lines.map(row => row.map(value => {
    let cell = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  }).join(',')).join('\r\n');
}
