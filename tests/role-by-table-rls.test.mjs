import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../db/supabase/migrations/20261020140459_ledgerly_role_by_table_rls.sql', import.meta.url),
  'utf8'
);

test('RLS authorization uses trusted active membership and role assignments', () => {
  assert.match(migration, /private\.brp_user_has_role_in_scope/);
  assert.match(migration, /u\.id = \(SELECT auth\.uid\(\)\)::text/);
  assert.match(migration, /u\.status = 'active'/);
  assert.match(migration, /ra\.deleted_at IS NULL/);
  assert.match(migration, /ra\.scope_type = 'engagement'/);
  assert.match(migration, /ra\.scope_id = target_engagement_id/);
  assert.doesNotMatch(migration, /user_metadata|raw_user_meta_data/);
});

test('business writes are table-specific and not granted to firm_admin by default', () => {
  assert.match(migration, /ledgerly_client_insert[\s\S]*?ARRAY\['managing_partner','engagement_partner','manager'\]/);
  assert.match(migration, /preparation_roles text\[\] := ARRAY\[[\s\S]*?'manager','senior','staff'/);
  assert.match(migration, /ledgerly_update_scope/);
  assert.match(migration, /ledgerly_insert_scope/);
  assert.match(migration, /ledgerly_engagement_update/);
  assert.doesNotMatch(migration, /CREATE POLICY brp_firm_role_write/);
  assert.match(migration, /REVOKE ALL ON public\.app_user FROM anon, authenticated/);
  assert.match(migration, /GRANT SELECT \(id, firm_id, display_name, email, status, created_at, updated_at, deleted_at\)/);
  assert.doesNotMatch(migration, /GRANT SELECT \([^)]*auth_secret/);
});

test('browser invitation, schema metadata, and physical deletes stay blocked', () => {
  assert.match(migration, /ledgerly_invitation_deny_browser_access[\s\S]*?USING \(false\) WITH CHECK \(false\)/);
  assert.match(migration, /schema_version_deny_browser[\s\S]*?USING \(false\) WITH CHECK \(false\)/);
  assert.match(migration, /REVOKE DELETE, TRUNCATE ON public\.%I FROM anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON public\.firm_invitation FROM anon, authenticated/);
});

test('audit event chain is server-write-only and change log is append-only for browser roles', () => {
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.immutable_event_chain FROM anon, authenticated/);
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.change_log FROM anon, authenticated/);
});
