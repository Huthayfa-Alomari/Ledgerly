-- Restrict first-firm bootstrap to the trusted Edge Function's service-role client.
-- The Edge Function validates the caller's Supabase Auth JWT before invoking this RPC.
DROP FUNCTION IF EXISTS public.ledgerly_bootstrap_first_firm(text, text);

CREATE OR REPLACE FUNCTION public.ledgerly_bootstrap_first_firm(
  p_user_id uuid,
  p_firm_name text,
  p_display_name text
)
RETURNS TABLE (firm_id text, user_id text, assigned_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  caller_email text;
  firm_key text;
  now_iso text := pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is required' USING ERRCODE = '42501';
  END IF;
  IF p_firm_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_firm_name)) < 2
     OR pg_catalog.length(pg_catalog.btrim(p_firm_name)) > 160 THEN
    RAISE EXCEPTION 'Firm name must contain 2 to 160 characters' USING ERRCODE = '22023';
  END IF;
  IF p_display_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_display_name)) < 2
     OR pg_catalog.length(pg_catalog.btrim(p_display_name)) > 120 THEN
    RAISE EXCEPTION 'Display name must contain 2 to 120 characters' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(7412, 20261020);

  IF EXISTS (SELECT 1 FROM public.firm LIMIT 1) THEN
    RAISE EXCEPTION 'Initial firm already exists; contact a firm administrator for an invitation'
      USING ERRCODE = '23505';
  END IF;

  SELECT u.email INTO caller_email
  FROM auth.users AS u
  WHERE u.id = p_user_id AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until < pg_catalog.now());

  IF caller_email IS NULL THEN
    RAISE EXCEPTION 'Active authenticated account email was not found' USING ERRCODE = '42501';
  END IF;

  firm_key := p_user_id::text;

  INSERT INTO public.firm (id, name, country, timezone, default_currency, status, created_at, updated_at)
  VALUES (firm_key, pg_catalog.btrim(p_firm_name), 'JO', 'Asia/Amman', 'JOD', 'active', now_iso, now_iso);

  INSERT INTO public.app_user (id, firm_id, display_name, email, auth_kind, status, created_at, updated_at)
  VALUES (p_user_id::text, firm_key, pg_catalog.btrim(p_display_name), caller_email, 'cloud', 'active', now_iso, now_iso);

  INSERT INTO public.role_assignment (id, firm_id, user_id, role, scope_type, scope_id, assigned_at, assigned_by, created_at)
  VALUES (pg_catalog.gen_random_uuid()::text, firm_key, p_user_id::text, 'firm_admin', 'firm', NULL, now_iso, p_user_id::text, now_iso);

  RETURN QUERY SELECT firm_key, p_user_id::text, 'firm_admin'::text;
END;
$function$;

REVOKE ALL ON FUNCTION public.ledgerly_bootstrap_first_firm(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledgerly_bootstrap_first_firm(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ledgerly_bootstrap_first_firm(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ledgerly_bootstrap_first_firm(uuid, text, text) TO service_role;
