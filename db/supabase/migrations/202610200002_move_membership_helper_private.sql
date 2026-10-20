-- Move the membership predicate out of the exposed public schema.
-- The helper remains SECURITY DEFINER because it must inspect app_user without recursively
-- re-entering app_user RLS. Its fixed empty search_path and explicit auth.uid() check are required.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.brp_user_has_firm_access(target_firm_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_user u
    WHERE u.id = (SELECT auth.uid())::text
      AND u.firm_id = target_firm_id
      AND u.status = 'active'
      AND u.deleted_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION private.brp_user_has_firm_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_user_has_firm_access(text) TO authenticated;

-- Rewrite every public-schema RLS policy expression that references the old helper.
DO $$
DECLARE
  p record;
  old_qual text;
  old_check text;
  new_qual text;
  new_check text;
  alter_sql text;
BEGIN
  FOR p IN
    SELECT pol.polname, cls.relname,
           pg_get_expr(pol.polqual, pol.polrelid) AS qual_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr
    FROM pg_policy pol
    JOIN pg_class cls ON cls.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'public'
      AND (
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%brp_user_has_firm_access%'
        OR coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%brp_user_has_firm_access%'
      )
  LOOP
    old_qual := p.qual_expr;
    old_check := p.check_expr;
    new_qual := old_qual;
    new_check := old_check;

    IF new_qual IS NOT NULL THEN
      new_qual := replace(new_qual, 'public.brp_user_has_firm_access', 'private.brp_user_has_firm_access');
      new_qual := regexp_replace(new_qual, '(^|[^.[:alnum:]_])brp_user_has_firm_access[(]', E'\\1private.brp_user_has_firm_access(', 'g');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := replace(new_check, 'public.brp_user_has_firm_access', 'private.brp_user_has_firm_access');
      new_check := regexp_replace(new_check, '(^|[^.[:alnum:]_])brp_user_has_firm_access[(]', E'\\1private.brp_user_has_firm_access(', 'g');
    END IF;

    alter_sql := format('ALTER POLICY %I ON public.%I', p.polname, p.relname);
    IF new_qual IS NOT NULL THEN
      alter_sql := alter_sql || format(' USING (%s)', new_qual);
    END IF;
    IF new_check IS NOT NULL THEN
      alter_sql := alter_sql || format(' WITH CHECK (%s)', new_check);
    END IF;
    EXECUTE alter_sql;
  END LOOP;
END $$;

-- Policies now use the non-exposed private helper; prevent direct RPC calls to the old function.
REVOKE ALL ON FUNCTION public.brp_user_has_firm_access(text) FROM PUBLIC, anon, authenticated;
