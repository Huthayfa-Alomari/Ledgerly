import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/supabase/migrations/202610200002_move_membership_helper_private.sql', import.meta.url), 'utf8');

test('private membership helper has fixed search path and authenticated-only execution', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.brp_user_has_firm_access\(target_firm_id text\)/i);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.brp_user_has_firm_access\(text\) FROM PUBLIC, anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION private\.brp_user_has_firm_access\(text\) TO authenticated/i);
});

test('all existing public policies referencing membership helper are rewritten before public RPC execution is revoked', () => {
  assert.match(sql, /FROM pg_policy pol[\s\S]*?brp_user_has_firm_access/i);
  assert.match(sql, /ALTER POLICY %I ON public\.%I/i);
  assert.match(sql, /private\.brp_user_has_firm_access/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.brp_user_has_firm_access\(text\) FROM PUBLIC, anon, authenticated/i);
});

test('migration fails closed if any public RLS policy still references the old helper', () => {
  assert.match(sql, /IF EXISTS \([\s\S]*?public\.brp_user_has_firm_access[\s\S]*?RAISE EXCEPTION 'Security migration aborted/i);
});
