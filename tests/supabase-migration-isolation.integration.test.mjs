import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = resolve(root, 'db/supabase/migrations');

test('replay the complete Supabase migration chain and verify two-office RLS isolation', {
  skip: !databaseUrl ? 'Set DATABASE_URL to a disposable PostgreSQL database named ledgerly_test.' : false,
}, async (t) => {
  const parsed = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', 'postgres'].includes(parsed.hostname) || parsed.pathname !== '/ledgerly_test') {
    throw new Error('Refusing schema reset outside the disposable ledgerly_test database.');
  }

  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const now = '2026-10-21T12:00:00.000Z';
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';
  const userScoped = '33333333-3333-4333-8333-333333333333';
  const reviewerA = '44444444-4444-4444-8444-444444444444';
  const selfReviewer = '55555555-5555-4555-8555-555555555555';

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
      try { await client.query('ROLLBACK'); } catch { /* preserve the originating error */ }
      throw error;
    }
  }

  async function idsFor(userId, query) {
    const result = await asUser(userId, () => client.query(query));
    return result.rows.map(row => Object.values(row)[0]).sort();
  }

  try {
    // A clean database emulating only the Supabase primitives used by the migrations.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
          EXECUTE 'CREATE ROLE anon NOLOGIN';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
          EXECUTE 'CREATE ROLE authenticated NOLOGIN';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
          EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS';
        END IF;
      END $$;

      DROP SCHEMA IF EXISTS storage CASCADE;
      DROP SCHEMA IF EXISTS auth CASCADE;
      DROP SCHEMA IF EXISTS private CASCADE;
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO postgres;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated, service_role;

      CREATE SCHEMA auth;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        email_confirmed_at timestamptz,
        deleted_at timestamptz
      );
      CREATE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SET search_path = ''
      AS $$
        SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

      CREATE SCHEMA storage;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY,
        name text NOT NULL,
        public boolean NOT NULL DEFAULT false,
        file_size_limit bigint,
        allowed_mime_types text[]
      );
      CREATE TABLE storage.objects (
        id text PRIMARY KEY,
        bucket_id text NOT NULL REFERENCES storage.buckets(id),
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
        updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
        UNIQUE (bucket_id, name)
      );
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION storage.foldername(p_name text)
      RETURNS text[]
      LANGUAGE sql
      IMMUTABLE
      SET search_path = ''
      AS $$
        SELECT CASE
          WHEN pg_catalog.cardinality(parts) > 1
            THEN parts[1:pg_catalog.cardinality(parts)-1]
          ELSE ARRAY[]::text[]
        END
        FROM (SELECT pg_catalog.string_to_array(p_name, '/') AS parts) AS split_path;
      $$;
      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated, service_role;
    `);

    const migrationFiles = readdirSync(migrationsDir)
      .filter(name => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));
    assert.ok(migrationFiles.length >= 22, `Expected the complete migration chain, found ${migrationFiles.length} files.`);
    const versions = migrationFiles.map(name => name.match(/^(\d+)_/)?.[1]);
    assert.ok(versions.every(Boolean), 'Every migration filename must start with a numeric version.');
    assert.equal(new Set(versions).size, versions.length, 'Migration version prefixes must be unique.');

    for (const name of migrationFiles) {
      const sql = readFileSync(resolve(migrationsDir, name), 'utf8');
      try {
        await client.query(sql);
      } catch (error) {
        throw new Error(`Full migration replay failed at ${name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }

    await t.test('all public tables keep RLS after clean replay', async () => {
      const result = await client.query(`
        SELECT tablename FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
          AND tablename IN (
            SELECT c.relname FROM pg_catalog.pg_class c
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND NOT c.relrowsecurity
          )
        ORDER BY tablename
      `);
      assert.deepEqual(result.rows, [], 'Public business tables without RLS: ' + result.rows.map(row => row.tablename).join(', '));
    });

    await client.query(`
      INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
        ('${userA}','manager-a@example.test',pg_catalog.now()),
        ('${userB}','manager-b@example.test',pg_catalog.now()),
        ('${userScoped}','scoped-a@example.test',pg_catalog.now()),
        ('${reviewerA}','reviewer-a@example.test',pg_catalog.now()),
        ('${selfReviewer}','self-reviewer-a@example.test',pg_catalog.now());

      INSERT INTO public.firm(id,name,created_at) VALUES
        ('firm-a','Office A','${now}'),
        ('firm-b','Office B','${now}');

      INSERT INTO public.app_user(id,firm_id,display_name,email,auth_kind,status,created_at) VALUES
        ('${userA}','firm-a','Office A Manager','manager-a@example.test','cloud','active','${now}'),
        ('${userB}','firm-b','Office B Manager','manager-b@example.test','cloud','active','${now}'),
        ('${userScoped}','firm-a','Engagement-only Staff','scoped-a@example.test','cloud','active','${now}'),
        ('${reviewerA}','firm-a','Office A Reviewer','reviewer-a@example.test','cloud','active','${now}'),
        ('${selfReviewer}','firm-a','Combined-role User','self-reviewer-a@example.test','cloud','active','${now}');

      INSERT INTO public.role_assignment(id,firm_id,user_id,role,scope_type,scope_id,assigned_at,assigned_by,created_at) VALUES
        ('ra-a','firm-a','${userA}','manager','firm',NULL,'${now}','${userA}','${now}'),
        ('ra-b','firm-b','${userB}','manager','firm',NULL,'${now}','${userB}','${now}'),
        ('ra-scoped','firm-a','${userScoped}','staff','engagement','eng-a1','${now}','${userA}','${now}'),
        ('ra-reviewer','firm-a','${reviewerA}','reviewer','engagement','eng-a1','${now}','${userA}','${now}'),
        ('ra-self-manager','firm-a','${selfReviewer}','manager','firm',NULL,'${now}','${userA}','${now}'),
        ('ra-self-reviewer','firm-a','${selfReviewer}','reviewer','firm',NULL,'${now}','${userA}','${now}');

      INSERT INTO public.client(id,firm_id,name,created_at) VALUES
        ('client-a','firm-a','Client A','${now}'),
        ('client-b','firm-b','Client B','${now}');

      INSERT INTO public.fiscal_year(id,firm_id,client_id,start_date,end_date,created_at) VALUES
        ('fy-a','firm-a','client-a','2026-01-01','2026-12-31','${now}'),
        ('fy-b','firm-b','client-b','2026-01-01','2026-12-31','${now}');

      INSERT INTO public.engagement(id,firm_id,client_id,fiscal_year_id,opened_at,created_at) VALUES
        ('eng-a1','firm-a','client-a','fy-a','${now}','${now}'),
        ('eng-a2','firm-a','client-a','fy-a','${now}','${now}'),
        ('eng-b1','firm-b','client-b','fy-b','${now}','${now}');

      INSERT INTO public.working_paper(id,firm_id,engagement_id,reference,title,paper_type,preparer_id,status,created_at) VALUES
        ('wp-a1','firm-a','eng-a1','A-100','Paper A1','analytical','${userA}','draft','${now}'),
        ('wp-a2','firm-a','eng-a2','A-200','Paper A2','analytical','${userA}','draft','${now}'),
        ('wp-b1','firm-b','eng-b1','B-100','Paper B1','analytical','${userB}','draft','${now}'),
        ('wp-self','firm-a','eng-a1','A-SELF','Self-review paper','analytical','${selfReviewer}','draft','${now}');

      INSERT INTO public.firm_workspace_snapshot(firm_id,payload,version,updated_by,updated_at) VALUES
        ('firm-a','{"clients":["client-a"]}'::jsonb,1,'${userA}',pg_catalog.now()),
        ('firm-b','{"clients":["client-b"]}'::jsonb,1,'${userB}',pg_catalog.now());

      INSERT INTO public.workspace_evidence_file
        (id,firm_id,engagement_id,title,object_key,file_name,mime_type,file_size,file_sha256,created_by,created_at) VALUES
        ('evidence-a','firm-a','eng-a1','Bank statement A','firm-a/eng-a1/a.pdf','a.pdf','application/pdf',100,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','${userA}',pg_catalog.now()),
        ('evidence-b','firm-b','eng-b1','Bank statement B','firm-b/eng-b1/b.pdf','b.pdf','application/pdf',100,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','${userB}',pg_catalog.now());

      INSERT INTO storage.objects(id,bucket_id,name) VALUES
        ('object-a','ledgerly-evidence','firm-a/eng-a1/a.pdf'),
        ('object-b','ledgerly-evidence','firm-b/eng-b1/b.pdf');
    `);

    await t.test('each office sees only its own firm, clients, engagements and snapshots', async () => {
      assert.deepEqual(await idsFor(userA, 'SELECT id FROM public.firm ORDER BY id'), ['firm-a']);
      assert.deepEqual(await idsFor(userB, 'SELECT id FROM public.firm ORDER BY id'), ['firm-b']);
      assert.deepEqual(await idsFor(userA, 'SELECT id FROM public.client ORDER BY id'), ['client-a']);
      assert.deepEqual(await idsFor(userB, 'SELECT id FROM public.client ORDER BY id'), ['client-b']);
      assert.deepEqual(await idsFor(userA, 'SELECT id FROM public.engagement ORDER BY id'), ['eng-a1','eng-a2']);
      assert.deepEqual(await idsFor(userB, 'SELECT id FROM public.engagement ORDER BY id'), ['eng-b1']);
      assert.deepEqual(await idsFor(userA, 'SELECT firm_id FROM public.firm_workspace_snapshot ORDER BY firm_id'), ['firm-a']);
      assert.deepEqual(await idsFor(userB, 'SELECT firm_id FROM public.firm_workspace_snapshot ORDER BY firm_id'), ['firm-b']);
      assert.deepEqual(await idsFor(userA, 'SELECT id FROM public.workspace_evidence_file ORDER BY id'), ['evidence-a']);
      assert.deepEqual(await idsFor(userB, 'SELECT id FROM public.workspace_evidence_file ORDER BY id'), ['evidence-b']);
    });

    await t.test('engagement-scoped staff cannot read other engagements in the same firm', async () => {
      assert.deepEqual(await idsFor(userScoped, 'SELECT id FROM public.engagement ORDER BY id'), ['eng-a1']);
      assert.deepEqual(await idsFor(userScoped, 'SELECT id FROM public.working_paper ORDER BY id'), ['wp-a1','wp-self']);
      assert.deepEqual(await idsFor(userScoped, 'SELECT name FROM storage.objects ORDER BY name'), ['firm-a/eng-a1/a.pdf']);
    });

    await t.test('cross-firm inserts, scope changes, and storage paths are rejected', async () => {
      await assert.rejects(asUser(userA, () => client.query(
        "INSERT INTO public.client(id,firm_id,name,created_at) VALUES ('client-forged','firm-b','Forged','${now}')"
      )), /row-level security policy/i);

      await assert.rejects(asUser(userA, () => client.query(
        "UPDATE public.client SET firm_id='firm-b' WHERE id='client-a'"
      )), /row-level security policy/i);

      await assert.rejects(asUser(userA, () => client.query(
        "INSERT INTO storage.objects(id,bucket_id,name) VALUES ('object-forged','ledgerly-evidence','firm-b/eng-b1/forged.pdf')"
      )), /row-level security policy/i);

      const crossOfficeRows = await asUser(userA, () => client.query(
        "UPDATE public.working_paper SET title='Cross office edit' WHERE id='wp-b1' RETURNING id"
      ));
      assert.equal(crossOfficeRows.rowCount, 0);
      const crossEngagementRows = await asUser(userScoped, () => client.query(
        "UPDATE public.working_paper SET title='Other engagement edit' WHERE id='wp-a2' RETURNING id"
      ));
      assert.equal(crossEngagementRows.rowCount, 0);
    });

    await t.test('evidence metadata cannot bind an office to another office engagement', async () => {
      await assert.rejects(asUser(userA, () => client.query(
        `INSERT INTO public.workspace_evidence_file
          (id,firm_id,engagement_id,title,object_key,file_name,mime_type,file_size,file_sha256,created_by)
         VALUES ('evidence-forged','firm-a','eng-b1','Forged','firm-a/eng-b1/forged.pdf','forged.pdf','application/pdf',100,
           'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','${userA}')`
      )), /active engagement within the same firm/i);
    });

    await t.test('working-paper sign-off is independent and signed content must be reopened before editing', async () => {
      await assert.rejects(asUser(reviewerA, () => client.query(
        "UPDATE public.working_paper SET title='Reviewer changed preparation content' WHERE id='wp-a1'"
      )), /Review-only users cannot alter working-paper preparation content/);

      await asUser(reviewerA, () => client.query(
        "UPDATE public.working_paper SET status='reviewed', reviewed_by=$1 WHERE id='wp-a1'",
        [reviewerA]
      ));
      const signed = await client.query("SELECT status,reviewed_by,reviewed_at FROM public.working_paper WHERE id='wp-a1'");
      assert.equal(signed.rows[0].status, 'reviewed');
      assert.equal(signed.rows[0].reviewed_by, reviewerA);
      assert.ok(signed.rows[0].reviewed_at);

      await assert.rejects(asUser(reviewerA, () => client.query(
        "UPDATE public.working_paper SET status='in_review', title='Change while reopening' WHERE id='wp-a1'"
      )), /reopened in a separate update/i);

      await assert.rejects(asUser(selfReviewer, () => client.query(
        "UPDATE public.working_paper SET status='reviewed', reviewed_by=$1 WHERE id='wp-self'",
        [selfReviewer]
      )), /different authorized reviewer/i);

      await asUser(reviewerA, () => client.query(
        "UPDATE public.working_paper SET status='in_review' WHERE id='wp-a1'"
      ));
      const reopened = await client.query("SELECT status,reviewed_by,reviewed_at FROM public.working_paper WHERE id='wp-a1'");
      assert.equal(reopened.rows[0].status, 'in_review');
      assert.equal(reopened.rows[0].reviewed_by, null);
      assert.equal(reopened.rows[0].reviewed_at, null);

      await asUser(userA, () => client.query(
        "UPDATE public.working_paper SET title='Edited after separate reopening' WHERE id='wp-a1'"
      ));
      const edited = await client.query("SELECT title FROM public.working_paper WHERE id='wp-a1'");
      assert.equal(edited.rows[0].title, 'Edited after separate reopening');
    });

    await t.test('change-log cannot be inserted by the browser and trigger blocks actor spoofing', async () => {
      const privileges = await client.query(`
        SELECT has_table_privilege('authenticated','public.change_log','INSERT') AS can_insert,
               has_table_privilege('authenticated','public.change_log','UPDATE') AS can_update,
               has_table_privilege('authenticated','public.app_user','UPDATE') AS can_edit_users,
               has_table_privilege('authenticated','public.role_assignment','INSERT') AS can_assign_roles
      `);
      assert.deepEqual(privileges.rows[0], {
        can_insert: false, can_update: false, can_edit_users: false, can_assign_roles: false,
      });

      // Temporarily bypass RLS only in this disposable database so assertions reach the trigger.
      await client.query(`
        GRANT INSERT ON public.change_log TO authenticated;
        ALTER TABLE public.change_log DISABLE ROW LEVEL SECURITY;
      `);

      const badEvent = {
        id: 'event-spoofed', firm: 'firm-a', engagement: 'eng-a1', actor: userB,
        action: 'update', entity: 'client', entityId: 'client-a', occurredAt: '1900-01-01T00:00:00.000Z',
      };
      await assert.rejects(asUser(userA, () => client.query(
        `INSERT INTO public.change_log(id,firm_id,engagement_id,actor_id,action,entity_type,entity_id,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [badEvent.id,badEvent.firm,badEvent.engagement,badEvent.actor,badEvent.action,badEvent.entity,badEvent.entityId,badEvent.occurredAt]
      )), /change_log actor_id must match the authenticated user/);

      await asUser(userA, () => client.query(
        `INSERT INTO public.change_log(id,firm_id,engagement_id,actor_id,action,entity_type,entity_id,occurred_at)
         VALUES ('event-valid','firm-a','eng-a1',$1,'update','client','client-a','1900-01-01T00:00:00.000Z')`,
        [userA]
      ));
      const timestamp = await client.query("SELECT occurred_at FROM public.change_log WHERE id='event-valid'");
      assert.equal(timestamp.rowCount, 1);
      assert.notEqual(timestamp.rows[0].occurred_at, '1900-01-01T00:00:00.000Z');
      assert.match(timestamp.rows[0].occurred_at, /^20\d\d-/);
    });

    await t.test('review and audit guards remain compatible with the existing live column layout', async () => {
      // The live project uses prepared_by and has no change_log.engagement_id column.
      // Re-shape the disposable database to emulate that layout after validating clean replay.
      await client.query(`
        ALTER TABLE public.working_paper RENAME COLUMN preparer_id TO prepared_by;
        ALTER TABLE public.working_paper ADD COLUMN IF NOT EXISTS procedure_ref text;
        ALTER TABLE public.working_paper ADD COLUMN IF NOT EXISTS objective text;
        ALTER TABLE public.working_paper ADD COLUMN IF NOT EXISTS work_done text;
        ALTER TABLE public.change_log DROP COLUMN IF EXISTS engagement_id;
      `);

      const migration = readFileSync(
        new URL('../db/supabase/migrations/20261021110000_ledgerly_audit_log_and_workpaper_review_guard.sql', import.meta.url),
        'utf8'
      );
      await client.query(migration);

      await asUser(reviewerA, () => client.query(
        "UPDATE public.working_paper SET status='reviewed', reviewed_by=$1 WHERE id='wp-a1'",
        [reviewerA]
      ));
      await assert.rejects(asUser(reviewerA, () => client.query(
        "UPDATE public.working_paper SET title='Cannot edit a reviewed live-layout paper' WHERE id='wp-a1'"
      )), /Signed-off working papers must be reopened in a separate update/);

      await asUser(reviewerA, () => client.query(
        "UPDATE public.working_paper SET status='in_review' WHERE id='wp-a1'"
      ));
      await asUser(userA, () => client.query(
        "UPDATE public.working_paper SET objective='Edited through live-layout column' WHERE id='wp-a1'"
      ));
      const liveLayoutPaper = await client.query(
        "SELECT status,reviewed_by,reviewed_at,objective,prepared_by FROM public.working_paper WHERE id='wp-a1'"
      );
      assert.equal(liveLayoutPaper.rows[0].status, 'in_review');
      assert.equal(liveLayoutPaper.rows[0].reviewed_by, null);
      assert.equal(liveLayoutPaper.rows[0].reviewed_at, null);
      assert.equal(liveLayoutPaper.rows[0].objective, 'Edited through live-layout column');
      assert.equal(liveLayoutPaper.rows[0].prepared_by, userA);

      // Reapply the revoked INSERT grant only inside this disposable test after proving the
      // default permissions were closed. The trigger must handle absent engagement_id.
      await client.query(`
        GRANT INSERT ON public.change_log TO authenticated;
        ALTER TABLE public.change_log DISABLE ROW LEVEL SECURITY;
      `);
      await assert.rejects(asUser(userA, () => client.query(
        "INSERT INTO public.change_log(id,firm_id,actor_id,action,entity_type,entity_id,occurred_at) VALUES ('live-spoof','firm-a',$1,'update','client','client-a','1900-01-01T00:00:00.000Z')",
        [userB]
      )), /change_log actor_id must match the authenticated user/);
      await asUser(userA, () => client.query(
        "INSERT INTO public.change_log(id,firm_id,actor_id,action,entity_type,entity_id,occurred_at) VALUES ('live-valid','firm-a',$1,'update','client','client-a','1900-01-01T00:00:00.000Z')",
        [userA]
      ));
      const liveEvent = await client.query("SELECT occurred_at FROM public.change_log WHERE id='live-valid'");
      assert.notEqual(liveEvent.rows[0].occurred_at, '1900-01-01T00:00:00.000Z');
      assert.match(liveEvent.rows[0].occurred_at, /^20\\d\\d-/);
    });
  } finally {
    await client.end();
  }
});
