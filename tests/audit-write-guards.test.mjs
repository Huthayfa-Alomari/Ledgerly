import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../db/supabase/migrations/20261021110000_ledgerly_audit_log_and_workpaper_review_guard.sql', import.meta.url), 'utf8');

test('change log actor identity and timestamp are enforced at insert time', () => {
  assert.match(migration, /NEW\.actor_id IS DISTINCT FROM auth\.uid\(\)::text/);
  assert.match(migration, /change_log actor_id must match the authenticated user/);
  assert.match(migration, /NEW\.occurred_at := pg_catalog\.to_char/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.change_log FROM anon, authenticated/);
  assert.match(migration, /Trusted server-side code \(service_role\)/);
});

test('working-paper review fields are protected from preparer-role sign-off', () => {
  assert.match(migration, /ledgerly_guard_working_paper_review_fields/);
  assert.match(migration, /Only an authorized reviewer may change working-paper review fields/);
  assert.match(migration, /Final working-paper sign-off requires a partner or independent reviewer/);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON public\.working_paper/);
  assert.match(migration, /The preparer cannot independently sign off their own working paper/);
  assert.equal((migration.match(/'معتمد'/g) || []).length, 3, 'Arabic approval must be guarded on insert, update, and old-status locking');
  assert.match(migration, /Signed-off working papers must be reopened/);
  assert.match(migration, /Review-only users cannot alter working-paper preparation content/);
  assert.match(migration, /CREATE POLICY ledgerly_working_paper_review_update/);
});
