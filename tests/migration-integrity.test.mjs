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
});

test('security hardening overlay is not silently treated as an executable migration', () => {
  const note = readFileSync(resolve(root, 'db/supabase/security/README.md'), 'utf8');
  assert.match(note, /has \*\*not\*\* been applied/);
  assert.match(note, /dedicated test Supabase project/);
});
