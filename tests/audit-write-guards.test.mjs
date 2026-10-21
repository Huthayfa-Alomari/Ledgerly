import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../db/supabase/migrations/20261021110000_ledgerly_audit_log_and_workpaper_review_guard.sql', import.meta.url), 'utf8');

test('change log actor identity and timestamp are enforced at insert time without assuming engagement_id exists', () => {
  assert.match(migration, /NEW\.actor_id IS DISTINCT FROM auth\.uid\(\)::text/);
  assert.match(migration, /change_log actor_id must match the authenticated user/);
  assert.match(migration, /NEW\.occurred_at := pg_catalog\.to_char/);
  assert.match(migration, /pg_catalog\.to_jsonb\(NEW\) ->> 'engagement_id'/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.change_log FROM anon, authenticated/);
  assert.match(migration, /Trusted server operations may write system events/);
});

test('review guard supports both existing prepared_by and canonical preparer_id columns', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reviewed_by text REFERENCES public\.app_user\(id\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS reviewed_at text/);
  assert.match(migration, /COALESCE\(new_row ->> 'preparer_id', new_row ->> 'prepared_by'\)/);
  assert.match(migration, /pg_catalog\.to_jsonb\(NEW\)/);
  assert.match(migration, /pg_catalog\.to_jsonb\(OLD\)/);
  assert.doesNotMatch(migration, /NEW\.preparer_id|NEW\.prepared_by|NEW\.procedure_ref|NEW\.objective|NEW\.work_done/);
  assert.match(migration, /NEW\.status = 'reviewed'/);
  assert.match(migration, /Final working-paper sign-off requires a different authorized reviewer/);
  assert.match(migration, /Signed-off working papers must be reopened in a separate update/);
  assert.match(migration, /Review-only users cannot alter working-paper preparation content/);
  assert.match(migration, /CREATE POLICY ledgerly_working_paper_review_update/);
});
