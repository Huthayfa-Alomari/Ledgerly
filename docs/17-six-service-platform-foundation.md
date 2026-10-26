# Six-Service Platform Foundation

Status: **design baseline — implementation not yet enabled by this document**  
Target repository: `Huthayfa-Alomari/Ledgerly`  
Base branch at planning time: `main`  
Product decision: one platform, six service lines, local + cloud operation, service coverage represented in the first commercial release.

## 1. Product boundary

Ledgerly remains the existing React/TypeScript application and keeps its reconciliation engine, audit working-paper workflows, encrypted local vault, and current Supabase integration. Do not create a replacement repository or migrate credentials/data from other products.

The first release should expose all six service lines in the product navigation and support a usable, deliberately bounded workflow in each. This is not a claim that all six disciplines will be fully production-complete at once. Professional calculations, regulatory forms, final reports, external uploads, and cloud sync remain gated by the acceptance criteria in this document and `RELEASE_READINESS.md`.

## 2. Six service lines

Use stable service identifiers independent of translated labels:

| Key | Arabic label | Initial workflow boundary |
|---|---|---|
| `external_audit` | التدقيق الخارجي | Engagement acceptance, independence assessment, risk plan, trial balance, workpapers, evidence, review and draft reporting |
| `internal_audit` | التدقيق الداخلي | Audit universe, risk/control register, annual plan, control tests, findings, action owners and follow-up |
| `bookkeeping` | مسك الحسابات | Chart of accounts, journal drafts, posting review, ledger, reconciliation and trial balance |
| `tax_advisory` | الاستشارات الضريبية | Tax calendar, client document checklist, calculation workpapers, reviewed draft return and submission-status tracking |
| `training_development` | التطوير والتدريب | Course catalogue, cohorts, sessions, attendance, assessments, learning materials and certificate records |
| `feasibility_studies` | دراسات الجدوى الاقتصادية | Project assumptions, capital expenditure, operating model, revenue/cost scenarios, cash flow, break-even and sensitivity analysis |

Each module must show clear empty, loading, error, read-only, and disabled states. Labels must support Arabic RTL and English LTR. Do not display a module as “complete” merely because its navigation item exists.

## 3. Shared domain foundation

Shared entities are limited to cross-service concepts:

- Firm and firm membership
- User identity, role assignment, and service/engagement scope
- Client profile and contacts
- Service engagement (with explicit `service_type`)
- Tasks, deadlines, comments, and approved time entries
- Contract/fee metadata and subscription entitlements
- Document metadata, retention classification, and event history
- Independence/conflict assessment records

Every tenant-owned row must be scoped to `firm_id`. Engagement-specific records must be scoped to the engagement directly or through a constrained parent relationship. Use foreign keys and database policies as well as UI checks; never trust client-supplied `firm_id` values as authorization.

Do not force every discipline into the existing external-audit `engagement_type` enum. Introduce a top-level service identifier with module-specific child records, and migrate existing audit records without changing their IDs or historical meaning. Prefer additive migrations, explicit backfill, and tested rollback/recovery instructions.

## 4. Service-specific separation and professional safeguards

- An engagement belongs to exactly one primary service line; shared client metadata does not make workpapers, tax calculations, internal audit tests, or training records interchangeable.
- Access is granted by firm membership plus service/engagement assignment. Client portal roles must not inherit internal staff access.
- Bookkeeping or tax work for an entity that is also an external-audit client must create an independence/conflict assessment. The system flags the relationship and requires a qualified professional's documented evaluation; it must not automatically assert that the audit is permitted or prohibited.
- No staff member may approve their own work where the workflow requires independent review.
- AI outputs are drafts with source references and reviewer disposition. AI must not sign, submit, certify, or make final professional decisions.
- Tax rules, official forms, and standards references must be dated, sourced, jurisdiction-specific, and reviewed by a qualified professional before being represented as current.
- Feasibility outputs must display assumptions, units, currency, forecast period, scenarios, and sensitivity ranges; do not present forecasts as guarantees.

## 5. Local and cloud operating modes

### Local-first
Keep the current encrypted local vault as the supported local data path until a database/repository migration is designed and tested. Do not silently move existing vault contents into a new schema. Export/import and restore must be versioned, validated, and covered by regression tests.

### Cloud
The existence of Supabase Auth is not proof that workspace sync is safe. Keep snapshot push/restore and member invitations disabled until all of these gates pass:

1. Firm-scoped authorization verified for every table, RPC, Edge Function, and Storage path.
2. Live staging tests using two independent firms, including negative cross-firm read/write attempts.
3. End-to-end encryption/key distribution/recovery design reviewed and tested.
4. Sync conflict behavior tested; no silent last-write-wins.
5. Backup/restore, retention/deletion, key-loss and schema-version drills documented.
6. External uploads remain blocked until malware scanning/quarantine and upload access controls exist.

Local and cloud records need stable IDs and explicit sync metadata. A conflict must be surfaced for review rather than silently overwritten. A successful login must never trigger an unannounced upload of local client records.

## 6. Subscription model to implement after entitlements are defined

Proposed commercial defaults (not validated market prices):

| Plan | Monthly price | Included seats | Trial |
|---|---:|---:|---:|
| Individual | JOD 19 | 1 | 14 days |
| Office | JOD 69 | 5 | 14 days |
| Office Plus | JOD 129 | 10 | 14 days |
| Enterprise | Contract | Contract-defined | By agreement |

Implement subscription state and entitlements as server-verified business rules, not as client-only UI flags. Define trial start/end, grace period, cancellation, renewal, seat limits, and module access before connecting payment processing. Expiry must not destroy or lock the user's ability to export their own data. Do not claim payments are integrated until a payment provider flow and webhook verification are implemented and tested.

## 7. Delivery sequence and acceptance gates

### Gate 0 — baseline (first)
- Inspect current main commit, repository tree, migrations, tests, package scripts, and latest CI runs.
- Capture the current successful baseline and list existing release blockers.
- Work on a dedicated feature branch; do not push experimental changes directly to `main`.

### Gate 1 — module registry and navigation
- Add a typed, stable service registry with translations, icon/label, feature state, and access policy.
- Integrate it into the existing application shell without replacing current audit/reconciliation behavior.
- Test all six navigation entries, RTL/LTR, keyboard access, and disabled/empty states.

### Gate 2 — shared client and service engagement
- Reuse existing client and engagement structures where safe; add service identity additively.
- Validate required fields and service-specific lifecycle transitions.
- Add independence/conflict assessment hooks at engagement acceptance.

### Gate 3 — first usable workflow for every service
- Deliver one bounded end-to-end workflow per service, with persistence appropriate to the currently supported storage mode.
- Use synthetic fixtures only; do not claim full compliance or production readiness.
- Add unit/integration tests for validation, authorization, and export/restore.

### Gate 4 — cloud security and subscriptions
- Complete tenant isolation, encryption/key management, sync, recovery, entitlements, and trial logic.
- Keep gated capabilities disabled until staging tests pass.

### Gate 5 — pilot and release
- Test with two synthetic firms and representative workflows across all six services.
- Run unit tests, TypeScript/production build, migration tests, dependency audit, authorization negative tests, backup/restore drills, accessibility, and professional review.
- Produce a Windows installer only from the exact commit that passed CI. Do not describe an unsigned installer as trusted/signed.

## 8. Definition of done

A service is not done until:
- Its end-to-end workflow persists and survives reload/backup/restore as supported.
- Input validation, errors, loading, empty, and disabled states work.
- Firm isolation and role tests include negative cases.
- Material actions are attributed to a verified identity in cloud mode; local identity limitations are disclosed.
- Arabic RTL and English LTR are checked.
- Exports are labeled draft until professional review.
- Tests and CI results are linked to the exact commit.
- Documentation states what is implemented, what is gated, and what remains unverified.

## 9. Explicit non-goals for the first implementation slice

- Do not rewrite the application from scratch.
- Do not enable live cloud sync, invitations, or external file uploads as a side effect of adding navigation.
- Do not add speculative tax rates or claim official Jordanian tax integration without current authoritative specifications.
- Do not generate or sign a final external auditor opinion automatically.
- Do not claim all six services are production-ready simply because they appear in the UI.
