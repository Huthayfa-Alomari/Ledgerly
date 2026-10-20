# Ledgerly — External Audit Practice Platform

Ledgerly is a bilingual Arabic/English external-audit practice platform, packaged as a Windows desktop application. It includes client and engagement workflows, planning and risks, trial-balance review, working papers, evidence indexing, findings, reporting, and bank reconciliation.

## Strategic direction (approved) — Audit Practice Platform

This project is being developed incrementally into **Audit Practice Platform**: a local-first + optional-cloud platform for audit firms to manage clients, engagements, data analysis, audit evidence, working-paper review, and engagement outputs — with the existing bank reconciliation engine as its first analytical module. No rewrite, no parallel project.

- **Design documents (approved, precede any data wiring):** [`docs/`](docs/README.md) — architecture & current-state review, entity model, database design, permissions, ISA standards mapping.
- **Local schema reference:** [`db/schema.sql`](db/schema.sql) — SQLite-oriented DDL for local persistence design. **Do not execute this file directly on PostgreSQL** because it includes SQLite-specific syntax. The initial Supabase/PostgreSQL migration is [`db/supabase/migrations/202610190001_initial_audit_platform.sql`](db/supabase/migrations/202610190001_initial_audit_platform.sql), with tenant-level RLS guidance in [`db/supabase/README.md`](db/supabase/README.md).
- **Engineering decisions that bind all future code:** engagement file as the aggregate root (`firm → client → engagement`), client-generated UUIDv7, immutable evidence & change log, conservative matching never auto-commits (see `docs/01-architecture.md` §5).
- **Open dependency work before next stage:** two high-severity audit findings are tracked in `docs/01-architecture.md` §2.4 (KI-1 SheetJS supply source, KI-2 pdfjs-dist upgrade with regression tests).

## Audit platform modules — current prototype

The current UI now includes an application shell and initial local workflows for:
- Client register, basic contact/tax fields, acceptance status, and independence-check tracking.
- Engagement files linked to a client and fiscal year, with framework, task type, status, and planning materiality field.
- Risk register with likelihood, impact, area, and planned response.
- Trial-balance import from CSV/XLS/XLSX, account rows, debit/credit totals, CSV export, and a basic arithmetic balance check.
- Working-paper register with preparer/reviewer fields and review status.
- Evidence index metadata, linked references, findings/recommendations, and completion checklists.
- Dashboard, CSV/JSON export, local JSON backup restore, and bank reconciliation.

**These workflows currently persist in browser LocalStorage, not in the SQL schema.** The Supabase migration is a database foundation and is not yet connected to the UI. Evidence records index references only; they do not upload or encrypt evidence files. Checklists are workflow aids, not proof of compliance.

## What works in the reconciliation module
- Local CSV, XLSX/XLS and PDF import, with manual column mapping and row preview.
- Arabic/Persian digit normalization, common amount/date parsing, and validation warnings.
- Column auto-detection avoids fuzzy-matching blank or very short headers; the UI lets the user re-run detection and manually adjust the mapping.
- Opening/beginning balance rows are identified when the row has a balance but no movement amount, excluded from transaction matching, and not flagged as missing debit/credit.
- Assign imported rows as either a bank statement or a general ledger.
- Conservative one-to-one matching based on signed amount, date window, and normalized description; if description differs, a unique amount/date candidate may be suggested.
- Ambiguous duplicates are not automatically matched; unmatched rows and ambiguity counts are shown.
- Arabic and English UI.

## Important accounting limitations
- This is a prototype, not an audited accounting product. Review every suggested match before relying on it.
- Both imported sources must use compatible debit/credit sign conventions. A bank's displayed debit/credit semantics may differ from the ledger's semantics; verify sample rows before running matching.
- Current matching supports one-to-one transactions only. It does not yet handle grouped deposits, split payments, bank fees netted against transfers, foreign-exchange differences, reversals, or configurable bank-specific rules.
- A date window is user-controlled. A wider window increases false-positive risk.
- PDF table extraction is best-effort. Scanned PDF OCR extracts text lines but does not reliably reconstruct financial columns; visually verify the source.
- No journal entries are posted and no match is silently committed as an accounting fact.

## Privacy
- Files are processed in the browser; there is no app backend, analytics, or file-upload endpoint.
- XLSX/CSV parsing uses SheetJS locally and PDF text extraction uses PDF.js locally.
- Tesseract.js OCR may fetch language data on first use. For strictly offline operation, bundle the Arabic/English OCR language data locally and configure Tesseract's worker/core/lang paths.
- Avoid production bank data until the product is reviewed and tested in your environment.

## Requirements
- Node.js 20.19+ or 22.12+
- npm

## Run for development
```bash
npm ci
npm run dev
```

## Windows desktop application
The Windows desktop shell uses Electron with Node integration disabled, context isolation enabled, and sandboxing enabled. The app remains local-first. The bundled public Supabase project URL/publishable key enable the optional sign-in UI in the Windows build; audit-data cloud sync and evidence upload remain disabled.

To build a Windows installer on a Windows machine:
```powershell
npm ci
npm test
npm run build
cd desktop
npm install
npm run dist
```
The installer is written to `desktop/release/`. In GitHub, run **Actions → Ledgerly Windows Installer → Run workflow** to build a Windows installer artifact, or push a tag such as `ledgerly-v1.0.0` to trigger the workflow. The installer artifact is currently x64 Windows.

User data is kept in the Electron app's user-data directory and is not deleted by the uninstaller. Before replacing an existing browser-only installation, export a JSON backup from the current browser app and keep it safely; browser LocalStorage does not automatically transfer into the Windows app.

## Checks
```bash
npm test
npm run build
```

The current regression suite covers the reconciliation core, engagement workflows, workpaper history, schema safeguards, and the UI refresh/demo-data affordance. A successful test run does not replace a production build and a browser-level acceptance test.

## Test workflow
1. Import `samples/sample-bank-statement.csv`, verify the detected columns, and choose **Use as bank statement / اعتماد ككشف بنك**.
2. Import `samples/sample-ledger.csv`, verify the detected columns, and choose **Use as ledger / اعتماد كدفتر أستاذ**.
3. Confirm the opening-balance row is labelled as a balance rather than a transaction.
4. Run matching with a 0-day date window. The sample should produce 3 suggested matches, 0 unmatched bank transactions, 0 unmatched ledger transactions, and 0 ambiguous cases.
5. Inspect all suggestions manually; matching is advisory and does not post journal entries.

## Product identity and Windows packaging
- Product name is **Ledgerly** across the app title and Windows installer.
- The existing web application is packaged into a Windows desktop shell; this is not a rewrite and retains the current local-first data model.
- Windows installer creation is automated with GitHub Actions. The installer must pass the Windows build workflow before it is treated as a verified release.

## Patch notes (2026-10-18)
- Fixed fuzzy header detection so blank/short headers cannot accidentally map to financial fields.
- Fixed the controlled mapping selector to consistently use string option values and added a manual **Re-detect columns** action.
- Fixed the import-acceptance guard to treat column index `0` as a valid mapping.
- Opening/beginning balance rows with a balance and no movement amount are identified and excluded from matching counts.
- Added regression tests for the above and an integrated sample reconciliation; all 19 automated tests pass in the patch workspace.
- The package build could not be verified in this workspace because dependency installation could not complete (npm registry DNS/network error), leaving TypeScript/React type packages missing. Run `npm ci` and `npm run build` on a network-connected machine before deployment.
- The previously reported dependency audit findings are not silently treated as resolved; review `npm audit` and the tracked dependency notes before using real client/bank data.


## Build 0.3 verification status
- `npm test`: 19/19 core tests pass in the current workspace.
- TypeScript/TSX transpilation syntax check: passed for `App.tsx`, `Reconciliation.tsx`, and `main.tsx`.
- `npm run build`: **not verified** in this workspace because dependency installation from the npm registry timed out and local type packages are incomplete. Re-run `npm ci` and `npm run build` on a network-connected machine.
- Supabase migration: generated but not applied to a real project; SQL execution, RLS behavior, and cross-tenant isolation still require integration testing.

## Build 0.4 — workflow hardening

This build continues the existing project and adds:
- A local activity log for key record creation, trial-balance imports, checklist updates, and backup restore events. The log is browser-local and is not tamper-proof.
- Persistent engagement completion checklist state, included in JSON backups and restored from older backups with safe defaults.
- Trial-balance import guard against duplicate non-empty account codes before replacing the current engagement's imported balances.
- More careful debit/credit header matching to avoid selecting opening/closing balance columns as movement columns.
- Accounting-style parenthesized negative amount parsing and an explicit trial-balance import difference notice.
- Backward-compatible migration of local browser data when new fields are introduced.

### Validation status for Build 0.4
- `node --test`: 19/19 tests pass.
- TypeScript TSX transpilation syntax check: passed for `src/App.tsx` and `src/Reconciliation.tsx`.
- SQLite schema execution: passed; 24 tables created in an in-memory test database.
- Full `tsc -b` / Vite production build: not verified in this environment because package installation did not complete. Run `npm ci`, `npm test`, and `npm run build` locally before accepting this build.

### Known non-production limitations
- UI records remain in browser LocalStorage; there is no deployed authentication, server-enforced role model, or live cloud sync.
- Evidence is metadata-only; binary upload, encryption-at-rest configuration, and controlled access are not implemented.
- Local activity log can be modified or deleted by anyone with browser access and must not be treated as a compliant immutable audit trail.
- Professional audit judgments and final audit opinions require qualified human review.

### Build 0.5 — security hardening draft

See `docs/08-build-0.5-security-hardening.md` and `db/supabase/security/README.md`. A hardening SQL overlay is included but is **not applied to any Supabase project**. Production cloud mode remains blocked on a dedicated test project, formal migration review, real Auth integration, role/action-specific RLS, secure evidence storage, and cross-firm integration tests.

## Extended audit suite scope (Build 0.6 planning foundation)
The full product scope for engagement acceptance/independence, digital workpapers, analytics and sampling, PBC portal, time/billing, quality, AI advisory, governance communications, knowledge base and small-firm plans is documented in `docs/08-product-scope-and-delivery-roadmap.md`. The additive PostgreSQL/Supabase schema foundation is `db/supabase/migrations/202610190003_extended_audit_suite.sql`.

**Important:** Build 0.6 scope/schema foundation is not a claim that all modules are implemented in the current UI. Migration 0003 has not been applied to a live database. Apply only after reviewing all migrations on a dedicated staging Supabase project. Never reuse another product's database. AI outputs remain advisory and require documented human review.

## Build 0.7 — Engagement intake improvements

The engagement creation form now captures engagement scope, planned start/end dates, agreed fee in JOD, team members, independence/declaration status, and conflict-check status. The form rejects an end date earlier than the start date and shows these details in the engagement register. Legacy saved records remain readable because the new fields are optional. These are local administrative fields only: the status is not a cryptographic e-signature, does not establish professional independence, and is not a substitute for an engagement acceptance procedure. LocalStorage remains the persistence layer in this build.

Verification: `node --test` passes 29 tests. A production TypeScript/Vite build was not verified because dependency installation timed out in the current environment.

## Build 0.8 — Digital workpaper workflow

Digital workpaper creation now captures procedure steps, conclusion, and audit tickmarks. Status transitions and reviewer-note changes append local version-history entries and local activity events. The register exposes version history for review. Existing records without these optional fields continue to render.

**Limitations:** this is browser-local traceability, not a tamper-proof audit trail; reviewer identity is a local label, not authenticated identity; no evidence binaries are uploaded or permissioned; the workflow is not a substitute for the audit firm's approved methodology. Cloud persistence and server-enforced immutability remain pending a dedicated Supabase project and reviewed migrations.

Verification: `node --test` passes 33 tests. A production build remains unverified because dependency installation was interrupted by an environment timeout; do not treat this as a release candidate until `npm ci` and `npm run build` succeed in the user's development environment.


## Supabase project status

The dedicated Supabase project has been created. See [docs/09-supabase-live-project.md](docs/09-supabase-live-project.md) for the project reference, applied live schema, security gate, and remaining integration work. Optional Supabase email/password authentication and first-firm onboarding are implemented. Audit-record synchronization and evidence upload are still disabled; do not replay the earlier draft SQL migrations against the live project without reconciling them first.


## Build 1.0 — UI/UX refresh (2026-10-19)

- Refined the existing Arabic-first audit workspace with a consistent spacing, color, typography, card, form, table, and status-token system.
- Improved the dashboard hierarchy, active navigation, engagement selector, quick actions, hover/focus states, and mobile navigation (horizontal scrollable module rail).
- Added reduced-motion support and clearer keyboard focus indicators.
- Added an explicit demo-data action for empty workspaces. It creates synthetic client, engagement, risk, workpaper, evidence-index, finding, and balanced trial-balance records; it refuses to seed when key records already exist, and clearly warns that the records are fictional.
- Kept the current project and workflows; no parallel app was created.
- `npm test`: 36/36 tests pass in this package.
- `npm run build`: not verified because `npm ci` timed out in this execution environment and local TypeScript/Vite binaries were not available. Run install/build on a network-connected machine before deployment.
- Supabase remains a separate live database foundation; the UI still uses browser LocalStorage. The UI refresh does not claim cloud sync, login, or secure evidence uploads are complete.

## بيانات تجريبية

من لوحة المتابعة اضغط «تحميل بيانات تجريبية». الزر متاح حتى لو كانت لديك سجلات محلية، ويضيف سجلات تدريبية دون حذف البيانات الموجودة. إذا كانت بيانات التدريب موجودة مسبقًا، ستظهر رسالة بذلك بدل تكرارها. هذه السجلات وهمية وليست ملفات عميل حقيقية.

ملفات CSV لاختبار المطابقة البنكية موجودة داخل مجلد `samples/`: `sample-bank-statement.csv` و`sample-ledger.csv`.


## Optional cloud sign-in and first-firm setup

- The browser-safe Supabase project URL and publishable key are included as public client configuration so the packaged Windows app can show sign-up/sign-in without build-time secrets. They are not service-role credentials; RLS remains the data access boundary.
- You can override the defaults for a staging project with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Never use a `service_role` or `sb_secret_` key in the app.
- First-firm initialization is restricted to a verified owner email. Configure the Supabase Edge Function secret `LEDGERLY_BOOTSTRAP_EMAIL` as documented in [the live project notes](docs/09-supabase-live-project.md) before using the button.
- Authentication does **not** synchronize the app's local clients, engagements, working papers, trial balances, or evidence. Cloud sync must be implemented and tenant-isolation tested before multiple users rely on shared audit records.
