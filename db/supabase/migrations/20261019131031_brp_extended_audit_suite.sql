-- Extended Audit Suite: feature model for engagement acceptance, analytics, PBC,
-- time/billing, quality, AI-assisted review, client portal, and firm operations.
-- This file is self-contained for clean replay; it bootstraps the transitional private helper
-- that earlier drafts expected from an out-of-chain security overlay. Later RLS migrations
-- replace its broad write-policy use with the final role-by-table matrix. IDs are TEXT.
-- AI outputs are advisory only; no generated text is an audit conclusion or opinion.

-- Clean-replay bootstrap for the transitional role-gated policies below.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.brp_user_has_firm_role(target_firm_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_user u
    JOIN public.role_assignment ra
      ON ra.user_id = u.id
     AND ra.firm_id = u.firm_id
    WHERE u.id = (SELECT auth.uid())::text
      AND u.firm_id = target_firm_id
      AND u.status = 'active'
      AND u.deleted_at IS NULL
      AND ra.scope_type = 'firm'
      AND ra.deleted_at IS NULL
      AND ra.role = ANY(ARRAY['firm_admin','managing_partner','engagement_partner','manager']::text[])
  );
$function$;
REVOKE ALL ON FUNCTION private.brp_user_has_firm_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brp_user_has_firm_role(text) TO authenticated;

CREATE TABLE IF NOT EXISTS engagement_terms (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  scope_text TEXT NOT NULL, start_date TEXT, end_date TEXT, fee_minor BIGINT, currency CHAR(3) NOT NULL DEFAULT 'JOD',
  time_budget_minutes INTEGER, reporting_framework TEXT, local_standard TEXT, signed_letter_ref TEXT,
  created_at TEXT NOT NULL, updated_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS independence_assessment (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), client_id TEXT NOT NULL REFERENCES client(id),
  engagement_id TEXT REFERENCES engagement(id), assessed_by TEXT NOT NULL REFERENCES app_user(id), assessed_at TEXT NOT NULL,
  financial_interests TEXT, relationships TEXT, services_provided TEXT, threats_json TEXT NOT NULL DEFAULT '[]',
  safeguards_json TEXT NOT NULL DEFAULT '[]', decision TEXT NOT NULL CHECK(decision IN ('clear','safeguards_required','escalate','decline')),
  reviewer_id TEXT REFERENCES app_user(id), reviewed_at TEXT, notes TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS independence_declaration (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), assessment_id TEXT NOT NULL REFERENCES independence_assessment(id),
  user_id TEXT NOT NULL REFERENCES app_user(id), declaration_text TEXT NOT NULL, signed_at TEXT NOT NULL,
  signature_method TEXT NOT NULL CHECK(signature_method IN ('typed_name','e_signature_provider','certificate')),
  signature_evidence_ref TEXT, content_sha256 TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS engagement_team_member (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  user_id TEXT NOT NULL REFERENCES app_user(id), role TEXT NOT NULL, planned_minutes INTEGER NOT NULL DEFAULT 0,
  hourly_cost_minor BIGINT, assigned_at TEXT NOT NULL, assigned_by TEXT REFERENCES app_user(id), removed_at TEXT,
  UNIQUE(engagement_id,user_id,role)
);
CREATE TABLE IF NOT EXISTS audit_plan_procedure (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  risk_id TEXT REFERENCES risk(id), working_paper_id TEXT REFERENCES working_paper(id), procedure_ref TEXT NOT NULL,
  assertion TEXT, objective TEXT NOT NULL, procedure_text TEXT NOT NULL, source_standard TEXT, risk_basis TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','not_applicable')),
  prepared_by TEXT REFERENCES app_user(id), completed_at TEXT, reviewer_id TEXT REFERENCES app_user(id), reviewed_at TEXT,
  human_approved INTEGER NOT NULL DEFAULT 0 CHECK(human_approved IN (0,1)), created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS working_paper_version (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), working_paper_id TEXT NOT NULL REFERENCES working_paper(id),
  version_no INTEGER NOT NULL, snapshot_json TEXT NOT NULL, content_sha256 TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES app_user(id), changed_at TEXT NOT NULL, change_reason TEXT NOT NULL,
  UNIQUE(working_paper_id,version_no)
);
CREATE TABLE IF NOT EXISTS working_paper_tickmark (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), working_paper_id TEXT NOT NULL REFERENCES working_paper(id),
  code TEXT NOT NULL, description TEXT NOT NULL, evidence_id TEXT REFERENCES evidence(id), page_or_cell TEXT,
  created_by TEXT NOT NULL REFERENCES app_user(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analytics_run (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  run_type TEXT NOT NULL CHECK(run_type IN ('benford','after_hours','manual_journal','duplicate','round_amount','cutoff','ratio','expectation','mus','other')),
  source_batch_id TEXT, parameters_json TEXT NOT NULL DEFAULT '{}', engine_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','reviewed')),
  started_at TEXT, completed_at TEXT, executed_by TEXT REFERENCES app_user(id), summary_json TEXT, error_message TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analytics_result (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), run_id TEXT NOT NULL REFERENCES analytics_run(id),
  result_key TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','low','medium','high','critical')),
  transaction_ref TEXT, account_ref TEXT, amount_minor BIGINT, currency CHAR(3) DEFAULT 'JOD', explanation TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'unreviewed' CHECK(disposition IN ('unreviewed','false_positive','investigate','finding','resolved')),
  working_paper_id TEXT REFERENCES working_paper(id), finding_ref TEXT, reviewed_by TEXT REFERENCES app_user(id), reviewed_at TEXT,
  UNIQUE(run_id,result_key)
);
CREATE TABLE IF NOT EXISTS audit_sample (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  working_paper_id TEXT REFERENCES working_paper(id), population_ref TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('random','systematic','stratified','mus','judgmental')),
  population_count INTEGER NOT NULL, population_value_minor BIGINT, currency CHAR(3) DEFAULT 'JOD', confidence_level NUMERIC(5,2),
  tolerable_misstatement_minor BIGINT, expected_misstatement_minor BIGINT, sample_size INTEGER NOT NULL,
  seed TEXT NOT NULL, selection_parameters_json TEXT NOT NULL DEFAULT '{}', generated_at TEXT NOT NULL, generated_by TEXT REFERENCES app_user(id),
  reviewer_id TEXT REFERENCES app_user(id), reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_sample_item (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), sample_id TEXT NOT NULL REFERENCES audit_sample(id),
  population_item_ref TEXT NOT NULL, selected_value_minor BIGINT, projected_misstatement_minor BIGINT,
  test_result TEXT NOT NULL DEFAULT 'pending' CHECK(test_result IN ('pending','no_exception','exception','not_tested')),
  evidence_id TEXT REFERENCES evidence(id), notes TEXT, UNIQUE(sample_id,population_item_ref)
);
CREATE TABLE IF NOT EXISTS pbc_request (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  request_ref TEXT NOT NULL, title TEXT NOT NULL, description TEXT, requested_from TEXT, due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','partially_received','received','accepted','rejected','overdue','cancelled')),
  procedure_id TEXT REFERENCES audit_plan_procedure(id), working_paper_id TEXT REFERENCES working_paper(id),
  requested_by TEXT REFERENCES app_user(id), created_at TEXT NOT NULL, last_reminder_at TEXT, response_notes TEXT, deleted_at TEXT,
  UNIQUE(engagement_id,request_ref)
);
CREATE TABLE IF NOT EXISTS pbc_submission (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), request_id TEXT NOT NULL REFERENCES pbc_request(id),
  submitted_by_name TEXT, submitted_by_user TEXT REFERENCES app_user(id), object_key TEXT NOT NULL,
  file_name TEXT NOT NULL, mime_type TEXT, file_size BIGINT, file_sha256 TEXT NOT NULL, uploaded_at TEXT NOT NULL,
  scan_status TEXT NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending','clean','quarantined','failed')),
  accepted_by TEXT REFERENCES app_user(id), accepted_at TEXT, rejection_reason TEXT, supersedes_id TEXT REFERENCES pbc_submission(id)
);
CREATE TABLE IF NOT EXISTS time_entry (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  user_id TEXT NOT NULL REFERENCES app_user(id), work_date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes > 0),
  activity_code TEXT NOT NULL, description TEXT, billable INTEGER NOT NULL DEFAULT 1 CHECK(billable IN (0,1)),
  approved_by TEXT REFERENCES app_user(id), approved_at TEXT, invoice_line_id TEXT, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  invoice_number TEXT NOT NULL, issued_date TEXT NOT NULL, due_date TEXT, currency CHAR(3) NOT NULL DEFAULT 'JOD',
  subtotal_minor BIGINT NOT NULL, tax_minor BIGINT NOT NULL DEFAULT 0, total_minor BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','partially_paid','paid','overdue','void')),
  milestone TEXT, hours_basis_minutes INTEGER, external_ref TEXT, created_by TEXT REFERENCES app_user(id), created_at TEXT NOT NULL,
  UNIQUE(firm_id,invoice_number)
);
CREATE TABLE IF NOT EXISTS invoice_line (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), invoice_id TEXT NOT NULL REFERENCES invoice(id),
  description TEXT NOT NULL, quantity NUMERIC(12,2) NOT NULL DEFAULT 1, unit_price_minor BIGINT NOT NULL,
  amount_minor BIGINT NOT NULL, time_entry_id TEXT REFERENCES time_entry(id)
);
CREATE TABLE IF NOT EXISTS quality_check (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  check_code TEXT NOT NULL, description TEXT NOT NULL, standard_ref TEXT, required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','passed','failed','not_applicable')), evidence_ref TEXT,
  completed_by TEXT REFERENCES app_user(id), completed_at TEXT, reviewer_note TEXT, UNIQUE(engagement_id,check_code)
);
CREATE TABLE IF NOT EXISTS professional_judgment (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  working_paper_id TEXT REFERENCES working_paper(id), topic TEXT NOT NULL, facts TEXT NOT NULL, alternatives_json TEXT NOT NULL,
  rationale TEXT NOT NULL, key_assumptions TEXT, standard_refs_json TEXT, preparer_id TEXT NOT NULL REFERENCES app_user(id),
  prepared_at TEXT NOT NULL, reviewer_id TEXT REFERENCES app_user(id), reviewed_at TEXT, conclusion TEXT NOT NULL,
  supersedes_id TEXT REFERENCES professional_judgment(id), content_sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS management_letter_point (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  finding_id TEXT REFERENCES exception(id), title TEXT NOT NULL, condition_text TEXT NOT NULL, criteria_text TEXT,
  cause_text TEXT, effect_text TEXT, recommendation TEXT NOT NULL, management_response TEXT, owner_name TEXT, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','implemented','verified','closed','accepted_risk')),
  followup_date TEXT, verified_by TEXT REFERENCES app_user(id), verified_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS analytical_procedure (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  account_ref TEXT NOT NULL, period TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('prior_period','budget','industry','regression','custom')),
  expected_minor BIGINT NOT NULL, actual_minor BIGINT NOT NULL, variance_minor BIGINT NOT NULL,
  threshold_minor BIGINT NOT NULL, explanation TEXT, source_data_json TEXT NOT NULL DEFAULT '{}',
  working_paper_id TEXT REFERENCES working_paper(id), status TEXT NOT NULL DEFAULT 'unreviewed' CHECK(status IN ('unreviewed','explained','investigate','finding')),
  prepared_by TEXT REFERENCES app_user(id), reviewed_by TEXT REFERENCES app_user(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS going_concern_indicator (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), client_id TEXT NOT NULL REFERENCES client(id),
  engagement_id TEXT REFERENCES engagement(id), period TEXT NOT NULL, indicator_code TEXT NOT NULL, value_numeric NUMERIC(18,4),
  threshold_numeric NUMERIC(18,4), risk_level TEXT NOT NULL CHECK(risk_level IN ('low','medium','high','critical')),
  evidence_ref TEXT, explanation TEXT NOT NULL, reviewed_by TEXT REFERENCES app_user(id), reviewed_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS governance_communication (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  communication_type TEXT NOT NULL CHECK(communication_type IN ('management_letter','audit_committee_summary','open_question','representation_letter','other')),
  subject TEXT NOT NULL, content TEXT NOT NULL, recipient TEXT, sent_at TEXT, response_due TEXT, response_text TEXT,
  evidence_id TEXT REFERENCES evidence(id), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','sent','responded','closed')),
  prepared_by TEXT REFERENCES app_user(id), approved_by TEXT REFERENCES app_user(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_article (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), title TEXT NOT NULL, topic TEXT NOT NULL,
  accounting_issue TEXT NOT NULL, analysis_text TEXT NOT NULL, conclusion_text TEXT, standard_refs_json TEXT NOT NULL DEFAULT '[]',
  anonymized_example INTEGER NOT NULL DEFAULT 1 CHECK(anonymized_example IN (0,1)), author_id TEXT REFERENCES app_user(id),
  reviewer_id TEXT REFERENCES app_user(id), approved_at TEXT, visibility TEXT NOT NULL DEFAULT 'firm' CHECK(visibility IN ('private','firm','template')),
  created_at TEXT NOT NULL, updated_at TEXT, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS peer_review (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT NOT NULL REFERENCES engagement(id),
  working_paper_id TEXT REFERENCES working_paper(id), reviewer_id TEXT NOT NULL REFERENCES app_user(id),
  review_type TEXT NOT NULL CHECK(review_type IN ('peer','manager','partner','eqcr')), status TEXT NOT NULL DEFAULT 'requested'
    CHECK(status IN ('requested','in_progress','returned','cleared','escalated')),
  comments TEXT, requested_at TEXT NOT NULL, completed_at TEXT, conflicts_checked INTEGER NOT NULL DEFAULT 0 CHECK(conflicts_checked IN (0,1))
);
CREATE TABLE IF NOT EXISTS ai_advisory_record (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT REFERENCES engagement(id),
  advisory_type TEXT NOT NULL CHECK(advisory_type IN ('risk_procedure','contract_summary','disclosure_gap','analytical_expectation','report_draft','other')),
  model_name TEXT, prompt_version TEXT NOT NULL, input_hash TEXT NOT NULL, output_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]', limitations TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','accepted','edited','rejected','superseded')),
  human_reviewer_id TEXT REFERENCES app_user(id), human_reviewed_at TEXT, human_decision_note TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS client_portal_settings (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL UNIQUE REFERENCES firm(id), brand_name TEXT NOT NULL,
  logo_object_key TEXT, primary_color TEXT, portal_subdomain TEXT, custom_domain TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)), updated_by TEXT REFERENCES app_user(id), updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS report_template (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), template_code TEXT NOT NULL, title TEXT NOT NULL,
  report_type TEXT NOT NULL, framework TEXT, client_size_band TEXT CHECK(client_size_band IN ('micro','small','medium','large','all')),
  version_no INTEGER NOT NULL DEFAULT 1, body_template TEXT NOT NULL, approved_by TEXT REFERENCES app_user(id), approved_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(firm_id,template_code,version_no)
);
CREATE TABLE IF NOT EXISTS firm_subscription_plan (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), plan_code TEXT NOT NULL,
  billing_period TEXT NOT NULL CHECK(billing_period IN ('monthly','annual')), price_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'JOD', seat_limit INTEGER NOT NULL, active_engagement_limit INTEGER NOT NULL,
  starts_at TEXT NOT NULL, ends_at TEXT, status TEXT NOT NULL CHECK(status IN ('trial','active','past_due','cancelled'))
);
CREATE TABLE IF NOT EXISTS firm_performance_snapshot (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  utilization_rate NUMERIC(7,4), revenue_per_hour_minor BIGINT, median_completion_days NUMERIC(10,2),
  budget_overrun_rate NUMERIC(7,4), source_json TEXT NOT NULL DEFAULT '{}', generated_at TEXT NOT NULL,
  UNIQUE(firm_id,period_start,period_end)
);
CREATE TABLE IF NOT EXISTS immutable_event_chain (
  id TEXT PRIMARY KEY, firm_id TEXT NOT NULL REFERENCES firm(id), engagement_id TEXT REFERENCES engagement(id),
  sequence_no BIGINT NOT NULL, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  actor_id TEXT REFERENCES app_user(id), occurred_at TEXT NOT NULL, payload_hash TEXT NOT NULL,
  previous_hash TEXT, event_hash TEXT NOT NULL, signing_key_id TEXT, UNIQUE(firm_id,sequence_no)
);

-- Prevent ordinary Data API clients from modifying immutable snapshots/signatures/event-chain rows.
CREATE OR REPLACE FUNCTION private.brp_reject_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'This record is append-only; create a superseding record instead.'; END; $$;
REVOKE ALL ON FUNCTION private.brp_reject_immutable_mutation() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['independence_declaration','working_paper_version','immutable_event_chain'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS brp_immutable_%I ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER brp_immutable_%I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.brp_reject_immutable_mutation()',t,t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated',t);
  END LOOP;
END $$;

-- Firm-level row isolation. These policies depend on the hardened helper from migration 0002.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'engagement_terms','independence_assessment','independence_declaration','engagement_team_member',
    'audit_plan_procedure','working_paper_version','working_paper_tickmark','analytics_run','analytics_result',
    'audit_sample','audit_sample_item','pbc_request','pbc_submission','time_entry','invoice','invoice_line',
    'quality_check','professional_judgment','management_letter_point','analytical_procedure','going_concern_indicator',
    'governance_communication','knowledge_article','peer_review','ai_advisory_record','client_portal_settings',
    'report_template','firm_subscription_plan','firm_performance_snapshot','immutable_event_chain'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS brp_firm_member_read ON public.%I',t);
    EXECUTE format('DROP POLICY IF EXISTS brp_firm_role_write ON public.%I',t);
    EXECUTE format('CREATE POLICY brp_firm_member_read ON public.%I FOR SELECT TO authenticated USING (public.brp_user_has_firm_access(firm_id))',t);
    EXECUTE format('CREATE POLICY brp_firm_role_write ON public.%I FOR ALL TO authenticated USING (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id)) WITH CHECK (public.brp_user_has_firm_access(firm_id) AND private.brp_user_has_firm_role(firm_id))',t);
  END LOOP;
END $$;

INSERT INTO schema_version(version,applied_at,note)
VALUES (3, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'Extended audit suite: engagement, analytics, PBC, billing, quality, advisory and firm ops')
ON CONFLICT(version) DO NOTHING;
