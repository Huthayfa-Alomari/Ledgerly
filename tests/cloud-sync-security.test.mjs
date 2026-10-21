import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../db/supabase/migrations/20261021100000_ledgerly_cloud_sync_private_evidence.sql', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../src/lib/cloud-workspace.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/CloudWorkspacePanel.tsx', import.meta.url), 'utf8');

test('cloud snapshot uses optimistic version checks and firm-scoped RLS', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.firm_workspace_snapshot/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /brp_user_has_role_in_scope\(firm_id, NULL/);
  assert.match(migration, /updated_by = \(SELECT auth\.uid\(\)\)::text/);
  assert.match(migration, /REVOKE DELETE, TRUNCATE ON public\.firm_workspace_snapshot/);
  assert.match(sync, /current !== expected/);
  assert.match(sync, /CloudConflictError/);
  assert.match(sync, /version=eq\.\$\{current\}/);
});

test('evidence bucket is private and scoped to firm plus engagement folders', () => {
  assert.match(migration, /'ledgerly-evidence', 'ledgerly-evidence', false/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\]/);
  assert.match(migration, /storage\.foldername\(name\)\)\[2\]/);
  assert.match(migration, /CREATE POLICY ledgerly_evidence_object_read/);
  assert.match(migration, /CREATE POLICY ledgerly_evidence_object_insert/);
  assert.doesNotMatch(migration, /CREATE POLICY ledgerly_evidence_object_delete/);
  assert.match(sync, /SHA-256/);
  assert.match(sync, /25 \* 1024 \* 1024/);
  assert.match(sync, /storage\/v1\/object\/ledgerly-evidence/);
  assert.match(panel, /تنزيل/);
});

test('integration tests cover cross-firm snapshot and evidence denial when credentials are supplied', () => {
  const integration = readFileSync(new URL('./tenant-isolation-integration.test.mjs', import.meta.url), 'utf8');
  assert.match(integration, /LEDGERLY_TEST_TOKEN_A/);
  assert.match(integration, /LEDGERLY_TEST_TOKEN_B/);
  assert.match(integration, /cross-firm/);
  assert.match(integration, /skip/);
});
