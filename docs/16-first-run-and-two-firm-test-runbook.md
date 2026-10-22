# Ledgerly first-run and two-firm acceptance runbook

Last reviewed: 2026-10-22

## Current connected-project facts

- Supabase project: `delvbdvjdmcblqiqaxsd` (currently named `Bank-Reconciliation-Pro`).
- The migration ledger contains 23 entries through `20261021155218_ledgerly_consolidate_workpaper_update_policy`.
- The Edge Functions `ledgerly-bootstrap-first-firm` and `ledgerly-invite-member` are deployed and active.
- The live project currently has zero firms and zero application-user memberships. This means the first-firm setup has not been completed.
- The invitation function is intentionally gated. Do not enable invitations before the live two-firm isolation tests pass.
- A single connected project is not a staging environment. Do not seed synthetic acceptance-test firms into the connected project unless the owner explicitly designates it as disposable staging.

## Configure the official app build

1. In GitHub repository settings, create repository **Variables** (not secrets) for:
   - `VITE_SUPABASE_URL` = the project's API URL.
   - `VITE_SUPABASE_ANON_KEY` = the browser-safe publishable/anon key.
2. Never place `service_role`, `sb_secret_`, database passwords, or function secrets in Vite variables or source control.
3. Set the Edge Function secret `LEDGERLY_BOOTSTRAP_EMAIL` to the confirmed owner email. It must match a confirmed Supabase Auth account exactly after lowercase normalization.
4. Keep `LEDGERLY_INVITATIONS_ENABLED` unset until staging tenant-isolation acceptance passes.
5. Configure Auth email confirmation and an HTTPS Site URL/redirect allowlist before inviting real team members.
6. Trigger the Windows installer workflow and verify all CI jobs pass before distributing the artifact.

## First-office smoke test

1. Create an owner account through Ledgerly with a unique passphrase of at least 12 characters.
2. Confirm the email through Supabase Auth.
3. Sign in and enter the same owner email that is configured in `LEDGERLY_BOOTSTRAP_EMAIL`.
4. Choose a firm name and display name, then run **تهيئة المكتب الأول**.
5. Confirm the app refreshes the workspace membership automatically, without a manual page reload.
6. Confirm the firm snapshot is initially absent and the app does not upload local clients or workpapers just because sign-in succeeded.
7. Export a local JSON backup before any cloud pull/restore. Use synthetic records for this test.

## Two-firm acceptance test (staging only)

Create two distinct firms and at least two confirmed users in each firm. Use synthetic records only:

- Firm ELITE: E-01 شركة السهل للتجارة العامة; E-02 شركة رواسي للمقاولات.
- Firm MITHAQ: M-01 شركة الندى للصناعات الغذائية; M-02 شركة المحور للخدمات اللوجستية.
- Financial year-end: 2025-12-31; currency: JOD.

Verify using actual signed-in sessions, not service-role requests from the browser:

- Firm A cannot read or mutate Firm B's workspace snapshot.
- Firm A cannot read Firm B's evidence metadata or download its Storage objects.
- A staff member cannot overwrite the full-firm snapshot if their role does not grant that permission.
- An engagement-scoped member cannot access unassigned engagements or their child records.
- Cross-firm IDs cannot be supplied to bypass client, fiscal-year, engagement, or evidence scoping.
- A stale snapshot version is rejected; it must never silently overwrite a newer version.
- Evidence download recomputes SHA-256 and rejects a mismatch.
- Sign-off/review rules prevent self-review and editing a signed-off workpaper without a valid reopen workflow.
- Local-only data remains local until the operator chooses to synchronize it explicitly.

Record each result, request/response status, role, and expected denial. Do not use real client data or production credentials in automated tests.

## Release decision

The app is **not cleared for unrestricted commercial use with real audit-client data** until all of the following have evidence:

- CI: dependency audit, tests, production build, ordered migration replay/RLS tests, and Windows packaging all pass on the candidate commit.
- Live staging: the two-firm and multi-role API/Storage tests pass.
- Operations: backup/restore drill, evidence retention/cleanup, and recovery procedures are verified.
- Professional review: audit methodology, reporting templates, independence, review and sign-off flows are approved by qualified audit professionals.
- Security review: independent application review, device/data protection policy, incident response, and release-signing/update plan are approved.

This runbook is an execution checklist, not evidence that these tests have already passed.
