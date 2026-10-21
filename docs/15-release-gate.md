# Ledgerly release gate

Status checked against `main` on 2026-10-21. This is a release-candidate checklist, not a claim that the product has passed every production acceptance requirement.

## Verified in repository CI

- `npm audit --audit-level=high` for the web application and desktop packaging dependencies.
- Node unit/regression tests and production TypeScript/Vite build.
- Full ordered SQL migration replay against a disposable PostgreSQL 16 database.
- Tenant-isolation, role, workpaper-review, evidence-scope and RLS tests within the simulated Supabase/PostgreSQL environment.
- Windows x64 NSIS installer build.
- Supabase live migration history currently contains all 23 migration versions represented by `db/supabase/migrations`.

## Current technical behavior

- Local-first mode stores workspace data in browser LocalStorage. It is not application-encrypted and the local activity log is not tamper-proof.
- If loading stored data fails, persistence is gated to avoid overwriting it with an empty database.
- If a save fails, the UI now offers export of the latest in-memory state and an explicit retry. Export the current in-memory snapshot immediately before closing the app.
- Cloud workspace snapshot sync is manual/explicit and version-checked; it is not real-time record-level collaboration.
- Cloud evidence uses a private bucket and firm/engagement scope controls. Malware scanning, retention automation and a disaster-recovery drill are not claimed complete.
- Amounts are normalized and calculated at integer-fils boundaries, but the persisted JSON model is not yet a fully versioned integer-fils schema. Do not claim all persisted amounts have been migrated to minor-unit integers.

- Trial-balance import uses a strict JOD parser: it preserves the decimal point and Arabic decimal separator, supports three-decimal fils and parenthesized negatives, and flags malformed nonblank amounts rather than silently converting them to zero.
- Invitations remain gated until real-account isolation checks are completed.

## Required before real client data or general commercial launch

1. Configure a dedicated staging Supabase project, not production, and set the allowlisted bootstrap email through Supabase Edge Function secrets. Never commit service-role credentials.
2. Create two separate test firms and confirmed users, with distinct role assignments. Exercise cross-firm reads/writes and object upload/download through the actual Supabase Data API and Storage endpoints. The current SQL replay tests simulate Supabase primitives and do not replace this live staging check.
3. Test evidence upload/download, SHA-256 verification, metadata failure cleanup, file-size/MIME rejection, and cross-engagement authorization.
4. Run a backup/restore drill on a disposable workspace; verify that a failed export or failed browser download does not cause operators to believe data is safely backed up.
5. Test real bank statement and ledger files from multiple banks, including Arabic/English headers, duplicate dates/amounts, reversed signs, one-to-many candidates, malformed PDFs and large workbooks. Manually reconcile expected outputs.
6. Complete independent security review/penetration test, accessibility review (Arabic RTL and English LTR), and audit-professional review of workpaper templates and reporting requirements.
7. Decide and document retention, encryption-at-rest/device policy, support/incident response, update/signing strategy for the Windows installer, and privacy terms.
8. Only after the above gates pass, enable member invitations and publish a versioned GitHub release. Do not publish a production-ready claim based solely on CI or a successful installer build.

## Known external dependency

The live Supabase project reports leaked-password protection disabled. The current Supabase plan does not expose this control; do not claim compromised-password screening is active. Keep the client-side password-length rule and document the residual risk until the feature is enabled on a supported plan.

## Installer

The current Windows workflow produces an x64 NSIS installer as a temporary GitHub Actions artifact (30-day retention). A tagged release `ledgerly-v*` publishes the installer to GitHub Releases. The current artifact is not code-signed; Windows SmartScreen may display an unknown-publisher warning.
