-- Reconstructed compatibility migration for the recorded live version 20261019133936.
-- The original SQL was not retained in the repository. This implements the migration's
-- stated intent: split each generic FOR ALL firm-role policy into action-specific policies.
-- The later 20261020140459 role-by-table matrix replaces these transitional policies.

DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'brp_firm_role_write'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS brp_firm_role_write ON %I.%I', p.schemaname, p.tablename);

    EXECUTE format(
      'CREATE POLICY brp_firm_role_insert ON %I.%I FOR INSERT TO authenticated WITH CHECK (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id))',
      p.schemaname, p.tablename
    );
    EXECUTE format(
      'CREATE POLICY brp_firm_role_update ON %I.%I FOR UPDATE TO authenticated USING (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id)) WITH CHECK (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id))',
      p.schemaname, p.tablename
    );
    EXECUTE format(
      'CREATE POLICY brp_firm_role_delete ON %I.%I FOR DELETE TO authenticated USING (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id))',
      p.schemaname, p.tablename
    );
  END LOOP;
END $$;
