# Build 0.3 — scope and acceptance status

## Implemented in this build
- Single application shell and module navigation.
- Client register with acceptance/continuance and independence tracking fields.
- Engagement register linked to clients and financial years.
- Risk register and risk response fields.
- CSV/XLS/XLSX trial-balance import, row listing, arithmetic debit/credit comparison, CSV export.
- Working-paper index with preparer/reviewer and workflow status.
- Evidence metadata index and linkage fields (no binary upload yet).
- Findings register with criteria, condition, effect, recommendation, severity, and follow-up status.
- Completion checklist UI, engagement summary, JSON backup export/restore, CSV report, and existing bank reconciliation module.
- Supabase/PostgreSQL migration draft with tenant-level RLS policies.

## Acceptance status

| Area | Status | Remaining acceptance work |
|---|---|---|
| Reconciliation core | 19 automated tests pass | Browser end-to-end acceptance and more transaction edge cases |
| TSX syntax | Passed transpilation syntax check | Full `tsc -b` and production Vite build with installed dependencies |
| Client/engagement UI | Implemented locally | Component tests, validation tests, persistence/restore tests |
| Trial-balance import | Implemented locally | Tests for real client exports, duplicate headers, negative values, totals, and mapping review |
| Workpapers/findings/evidence index | Implemented locally | Workflow tests, audit trail, review authorization, evidence file storage |
| SQLite schema | Executes in Python sqlite3; 24 tables | Migration tests and local repository/data access layer |
| Supabase migration | Draft generated | Apply to a dedicated project; verify RLS across two firms and all CRUD paths |
| Production security | Not ready | Auth, role enforcement, encrypted evidence storage, immutable audit trail, backup/restore drills, dependency audit, penetration test |

## Release gate

Do not call this a production-ready external audit system until all tests above are complete, professional requirements have been reviewed, and security and legal/compliance review are complete. The app must not auto-generate or sign an audit opinion.
