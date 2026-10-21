-- Supabase PostgreSQL migration for Bank Reconciliation Pro / Audit Practice Platform.
-- Apply only to a dedicated Supabase project after reviewing this migration.
-- Bootstrap firm and initial app_user records with the Supabase SQL editor or trusted server;
-- never expose the service-role key in a browser application.

-- =====================================================================
-- Audit Practice Platform — Canonical Schema (portable DDL)
-- Reference: docs/03-database-design.md  ·  Entity specs: docs/02-entity-model.md
--
-- Target: PostgreSQL/Supabase; this migration is generated from the SQLite schema reference.
-- Conventions (ADR-2/5/6/8):
--   * IDs: UUIDv7 generated client-side, stored as TEXT.
--   * Money: INTEGER minor units (*_minor) + currency CHAR(3). Never floats.
--   * Dates: TEXT ISO-8601 ('YYYY-MM-DD' day fields, full UTC timestamps otherwise).
--   * JSON: TEXT here; cloud deployment may upgrade to JSONB via overlay migration.
--   * Every business table starts with firm_id and carries standard sync columns.
--   * No physical deletes: deleted_at tombstones only. change_log is append-only.
--   * Table/column names avoid SQL reserved words (app_user, reconciliation_match,
--     interval_size) so the same file runs on both engines unquoted.
-- SQLite note: run with -- PostgreSQL/Supabase migration: foreign keys are enforced by PostgreSQL.
-- =====================================================================

-- PostgreSQL/Supabase migration: foreign keys are enforced by PostgreSQL.

-- ---------------------------------------------------------------------
-- 0. Schema versioning (docs/03 §5)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,          -- sequential migration number
  applied_at  TEXT NOT NULL,
  note        TEXT
);

-- ---------------------------------------------------------------------
-- 1. Firm — isolation root (docs/02 §3.1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS firm (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  license_number TEXT,
  country        TEXT NOT NULL DEFAULT 'JO',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Amman',
  default_currency TEXT NOT NULL DEFAULT 'JOD',
  settings_json  TEXT,                    -- firm methodology: materiality policy, tolerances, templates
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_at     TEXT,
  updated_by     TEXT,
  row_version    INTEGER NOT NULL DEFAULT 1,
  origin_device  TEXT,
  deleted_at     TEXT
);

-- ---------------------------------------------------------------------
-- 2. Users & roles (docs/02 §4.1, docs/04)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (     -- 'user' is reserved in PostgreSQL
  id           TEXT PRIMARY KEY,
  firm_id      TEXT NOT NULL REFERENCES firm(id),
  display_name TEXT NOT NULL,
  email        TEXT,
  auth_kind    TEXT NOT NULL DEFAULT 'local_pin' CHECK (auth_kind IN ('local_pin','cloud')),
  auth_secret  TEXT,                      -- PIN verifier / hash only — NEVER plaintext
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_at   TEXT,
  updated_by   TEXT,
  row_version  INTEGER NOT NULL DEFAULT 1,
  origin_device TEXT,
  deleted_at   TEXT
);

CREATE TABLE IF NOT EXISTS role_assignment (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  user_id     TEXT NOT NULL REFERENCES app_user(id),
  role        TEXT NOT NULL CHECK (role IN (
                'firm_admin','managing_partner','engagement_partner','manager',
                'senior','staff','reviewer','eqcr')),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('firm','engagement')),
  scope_id    TEXT,                       -- engagement id when scope_type='engagement'
  assigned_at TEXT NOT NULL,
  assigned_by TEXT,
  created_at  TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  origin_device TEXT,
  deleted_at  TEXT,
  CHECK (scope_type = 'firm' OR scope_id IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- 3. Client, acceptance, fiscal year (docs/02 §3.2–3.4, §4.2)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  name        TEXT NOT NULL,
  legal_form  TEXT CHECK (legal_form IN ('sole','partnership','llc','corporation','nonprofit','other')),
  tax_number  TEXT,
  industry    TEXT,
  contact_json TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  origin_device TEXT,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS client_acceptance (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  client_id   TEXT NOT NULL REFERENCES client(id),
  decision    TEXT NOT NULL CHECK (decision IN ('accepted','continued','declined','expired')),
  independence_check_done INTEGER NOT NULL DEFAULT 0 CHECK (independence_check_done IN (0,1)),
  notes       TEXT,
  performed_by TEXT,
  performed_at TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  origin_device TEXT,
  deleted_at  TEXT
);

CREATE TABLE IF NOT EXISTS fiscal_year (
  id          TEXT PRIMARY KEY,
  firm_id     TEXT NOT NULL REFERENCES firm(id),
  client_id   TEXT NOT NULL REFERENCES client(id),
  start_date  TEXT NOT NULL,              -- ISO date
  end_date    TEXT NOT NULL,
  reporting_framework TEXT,               -- e.g. IFRS
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  origin_device TEXT,
  deleted_at  TEXT,
  CHECK (start_date < end_date)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_year_client ON fiscal_year(firm_id, client_id, start_date);

-- ---------------------------------------------------------------------
-- 4. Engagement — the aggregate root (docs/02 §3.3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement (
  id               TEXT PRIMARY KEY,
  firm_id          TEXT NOT NULL REFERENCES firm(id),
  client_id        TEXT NOT NULL REFERENCES client(id),
  fiscal_year_id   TEXT NOT NULL REFERENCES fiscal_year(id),
  engagement_type  TEXT NOT NULL DEFAULT 'annual_audit'
                     CHECK (engagement_type IN ('annual_audit','interim','special','other')),
  partner_id       TEXT REFERENCES app_user(id),
  manager_id       TEXT REFERENCES app_user(id),
  status           TEXT NOT NULL DEFAULT 'planning'
                     CHECK (status IN ('planning','fieldwork','review','finalization','closed','cancelled')),
  engagement_letter_ref TEXT,
  materiality_json TEXT,                 -- Phase 3: materiality numbers + bases (docs/02 §3.3)
  opened_at        TEXT NOT NULL,
  closed_at        TEXT,
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT,
  updated_by       TEXT,
  row_version      INTEGER NOT NULL DEFAULT 1,
  origin_device    TEXT,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_engagement_scope ON engagement(firm_id, client_id, fiscal_year_id);

-- ---------------------------------------------------------------------
-- 5. Accounts (docs/02 §3.5 — imported with trial balance, Phase 3)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account (
  id              TEXT PRIMARY KEY,
  firm_id         TEXT NOT NULL REFERENCES firm(id),
  client_id       TEXT NOT NULL REFERENCES client(id),
  fiscal_year_id  TEXT NOT NULL REFERENCES fiscal_year(id),
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  name_en         TEXT,
  type            TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  parent_id       TEXT REFERENCES account(id),
  is_postable     INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0,1)),
  currency        TEXT NOT NULL,
  opening_balance_minor INTEGER NOT NULL DEFAULT 0,
  closing_balance_minor INTEGER NOT NULL DEFAULT 0,
  mapping_code    TEXT,                   -- FS line mapping (Phase 6)
  created_at      TEXT NOT NULL,
  created_by      TEXT,
  updated_at      TEXT,
  updated_by      TEXT,
  row_version     INTEGER NOT NULL DEFAULT 1,
  origin_device   TEXT,
  deleted_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_code
  ON account(fiscal_year_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_account_tree ON account(fiscal_year_id, parent_id);

-- ---------------------------------------------------------------------
-- 6. Imports & transactions (docs/02 §4.3–4.4)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_batch (
  id                TEXT PRIMARY KEY,
  firm_id           TEXT NOT NULL REFERENCES firm(id),
  engagement_id     TEXT NOT NULL REFERENCES engagement(id),
  batch_kind        TEXT NOT NULL CHECK (batch_kind IN ('bank_statement','ledger','trial_balance','supporting')),
  source_type       TEXT NOT NULL CHECK (source_type IN ('csv','xlsx','pdf','ocr','manual')),
  file_name         TEXT,
  file_sha256       TEXT,
  column_mapping_json TEXT,
  parse_warnings_json TEXT,
  row_count         INTEGER NOT NULL DEFAULT 0,
  duplicate_of_id   TEXT REFERENCES import_batch(id),
  imported_by       TEXT,
  imported_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  row_version       INTEGER NOT NULL DEFAULT 1,
  origin_device     TEXT,
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_import_batch_eng ON import_batch(firm_id, engagement_id);

CREATE TABLE IF NOT EXISTS transaction_line (
  id                 TEXT PRIMARY KEY,
  firm_id            TEXT NOT NULL REFERENCES firm(id),
  engagement_id      TEXT NOT NULL REFERENCES engagement(id),
  batch_id           TEXT NOT NULL REFERENCES import_batch(id),
  side               TEXT NOT NULL CHECK (side IN ('bank','ledger')),
  line_no            INTEGER NOT NULL,    -- source row number (sourceRow)
  tx_date            TEXT,
  value_date         TEXT,
  description_raw    TEXT,
  description_norm   TEXT,
  debit_minor        INTEGER,
  credit_minor       INTEGER,
  signed_amount_minor INTEGER,
  balance_minor      INTEGER,
  currency           TEXT NOT NULL,
  account_id         TEXT REFERENCES account(id),   -- ledger only, filled Phase 3+
  raw_json           TEXT,               -- original row exactly as imported (immutable)
  created_at         TEXT NOT NULL,
  row_version        INTEGER NOT NULL DEFAULT 1,
  origin_device      TEXT,
  deleted_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_tx_batch
  ON transaction_line(firm_id, engagement_id, batch_id, line_no);
CREATE INDEX IF NOT EXISTS idx_tx_amount_date
  ON transaction_line(engagement_id, side, tx_date, signed_amount_minor);

-- ---------------------------------------------------------------------
-- 7. Reconciliation runs (docs/02 §4.5 — immutable runs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reconciliation_run (
  id                 TEXT PRIMARY KEY,
  firm_id            TEXT NOT NULL REFERENCES firm(id),
  engagement_id      TEXT NOT NULL REFERENCES engagement(id),
  bank_batch_id      TEXT NOT NULL REFERENCES import_batch(id),
  ledger_batch_id    TEXT NOT NULL REFERENCES import_batch(id),
  params_json        TEXT NOT NULL,       -- amount_tolerance_minor, date_window_days, sign convention
  result_summary_json TEXT,
  run_by             TEXT,
  run_at             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  row_version        INTEGER NOT NULL DEFAULT 1,
  origin_device      TEXT,
  deleted_at         TEXT                 -- tombstone only; results are immutable
);
CREATE INDEX IF NOT EXISTS idx_run_eng ON reconciliation_run(firm_id, engagement_id, run_at);

-- ---------------------------------------------------------------------
-- 8. Working papers & evidence (docs/02 §3.6–3.7, ADR-7)
-- Created before exception/match, which may reference working papers.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS working_paper (
  id               TEXT PRIMARY KEY,
  firm_id          TEXT NOT NULL REFERENCES firm(id),
  engagement_id    TEXT NOT NULL REFERENCES engagement(id),
  reference        TEXT NOT NULL,         -- hierarchical ref, e.g. 'A-1000-02'
  cycle            TEXT CHECK (cycle IN ('treasury','revenue','purchasing','payroll','inventory','capex','general','other')),
  title            TEXT NOT NULL,
  paper_type       TEXT NOT NULL CHECK (paper_type IN ('reconciliation','analytical','sample_test','lead_schedule','support','memo')),
  preparer_id      TEXT NOT NULL REFERENCES app_user(id),
  prepared_at      TEXT,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','reviewed','returned')),
  conclusion       TEXT,
  conclusion_status TEXT CHECK (conclusion_status IN ('supported','supported_with_exceptions','insufficient_evidence')),
  source_refs_json TEXT,                  -- run_ids / batch_ids / sample_ids feeding this paper
  supersedes_id    TEXT REFERENCES working_paper(id),
  created_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_at       TEXT,
  updated_by       TEXT,
  row_version      INTEGER NOT NULL DEFAULT 1,
  origin_device    TEXT,
  deleted_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wp_reference
  ON working_paper(engagement_id, reference) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS evidence (
  id               TEXT PRIMARY KEY,
  firm_id          TEXT NOT NULL REFERENCES firm(id),
  engagement_id    TEXT NOT NULL REFERENCES engagement(id),
  working_paper_id TEXT REFERENCES working_paper(id),
  title            TEXT NOT NULL,
  evidence_kind    TEXT NOT NULL CHECK (evidence_kind IN ('file','import_batch','match_run','confirmation','memo','screenshot')),
  file_name        TEXT,
  file_sha256      TEXT,                  -- mandatory for kind='file' (checked in code)
  file_size        INTEGER,
  mime_type        TEXT,
  storage_path     TEXT,                  -- local mode: relative path in evidence store
  object_key       TEXT,                  -- cloud mode
  source           TEXT NOT NULL DEFAULT 'client_provided' CHECK (source IN ('client_provided','generated','external')),
  obtained_at      TEXT NOT NULL,
  obtained_by      TEXT,
  supersedes_id    TEXT REFERENCES evidence(id),
  superseded       INTEGER NOT NULL DEFAULT 0 CHECK (superseded IN (0,1)),
  retention_until  TEXT,
  created_at       TEXT NOT NULL,
  row_version      INTEGER NOT NULL DEFAULT 1,
  origin_device    TEXT,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_eng ON evidence(firm_id, engagement_id, working_paper_id);

-- ---------------------------------------------------------------------
-- 9. Exceptions (docs/02 §3.8)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exception (
  id               TEXT PRIMARY KEY,
  firm_id          TEXT NOT NULL REFERENCES firm(id),
  engagement_id    TEXT NOT NULL REFERENCES engagement(id),
  kind             TEXT NOT NULL CHECK (kind IN (
                     'unmatched_bank','unmatched_ledger','ambiguous_candidates','amount_difference',
                     'date_outside_window','possible_duplicate','possible_reversal','bank_fee_pattern',
                     'fx_difference','sign_convention_conflict','unparseable_row','validation_warning',
                     'other')),
  severity         TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('info','low','medium','high')),
  source_type      TEXT NOT NULL CHECK (source_type IN ('import','reconciliation','trial_balance','journal_test','analytics')),
  source_refs_json TEXT NOT NULL,         -- batch_id / run_id / line ids / procedure_id — no exception without data
  title            TEXT NOT NULL,
  detail           TEXT,
  detected_at      TEXT NOT NULL,
  detected_by      TEXT NOT NULL DEFAULT 'engine',  -- 'engine' or user id
  root_cause       TEXT,
  disposition      TEXT NOT NULL DEFAULT 'open'
                     CHECK (disposition IN ('open','under_review','resolved','waived','escalated')),
  disposition_note TEXT,
  disposition_by   TEXT,
  disposition_at   TEXT,
  working_paper_id TEXT REFERENCES working_paper(id),
  created_at       TEXT NOT NULL,
  row_version      INTEGER NOT NULL DEFAULT 1,
  origin_device    TEXT,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_exception_eng ON exception(firm_id, engagement_id, kind, disposition);

-- ---------------------------------------------------------------------
-- 10. Matches (docs/02 §4.6 — ADR-4: suggestions are not facts)
-- Table named reconciliation_match: 'match' is an SQL keyword.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reconciliation_match (
  id               TEXT PRIMARY KEY,
  firm_id          TEXT NOT NULL REFERENCES firm(id),
  engagement_id    TEXT NOT NULL REFERENCES engagement(id),
  run_id           TEXT NOT NULL REFERENCES reconciliation_run(id),
  bank_line_id     TEXT NOT NULL REFERENCES transaction_line(id),
  ledger_line_id   TEXT NOT NULL REFERENCES transaction_line(id),
  match_basis      TEXT NOT NULL CHECK (match_basis IN ('exact','amount_date','manual')),
  status           TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested','approved','rejected')),
  amount_diff_minor INTEGER NOT NULL DEFAULT 0,
  date_diff_days   INTEGER,
  decided_by       TEXT,
  decided_at       TEXT,
  note             TEXT,
  created_at       TEXT NOT NULL,
  row_version      INTEGER NOT NULL DEFAULT 1,
  origin_device    TEXT,
  deleted_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_match_run ON reconciliation_match(firm_id, engagement_id, run_id, status);

-- ---------------------------------------------------------------------
-- 11. Horizontal links (docs/02 §4.7 — "linked working papers")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cross_link (
  id            TEXT PRIMARY KEY,
  firm_id       TEXT NOT NULL REFERENCES firm(id),
  engagement_id TEXT NOT NULL REFERENCES engagement(id),
  from_type     TEXT NOT NULL,
  from_id       TEXT NOT NULL,
  to_type       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  relation      TEXT NOT NULL CHECK (relation IN ('supports','contradicts','explains','supersedes','generates')),
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  row_version   INTEGER NOT NULL DEFAULT 1,
  origin_device TEXT,
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_link_from ON cross_link(engagement_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_link_to   ON cross_link(engagement_id, to_type, to_id);

-- ---------------------------------------------------------------------
-- 12. Risks, procedures, samples (docs/02 §4.8 — Phases 3–4)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk (
  id              TEXT PRIMARY KEY,
  firm_id         TEXT NOT NULL REFERENCES firm(id),
  engagement_id   TEXT NOT NULL REFERENCES engagement(id),
  assertion_scope TEXT NOT NULL CHECK (assertion_scope IN ('fs_level','assertion')),
  description     TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'error' CHECK (category IN ('fraud','error')),
  likelihood      TEXT CHECK (likelihood IN ('low','medium','high')),
  impact          TEXT CHECK (impact IN ('low','medium','high')),
  inherent_risk   TEXT CHECK (inherent_risk IN ('low','medium','high')),
  assessed_by     TEXT,
  assessed_at     TEXT,
  created_at      TEXT NOT NULL,
  row_version     INTEGER NOT NULL DEFAULT 1,
  origin_device   TEXT,
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS audit_procedure (
  id              TEXT PRIMARY KEY,
  firm_id         TEXT NOT NULL REFERENCES firm(id),
  engagement_id   TEXT NOT NULL REFERENCES engagement(id),
  risk_id         TEXT REFERENCES risk(id),
  working_paper_id TEXT REFERENCES working_paper(id),
  method          TEXT NOT NULL CHECK (method IN ('inspection','observation','recalculation','confirmation','analytical','inquiry','caat')),
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','performed','evaluated')),
  result_summary  TEXT,
  performed_by    TEXT,
  performed_at    TEXT,
  created_at      TEXT NOT NULL,
  row_version     INTEGER NOT NULL DEFAULT 1,
  origin_device   TEXT,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_procedure_risk ON audit_procedure(engagement_id, risk_id);

CREATE TABLE IF NOT EXISTS sample (
  id               TEXT PRIMARY KEY,
  firm_id          TEXT NOT NULL REFERENCES firm(id),
  engagement_id    TEXT NOT NULL REFERENCES engagement(id),
  procedure_id     TEXT NOT NULL REFERENCES audit_procedure(id),
  method           TEXT NOT NULL CHECK (method IN ('random','systematic','mus','judgmental')),
  population_ref   TEXT NOT NULL,         -- batch/query reference
  population_size  INTEGER NOT NULL,
  sample_size      INTEGER NOT NULL,
  interval_size    INTEGER,               -- systematic/MUS interval ('interval' is reserved in PG)
  seed             INTEGER,               -- mandatory for reproducible random/systematic/mus
  selection_json   TEXT NOT NULL,         -- selected line ids
  evaluation_json  TEXT,
  conclusion       TEXT,
  created_at       TEXT NOT NULL,
  row_version      INTEGER NOT NULL DEFAULT 1,
  origin_device    TEXT,
  deleted_at       TEXT
);

-- ---------------------------------------------------------------------
-- 13. Misstatements (docs/02 §4.9 — Phase 6)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS misstatement (
  id                TEXT PRIMARY KEY,
  firm_id           TEXT NOT NULL REFERENCES firm(id),
  engagement_id     TEXT NOT NULL REFERENCES engagement(id),
  account_id        TEXT REFERENCES account(id),
  source_exception_id TEXT REFERENCES exception(id),
  assertion         TEXT,
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('factual','judgmental','projected')),
  corrected         INTEGER NOT NULL DEFAULT 0 CHECK (corrected IN (0,1)),
  note              TEXT,
  created_at        TEXT NOT NULL,
  row_version       INTEGER NOT NULL DEFAULT 1,
  origin_device     TEXT,
  deleted_at        TEXT
);

-- ---------------------------------------------------------------------
-- 14. Reviews (docs/02 §3.9 — ordered levels, reviewer ≠ preparer)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review (
  id             TEXT PRIMARY KEY,
  firm_id        TEXT NOT NULL REFERENCES firm(id),
  engagement_id  TEXT NOT NULL REFERENCES engagement(id),
  target_type    TEXT NOT NULL CHECK (target_type IN ('working_paper','exception','engagement','report_draft')),
  target_id      TEXT NOT NULL,
  level          TEXT NOT NULL CHECK (level IN ('preparer_check','senior_review','manager_review','partner_signoff','eqcr')),
  reviewer_id    TEXT NOT NULL REFERENCES app_user(id),
  decision       TEXT NOT NULL CHECK (decision IN ('approved','approved_with_notes','returned')),
  findings_json  TEXT,
  extent_note    TEXT,
  round_no       INTEGER NOT NULL DEFAULT 1,
  reviewed_at    TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  row_version    INTEGER NOT NULL DEFAULT 1,
  origin_device  TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_target ON review(engagement_id, target_type, target_id, round_no);

-- ---------------------------------------------------------------------
-- 15. Change log (docs/02 §4.10 — APPEND-ONLY, ADR-5)
-- No UPDATE/DELETE path exists by design; do not grant one in cloud RBAC.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_log (
  id             TEXT PRIMARY KEY,
  firm_id        TEXT NOT NULL,
  engagement_id  TEXT,
  actor_id       TEXT,
  device_id      TEXT,
  action         TEXT NOT NULL,           -- create/update/delete/approve/match/import/...
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  before_json    TEXT,
  after_json     TEXT,
  reason         TEXT,
  occurred_at    TEXT NOT NULL,
  sync_batch_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_changelog_entity ON change_log(firm_id, entity_type, entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_changelog_sync   ON change_log(sync_batch_id, occurred_at);

-- ---------------------------------------------------------------------
-- 16. Sync outbox (docs/03 §2 — nothing leaves the device unseen)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_outbox (
  id            TEXT PRIMARY KEY,
  firm_id       TEXT NOT NULL,
  change_log_id TEXT NOT NULL REFERENCES change_log(id),
  state         TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','in_flight','sent','conflict','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  queued_at     TEXT NOT NULL,
  sent_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_state ON sync_outbox(firm_id, state, queued_at);


-- Tenant isolation: every business table is scoped by firm_id. The helper is SECURITY DEFINER
-- to avoid recursive RLS evaluation when it reads app_user. IDs for app_user must match
-- auth.users.id::text. Provision membership only from a trusted administrative process.
CREATE OR REPLACE FUNCTION public.brp_user_has_firm_access(target_firm_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_user u
    WHERE u.id = auth.uid()::text
      AND u.firm_id = target_firm_id
      AND u.status = 'active'
      AND u.deleted_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.brp_user_has_firm_access(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.brp_user_has_firm_access(text) TO authenticated;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'app_user','role_assignment','client','client_acceptance','fiscal_year','engagement',
    'account','import_batch','transaction_line','reconciliation_run','working_paper','evidence',
    'exception','reconciliation_match','cross_link','risk','audit_procedure','sample','misstatement',
    'review','change_log','sync_outbox'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS brp_firm_isolation ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY brp_firm_isolation ON public.%I FOR ALL TO authenticated USING (public.brp_user_has_firm_access(firm_id)) WITH CHECK (public.brp_user_has_firm_access(firm_id))',
      tbl
    );
  END LOOP;

  -- firm is the tenant root and uses id (not firm_id), so it needs its own predicate.
  ALTER TABLE public.firm ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS brp_firm_isolation ON public.firm;
  CREATE POLICY brp_firm_isolation ON public.firm
    FOR ALL TO authenticated
    USING (public.brp_user_has_firm_access(id))
    WITH CHECK (public.brp_user_has_firm_access(id));
END $$;

-- change_log is intended to be append-only from application roles.
REVOKE UPDATE, DELETE, TRUNCATE ON public.change_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.change_log TO authenticated;

-- No access is granted to anonymous users. Use explicit role checks in a trusted API for
-- operations such as firm setup, membership management, final sign-off, and retention holds.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
