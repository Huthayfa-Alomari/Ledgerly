-- Consolidate the preparer and reviewer UPDATE permissions into one permissive RLS policy.
-- The trigger remains the enforcement point for content changes, review metadata and sign-off.
-- A single policy avoids OR-combination overhead and the multiple_permissive_policies lint.

DROP POLICY IF EXISTS ledgerly_working_paper_review_update ON public.working_paper;
DROP POLICY IF EXISTS ledgerly_update_scope ON public.working_paper;

CREATE POLICY ledgerly_update_scope
ON public.working_paper
FOR UPDATE TO authenticated
USING (
  private.brp_user_has_role_in_scope(
    firm_id, engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
  )
)
WITH CHECK (
  private.brp_user_has_role_in_scope(
    firm_id, engagement_id,
    ARRAY['firm_admin','managing_partner','engagement_partner','manager','senior','staff','reviewer','eqcr']::text[]
  )
);
