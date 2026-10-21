import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../db/supabase/migrations/20261021154100_ledgerly_consolidate_workpaper_update_policy.sql', import.meta.url),
  'utf8'
);

test('consolidation removes both overlapping UPDATE policies and recreates one role union', () => {
  assert.match(migration, /DROP POLICY IF EXISTS ledgerly_working_paper_review_update ON public\.working_paper/i);
  assert.match(migration, /DROP POLICY IF EXISTS ledgerly_update_scope ON public\.working_paper/i);
  assert.equal((migration.match(/CREATE POLICY ledgerly_update_scope/gi) || []).length, 1);
  assert.doesNotMatch(migration, /CREATE POLICY ledgerly_working_paper_review_update/i);
  for (const role of ['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']) {
    assert.ok(migration.includes("'" + role + "'"), 'Missing UPDATE role: ' + role);
  }
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);
});
