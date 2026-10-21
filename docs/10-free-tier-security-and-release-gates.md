# Ledgerly — Free-tier security baseline and release gates

Updated: 2026-10-21

## Decision: do not upgrade solely for leaked-password detection

The current Supabase Free plan does not include Supabase Auth's leaked-password protection. Keep the project on the current plan for now. This is a documented residual risk, not a reason to block all local-first development.

Official reference: https://supabase.com/docs/guides/auth/password-security

## No-cost mitigations

1. The Ledgerly signup UI requires at least 12 characters. Prefer a unique passphrase not reused on other services.
2. Configure the available Auth password minimum to at least 12 characters in Supabase Auth settings if the setting is available on the current plan. Client-side validation alone can be bypassed; server-side Auth configuration is authoritative.
3. Keep email confirmation enabled for public signup if the intended registration policy requires it.
4. Keep first-firm bootstrap protected by the confirmed owner email allowlist secret `LEDGERLY_BOOTSTRAP_EMAIL`.
5. Keep `LEDGERLY_INVITATIONS_ENABLED` unset until role/scope integration tests pass.
6. Never expose the service-role key in the browser or commit secrets to Git.
7. Treat the Security Advisor leaked-password warning as an accepted limitation until upgrading or adopting a separately reviewed password-screening design.

## Cloud readiness gates

- The app is still local-first; private evidence upload and cloud sync are not verified end-to-end.
- The live database has role-by-table and child-scope RLS migrations. Repository migrations exist under `db/supabase/migrations`, but their version timestamps differ from the live migration history. Reconcile history carefully; do not replay a duplicate migration onto production.
- Before enabling multi-user cloud work, run authenticated integration tests with at least two firms, multiple roles, engagement-level assignments, inactive users, and cross-firm read/write attempts.
- Evidence files must live in a private Storage bucket, with Storage RLS policies enforcing firm and engagement scope. Do not use a public bucket for audit evidence.
- Validate backup/restore and evidence retrieval before describing the product as production-ready.

## Storage security reference

Supabase Storage access is governed by RLS on `storage.objects`; private buckets require authorization for both uploads and downloads:
https://supabase.com/docs/guides/storage/security/access-control

