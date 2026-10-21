import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/supabase/migrations/20261021154043_ledgerly_foreign_key_indexes.sql', import.meta.url), 'utf8');

test('foreign-key index migration inspects the destination schema and adds idempotent B-tree indexes', () => {
  assert.match(sql, /FOR fk IN[\s\S]*c\.contype = 'f'/);
  assert.match(sql, /i\.indisvalid/);
  assert.match(sql, /i\.indisready/);
  assert.match(sql, /i\.indpred IS NULL/);
  assert.match(sql, /am\.amname = 'btree'/);
  assert.match(sql, /pg_catalog\.array_agg/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
  assert.match(sql, /pg_catalog\.md5/);
  assert.doesNotMatch(sql, /DROP INDEX|DROP TABLE|DELETE FROM|TRUNCATE TABLE/i);
});
