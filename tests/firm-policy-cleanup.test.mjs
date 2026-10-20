import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../db/supabase/migrations/20261020150000_ledgerly_firm_policy_cleanup.sql', import.meta.url),
  'utf8'
);

test('legacy firm read policy is removed so only the scoped Ledgerly policy remains', () => {
  assert.match(migration, /DROP POLICY IF EXISTS brp_firm_read ON public\.firm/);
});
