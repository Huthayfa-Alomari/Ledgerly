-- Harden user-attributed audit events and protect working-paper review/sign-off fields.
-- This is an additive correction to the existing role matrix, not a replacement of firm RLS.

CREATE OR REPLACE FUNCTION private.ledgerly_stamp_change_log_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- Trusted database operations may write system events; browser users may not impersonate actors.
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

  IF NOT private.brp_user_has_role_in_scope(
    NEW.firm_id, NULL,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
  ) THEN
    RAISE EXCEPTION 'User is not an active member of this firm'
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
CREATE POLICY ledgerly_change_log_insert
ON public.change_log
FOR INSERT TO authenticated
WITH CHECK (
  actor_id = (SELECT auth.uid())::text
  AND private.brp_user_has_role_in_scope(
    firm_id, NULL,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
  )
);

CREATE OR REPLACE FUNCTION private.ledgerly_guard_working_paper_review_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  jwt_role text := current_setting('request.jwt.claim.role', true);
  is_preparer boolean;
  can_review boolean;
BEGIN
  IF jwt_role = 'service_role' OR current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'A working paper cannot be moved between firm or engagement scopes'
      USING ERRCODE = '42501';
  END IF;

  is_preparer := private.brp_user_has_role_in_scope(
    OLD.firm_id, OLD.engagement_id, ARRAY['manager','senior','staff']::text[]
  );
  can_review := private.brp_user_has_role_in_scope(
    OLD.firm_id, OLD.engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','reviewer','eqcr']::text[]
  );

  IF (NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by) THEN
    IF auth.uid() IS NULL OR NOT can_review THEN
      RAISE EXCEPTION 'Only an authorized reviewer may change working-paper review fields'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       AND NEW.reviewed_by IS NOT NULL
       AND NEW.reviewed_by IS DISTINCT FROM auth.uid()::text THEN
      RAISE EXCEPTION 'reviewed_by must identify the authenticated reviewer'
        USING ERRCODE = '42501';
    END IF;

    IF pg_catalog.lower(NEW.status) IN ('approved','signed_off','final','locked','issued','closed')
       AND NOT private.brp_user_has_role_in_scope(
         OLD.firm_id, OLD.engagement_id,
         ARRAY['firm_admin','managing_partner','engagement_partner','reviewer','eqcr']::text[]
       ) THEN
      RAISE EXCEPTION 'Final working-paper sign-off requires a partner or independent reviewer'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Review-only users may change review fields, not preparer content.
  IF NOT is_preparer
     AND (pg_catalog.to_jsonb(NEW) - ARRAY['status','reviewed_by','updated_at']::text[])
         IS DISTINCT FROM
         (pg_catalog.to_jsonb(OLD) - ARRAY['status','reviewed_by','updated_at']::text[]) THEN
    RAISE EXCEPTION 'Review-only users cannot alter working-paper preparation content'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := pg_catalog.to_char(
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS ledgerly_working_paper_review_guard ON public.working_paper;
CREATE TRIGGER ledgerly_working_paper_review_guard
BEFORE UPDATE ON public.working_paper
FOR EACH ROW EXECUTE FUNCTION private.ledgerly_guard_working_paper_review_fields();

-- Permit reviewers to reach the update trigger; the trigger restricts review-only roles to
-- status/reviewed_by and keeps final sign-off behind a stricter partner/EQCR role gate.
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
