import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../db/supabase/migrations/20261021130000_ledgerly_evidence_engagement_scope_guard.sql', import.meta.url),
  'utf8'
);

test('evidence metadata and private storage keys must resolve to an engagement in the same firm', () => {
  assert.match(migration, /ledgerly_guard_workspace_evidence_scope/);
  assert.match(migration, /e\.id = NEW\.engagement_id[\s\S]*e\.firm_id = NEW\.firm_id/);
  assert.match(migration, /object_key must begin with its firm and engagement identifiers/);
  assert.match(migration, /ledgerly_workspace_evidence_read[\s\S]*EXISTS/);
  assert.match(migration, /ledgerly_workspace_evidence_insert[\s\S]*EXISTS/);
  assert.match(migration, /ledgerly_evidence_object_read[\s\S]*EXISTS/);
  assert.match(migration, /ledgerly_evidence_object_insert[\s\S]*EXISTS/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE TABLE/i);
});
