import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../src/CloudAuthPanel.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../db/supabase/migrations/20261020102903_ledgerly_bootstrap_service_role_only.sql', import.meta.url), 'utf8');
const edgeFunction = readFileSync(new URL('../supabase/functions/ledgerly-bootstrap-first-firm/index.ts', import.meta.url), 'utf8');

test('cloud auth uses only the browser-safe key and never embeds a privileged credential', () => {
  assert.match(panel, /apikey: config\.anonKey/);
  assert.match(panel, /sessionStorage\.setItem\(SESSION_KEY/);
  assert.match(panel, /token\?grant_type=refresh_token/);
  assert.match(panel, /password\.length < 12/);
  assert.match(panel, /12 حرفًا على الأقل/);
  assert.doesNotMatch(panel, /service_role|sb_secret_/i);
});

test('first-firm bootstrap requires an authenticated caller and serializes first registration', () => {
  assert.match(edgeFunction, /auth\.getUser\(token\)/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /Initial firm already exists/);
  assert.match(migration, /'firm_admin'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ledgerly_bootstrap_first_firm\(uuid, text, text\) FROM anon/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.ledgerly_bootstrap_first_firm\(uuid, text, text\) FROM authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.ledgerly_bootstrap_first_firm\(uuid, text, text\) TO service_role/);
  assert.match(edgeFunction, /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
});

test('first-firm onboarding does not imply cloud workspace sync is enabled', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(panel, /onFirmProvisioned\?: \(\) => void/);
  assert.match(panel, /onFirmProvisioned\?\.\(\)/);
  assert.match(app, /المزامنة السحابية محجوبة مؤقتًا/);
  assert.match(app, /لم نفعّل رفع أو استعادة لقطات مساحة العمل عبر السحابة/);
  assert.doesNotMatch(app, /CloudWorkspacePanel/);
  assert.doesNotMatch(app, /setCloudWorkspaceRefresh/);
});

test('first launch shows a login gate with an explicit local-only escape hatch', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /تسجيل الدخول إلى Ledgerly/);
  assert.match(app, /if \(!cloudSession && !cloudGateDismissed\)/);
  assert.match(app, /متابعة بالوضع المحلي دون تسجيل الدخول/);
  assert.match(app, /VITE_SUPABASE_URL/);
});

test('local audit evidence can attach browser-stored files and preview images', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const vault = readFileSync(new URL('../src/lib/local-evidence-files.ts', import.meta.url), 'utf8');
  assert.match(app, /إرفاق صورة أو ملف/);
  assert.match(app, /<LocalEvidenceAttachment row=\{e\} passphrase=\{vaultPassphrase\}\/?>/);
  assert.match(app, /saveLocalEvidenceFile\(evidenceFile,vaultPassphrase\)/);
  assert.match(vault, /indexedDB\.open/);
  assert.match(vault, /25 \* 1024 \* 1024/);
  assert.doesNotMatch(vault, /service_role|sb_secret_/i);
});
