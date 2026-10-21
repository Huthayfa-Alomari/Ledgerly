-- Close a tenant-integrity gap in cloud evidence metadata and object paths.
-- Folder prefixes must resolve to a real engagement owned by the same firm. A firm-scoped
-- role must not be able to label another firm's engagement as belonging to its own office.

CREATE OR REPLACE FUNCTION private.ledgerly_guard_workspace_evidence_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  expected_prefix text;
BEGIN
  expected_prefix := NEW.firm_id || '/' || NEW.engagement_id || '/';

  IF pg_catalog.left(NEW.object_key, pg_catalog.length(expected_prefix)) <> expected_prefix THEN
    RAISE EXCEPTION 'Evidence object key must begin with its firm and engagement identifiers'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.engagement e
    WHERE e.id = NEW.engagement_id
      AND e.firm_id = NEW.firm_id
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Evidence must reference an active engagement within the same firm'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.ledgerly_guard_workspace_evidence_scope() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.ledgerly_guard_workspace_evidence_scope() TO authenticated, service_role;

DROP TRIGGER IF EXISTS ledgerly_workspace_evidence_scope_guard ON public.workspace_evidence_file;
CREATE TRIGGER ledgerly_workspace_evidence_scope_guard
BEFORE INSERT OR UPDATE OF firm_id, engagement_id, object_key
ON public.workspace_evidence_file
FOR EACH ROW EXECUTE FUNCTION private.ledgerly_guard_workspace_evidence_scope();

DROP POLICY IF EXISTS ledgerly_workspace_evidence_read ON public.workspace_evidence_file;
CREATE POLICY ledgerly_workspace_evidence_read ON public.workspace_evidence_file
  FOR SELECT TO authenticated
  USING (
    private.brp_user_has_role_in_scope(firm_id, engagement_id,
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[])
    AND EXISTS (
      SELECT 1 FROM public.engagement e
      WHERE e.id = workspace_evidence_file.engagement_id
        AND e.firm_id = workspace_evidence_file.firm_id
        AND e.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS ledgerly_workspace_evidence_insert ON public.workspace_evidence_file;
CREATE POLICY ledgerly_workspace_evidence_insert ON public.workspace_evidence_file
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())::text
    AND private.brp_user_has_role_in_scope(firm_id, engagement_id,
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff']::text[])
    AND pg_catalog.left(object_key, pg_catalog.length(firm_id || '/' || engagement_id || '/')) =
      firm_id || '/' || engagement_id || '/'
    AND EXISTS (
      SELECT 1 FROM public.engagement e
      WHERE e.id = workspace_evidence_file.engagement_id
        AND e.firm_id = workspace_evidence_file.firm_id
        AND e.deleted_at IS NULL
    )
  );

-- Private objects have the same firm/engagement binding as their metadata records.
DROP POLICY IF EXISTS ledgerly_evidence_object_read ON storage.objects;
CREATE POLICY ledgerly_evidence_object_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ledgerly-evidence'
    AND private.brp_user_has_role_in_scope(
      (storage.foldername(name))[1], (storage.foldername(name))[2],
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[])
    AND EXISTS (
      SELECT 1 FROM public.engagement e
      WHERE e.id = (storage.foldername(name))[2]
        AND e.firm_id = (storage.foldername(name))[1]
        AND e.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS ledgerly_evidence_object_insert ON storage.objects;
CREATE POLICY ledgerly_evidence_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ledgerly-evidence'
    AND private.brp_user_has_role_in_scope(
      (storage.foldername(name))[1], (storage.foldername(name))[2],
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff']::text[])
    AND EXISTS (
      SELECT 1 FROM public.engagement e
      WHERE e.id = (storage.foldername(name))[2]
        AND e.firm_id = (storage.foldername(name))[1]
        AND e.deleted_at IS NULL
    )
  );
