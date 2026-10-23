# Ledgerly Firm Onboarding and Two-Office Acceptance Plan

## Purpose
Make the existing Ledgerly repository usable as a multi-firm external-audit workspace without replacing the existing local audit modules or enabling unsafe cross-firm access.

## Current observed behavior
- Browser-safe Supabase configuration is read from Vite environment variables. When absent, cloud auth is not configured.
- CloudAuthPanel supports login and signup, but cloud setup is not currently a clear first-run gate.
- Signup asks for a firm name; a successful Auth signup alone must not be treated as a fully provisioned firm.
- CloudWorkspacePanel resolves the firm through public.app_user and expects exactly one active firm membership.
- Clients and engagements are currently held in the local application DB unless explicitly synchronized.
- The Supabase database already has firm, app_user, role_assignment, client, fiscal_year, engagement and workspace/evidence tables. Do not recreate these tables blindly.

## Required implementation order
1. First-run gate: when Supabase config is missing, show a clear setup screen with exact VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY instructions and never imply that cloud login is available. Never ship a service-role key to the browser.
2. Auth gate: when configured and there is no valid session, show login/signup before entering the cloud workspace. Provide sign-out and session-expiry handling.
3. Atomic onboarding: create a trusted server-side/database RPC for first-firm provisioning. It must use auth.uid(), create the firm, create the app_user record, and assign firm_admin/managing_partner in one transaction. It must not accept an arbitrary owner user ID from the client. Restrict first-firm bootstrap so an authenticated user cannot create an unlimited number of privileged firms through the bootstrap path. Handle Supabase email-confirmation flows where signup returns no active session.
4. Firm workspace: show the active firm identity and a clear onboarding checklist. If the user has no membership, show a safe onboarding/recovery state rather than a generic error.
5. Client and engagement management: persist records to the existing normalized tables or implement a carefully versioned, validated firm-scoped repository adapter. Do not silently mix local data and normalized cloud records. Engagement creation must validate that its client and fiscal year belong to the same firm.
6. Security: review RLS on all tables and Storage objects; enforce firm scope server-side. Users must not be able to alter firm_id or role assignments to gain access to another firm. Invite/role assignment must be restricted to authorized firm administrators and use a trusted server-side path.
7. Migration and recovery: preserve existing local records, provide explicit export/backup before import, and make import idempotent. Do not auto-upload local client data merely because a user signs in.
8. Test: create separate test identities and synthetic records for ELITE and MITHAQ in staging only. Verify both positive and negative access cases across reads, inserts, updates, deletes, evidence uploads, and downloads.

## Acceptance checklist
- [ ] Missing config shows actionable setup, not a broken or misleading login.
- [ ] Login, logout, expired-session handling, and email-confirmation flow work.
- [ ] First firm and first administrator are provisioned atomically and safely.
- [ ] Client, fiscal-year, and engagement CRUD persists across refresh and devices.
- [ ] Engagements cannot reference a client or fiscal year from another firm.
- [ ] ELITE cannot read or mutate MITHAQ data and vice versa, including evidence storage.
- [ ] Local-only data is not overwritten or uploaded without explicit user confirmation.
- [ ] Import/export backups and audit logs are tested.
- [ ] Unit tests, type checks, build, and staging integration tests pass.

## Two-office test data
Use the supplied synthetic pack only after the application and tenant provisioning are ready:
- ELITE: E-01, E-02
- MITHAQ: M-01, M-02
Never seed synthetic records into production or infer a test pass from expected-value spreadsheets alone.

## Release policy
Do not merge this work or describe the product as production-ready until tests have been run against the actual code and staging database. A pull request and documentation are not substitutes for a verified implementation.
