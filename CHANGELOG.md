# Ledgerly Changelog

This file summarizes historical milestones. Current capabilities and release restrictions are documented in `README.md` and `RELEASE_READINESS.md`.

## 1.0 — UI/UX refresh (2026-10-19)

- Refreshed the Arabic-first audit workspace with consistent spacing, color, typography, forms, tables, and status tokens.
- Improved the dashboard hierarchy, active navigation, engagement selector, quick actions, focus states, reduced-motion support, and mobile navigation.
- Added a clearly labelled synthetic demo-data action that does not overwrite existing records.

## 0.8 — Digital workpaper workflow

- Added procedure steps, conclusions, audit tickmarks, workpaper status transitions, version history, and reviewer-note activity events.
- Kept local traceability distinct from a server-authoritative immutable audit log. Reviewer names in local mode are not verified identities.

## 0.7 — Engagement intake

- Added engagement scope, planned dates, agreed fees in JOD, team members, independence/declaration status, and conflict-check status.
- Added validation preventing an end date earlier than a start date.
- These fields record workflow information; they do not establish professional independence or an authenticated electronic signature.

## 0.6 — Extended audit suite foundation

- Documented the planned scope for engagement acceptance, digital workpapers, analytics and sampling, client-document requests, time and billing, quality, AI advisory, and small-firm workflows.
- Added an additive PostgreSQL/Supabase schema foundation. A schema foundation does not by itself mean a module is deployed or production-ready.

## 0.5 — Security-hardening draft

- Introduced a security-hardening design and a preliminary SQL overlay for review.
- Cloud production remains subject to reviewed migrations, live authorization tests, end-to-end key management, evidence security, backup and recovery exercises, and independent review.

## 0.4 — Workflow hardening

- Added a local activity log for key record creation, trial-balance imports, checklist changes, and backup restoration.
- Persisted engagement checklist state in JSON backups with backwards-compatible defaults.
- Added duplicate account-code checks before replacing a trial-balance import.
- Improved debit/credit column detection and parenthesized negative amount parsing.
- Added explicit trial-balance difference notices and local data recovery controls.

## 0.3 — Reconciliation prototype

- Added local CSV/XLS/XLSX/PDF imports, manual column mapping, preview, Arabic/Persian digit normalization, common date and amount parsing, and validation warnings.
- Added conservative one-to-one bank-to-ledger matching with amount/date/description checks and ambiguity reporting.
- Identified opening-balance rows so they are not treated as ordinary transactions.
- The early prototype had gaps in grouped deposits, split payments, bank-specific rules, FX differences, and scanned-PDF table reconstruction. Review all suggested matches; matching is advisory and does not post journal entries.

## 2026-10-18 — Reconciliation fixes

- Prevented blank or short spreadsheet headers from being fuzzy-matched to financial fields.
- Added a manual column re-detection action and fixed the column-index-zero import guard.
- Excluded opening-balance rows from transaction counts and matching.
- Added regression cases around column mapping and sample reconciliation.

## Historical validation notes

Earlier development workspaces occasionally could not run a production build because package installation or type dependencies were unavailable in those environments. Those statements describe historical workspaces, not current CI status. The current status should be taken from the latest GitHub Actions run, not from these historical notes.

Older prototype records used browser-local persistence and local reviewer labels. The current release gates remain authoritative: do not use live client data or enable broader cloud sync or member invitations until the gates in `RELEASE_READINESS.md` are completed.
