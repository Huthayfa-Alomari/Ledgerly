import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const databaseUrl = process.env.DATABASE_URL;

test('PostgreSQL enforces change-log actor identity and working-paper review/sign-off controls', {
  skip: !databaseUrl ? 'Set DATABASE_URL to the disposable ledgerly_test PostgreSQL database to run SQL integration tests.' : false,
}, async () => {
  const parsed = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', 'postgres'].includes(parsed.hostname) || parsed.pathname !== '/ledgerly_test') {
    throw new Error('Refusing to run destructive fixture setup outside the disposable ledgerly_test database.');
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const migration = readFileSync(
    new URL('../db/supabase/migrations/20261021110000_ledgerly_audit_log_and_workpaper_review_guard.sql', import.meta.url),
    'utf8'
  );

  const staffId = '11111111-1111-4111-8111-111111111111';
  const reviewerId = '22222222-2222-4222-8222-222222222222';
  const combinedId = '33333333-3333-4333-8333-333333333333';

  async function asUser(userId, callback) {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT pg_catalog.set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await client.query("SELECT pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true)");
      const result = await callback();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* keep the original SQL error */ }
      throw error;
    }
  }

  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN EXECUTE 'CREATE ROLE anon NOLOGIN'; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN EXECUTE 'CREATE ROLE authenticated NOLOGIN'; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS'; END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS private;
      CREATE SCHEMA IF NOT EXISTS auth;

      DROP TABLE IF EXISTS public.working_paper CASCADE;
      DROP TABLE IF EXISTS public.change_log CASCADE;
      DROP TABLE IF EXISTS public.test_role_assignment CASCADE;
      DROP FUNCTION IF EXISTS private.ledgerly_stamp_change_log_actor() CASCADE;
      DROP FUNCTION IF EXISTS private.ledgerly_guard_working_paper_review_fields() CASCADE;
      DROP FUNCTION IF EXISTS private.brp_user_has_role_in_scope(text,text,text[]) CASCADE;
      DROP FUNCTION IF EXISTS auth.uid() CASCADE;

      CREATE TABLE public.test_role_assignment (
        user_id uuid NOT NULL,
        firm_id text NOT NULL,
        role text NOT NULL,
        scope_type text NOT NULL,
        scope_id text
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql STABLE
      SET search_path = ''
      AS $$
        SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      CREATE OR REPLACE FUNCTION private.brp_user_has_role_in_scope(
        target_firm_id text,
        target_engagement_id text,
        allowed_roles text[]
      )
      RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = ''
      AS $$
        SELECT EXISTS (
          SELECT 1
          FROM public.test_role_assignment ra
          WHERE ra.user_id = (SELECT auth.uid())
            AND ra.firm_id = target_firm_id
            AND ra.role = ANY(allowed_roles)
            AND (
              ra.scope_type = 'firm'
              OR (
                target_engagement_id IS NOT NULL
                AND ra.scope_type = 'engagement'
                AND ra.scope_id = target_engagement_id
              )
            )
        );
      $$;

      CREATE TABLE public.change_log (
        id bigserial PRIMARY KEY,
        firm_id text NOT NULL,
        actor_id text NOT NULL,
        occurred_at text NOT NULL
      );

      CREATE TABLE public.working_paper (
        id text PRIMARY KEY,
        firm_id text NOT NULL,
        engagement_id text NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        reviewed_by text,
        prepared_by text,
        updated_at text,
        title text,
        procedure_ref text,
        objective text,
        work_done text,
        conclusion text,
        extra_note text
      );

      ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.working_paper ENABLE ROW LEVEL SECURITY;

      GRANT USAGE ON SCHEMA auth, private TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT EXECUTE ON FUNCTION private.brp_user_has_role_in_scope(text,text,text[]) TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.change_log TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE ON TABLE public.working_paper TO authenticated;

      CREATE POLICY fixture_working_paper_read
      ON public.working_paper FOR SELECT TO authenticated
      USING (private.brp_user_has_role_in_scope(firm_id, engagement_id,
        ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]));

      CREATE POLICY fixture_working_paper_insert
      ON public.working_paper FOR INSERT TO authenticated
      WITH CHECK (private.brp_user_has_role_in_scope(firm_id, engagement_id,
        ARRAY['manager','senior','staff']::text[]));

      CREATE POLICY fixture_working_paper_prepare_update
      ON public.working_paper FOR UPDATE TO authenticated
      USING (private.brp_user_has_role_in_scope(firm_id, engagement_id,
        ARRAY['manager','senior','staff']::text[]))
      WITH CHECK (private.brp_user_has_role_in_scope(firm_id, engagement_id,
        ARRAY['manager','senior','staff']::text[]));
    `);

    await client.query(migration);

    const privileges = await client.query(`
      SELECT
        has_table_privilege('authenticated','public.change_log','INSERT') AS can_insert,
        has_table_privilege('authenticated','public.change_log','UPDATE') AS can_update,
        has_table_privilege('authenticated','public.change_log','DELETE') AS can_delete,
        has_table_privilege('authenticated','public.change_log','TRUNCATE') AS can_truncate
    `);
    assert.deepEqual(privileges.rows[0], {
      can_insert: false, can_update: false, can_delete: false, can_truncate: false,
    });

    await client.query(`
      INSERT INTO public.test_role_assignment(user_id,firm_id,role,scope_type,scope_id) VALUES
        ('${staffId}','firm-1','staff','firm',NULL),
        ('${reviewerId}','firm-1','reviewer','engagement','eng-1'),
        ('${combinedId}','firm-1','staff','firm',NULL),
        ('${combinedId}','firm-1','reviewer','firm',NULL);

      INSERT INTO public.working_paper
        (id,firm_id,engagement_id,status,prepared_by,updated_at,title,procedure_ref,objective,work_done,conclusion)
      VALUES
        ('wp-1','firm-1','eng-1','draft','${staffId}','2000-01-01T00:00:00Z','Original title','P-1','Objective','Work performed','Pending'),
        ('wp-2','firm-1','eng-1','draft','${combinedId}','2000-01-01T00:00:00Z','Combined user paper','P-2','Objective','Work performed','Pending');
    `);

    await assert.rejects(
      asUser(staffId, () => client.query(
        "UPDATE public.working_paper SET status='معتمد', reviewed_by=$1 WHERE id='wp-1'",
        [reviewerId]
      )),
      /Only an authorized reviewer may change working-paper review fields/
    );

    await asUser(reviewerId, () => client.query(
      "UPDATE public.working_paper SET status='معتمد', reviewed_by=$1 WHERE id='wp-1'",
      [reviewerId]
    ));

    await assert.rejects(
      asUser(reviewerId, () => client.query(
        "UPDATE public.working_paper SET title='Tampered after sign-off' WHERE id='wp-1'"
      )),
      /Signed-off working papers must be reopened/
    );

    await asUser(reviewerId, () => client.query(
      "UPDATE public.working_paper SET status='draft', reviewed_by=NULL WHERE id='wp-1'"
    ));
    await asUser(staffId, () => client.query(
      "UPDATE public.working_paper SET title='Updated after reopening' WHERE id='wp-1'"
    ));

    await assert.rejects(
      asUser(combinedId, () => client.query(
        "UPDATE public.working_paper SET status='معتمد', reviewed_by=$1 WHERE id='wp-2'",
        [combinedId]
      )),
      /The preparer cannot independently sign off their own working paper/
    );

    await assert.rejects(
      asUser(reviewerId, () => client.query(
        "UPDATE public.working_paper SET objective='Reviewer changed preparation content' WHERE id='wp-1'"
      )),
      /Review-only users cannot alter working-paper preparation content/
    );

    // Temporarily add a test-only INSERT grant/policy after proving production defaults revoke it.
    // This reaches the trigger directly to verify actor impersonation protection.
    await client.query(`
      GRANT INSERT ON public.change_log TO authenticated;
      CREATE POLICY fixture_change_log_insert
      ON public.change_log FOR INSERT TO authenticated
      WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL,
        ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]));
    `);

    await assert.rejects(
      asUser(staffId, () => client.query(
        "INSERT INTO public.change_log(firm_id,actor_id,occurred_at) VALUES ('firm-1',$1,'1900-01-01T00:00:00Z')",
        [reviewerId]
      )),
      /change_log actor_id must match the authenticated user/
    );

    const inserted = await asUser(staffId, () => client.query(
      "INSERT INTO public.change_log(firm_id,actor_id,occurred_at) VALUES ('firm-1',$1,'1900-01-01T00:00:00Z') RETURNING occurred_at",
      [staffId]
    ));
    assert.notEqual(inserted.rows[0].occurred_at, '1900-01-01T00:00:00Z');
    assert.match(inserted.rows[0].occurred_at, /^20\d\d-/);
  } finally {
    await client.end();
  }
});
