-- Member invitations are managed only by the trusted Edge Function.
CREATE TABLE IF NOT EXISTS public.firm_invitation (
  id text PRIMARY KEY,
  firm_id text NOT NULL REFERENCES public.firm(id),
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('engagement_partner','manager','senior','staff','reviewer','eqcr')),
  invited_by text NOT NULL REFERENCES public.app_user(id),
  auth_user_id text NOT NULL REFERENCES public.app_user(id),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','revoked','expired')),
  created_at text NOT NULL,
  expires_at text NOT NULL,
  accepted_at text,
  updated_at text,
  row_version integer NOT NULL DEFAULT 1,
  origin_device text,
  deleted_at text
);

CREATE INDEX IF NOT EXISTS idx_firm_invitation_firm_status
  ON public.firm_invitation(firm_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_firm_invitation_sent_email
  ON public.firm_invitation(firm_id, lower(email)) WHERE status = 'sent';

ALTER TABLE public.firm_invitation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.firm_invitation FROM PUBLIC;
REVOKE ALL ON TABLE public.firm_invitation FROM anon;
REVOKE ALL ON TABLE public.firm_invitation FROM authenticated;
GRANT ALL ON TABLE public.firm_invitation TO service_role;

CREATE OR REPLACE FUNCTION public.ledgerly_add_firm_invited_member(
  p_inviter_id uuid,
  p_target_user_id uuid,
  p_firm_id text,
  p_email text,
  p_display_name text,
  p_role text
)
RETURNS TABLE (invitation_id text, firm_id text, invited_user_id text, assigned_role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  inviter_email text;
  target_email text;
  invitation_key text := pg_catalog.gen_random_uuid()::text;
  now_iso text := pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  expires_iso text := pg_catalog.to_char((pg_catalog.clock_timestamp() + interval '7 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF p_inviter_id IS NULL OR p_target_user_id IS NULL OR p_firm_id IS NULL THEN
    RAISE EXCEPTION 'Inviter, invitee, and firm are required' USING ERRCODE = '22023';
  END IF;
  IF p_email IS NULL OR pg_catalog.length(pg_catalog.btrim(p_email)) < 5
     OR pg_catalog.length(pg_catalog.btrim(p_email)) > 254
     OR p_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$' THEN
    RAISE EXCEPTION 'A valid email address is required' USING ERRCODE = '22023';
  END IF;
  IF p_display_name IS NULL OR pg_catalog.length(pg_catalog.btrim(p_display_name)) < 2
     OR pg_catalog.length(pg_catalog.btrim(p_display_name)) > 120 THEN
    RAISE EXCEPTION 'Display name must contain 2 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_role NOT IN ('engagement_partner','manager','senior','staff','reviewer','eqcr') THEN
    RAISE EXCEPTION 'Role is not eligible for invitation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_firm_id), 20261020);

  SELECT u.email INTO inviter_email
  FROM public.app_user u
  WHERE u.id = p_inviter_id::text AND u.firm_id = p_firm_id
    AND u.status = 'active' AND u.deleted_at IS NULL;
  IF inviter_email IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.role_assignment ra
    WHERE ra.user_id = p_inviter_id::text AND ra.firm_id = p_firm_id
      AND ra.scope_type = 'firm' AND ra.deleted_at IS NULL
      AND ra.role IN ('firm_admin','managing_partner')
  ) THEN
    RAISE EXCEPTION 'Only firm administrators or managing partners may invite members' USING ERRCODE = '42501';
  END IF;

  SELECT u.email INTO target_email
  FROM auth.users u
  WHERE u.id = p_target_user_id AND u.deleted_at IS NULL;
  IF target_email IS NULL OR pg_catalog.lower(target_email) <> pg_catalog.lower(pg_catalog.btrim(p_email)) THEN
    RAISE EXCEPTION 'Invited account email does not match' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.app_user u WHERE pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_email)) AND u.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This email is already linked to a Ledgerly user' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.firm_invitation i WHERE i.firm_id = p_firm_id AND pg_catalog.lower(i.email) = pg_catalog.lower(pg_catalog.btrim(p_email)) AND i.status = 'sent') THEN
    RAISE EXCEPTION 'A pending invitation already exists for this email' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.app_user (id, firm_id, display_name, email, auth_kind, status, created_at, updated_at)
  VALUES (p_target_user_id::text, p_firm_id, pg_catalog.btrim(p_display_name), pg_catalog.lower(pg_catalog.btrim(p_email)), 'cloud', 'active', now_iso, now_iso);

  INSERT INTO public.role_assignment (id, firm_id, user_id, role, scope_type, scope_id, assigned_at, assigned_by, created_at)
  VALUES (pg_catalog.gen_random_uuid()::text, p_firm_id, p_target_user_id::text, p_role, 'firm', NULL, now_iso, p_inviter_id::text, now_iso);

  INSERT INTO public.firm_invitation (id, firm_id, email, display_name, role, invited_by, auth_user_id, status, created_at, expires_at)
  VALUES (invitation_key, p_firm_id, pg_catalog.lower(pg_catalog.btrim(p_email)), pg_catalog.btrim(p_display_name), p_role, p_inviter_id::text, p_target_user_id::text, 'sent', now_iso, expires_iso);

  RETURN QUERY SELECT invitation_key, p_firm_id, p_target_user_id::text, p_role;
END;
$function$;

REVOKE ALL ON FUNCTION public.ledgerly_add_firm_invited_member(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledgerly_add_firm_invited_member(uuid, uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ledgerly_add_firm_invited_member(uuid, uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ledgerly_add_firm_invited_member(uuid, uuid, text, text, text, text) TO service_role;
