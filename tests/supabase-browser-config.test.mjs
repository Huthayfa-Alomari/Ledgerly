import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/supabase-config.ts', import.meta.url), 'utf8');
const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

test('browser config accepts only browser-safe Supabase key variable', () => {
  assert.match(source, /VITE_SUPABASE_ANON_KEY/);
  assert.match(source, /sb_publishable_/);
  assert.match(source, /payload\.role !== 'anon'/);
  assert.match(source, /sb_secret_/);
  assert.match(source, /service_role/);
});

test('environment example explicitly forbids service-role credentials in Vite variables', () => {
  assert.match(example, /VITE_SUPABASE_URL=/);
  assert.match(example, /VITE_SUPABASE_ANON_KEY=/);
  assert.match(example, /NEVER put service_role or sb_secret/i);
  assert.doesNotMatch(example, /SERVICE_ROLE_KEY\s*=/i);
});
