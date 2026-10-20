-- Add parent-scope policies for immutable and child tables that do not carry engagement_id.
-- These policies prevent RLS-enabled tables from being accidentally inaccessible to all users,
-- while retaining parent engagement scope and append-only audit semantics.

CREATE POLICY ledgerly_event_chain_read
ON public.immutable_event_chain
FOR SELECT TO authenticated
USING (
  private.brp_user_has_role_in_scope(
    firm_id, engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
  )
);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.immutable_event_chain FROM anon, authenticated;

CREATE POLICY ledgerly_independence_declaration_read
ON public.independence_declaration
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.independence_assessment ia
    WHERE ia.id = independence_declaration.assessment_id
      AND ia.firm_id = independence_declaration.firm_id
      AND private.brp_user_has_role_in_scope(
        ia.firm_id, ia.engagement_id,
        ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
      )
  )
);

CREATE POLICY ledgerly_independence_declaration_insert
ON public.independence_declaration
FOR INSERT TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1
    FROM public.independence_assessment ia
    WHERE ia.id = independence_declaration.assessment_id
      AND ia.firm_id = independence_declaration.firm_id
      AND private.brp_user_has_role_in_scope(
        ia.firm_id, ia.engagement_id,
        ARRAY['managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
      )
  )
);
REVOKE UPDATE, DELETE, TRUNCATE ON public.independence_declaration FROM anon, authenticated;

CREATE POLICY ledgerly_working_paper_version_read
ON public.working_paper_version
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.working_paper wp
    WHERE wp.id = working_paper_version.working_paper_id
      AND wp.firm_id = working_paper_version.firm_id
      AND private.brp_user_has_role_in_scope(
        wp.firm_id, wp.engagement_id,
        ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
      )
  )
);

CREATE POLICY ledgerly_working_paper_version_insert
ON public.working_paper_version
FOR INSERT TO authenticated
WITH CHECK (
  changed_by = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1
    FROM public.working_paper wp
    WHERE wp.id = working_paper_version.working_paper_id
      AND wp.firm_id = working_paper_version.firm_id
      AND private.brp_user_has_role_in_scope(
        wp.firm_id, wp.engagement_id,
        ARRAY['managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
      )
  )
);
REVOKE UPDATE, DELETE, TRUNCATE ON public.working_paper_version FROM anon, authenticated;

DROP POLICY IF EXISTS ledgerly_read_firm_scope ON public.working_paper_tickmark;
CREATE POLICY ledgerly_working_paper_tickmark_read
ON public.working_paper_tickmark
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.working_paper wp
    WHERE wp.id = working_paper_tickmark.working_paper_id
      AND wp.firm_id = working_paper_tickmark.firm_id
      AND private.brp_user_has_role_in_scope(
        wp.firm_id, wp.engagement_id,
        ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
      )
  )
);

CREATE POLICY ledgerly_working_paper_tickmark_insert
ON public.working_paper_tickmark
FOR INSERT TO authenticated
WITH CHECK (
  created_by = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1
    FROM public.working_paper wp
    WHERE wp.id = working_paper_tickmark.working_paper_id
      AND wp.firm_id = working_paper_tickmark.firm_id
      AND private.brp_user_has_role_in_scope(
        wp.firm_id, wp.engagement_id,
        ARRAY['manager','senior','staff']::text[]
      )
  )
);
REVOKE UPDATE, DELETE, TRUNCATE ON public.working_paper_tickmark FROM anon, authenticated;
