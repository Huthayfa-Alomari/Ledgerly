-- Split the original tenant-wide FOR ALL policy into action-specific policies.
-- At this point in the migration chain the public membership helper exists; the private,
-- role-aware helper is installed by a later migration. That later migration rewrites these
-- policies to the private helper, and the role-by-table matrix eventually supersedes them.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'brp_firm_isolation'
      AND tablename <> 'firm'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS brp_firm_isolation ON %I.%I',
      p.schemaname, p.tablename
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY brp_firm_read ON %I.%I FOR SELECT TO authenticated USING (public.brp_user_has_firm_access(firm_id))',
      p.schemaname, p.tablename
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY brp_firm_insert ON %I.%I FOR INSERT TO authenticated WITH CHECK (public.brp_user_has_firm_access(firm_id))',
      p.schemaname, p.tablename
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY brp_firm_update ON %I.%I FOR UPDATE TO authenticated USING (public.brp_user_has_firm_access(firm_id)) WITH CHECK (public.brp_user_has_firm_access(firm_id))',
      p.schemaname, p.tablename
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY brp_firm_delete ON %I.%I FOR DELETE TO authenticated USING (public.brp_user_has_firm_access(firm_id))',
      p.schemaname, p.tablename
    );
  END LOOP;
END $$;
