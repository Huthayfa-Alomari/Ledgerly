-- Ledgerly role-by-table RLS matrix.
-- This migration intentionally denies browser DELETE: business records use tombstones/versioning.
-- Role scope is checked against trusted role_assignment rows, never user-editable JWT metadata.

CREATE OR REPLACE FUNCTION private.brp_user_has_role_in_scope(
  target_firm_id text,
  target_engagement_id text,
  allowed_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_user u
    JOIN public.role_assignment ra
      ON ra.user_id = u.id
     AND ra.firm_id = u.firm_id
    WHERE u.id = (SELECT auth.uid())::text
      AND u.firm_id = target_firm_id
      AND u.status = 'active'
      AND u.deleted_at IS NULL
      AND ra.deleted_at IS NULL
      AND ra.role = ANY(allowed_roles)
      AND (
        (ra.scope_type = 'firm')
        OR (
          target_engagement_id IS NOT NULL
          AND ra.scope_type = 'engagement'
          AND ra.scope_id = target_engagement_id
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.brp_user_has_role_in_scope(text,text,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_user_has_role_in_scope(text,text,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION private.brp_user_can_read_client(
  target_firm_id text,
  target_client_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.brp_user_has_role_in_scope(
      target_firm_id, NULL,
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
    )
    OR EXISTS (
      SELECT 1
      FROM public.engagement e
      WHERE e.firm_id = target_firm_id
        AND e.client_id = target_client_id
        AND e.deleted_at IS NULL
        AND private.brp_user_has_role_in_scope(
          e.firm_id, e.id,
          ARRAY['engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
        )
    );
$function$;

REVOKE ALL ON FUNCTION private.brp_user_can_read_client(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_user_can_read_client(text,text) TO authenticated;

-- Replace the generic role-agnostic policies with an explicit table/action matrix.
DO $$
DECLARE
  t text;
  p record;
  engagement_tables text[] := ARRAY[
    'engagement_terms','independence_assessment','engagement_team_member',
    'audit_plan_procedure','working_paper_version','working_paper_tickmark',
    'analytics_run','audit_sample','pbc_request','time_entry','invoice',
    'quality_check','professional_judgment','management_letter_point',
    'analytical_procedure','going_concern_indicator','governance_communication',
    'peer_review','ai_advisory_record','evidence','exception','audit_procedure',
    'risk','working_paper'
  ];
  firm_read_roles text[] := ARRAY[
    'firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr'
  ];
  preparation_roles text[] := ARRAY[
    'engagement_partner','manager','senior','staff'
  ];
  review_roles text[] := ARRAY[
    'managing_partner','engagement_partner','manager','reviewer','eqcr'
  ];
BEGIN
  -- Remove every existing policy on tenant-owned tables so permissive policies cannot OR-bypass the matrix.
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'firm_id'
      )
      AND tablename NOT IN ('firm_invitation')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  -- Firm identity and membership administration are read-only through the browser.
  CREATE POLICY ledgerly_firm_read ON public.firm
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.app_user u
        WHERE u.id = (SELECT auth.uid())::text
          AND u.firm_id = public.firm.id
          AND u.status = 'active' AND u.deleted_at IS NULL
      )
    );
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.firm FROM anon, authenticated;

  CREATE POLICY ledgerly_app_user_read ON public.app_user
    FOR SELECT TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, NULL, firm_read_roles));
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_user FROM anon, authenticated;

  CREATE POLICY ledgerly_role_assignment_read ON public.role_assignment
    FOR SELECT TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, NULL, firm_read_roles));
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.role_assignment FROM anon, authenticated;

  -- Invitation provisioning is server-only; the feature flag remains off.
  DROP POLICY IF EXISTS ledgerly_invitation_deny_browser_access ON public.firm_invitation;
  CREATE POLICY ledgerly_invitation_deny_browser_access ON public.firm_invitation
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  REVOKE ALL ON public.firm_invitation FROM anon, authenticated;

  -- Internal schema metadata is never available to browser roles.
  DROP POLICY IF EXISTS schema_version_deny_browser ON public.schema_version;
  CREATE POLICY schema_version_deny_browser ON public.schema_version
    FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
  REVOKE ALL ON public.schema_version FROM anon, authenticated;

  -- Tenant-scoped tables with a direct engagement_id column.
  FOREACH t IN ARRAY engagement_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'engagement_id'
    ) THEN
      EXECUTE format(
        'CREATE POLICY ledgerly_read_scope ON public.%I FOR SELECT TO authenticated USING (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[]))',
        t, firm_read_roles
      );
      IF t IN ('working_paper','evidence','audit_procedure','risk','audit_plan_procedure',
               'analytical_procedure','audit_sample','pbc_request','time_entry','analytics_run',
               'engagement_terms','engagement_team_member','going_concern_indicator','governance_communication',
               'professional_judgment','management_letter_point','ai_advisory_record') THEN
        EXECUTE format(
          'CREATE POLICY ledgerly_insert_scope ON public.%I FOR INSERT TO authenticated WITH CHECK (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[]))',
          t, preparation_roles
        );
        EXECUTE format(
          'CREATE POLICY ledgerly_update_scope ON public.%I FOR UPDATE TO authenticated USING (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[])) WITH CHECK (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[]))',
          t, preparation_roles, preparation_roles
        );
      ELSIF t IN ('exception') THEN
        EXECUTE format(
          'CREATE POLICY ledgerly_insert_scope ON public.%I FOR INSERT TO authenticated WITH CHECK (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[]))',
          t, preparation_roles
        );
        EXECUTE format(
          'CREATE POLICY ledgerly_update_scope ON public.%I FOR UPDATE TO authenticated USING (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[])) WITH CHECK (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[]))',
          t, ARRAY['engagement_partner','manager','senior']::text[], ARRAY['engagement_partner','manager','senior']::text[]
        );
      ELSIF t IN ('working_paper_version','peer_review','quality_check') THEN
        -- These are review/quality records; staff cannot create or amend review decisions.
        EXECUTE format(
          'CREATE POLICY ledgerly_insert_scope ON public.%I FOR INSERT TO authenticated WITH CHECK (private.brp_user_has_role_in_scope(firm_id, engagement_id, %L::text[]))',
          t, review_roles
        );
      END IF;
    END IF;
  END LOOP;

  -- Client rows are visible only to firm-scoped members or members assigned to an engagement for that client.
  CREATE POLICY ledgerly_client_read ON public.client
    FOR SELECT TO authenticated
    USING (private.brp_user_can_read_client(firm_id, id));
  CREATE POLICY ledgerly_client_insert ON public.client
    FOR INSERT TO authenticated
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['managing_partner','engagement_partner','manager']::text[]));
  CREATE POLICY ledgerly_client_update ON public.client
    FOR UPDATE TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['managing_partner','engagement_partner','manager']::text[]))
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['managing_partner','engagement_partner','manager']::text[]));

  CREATE POLICY ledgerly_engagement_read ON public.engagement
    FOR SELECT TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, id, firm_read_roles));
  CREATE POLICY ledgerly_engagement_insert ON public.engagement
    FOR INSERT TO authenticated
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['managing_partner','engagement_partner']::text[]));
  CREATE POLICY ledgerly_engagement_update ON public.engagement
    FOR UPDATE TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, id, ARRAY['managing_partner','engagement_partner','manager']::text[]))
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, id, ARRAY['managing_partner','engagement_partner','manager']::text[]));

  -- Firm-level resources with no direct engagement link are conservative by design.
  FOREACH t IN ARRAY ARRAY[
    'fiscal_year','client_portal_settings','firm_performance_snapshot','firm_subscription_plan',
    'invoice_line','knowledge_article','report_template','pbc_submission','audit_sample_item',
    'analytics_result','working_paper_tickmark'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'firm_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='ledgerly_read_scope'
    ) THEN
      EXECUTE format(
        'CREATE POLICY ledgerly_read_firm_scope ON public.%I FOR SELECT TO authenticated USING (private.brp_user_has_role_in_scope(firm_id, NULL, %L::text[]))',
        t, firm_read_roles
      );
    END IF;
  END LOOP;

  -- Administrative/configuration writes are distinct from professional sign-off.
  CREATE POLICY ledgerly_client_portal_write ON public.client_portal_settings
    FOR UPDATE TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner']::text[]))
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner']::text[]));
  CREATE POLICY ledgerly_report_template_insert ON public.report_template
    FOR INSERT TO authenticated
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner']::text[]));
  CREATE POLICY ledgerly_report_template_update ON public.report_template
    FOR UPDATE TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner']::text[]))
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner']::text[]));
  CREATE POLICY ledgerly_knowledge_insert ON public.knowledge_article
    FOR INSERT TO authenticated
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner','manager']::text[]));
  CREATE POLICY ledgerly_knowledge_update ON public.knowledge_article
    FOR UPDATE TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner','manager']::text[]))
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, ARRAY['firm_admin','managing_partner','manager']::text[]));

  -- Append-only logs: no UPDATE or DELETE via the browser.
  CREATE POLICY ledgerly_change_log_read ON public.change_log
    FOR SELECT TO authenticated
    USING (private.brp_user_has_role_in_scope(firm_id, NULL, firm_read_roles));
  CREATE POLICY ledgerly_change_log_insert ON public.change_log
    FOR INSERT TO authenticated
    WITH CHECK (private.brp_user_has_role_in_scope(firm_id, NULL, firm_read_roles));
  REVOKE UPDATE, DELETE, TRUNCATE ON public.change_log FROM anon, authenticated;

  -- Audit trail chain is server-generated only; browser cannot forge a tamper-evident chain.
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.immutable_event_chain FROM anon, authenticated;

  -- No browser deletes on tenant tables: use soft-delete/tombstone updates and preserve audit history.
  FOR t IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='firm_id'
      AND table_name NOT IN ('firm_invitation')
  LOOP
    EXECUTE format('REVOKE DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
