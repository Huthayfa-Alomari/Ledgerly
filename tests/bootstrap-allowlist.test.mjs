import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/ledgerly-bootstrap-first-firm/index.ts', import.meta.url), 'utf8');

test('first firm bootstrap fails closed unless the owner email is configured and verified', () => {
  assert.match(source, /LEDGERLY_BOOTSTRAP_EMAIL/);
  assert.match(source, /email_confirmed_at/);
  assert.match(source, /This account is not authorized to initialize the first firm/);
  assert.match(source, /First-firm setup is disabled/);
});
