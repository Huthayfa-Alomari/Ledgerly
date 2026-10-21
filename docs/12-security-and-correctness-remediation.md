# Security and correctness remediation notes

Date checked: 2026-10-21. This note describes code and migration changes in the review branch; it does not claim untested live behavior.

## Dependency and file-import security

- `pdfjs-dist` is pinned via lockfile to 6.4.299, which is newer than the patched version 6.2.108 identified in Mozilla's advisory for CVE-2026-16633. PDF import explicitly disables scripting, eval support and XFA; files over 50 MiB and PDFs over 500 pages are rejected. The trial-balance spreadsheet importer has its own 50 MiB and 250,000-row limits.
- `xlsx` now comes from the official SheetJS CDN package at version 0.20.3 because the public npm registry package was stale at 0.18.5.
- CI runs `npm audit --audit-level=high` before tests and the build. The current branch CI run passed install, audit, tests and build.
- Electron was moved from EOL 37.2.6 to 44.9.2, the latest stable line verified on 2026-10-21. Version 45 was not selected because it was still listed as prerelease at the time of verification.

## Financial precision

- The reconciliation engine rounds to JOD fils (0.001) and compares transaction amounts using integer fils, with a default tolerance of 0.001 JOD. This prevents a 0.004 JOD difference from being rounded into a false match.
- CSV parsing treats `0,004` as fils while preserving the common `1,234` thousands convention. When a number is ambiguous, users must verify locale/sign conventions.
- This is not yet a full domain-wide integer-money migration: imported and persisted values in some existing UI models remain JavaScript numbers. Do not treat this change as a comprehensive replacement of floating-point storage.

## Local data and project configuration

- Local persistence catches quota, storage-provider and JSON-serialization failures and shows an explicit warning. This prevents silent failure, but localStorage remains unencrypted and editable by a person with access to the app profile. Export backups regularly; do not call the local activity log tamper-proof.
- The bundled Supabase URL/key defaults were removed. Cloud sign-in/snapshot sync/evidence features remain disabled unless a build explicitly provides `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The public key is not a secret, but it must intentionally point to the right project.
- The AI prompt now uses real newline characters rather than literal backslash-n sequences.
- Reconciliation and the spreadsheet parser are loaded in separate chunks. Latest tested output: app JS ~340 kB, reconciliation chunk ~477 kB, spreadsheet chunk ~500 kB (raw sizes); PDF worker remains ~1.26 MB and is still a candidate for further optimization.

## Server-side audit controls

- Browser INSERT/UPDATE/DELETE to `public.change_log` is revoked. A server-side service-role writer must be used for authoritative change events; do not restore browser INSERT to the table to fix a UI permission error.
- A trigger rejects a change-log actor that does not correspond to the authenticated user, and stamps the event time for non-service database sessions. Service-role writes are trusted server-side operations and remain the appropriate path for authoritative log creation.
- A `working_paper` trigger protects review fields on both INSERT and UPDATE. It blocks final status on inserts without an authorized reviewer, prevents a preparer from signing off their own paper, locks signed-off content until it is reopened, and limits reviewer-only users to review fields.
- These SQL controls are included in `20261021110000_ledgerly_audit_log_and_workpaper_review_guard.sql` but have **not yet been applied to the live Supabase project**. They require peer review, staging application, and authenticated-role tests before production deployment.

## Migration integrity and remaining drift

- The duplicate `20261020110000` filename prefix was removed. The duplicate interim-gate file was deleted; the canonical `20261020104503_ledgerly_interim_firm_admin_write_gate.sql` remains. The bootstrap service-role migration filename was aligned to the live history version `20261020102903`.
- The three role/tenant migrations have now been renamed to their live history versions: `20261020140459` (role-by-table), `20261020140900` (scoped child-table policies), and `20261020141128` (firm-policy cleanup).
- CI checks unique numeric migration prefixes, checks these canonical filenames, and fails if the known duplicate/stale filenames return.
- **This is not a complete synchronization of every filename with the live migration history.** The repo still contains older local filenames whose timestamps differ from the live project list, and three live migration entries (`enable_rls_schema_version`, `split_role_write_policies`, and `ledgerly_expire_stale_invitations`) do not currently have an obvious one-to-one SQL file in the repo. Do not run `supabase db push` against production until a migration-by-migration diff/reconciliation is completed. Do not apply `db/supabase/security/202610190002_security_hardening.sql` manually: it is an archived intermediate overlay outside the migration chain and has not been approved as a fresh-install migration.

## Authorization scope and test limits

- The role helper intentionally grants office-wide access to users whose `role_assignment.scope_type = 'firm'`; a firm-scoped staff member can therefore read all engagements in that firm. Use engagement-scoped assignments when limiting staff to selected files. Changing this rule globally is a product authorization decision and still needs real test users.
- CI tests passed for the branch, but the staging integration tests requiring two separate firm/user identities remain skipped. The connected Supabase project currently has zero firm rows and zero app-user rows, so live cross-firm authorization has not been proven.
- The plan-gated Supabase leaked-password screening warning remains accepted without a paid upgrade. The client-side 12-character minimum is not a leaked-password check and must not be described as equivalent.
