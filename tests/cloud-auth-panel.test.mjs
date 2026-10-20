import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/CloudAuthPanel.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../db/supabase/migrations/20261020100000_ledgerly_secure_first_firm_bootstrap.sql', import.meta.url), 'utf8');

test('cloud auth uses only the browser-safe key and never embeds a privileged credential', () => {
  assert.match(panel, /apikey: config\.anonKey/);
  assert.match(panel, /sessionStorage\.setItem\(SESSION_KEY/);
  assert.match(panel, /token\?grant_type=refresh_token/);
  assert.doesNotMatch(panel, /service_role|sb_secret_/i);
});

test('first-firm bootstrap requires an authenticated caller and serializes first registration', () => {
  assert.match(migration, /caller_id := auth\.uid\(\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /Initial firm already exists/);
  assert.match(migration, /'firm_admin'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ledgerly_bootstrap_first_firm\(text, text\) FROM anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ledgerly_bootstrap_first_firm\(text, text\) TO authenticated/);
});
