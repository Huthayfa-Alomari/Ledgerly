import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationPath = join(root, 'db/supabase/migrations/202610190003_extended_audit_suite.sql');
const roadmapPath = join(root, 'docs/08-product-scope-and-delivery-roadmap.md');
const migration = readFileSync(migrationPath, 'utf8');
const roadmap = readFileSync(roadmapPath, 'utf8');

test('extended suite migration includes the core requested domains', () => {
  for (const table of [
    'engagement_terms','independence_assessment','independence_declaration','audit_plan_procedure',
    'working_paper_version','working_paper_tickmark','analytics_run','analytics_result','audit_sample',
    'pbc_request','pbc_submission','time_entry','invoice','quality_check','professional_judgment',
    'management_letter_point','analytical_procedure','going_concern_indicator','governance_communication',
    'knowledge_article','peer_review','ai_advisory_record','client_portal_settings','report_template',
    'firm_subscription_plan','firm_performance_snapshot','immutable_event_chain'
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`), `${table} should be in the migration`);
});

test('sensitive rows are append-only and new tables get firm isolation policies', () => {
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.%I FROM anon, authenticated/);
  assert.match(migration, /brp_user_has_firm_access\(firm_id\)/);
  assert.match(migration, /brp_user_has_firm_role\(firm_id\)/);
});

test('roadmap contains required human-review and staged-release controls', () => {
  for (const phrase of ['independence', 'Benford', 'PBC', 'MUS', 'going-concern', 'human approval', 'not been applied', 'Release gate']) {
    assert.ok(roadmap.toLowerCase().includes(phrase.toLowerCase()), `roadmap should cover ${phrase}`);
  }
});
