-- Temporary least-privilege gate: only firm_admin may write through generic RLS policies
-- until the full role-by-table permission matrix replaces these generic policies.
CREATE OR REPLACE FUNCTION private.brp_user_has_firm_role(target_firm_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
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
      AND ra.scope_type = 'firm'
      AND ra.deleted_at IS NULL
      AND ra.role = 'firm_admin'
  );
$function$;

COMMENT ON FUNCTION private.brp_user_has_firm_role(text)
IS 'Temporary conservative write gate: firm_admin only until table-specific role policies are implemented and tested.';
