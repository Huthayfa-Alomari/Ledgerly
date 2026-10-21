import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/supabase/migrations/20261020012402_restrict_schema_version_access.sql', import.meta.url), 'utf8');

test('internal schema version metadata is not accessible to browser roles', () => {
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.schema_version FROM PUBLIC, anon, authenticated/i);
  assert.match(sql, /GRANT ALL PRIVILEGES ON TABLE public\.schema_version TO postgres, service_role/i);
});
