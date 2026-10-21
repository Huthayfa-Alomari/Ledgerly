import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = resolve(root, 'db/supabase/migrations');
const migrations = readdirSync(migrationsDir).filter(name => name.endsWith('.sql'));
const versionOf = name => name.match(/^(\d+)_/)?.[1];

test('every migration filename has a unique version prefix', () => {
  const versions = new Map();
  for (const name of migrations) {
    const version = versionOf(name);
    assert.ok(version, `Migration is missing a numeric version prefix: ${name}`);
    assert.ok(!versions.has(version), `Duplicate migration version ${version}: ${versions.get(version)} and ${name}`);
    versions.set(version, name);
  }
});

test('bootstrap and temporary write-gate filenames align to one canonical version each', () => {
  assert.ok(migrations.includes('20261020102903_ledgerly_bootstrap_service_role_only.sql'));
  assert.ok(migrations.includes('20261020104503_ledgerly_interim_firm_admin_write_gate.sql'));
  assert.ok(!migrations.some(name => name.startsWith('20261020110000_')));
  assert.ok(migrations.includes('20261020140459_ledgerly_role_by_table_rls.sql'));
  assert.ok(migrations.includes('20261020140900_ledgerly_scoped_child_table_rls.sql'));
  assert.ok(migrations.includes('20261020141128_ledgerly_firm_policy_cleanup.sql'));
  assert.ok(migrations.includes('20261021154000_ledgerly_audit_log_and_workpaper_review_guard.sql'));
  assert.ok(migrations.includes('20261021154043_ledgerly_foreign_key_indexes.sql'));
  assert.ok(migrations.includes('20261021154056_ledgerly_evidence_engagement_scope_guard.sql'));
  assert.ok(migrations.includes('20261021155218_ledgerly_consolidate_workpaper_update_policy.sql'));
  assert.ok(migrations.includes('20261019130942_brp_initial_audit_core.sql'));
  assert.ok(migrations.includes('20261019131031_brp_extended_audit_suite.sql'));
  assert.ok(migrations.includes('20261019132425_enable_rls_schema_version.sql'));
  assert.ok(migrations.includes('20261019133936_split_role_write_policies.sql'));
  assert.ok(migrations.includes('20261020012402_restrict_schema_version_access.sql'));
  assert.ok(migrations.includes('20261020081921_move_membership_helper_private.sql'));
  assert.ok(migrations.includes('20261020082131_explicit_schema_version_deny_policy.sql'));
  assert.ok(migrations.includes('20261020085003_core_tenant_query_indexes.sql'));
  assert.ok(migrations.includes('20261020102654_ledgerly_secure_first_firm_bootstrap.sql'));
  assert.ok(migrations.includes('20261020103837_ledgerly_secure_member_invitations.sql'));
  assert.ok(migrations.includes('20261020103921_ledgerly_invitation_schema_alignment.sql'));
  assert.ok(migrations.includes('20261020104019_ledgerly_invitation_explicit_deny_policy.sql'));
  assert.ok(migrations.includes('20261020104150_ledgerly_expire_stale_invitations.sql'));
  assert.ok(!migrations.some(name => /^202610201(20000|43000|50000)_/.test(name)));
  const staleAliases = ['20261021154100_', '202610190001_', '202610190003_', '202610200001_', '202610200002_', '202610200003_', '202610200004_', '20261020100000_', '20261020104000_', '20261020104500_', '20261020105000_', '20261021110000_', '20261021125000_', '20261021130000_'];
  for (const alias of staleAliases) assert.ok(!migrations.some(name => name.startsWith(alias)), `Stale migration filename remains: ${alias}`);
});

test('all 23 deployed versions recorded in the live Supabase history have canonical local migration files', () => {
  const liveVersions = ['20261019130942','20261019131031','20261019132425','20261019133936','20261020012402','20261020081921','20261020082131','20261020085003','20261020102654','20261020102903','20261020103837','20261020103921','20261020104019','20261020104150','20261020104503','20261020140459','20261020140900','20261020141128','20261021040529','20261021154000','20261021154043','20261021154056','20261021155218'];
  for (const version of liveVersions) assert.ok(migrations.some(name => name.startsWith(version + '_')), `Missing local migration for live version ${version}`);
});

test('legacy security hardening SQL is outside the executable migration directory', () => {
  const archived = readFileSync(resolve(root, 'docs/archive/202610190002_security_hardening.sql'), 'utf8');
  const securityDir = resolve(root, 'db/supabase/security');
  assert.match(archived, /^-- ARCHIVED — DO NOT APPLY/);
  assert.ok(readdirSync(securityDir).every(name => !name.endsWith('.sql')));
});

test('security hardening overlay is not silently treated as an executable migration', () => {
  const note = readFileSync(resolve(root, 'db/supabase/security/README.md'), 'utf8');
  assert.match(note, /must not be applied/i);
  assert.match(note, /dedicated test Supabase project/);
  assert.match(note, /docs\/archive\/202610190002_security_hardening\.sql/);
});
