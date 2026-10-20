-- Focused indexes for the highest-traffic tenant and engagement relationships.
-- These do not alter data or RLS; they reduce scans for tenant-scoped lookups.
CREATE INDEX IF NOT EXISTS idx_app_user_firm_id ON public.app_user (firm_id);
CREATE INDEX IF NOT EXISTS idx_client_firm_id ON public.client (firm_id);
CREATE INDEX IF NOT EXISTS idx_engagement_firm_id ON public.engagement (firm_id);
CREATE INDEX IF NOT EXISTS idx_engagement_client_id ON public.engagement (client_id);
CREATE INDEX IF NOT EXISTS idx_engagement_team_member_firm_id ON public.engagement_team_member (firm_id);
CREATE INDEX IF NOT EXISTS idx_working_paper_firm_id ON public.working_paper (firm_id);
CREATE INDEX IF NOT EXISTS idx_working_paper_engagement_id ON public.working_paper (engagement_id);
CREATE INDEX IF NOT EXISTS idx_evidence_firm_id ON public.evidence (firm_id);
CREATE INDEX IF NOT EXISTS idx_evidence_engagement_id ON public.evidence (engagement_id);
CREATE INDEX IF NOT EXISTS idx_change_log_firm_id ON public.change_log (firm_id);
CREATE INDEX IF NOT EXISTS idx_audit_sample_firm_id ON public.audit_sample (firm_id);
CREATE INDEX IF NOT EXISTS idx_analytics_run_firm_id ON public.analytics_run (firm_id);
CREATE INDEX IF NOT EXISTS idx_analytics_run_engagement_id ON public.analytics_run (engagement_id);
CREATE INDEX IF NOT EXISTS idx_risk_firm_id ON public.risk (firm_id);
CREATE INDEX IF NOT EXISTS idx_risk_engagement_id ON public.risk (engagement_id);
