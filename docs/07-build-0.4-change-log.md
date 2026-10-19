# Build 0.4 — Change Log and Acceptance Notes

## Changes
1. Added a browser-local activity log capped at 2,000 events and a CSV export from Settings.
2. Persisted completion checklist state in the same local data store and included it in backups.
3. Preserved compatibility with older backups that do not contain `auditLog` or `completionChecks`.
4. Trial-balance import rejects duplicate non-empty account codes before replacing the current engagement's rows.
5. Improved header matching so movement debit/credit detection avoids opening and closing debit/credit columns.
6. Parenthesized accounting amounts such as `(125.50)` are parsed as negative values.
7. Import notice includes the movement debit-credit difference.

## Verification performed
- Existing Node test suite: 19 passed, 0 failed.
- TypeScript transpile-only syntax validation for both TSX files: passed.
- `db/schema.sql` executed using Python sqlite3: 24 tables created.
- Full dependency-backed TypeScript check and Vite build: not verified because `npm ci` did not complete in the build environment.

## Release blockers
- Deploy and test Supabase migration against a dedicated project, including tenant isolation tests across at least two firms.
- Implement server-enforced authentication and roles; current browser-local data is not a multi-user system.
- Add secure evidence upload/storage and authorization.
- Run full dependency audit, production build, browser acceptance tests, backup/restore drill, and security review.
- Obtain professional review of methodology and reports before real engagement use.
