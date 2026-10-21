import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/supabase/migrations/20261021125000_ledgerly_foreign_key_indexes.sql', import.meta.url), 'utf8');

test('foreign-key performance migration contains the reviewed set of idempotent index statements', () => {
  const statements = sql.split('\n').filter(line => /^CREATE INDEX IF NOT EXISTS /.test(line));
  assert.equal(statements.length, 115);
  assert.equal(new Set(statements.map(line => line.match(/^CREATE INDEX IF NOT EXISTS ([^ ]+)/)?.[1])).size, 115);
  assert.ok(statements.every(line => / ON public\.[a-z_]+ \([a-z_, ]+\);$/.test(line)));
  assert.doesNotMatch(sql, /DROP INDEX|DROP TABLE|DELETE FROM|ALTER TABLE/i);
});
