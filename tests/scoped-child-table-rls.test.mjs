import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../db/supabase/migrations/20261020143000_ledgerly_scoped_child_table_rls.sql', import.meta.url),
  'utf8'
);

test('firm identity uses a single canonical scoped read policy', () => {
  assert.match(migration, /DROP POLICY IF EXISTS brp_firm_member_read ON public\\.firm/);
  assert.match(migration, /DROP POLICY IF EXISTS brp_firm_isolation ON public\\.firm/);
  assert.match(migration, /CREATE POLICY ledgerly_firm_read/);
});

test('immutable event chain can be read only within the assigned scope and remains server-write-only', () => {
  assert.match(migration, /ledgerly_event_chain_read/);
  assert.match(migration, /private\.brp_user_has_role_in_scope\([\s\S]*?firm_id, engagement_id/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.immutable_event_chain FROM anon, authenticated/);
});

test('independence declarations are bound to the assessment scope and signing user', () => {
  assert.match(migration, /ledgerly_independence_declaration_read/);
  assert.match(migration, /ledgerly_independence_declaration_insert/);
  assert.match(migration, /user_id = \(SELECT auth\.uid\(\)\)::text/);
  assert.match(migration, /ia\.id = independence_declaration\.assessment_id/);
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.independence_declaration FROM anon, authenticated/);
});

test('workpaper child rows inherit parent engagement scope and stay append-only', () => {
  assert.match(migration, /ledgerly_working_paper_version_read/);
  assert.match(migration, /ledgerly_working_paper_version_insert/);
  assert.match(migration, /changed_by = \(SELECT auth\.uid\(\)\)::text/);
  assert.match(migration, /ledgerly_working_paper_tickmark_read/);
  assert.match(migration, /ledgerly_working_paper_tickmark_insert/);
  assert.match(migration, /created_by = \(SELECT auth\.uid\(\)\)::text/);
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.working_paper_version FROM anon, authenticated/);
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.working_paper_tickmark FROM anon, authenticated/);
});
