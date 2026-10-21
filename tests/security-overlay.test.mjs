import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../docs/archive/202610190002_security_hardening.sql', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../db/supabase/security/README.md', import.meta.url), 'utf8');

test('legacy security overlay is clearly archived and must not be applied', () => {
  assert.match(sql, /^-- ARCHIVED — DO NOT APPLY/);
  assert.match(sql, /not compatible as a drop-in update to the current live schema/);
});

test('archived security helper keeps fixed search path and restricted execution grants for historical review', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.brp_user_has_firm_role/i);
  assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.brp_user_has_firm_role\(text\) FROM PUBLIC, anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION private\.brp_user_has_firm_role\(text\) TO authenticated/i);
});

test('firm, app-user, and role assignment writes are revoked from browser roles', () => {
  for (const table of ['firm', 'app_user', 'role_assignment']) {
    assert.match(sql, new RegExp(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\\.${table} FROM anon, authenticated`, 'i'));
  }
});

test('business write policy requires both firm membership and a firm-level role', () => {
  assert.match(sql, /CREATE POLICY brp_firm_role_write ON public\.%I FOR ALL TO authenticated USING \(public\.brp_user_has_firm_access\(firm_id\) AND private\.brp_user_has_firm_role\(firm_id\)\) WITH CHECK \(public\.brp_user_has_firm_access\(firm_id\) AND private\.brp_user_has_firm_role\(firm_id\)\)/i);
  assert.match(sql, /ra\.scope_type = 'firm'/i);
});

test('change log remains append-only for authenticated clients', () => {
  assert.match(sql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.change_log FROM anon, authenticated/i);
  assert.match(sql, /CREATE POLICY brp_change_log_insert[\s\S]*?FOR INSERT TO authenticated/i);
});

test('deployment docs clearly state this overlay is not deployed and not production complete', () => {
  assert.match(readme, /partially deployed/i);
  assert.match(readme, /not a complete external-audit-office authorization model/i);
  assert.match(readme, /has \*\*not\*\* been applied/i);
});
