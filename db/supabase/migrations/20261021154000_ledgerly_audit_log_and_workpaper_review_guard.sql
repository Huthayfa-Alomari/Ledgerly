-- Harden user-attributed audit events and protect working-paper review/sign-off fields.
-- This migration must work against both the canonical replay schema (preparer_id/reference)
-- and the existing live schema observed on 2026-10-21 (prepared_by/procedure_ref/objective/work_done).
-- Access variant-specific row fields through to_jsonb(record), never through a static NEW.field ref.

ALTER TABLE public.working_paper
  ADD COLUMN IF NOT EXISTS reviewed_by text REFERENCES public.app_user(id);
ALTER TABLE public.working_paper
  ADD COLUMN IF NOT EXISTS reviewed_at text;

CREATE OR REPLACE FUNCTION private.ledgerly_stamp_change_log_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
  engagement_scope text;
BEGIN
  -- Trusted server operations may write system events; browser users may not impersonate actors.
  IF jwt_role = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN
    NEW.occurred_at := pg_catalog.to_char(
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor required for change_log'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.actor_id IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'change_log actor_id must match the authenticated user'
      USING ERRCODE = '42501';
  END IF;

  -- The live change_log table does not include engagement_id, while the reconstructed
  -- clean-install schema does. JSON access returns NULL safely when the key is absent.
  engagement_scope := NULLIF(pg_catalog.to_jsonb(NEW) ->> 'engagement_id', '');
  IF NOT private.brp_user_has_role_in_scope(
    NEW.firm_id, engagement_scope,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
  ) THEN
    RAISE EXCEPTION 'User is not an active member of this firm and engagement scope'
      USING ERRCODE = '42501';
  END IF;

  -- Browser clients cannot backdate log entries.
  NEW.occurred_at := pg_catalog.to_char(
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ledgerly_change_log_stamp_actor ON public.change_log;
CREATE TRIGGER ledgerly_change_log_stamp_actor
BEFORE INSERT ON public.change_log
FOR EACH ROW EXECUTE FUNCTION private.ledgerly_stamp_change_log_actor();

DROP POLICY IF EXISTS ledgerly_change_log_insert ON public.change_log;
-- The browser must not invent a "real-looking" event, even under its own identity.
-- Trusted server-side code (service_role) remains responsible for authoritative audit events.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.change_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.ledgerly_guard_working_paper_review_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
  new_row jsonb;
  old_row jsonb;
  preparer_id_value text;
  can_prepare boolean;
  can_review boolean;
  privileged_signoff boolean;
  preparation_content_changed boolean;
  now_iso text;
BEGIN
  IF jwt_role = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required for working-paper changes'
      USING ERRCODE = '42501';
  END IF;

  new_row := pg_catalog.to_jsonb(NEW);
  preparer_id_value := COALESCE(new_row ->> 'preparer_id', new_row ->> 'prepared_by');

  can_prepare := private.brp_user_has_role_in_scope(
    NEW.firm_id, NEW.engagement_id, ARRAY['manager','senior','staff']::text[]
  );
  can_review := private.brp_user_has_role_in_scope(
    NEW.firm_id, NEW.engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','reviewer','eqcr']::text[]
  );
  privileged_signoff := private.brp_user_has_role_in_scope(
    NEW.firm_id, NEW.engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','reviewer','eqcr']::text[]
  );
  now_iso := pg_catalog.to_char(
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  IF TG_OP = 'INSERT' THEN
    IF NOT can_prepare OR preparer_id_value IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'Working-paper preparer must be an authenticated member with preparation rights'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.status = 'reviewed' THEN
      IF NOT privileged_signoff
         OR NEW.reviewed_by IS DISTINCT FROM auth.uid()::text
         OR preparer_id_value = NEW.reviewed_by THEN
        RAISE EXCEPTION 'Final working-paper sign-off requires a different authorized reviewer acting as themselves'
          USING ERRCODE = '42501';
      END IF;
      NEW.reviewed_at := now_iso;
    ELSE
      IF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Review metadata can only be set during authorized sign-off'
          USING ERRCODE = '42501';
      END IF;
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    END IF;

    NEW.updated_at := now_iso;
    RETURN NEW;
  END IF;

  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'A working paper cannot be moved between firm or engagement scopes'
      USING ERRCODE = '42501';
  END IF;

  old_row := pg_catalog.to_jsonb(OLD);
  new_row := pg_catalog.to_jsonb(NEW);
  preparer_id_value := COALESCE(new_row ->> 'preparer_id', new_row ->> 'prepared_by');

  -- Ignore only review metadata and the server-maintained update timestamp. Every other
  -- column is preparation content, covering both schema variants without naming fields
  -- that might not exist on the current record type.
  preparation_content_changed :=
    (new_row - ARRAY['status','reviewed_by','reviewed_at','updated_at']::text[])
    IS DISTINCT FROM
    (old_row - ARRAY['status','reviewed_by','reviewed_at','updated_at']::text[]);

  IF (NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by)
     OR (NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at) THEN
    IF NOT can_review THEN
      RAISE EXCEPTION 'Only an authorized reviewer may change working-paper review fields'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'reviewed' THEN
    IF NOT privileged_signoff
       OR NEW.reviewed_by IS DISTINCT FROM auth.uid()::text
       OR preparer_id_value = NEW.reviewed_by THEN
      RAISE EXCEPTION 'Final working-paper sign-off requires a different authorized reviewer acting as themselves'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status IS DISTINCT FROM 'reviewed' THEN
      NEW.reviewed_at := now_iso;
    ELSE
      NEW.reviewed_at := OLD.reviewed_at;
    END IF;
  ELSE
    -- Reopening must be a separate reviewer action. The trigger clears sign-off metadata.
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  IF OLD.status = 'reviewed' AND preparation_content_changed THEN
    RAISE EXCEPTION 'Signed-off working papers must be reopened in a separate update before content changes'
      USING ERRCODE = '42501';
  END IF;

  IF preparation_content_changed AND NOT can_prepare THEN
    RAISE EXCEPTION 'Review-only users cannot alter working-paper preparation content'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now_iso;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ledgerly_working_paper_review_guard ON public.working_paper;
CREATE TRIGGER ledgerly_working_paper_review_guard
BEFORE INSERT OR UPDATE ON public.working_paper
FOR EACH ROW EXECUTE FUNCTION private.ledgerly_guard_working_paper_review_fields();

-- Reviewers need an UPDATE policy to reach the trigger. The trigger limits review-only roles
-- to sign-off metadata while keeping preparation content available to authorized preparers.
DROP POLICY IF EXISTS ledgerly_working_paper_review_update ON public.working_paper;
CREATE POLICY ledgerly_working_paper_review_update
ON public.working_paper
FOR UPDATE TO authenticated
USING (
  private.brp_user_has_role_in_scope(
    firm_id, engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','reviewer','eqcr']::text[]
  )
)
WITH CHECK (
  private.brp_user_has_role_in_scope(
    firm_id, engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','reviewer','eqcr']::text[]
  )
);
