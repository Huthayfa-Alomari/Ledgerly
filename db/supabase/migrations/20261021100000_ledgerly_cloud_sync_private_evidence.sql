-- Optional cloud workspace snapshot and private evidence storage.
-- Uses existing role/scope helper; browser clients never receive service-role credentials.
CREATE TABLE IF NOT EXISTS public.firm_workspace_snapshot (
  firm_id text PRIMARY KEY REFERENCES public.firm(id),
  payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.firm_workspace_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledgerly_workspace_snapshot_read ON public.firm_workspace_snapshot;
CREATE POLICY ledgerly_workspace_snapshot_read ON public.firm_workspace_snapshot
  FOR SELECT TO authenticated
  USING (private.brp_user_has_role_in_scope(firm_id, NULL,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]));
DROP POLICY IF EXISTS ledgerly_workspace_snapshot_insert ON public.firm_workspace_snapshot;
CREATE POLICY ledgerly_workspace_snapshot_insert ON public.firm_workspace_snapshot
  FOR INSERT TO authenticated
  WITH CHECK (
    updated_by = (SELECT auth.uid())::text
    AND private.brp_user_has_role_in_scope(firm_id, NULL,
      ARRAY['firm_admin','managing_partner','engagement_partner','manager']::text[])
  );
DROP POLICY IF EXISTS ledgerly_workspace_snapshot_update ON public.firm_workspace_snapshot;
CREATE POLICY ledgerly_workspace_snapshot_update ON public.firm_workspace_snapshot
  FOR UPDATE TO authenticated
  USING (private.brp_user_has_role_in_scope(firm_id, NULL,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager']::text[]))
  WITH CHECK (
    updated_by = (SELECT auth.uid())::text
    AND private.brp_user_has_role_in_scope(firm_id, NULL,
      ARRAY['firm_admin','managing_partner','engagement_partner','manager']::text[])
  );
REVOKE ALL ON public.firm_workspace_snapshot FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.firm_workspace_snapshot TO authenticated;
REVOKE DELETE, TRUNCATE ON public.firm_workspace_snapshot FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.workspace_evidence_file (
  id text PRIMARY KEY,
  firm_id text NOT NULL REFERENCES public.firm(id),
  engagement_id text NOT NULL,
  title text NOT NULL,
  object_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  file_sha256 text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_evidence_file ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledgerly_workspace_evidence_read ON public.workspace_evidence_file;
CREATE POLICY ledgerly_workspace_evidence_read ON public.workspace_evidence_file
  FOR SELECT TO authenticated
  USING (private.brp_user_has_role_in_scope(firm_id, engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]));
DROP POLICY IF EXISTS ledgerly_workspace_evidence_insert ON public.workspace_evidence_file;
CREATE POLICY ledgerly_workspace_evidence_insert ON public.workspace_evidence_file
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())::text
    AND private.brp_user_has_role_in_scope(firm_id, engagement_id,
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff']::text[])
    AND object_key LIKE firm_id || '/' || engagement_id || '/%'
  );
REVOKE ALL ON public.workspace_evidence_file FROM anon;
GRANT SELECT, INSERT ON public.workspace_evidence_file TO authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.workspace_evidence_file FROM anon, authenticated;

-- Private bucket: no public URLs. Max 25 MiB per object and conservative evidence formats.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ledgerly-evidence', 'ledgerly-evidence', false, 26214400,
  ARRAY['application/pdf','image/jpeg','image/png','image/webp','text/plain','text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS ledgerly_evidence_object_read ON storage.objects;
CREATE POLICY ledgerly_evidence_object_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ledgerly-evidence'
    AND private.brp_user_has_role_in_scope(
      (storage.foldername(name))[1], (storage.foldername(name))[2],
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[])
  );
DROP POLICY IF EXISTS ledgerly_evidence_object_insert ON storage.objects;
CREATE POLICY ledgerly_evidence_object_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ledgerly-evidence'
    AND private.brp_user_has_role_in_scope(
      (storage.foldername(name))[1], (storage.foldername(name))[2],
      ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff']::text[])
  );
-- Evidence is immutable from the browser; corrections are new evidence records.
DROP POLICY IF EXISTS ledgerly_evidence_object_update ON storage.objects;
DROP POLICY IF EXISTS ledgerly_evidence_object_delete ON storage.objects;
