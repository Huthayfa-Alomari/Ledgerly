# Ledgerly — External Audit Practice Platform

Ledgerly is an Arabic/English audit-practice application for small and mid-sized external-audit teams. It is the continuation of the existing project, not a parallel rewrite. The Windows desktop build packages the existing web application with Electron.

## Current modules

- Client register, engagement intake, scope and dates, planning risks, and engagement status.
- Trial-balance import and trust checks, account mapping, journal full-population screening, and risk-based prioritization.
- Digital workpapers, indexed evidence references, findings, review notes, source-to-evidence lineage, and administrative closure checks.
- Sampling tools, supplier-invoice register matching, document-request tracking, office time and fee records, draft reporting, and bank reconciliation.
- Local JSON backup/recovery, a password-protected encrypted local vault, and optional Supabase sign-in.

The modules help organize audit work. They do not replace an audit firm's approved methodology, professional judgment, evidence evaluation, or the partner's approval.

## Financial data and import rules

- JOD is represented to three decimal places. Ambiguous number strings such as `1,5`, `1.234,567`, or values with unknown suffixes are rejected instead of guessed; source row/field warnings should be resolved before relying on a result.
- Missing source columns must not be interpreted as verified zeroes. Review source mappings, signs, dates, control totals, and the population's completeness.
- Reconciliation matches and journal-screening exceptions are suggestions for investigation, not proof of error or fraud. Matching does not post accounting entries.
- Bank reconciliation supports CSV, XLS/XLSX and PDF input. Scanned PDF OCR may not reconstruct financial columns reliably; verify extracted values against the source.
- The import layer enforces resource bounds for file size, rows, columns, spreadsheet cells, PDF pages and OCR pixels.

## Local storage and privacy

- After vault unlock, the local workspace is stored in the encrypted local vault. The passphrase is not stored by Ledgerly; losing it may mean permanent loss of access. Keep a separate encrypted backup in a safe location.
- Financial-file parsing happens locally. The audit hash chain is local and tamper-evident only; it is not a server-authoritative immutable audit log.
- Do not treat browser storage or local reviewer labels as verified identity or non-repudiation.
- Supabase connection is optional and only configured through public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` values. Never place a service-role or secret key in client-side configuration.

## Cloud and production release gates

**Do not use real client files or enable broader cloud sync/member invitations until the release gates are completed.** The current application intentionally keeps workspace cloud snapshot sync blocked in the UI. End-to-end encryption and key recovery, live two-firm isolation, backup/restore drills, retention/deletion checks, server-side audit logging, upload safety and independent security review are still release requirements. There is no external client upload portal.

See [RELEASE_READINESS.md](RELEASE_READINESS.md) for the gate list and verification limits. Passing CI does not complete the live multi-firm test, a disaster-recovery drill, or an independent penetration test.

## Development

Requirements: Node.js 22 and npm.

```bash
npm ci
npm audit --audit-level=high
npm test
npm run build
```

To create a Windows installer on Windows:

```powershell
cd desktop
npm ci
npm audit --audit-level=high
npm run dist
```

The Windows installer workflow runs in GitHub Actions. Use the workflow artifact for test builds; a version tag such as `ledgerly-v1.0.0` publishes a GitHub Release only after the build job passes. Unsigned installers may trigger operating-system or browser reputation warnings. A SHA-256 manifest confirms file integrity, not that a file is safe.

## Sample reconciliation acceptance test

1. Import `samples/sample-bank-statement.csv` and assign it as the bank statement.
2. Import `samples/sample-ledger.csv` and assign it as the general ledger.
3. Confirm the opening-balance row is not treated as a transaction.
4. Run matching with a zero-day date window. The fixtures should produce three suggested matches, no unmatched transactions, and no ambiguous cases.
5. Inspect each match manually; nothing is posted automatically.

## Demo data

Use **تحميل بيانات تجريبية** in the dashboard for synthetic records. Demo data is fictional and must never be confused with client records.

## Project history

Historical milestones and early prototype notes are in [CHANGELOG.md](CHANGELOG.md). The UI, local persistence, schemas, and cloud capabilities have evolved since early Build 0.x notes; use the current code and release-readiness document rather than treating historic build descriptions as current behavior.
