-- ARCHIVED — DO NOT APPLY.
-- This was an intermediate security-hardening overlay written for the initial draft schema.
-- It is not a migration and is not compatible as a drop-in update to the current live schema.
-- Use the ordered files under db/supabase/migrations and review/test every schema change first.

-- SECURITY HARDENING OVERLAY for the initial audit platform schema.
-- Review and apply only to a dedicated test project after creating a formal migration
-- through the Supabase CLI. This file is intentionally NOT auto-applied by the app.
-- Requires the initial schema and its brp_user_has_firm_access(text) function.
-- Goal: prevent ordinary authenticated members from self-provisioning users/roles or
-- changing firm-wide settings, and require a trusted firm-level role for business writes.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Fixed search_path and schema-qualified references reduce object-shadowing risk.
CREATE OR REPLACE FUNCTION private.brp_user_has_firm_role(target_firm_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
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
      AND ra.scope_type = 'firm'
      AND ra.deleted_at IS NULL
      AND ra.role IN (
        'firm_admin','managing_partner','engagement_partner','manager',
        'senior','staff','reviewer','eqcr'
      )
  );
$$;
REVOKE ALL ON FUNCTION private.brp_user_has_firm_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_user_has_firm_role(text) TO authenticated;

-- Firm identity and membership/role administration must not be self-service via Data API.
DROP POLICY IF EXISTS brp_firm_isolation ON public.firm;
CREATE POLICY brp_firm_member_read ON public.firm
  FOR SELECT TO authenticated
  USING (public.brp_user_has_firm_access(id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.firm FROM anon, authenticated;
GRANT SELECT ON public.firm TO authenticated;

DROP POLICY IF EXISTS brp_firm_isolation ON public.app_user;
CREATE POLICY brp_app_user_member_read ON public.app_user
  FOR SELECT TO authenticated
  USING (public.brp_user_has_firm_access(firm_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.app_user FROM anon, authenticated;
GRANT SELECT ON public.app_user TO authenticated;

DROP POLICY IF EXISTS brp_firm_isolation ON public.role_assignment;
CREATE POLICY brp_role_assignment_member_read ON public.role_assignment
  FOR SELECT TO authenticated
  USING (public.brp_user_has_firm_access(firm_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.role_assignment FROM anon, authenticated;
GRANT SELECT ON public.role_assignment TO authenticated;

-- For business tables, separate row visibility from write authorization.
-- Firm membership alone is not sufficient to write. A firm-level role assignment is
-- provisioned only by a trusted administrative process (not via this browser app).
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'client','client_acceptance','fiscal_year','engagement','account','import_batch',
    'transaction_line','reconciliation_run','working_paper','evidence','exception',
    'reconciliation_match','cross_link','risk','audit_procedure','sample','misstatement',
    'review','sync_outbox'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS brp_firm_isolation ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS brp_firm_member_read ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS brp_firm_role_write ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY brp_firm_member_read ON public.%I FOR SELECT TO authenticated USING (public.brp_user_has_firm_access(firm_id))',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY brp_firm_role_write ON public.%I FOR ALL TO authenticated USING (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id)) WITH CHECK (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id))',
      tbl
    );
  END LOOP;
END $$;

-- Change log is append-only for authenticated clients. The application must still validate
-- event shape and never treat client-written log entries as tamper-proof evidence.
DROP POLICY IF EXISTS brp_firm_isolation ON public.change_log;
DROP POLICY IF EXISTS brp_firm_member_read ON public.change_log;
DROP POLICY IF EXISTS brp_change_log_insert ON public.change_log;
CREATE POLICY brp_firm_member_read ON public.change_log
  FOR SELECT TO authenticated
  USING (public.brp_user_has_firm_access(firm_id));
CREATE POLICY brp_change_log_insert ON public.change_log
  FOR INSERT TO authenticated
  WITH CHECK (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id));
REVOKE UPDATE, DELETE, TRUNCATE ON public.change_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.change_log TO authenticated;

-- Default privileges can vary by project; explicitly deny anonymous access to these tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
