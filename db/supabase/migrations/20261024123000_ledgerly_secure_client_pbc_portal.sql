-- Secure, engagement-scoped client document portal.
-- Client uploads are quarantined as pending; no automatic scan/acceptance is implied.

CREATE TABLE IF NOT EXISTS public.client_portal_member (
  id text PRIMARY KEY,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  firm_id text NOT NULL REFERENCES public.firm(id),
  client_id text NOT NULL REFERENCES public.client(id),
  engagement_id text NOT NULL REFERENCES public.engagement(id),
  display_name text NOT NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','disabled','expired')),
  invited_by text NOT NULL REFERENCES public.app_user(id),
  created_at text NOT NULL,
  updated_at text NOT NULL,
  accepted_at text,
  invitation_expires_at text NOT NULL,
  deleted_at text,
  UNIQUE (auth_user_id, firm_id, engagement_id)
);

CREATE INDEX IF NOT EXISTS idx_client_portal_member_scope
  ON public.client_portal_member(firm_id, client_id, engagement_id, status)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_portal_member_pending_email
  ON public.client_portal_member(firm_id, engagement_id, pg_catalog.lower(email))
  WHERE status IN ('invited','active') AND deleted_at IS NULL;

ALTER TABLE public.pbc_submission
  ADD COLUMN IF NOT EXISTS submitted_by_portal_user_id uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_pbc_submission_portal_user
  ON public.pbc_submission(submitted_by_portal_user_id, request_id, uploaded_at DESC);

ALTER TABLE public.client_portal_member ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.client_portal_member FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.client_portal_member TO service_role;

ALTER TABLE public.pbc_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pbc_submission ENABLE ROW LEVEL SECURITY;

-- pbc_request.response_notes and workflow identity fields are office-only. Grant the API
-- only the columns needed by the portal and the office request panel.
REVOKE SELECT ON TABLE public.pbc_request FROM anon, authenticated;
GRANT SELECT (
  id, firm_id, engagement_id, request_ref, title, description, requested_from,
  due_date, priority, status, created_at
) ON TABLE public.pbc_request TO authenticated;

-- Submissions can be inserted only once with pending scan status. No browser can update
-- acceptance, rejection, scan status, or delete a submitted record.
REVOKE ALL ON TABLE public.pbc_submission FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.pbc_submission FROM anon, authenticated;
GRANT SELECT (
  id, firm_id, request_id, submitted_by_name, submitted_by_user,
  submitted_by_portal_user_id, object_key, file_name, mime_type, file_size,
  file_sha256, uploaded_at, scan_status, rejection_reason, supersedes_id
) ON TABLE public.pbc_submission TO authenticated;
GRANT INSERT (
  id, firm_id, request_id, submitted_by_name, submitted_by_portal_user_id,
  object_key, file_name, mime_type, file_size, file_sha256, uploaded_at, scan_status
) ON TABLE public.pbc_submission TO authenticated;
GRANT ALL ON TABLE public.pbc_submission TO service_role;

-- Membership lookup is in a non-exposed schema and returns only a boolean.
CREATE OR REPLACE FUNCTION private.brp_client_portal_member_active(
  target_firm_id text,
  target_client_id text,
  target_engagement_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.client_portal_member m
    JOIN auth.users u ON u.id = m.auth_user_id
    JOIN public.engagement e
      ON e.id = m.engagement_id
     AND e.firm_id = m.firm_id
     AND e.client_id = m.client_id
    JOIN public.client c
      ON c.id = m.client_id
     AND c.firm_id = m.firm_id
    WHERE m.auth_user_id = (SELECT auth.uid())
      AND m.firm_id = target_firm_id
      AND m.client_id = target_client_id
      AND m.engagement_id = target_engagement_id
      AND m.status = 'active'
      AND m.deleted_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND u.email_confirmed_at IS NOT NULL
      AND pg_catalog.lower(u.email) = pg_catalog.lower(m.email)
      AND e.deleted_at IS NULL
      AND c.status = 'active'
      AND c.deleted_at IS NULL
  );
$function$;
REVOKE ALL ON FUNCTION private.brp_client_portal_member_active(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_client_portal_member_active(text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.brp_client_portal_can_read_request(target_request_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.pbc_request r
    JOIN public.engagement e
      ON e.id = r.engagement_id
     AND e.firm_id = r.firm_id
    WHERE r.id = target_request_id
      AND r.status <> 'cancelled'
      AND r.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND private.brp_client_portal_member_active(r.firm_id, e.client_id, e.id)
  );
$function$;
REVOKE ALL ON FUNCTION private.brp_client_portal_can_read_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_client_portal_can_read_request(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.brp_client_portal_can_upload_object(target_object_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  parts text[];
BEGIN
  parts := storage.foldername(target_object_key);
  IF pg_catalog.cardinality(parts) <> 3 THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.pbc_request r
    JOIN public.engagement e
      ON e.id = r.engagement_id
     AND e.firm_id = r.firm_id
    WHERE r.firm_id = parts[1]
      AND r.engagement_id = parts[2]
      AND r.id = parts[3]
      AND r.status IN ('requested','partially_received','rejected','overdue')
      AND r.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND private.brp_client_portal_member_active(r.firm_id, e.client_id, e.id)
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.brp_client_portal_can_upload_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_client_portal_can_upload_object(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.brp_client_portal_can_submit_submission(
  target_request_id text,
  target_firm_id text,
  target_object_key text,
  target_submitted_by uuid,
  target_submitted_by_name text,
  target_file_size bigint,
  target_file_sha256 text,
  target_mime_type text,
  target_scan_status text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  parts text[];
BEGIN
  parts := storage.foldername(target_object_key);
  IF pg_catalog.cardinality(parts) <> 3
     OR target_submitted_by IS DISTINCT FROM (SELECT auth.uid())
     OR target_scan_status <> 'pending'
     OR target_file_size IS NULL OR target_file_size < 1 OR target_file_size > 26214400
     OR target_file_sha256 !~ '^[0-9a-f]{64}$'
     OR target_mime_type NOT IN (
       'application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.ms-excel',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.pbc_request r
    JOIN public.engagement e
      ON e.id = r.engagement_id
     AND e.firm_id = r.firm_id
    JOIN public.client_portal_member m
      ON m.firm_id = r.firm_id
     AND m.client_id = e.client_id
     AND m.engagement_id = e.id
     AND m.auth_user_id = (SELECT auth.uid())
     AND m.status = 'active'
     AND m.deleted_at IS NULL
     AND m.accepted_at IS NOT NULL
     AND pg_catalog.lower(m.display_name) = pg_catalog.lower(target_submitted_by_name)
    JOIN auth.users u
      ON u.id = m.auth_user_id
     AND u.email_confirmed_at IS NOT NULL
     AND pg_catalog.lower(u.email) = pg_catalog.lower(m.email)
    JOIN public.client c
      ON c.id = e.client_id
     AND c.firm_id = r.firm_id
     AND c.status = 'active'
     AND c.deleted_at IS NULL
    JOIN storage.objects so
      ON so.bucket_id = 'ledgerly-client-submissions'
     AND so.name = target_object_key
    WHERE r.id = target_request_id
      AND r.firm_id = target_firm_id
      AND r.firm_id = parts[1]
      AND r.engagement_id = parts[2]
      AND r.id = parts[3]
      AND r.status IN ('requested','partially_received','rejected','overdue')
      AND r.deleted_at IS NULL
      AND e.deleted_at IS NULL
  );
END;
$function$;
REVOKE ALL ON FUNCTION private.brp_client_portal_can_submit_submission(text,text,text,uuid,text,bigint,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_client_portal_can_submit_submission(text,text,text,uuid,text,bigint,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.brp_client_portal_can_read_object(target_object_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.pbc_submission s
    JOIN public.pbc_request r ON r.id = s.request_id AND r.firm_id = s.firm_id
    JOIN public.engagement e ON e.id = r.engagement_id AND e.firm_id = r.firm_id
    WHERE s.object_key = target_object_key
      AND s.firm_id = r.firm_id
      AND r.deleted_at IS NULL
      AND e.deleted_at IS NULL
      AND (
        (
          s.scan_status = 'clean'
          AND s.submitted_by_portal_user_id = (SELECT auth.uid())
          AND private.brp_client_portal_member_active(r.firm_id, e.client_id, e.id)
        )
        OR private.brp_user_has_role_in_scope(
          r.firm_id, r.engagement_id,
          ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
        )
      )
  );
$function$;
REVOKE ALL ON FUNCTION private.brp_client_portal_can_read_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_client_portal_can_read_object(text) TO authenticated, service_role;

-- Client users see only their engagement's requests. Office-side role policies remain in force.
DROP POLICY IF EXISTS ledgerly_client_portal_request_read ON public.pbc_request;
CREATE POLICY ledgerly_client_portal_request_read ON public.pbc_request
  FOR SELECT TO authenticated
  USING (private.brp_client_portal_can_read_request(id));

DROP POLICY IF EXISTS ledgerly_client_portal_submission_read ON public.pbc_submission;
CREATE POLICY ledgerly_client_portal_submission_read ON public.pbc_submission
  FOR SELECT TO authenticated
  USING (
    submitted_by_portal_user_id = (SELECT auth.uid())
    AND private.brp_client_portal_can_read_request(request_id)
  );

DROP POLICY IF EXISTS ledgerly_client_portal_submission_insert ON public.pbc_submission;
CREATE POLICY ledgerly_client_portal_submission_insert ON public.pbc_submission
  FOR INSERT TO authenticated
  WITH CHECK (
    private.brp_client_portal_can_submit_submission(
      request_id, firm_id, object_key, submitted_by_portal_user_id, submitted_by_name,
      file_size, file_sha256, mime_type, scan_status
    )
  );

-- Private bucket. File types and size are restricted at Storage and the database insert gate.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ledgerly-client-submissions', 'ledgerly-client-submissions', false, 26214400,
  ARRAY[
    'application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Client uploads are create-only; reading objects requires a clean submission for that uploader.
DROP POLICY IF EXISTS ledgerly_client_portal_object_insert ON storage.objects;
CREATE POLICY ledgerly_client_portal_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ledgerly-client-submissions'
    AND private.brp_client_portal_can_upload_object(name)
  );

DROP POLICY IF EXISTS ledgerly_client_portal_object_read ON storage.objects;
CREATE POLICY ledgerly_client_portal_object_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ledgerly-client-submissions'
    AND private.brp_client_portal_can_read_object(name)
  );

-- Browser clients cannot replace or delete submissions or storage objects.
REVOKE UPDATE, DELETE, TRUNCATE ON public.pbc_submission FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON storage.objects FROM anon, authenticated;

-- Invitation provisioning is server-only: it validates the inviter, target engagement and email.
CREATE OR REPLACE FUNCTION public.ledgerly_add_client_portal_member(
  p_inviter_id uuid,
  p_target_user_id uuid,
  p_engagement_id text,
  p_email text,
  p_display_name text
)
RETURNS TABLE (member_id text, firm_id text, client_id text, engagement_id text, member_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_firm_id text;
  target_client_id text;
  target_email text;
  inviter_email text;
  member_key text := pg_catalog.gen_random_uuid()::text;
  now_iso text := pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  expires_iso text := pg_catalog.to_char((pg_catalog.clock_timestamp() + interval '7 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF p_inviter_id IS NULL OR p_target_user_id IS NULL OR p_engagement_id IS NULL THEN
    RAISE EXCEPTION 'Inviter, invitee and engagement are required' USING ERRCODE = '22023';
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

  SELECT e.firm_id, e.client_id
    INTO target_firm_id, target_client_id
  FROM public.engagement e
  JOIN public.client c ON c.id = e.client_id AND c.firm_id = e.firm_id
  WHERE e.id = p_engagement_id
    AND e.deleted_at IS NULL
    AND c.deleted_at IS NULL
    AND c.status = 'active';
  IF target_firm_id IS NULL OR target_client_id IS NULL THEN
    RAISE EXCEPTION 'Target engagement or client is not active' USING ERRCODE = '22023';
  END IF;

  SELECT u.email INTO inviter_email
  FROM public.app_user u
  WHERE u.id = p_inviter_id::text
    AND u.firm_id = target_firm_id
    AND u.status = 'active'
    AND u.deleted_at IS NULL;

  IF inviter_email IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.role_assignment ra
      WHERE ra.user_id = p_inviter_id::text
        AND ra.firm_id = target_firm_id
        AND ra.scope_type = 'firm'
        AND ra.deleted_at IS NULL
        AND ra.role IN ('firm_admin','managing_partner')
    )
    OR EXISTS (
      SELECT 1 FROM public.role_assignment ra
      WHERE ra.user_id = p_inviter_id::text
        AND ra.firm_id = target_firm_id
        AND ra.scope_type = 'engagement'
        AND ra.scope_id = p_engagement_id
        AND ra.deleted_at IS NULL
        AND ra.role IN ('engagement_partner','manager')
    )
  ) THEN
    RAISE EXCEPTION 'Only an authorized firm administrator, managing partner or engagement manager can invite this client contact' USING ERRCODE = '42501';
  END IF;

  SELECT u.email INTO target_email
  FROM auth.users u
  WHERE u.id = p_target_user_id
    AND u.deleted_at IS NULL;

  IF target_email IS NULL OR pg_catalog.lower(target_email) <> pg_catalog.lower(pg_catalog.btrim(p_email)) THEN
    RAISE EXCEPTION 'Invited account email does not match' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.app_user u
    WHERE pg_catalog.lower(u.email) = pg_catalog.lower(pg_catalog.btrim(p_email))
      AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This email is already linked to an internal Ledgerly user' USING ERRCODE = '23505';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(target_firm_id), pg_catalog.hashtext(p_engagement_id));

  UPDATE public.client_portal_member
  SET status = 'expired', updated_at = now_iso
  WHERE firm_id = target_firm_id
    AND engagement_id = p_engagement_id
    AND pg_catalog.lower(email) = pg_catalog.lower(pg_catalog.btrim(p_email))
    AND status = 'invited'
    AND invitation_expires_at < now_iso
    AND deleted_at IS NULL;

  IF EXISTS (
    SELECT 1 FROM public.client_portal_member m
    WHERE m.firm_id = target_firm_id
      AND m.engagement_id = p_engagement_id
      AND pg_catalog.lower(m.email) = pg_catalog.lower(pg_catalog.btrim(p_email))
      AND m.status IN ('invited','active')
      AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A client portal invitation or membership already exists for this engagement' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.client_portal_member (
    id, auth_user_id, firm_id, client_id, engagement_id, display_name, email,
    status, invited_by, created_at, updated_at, invitation_expires_at
  ) VALUES (
    member_key, p_target_user_id, target_firm_id, target_client_id, p_engagement_id,
    pg_catalog.btrim(p_display_name), pg_catalog.lower(pg_catalog.btrim(p_email)),
    'invited', p_inviter_id::text, now_iso, now_iso, expires_iso
  );

  RETURN QUERY SELECT member_key, target_firm_id, target_client_id, p_engagement_id, 'invited'::text;
END;
$function$;
REVOKE ALL ON FUNCTION public.ledgerly_add_client_portal_member(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledgerly_add_client_portal_member(uuid,uuid,text,text,text) TO service_role;

-- Email-confirmed invitees can activate only their own, engagement-scoped membership.
CREATE OR REPLACE FUNCTION public.ledgerly_accept_client_portal_invitation()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  user_id uuid := (SELECT auth.uid());
  user_email text;
  email_confirmed timestamptz;
  now_iso text := pg_catalog.to_char(pg_catalog.clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING ERRCODE = '42501';
  END IF;
  SELECT u.email, u.email_confirmed_at INTO user_email, email_confirmed
  FROM auth.users u
  WHERE u.id = user_id AND u.deleted_at IS NULL;
  IF user_email IS NULL OR email_confirmed IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.client_portal_member m
  SET status = 'expired', updated_at = now_iso
  WHERE m.auth_user_id = user_id
    AND pg_catalog.lower(m.email) = pg_catalog.lower(user_email)
    AND m.status = 'invited'
    AND m.invitation_expires_at < now_iso
    AND m.deleted_at IS NULL;

  UPDATE public.client_portal_member m
  SET status = 'active', accepted_at = COALESCE(m.accepted_at, now_iso), updated_at = now_iso
  WHERE m.auth_user_id = user_id
    AND pg_catalog.lower(m.email) = pg_catalog.lower(user_email)
    AND m.status = 'invited'
    AND m.invitation_expires_at >= now_iso
    AND m.deleted_at IS NULL;

  RETURN EXISTS (
    SELECT 1 FROM public.client_portal_member m
    WHERE m.auth_user_id = user_id
      AND pg_catalog.lower(m.email) = pg_catalog.lower(user_email)
      AND m.status = 'active'
      AND m.accepted_at IS NOT NULL
      AND m.deleted_at IS NULL
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.ledgerly_accept_client_portal_invitation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ledgerly_accept_client_portal_invitation() TO authenticated;
