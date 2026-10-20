import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../db/supabase/migrations/20261020110000_ledgerly_interim_firm_admin_write_gate.sql', import.meta.url), 'utf8');

test('generic write policies are temporarily limited to firm_admin', () => {
  assert.match(migration, /private\.brp_user_has_firm_role/);
  assert.match(migration, /ra\.role = 'firm_admin'/);
  assert.doesNotMatch(migration, /ra\.role IN \('firm_admin','managing_partner','engagement_partner'/);
  assert.match(migration, /Temporary conservative write gate/);
});
