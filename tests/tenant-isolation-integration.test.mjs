import test from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.LEDGERLY_TEST_SUPABASE_URL;
const anon = process.env.LEDGERLY_TEST_SUPABASE_ANON_KEY;
const tokenA = process.env.LEDGERLY_TEST_TOKEN_A;
const tokenB = process.env.LEDGERLY_TEST_TOKEN_B;
const firmA = process.env.LEDGERLY_TEST_FIRM_A;
const firmB = process.env.LEDGERLY_TEST_FIRM_B;
const engagementA = process.env.LEDGERLY_TEST_ENGAGEMENT_A;

const configured = Boolean(url && anon && tokenA && tokenB && firmA && firmB && engagementA && firmA !== firmB);
const integration = configured ? test : test.skip;

async function rest(token, path, init = {}) {
  return fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: anon, Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  });
}

integration('cross-firm snapshot reads return no other office rows', async () => {
  const response = await rest(tokenA, `/rest/v1/firm_workspace_snapshot?select=firm_id&firm_id=eq.${encodeURIComponent(firmB)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

integration('cross-firm snapshot insert/update is denied', async () => {
  const response = await rest(tokenA, `/rest/v1/firm_workspace_snapshot?firm_id=eq.${encodeURIComponent(firmB)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ payload: { forbidden: true }, version: 999, updated_by: 'attacker' }),
  });
  assert.ok([200, 401, 403].includes(response.status));
  if (response.status === 200) assert.deepEqual(await response.json(), []);
});

integration('cross-firm evidence metadata and object access are denied', async () => {
  const metadata = await rest(tokenA, `/rest/v1/workspace_evidence_file?select=id&firm_id=eq.${encodeURIComponent(firmB)}`);
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), []);
  const key = `${firmB}/${engagementA}/does-not-exist.pdf`;
  const object = await rest(tokenA, `/storage/v1/object/ledgerly-evidence/${key.split('/').map(encodeURIComponent).join('/')}`);
  assert.ok([400, 401, 403, 404].includes(object.status));
});

integration('an unrelated firm cannot create a snapshot for another office', async () => {
  const response = await rest(tokenA, '/rest/v1/firm_workspace_snapshot', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ firm_id: firmB, payload: { test: true }, version: 1, updated_by: 'not-user-a' }),
  });
  assert.ok([401, 403, 409].includes(response.status));
});
