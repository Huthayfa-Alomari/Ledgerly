import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/supabase/migrations/20261020082131_explicit_schema_version_deny_policy.sql', import.meta.url), 'utf8');

test('schema version metadata explicitly denies browser roles', () => {
  assert.match(sql, /CREATE POLICY schema_version_deny_browser/i);
  assert.match(sql, /FOR ALL\s+TO anon, authenticated\s+USING \(false\)\s+WITH CHECK \(false\)/i);
});
