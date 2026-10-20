# Supabase Live Project Status — Build 0.9

## Project
- Name: `Bank-Reconciliation-Pro`
- Project ref: `delvbdvjdmcblqiqaxsd`
- Region: `eu-central-1` (Frankfurt)
- API URL: `https://delvbdvjdmcblqiqaxsd.supabase.co`
- Observed status: `ACTIVE_HEALTHY`
- PostgreSQL: 17

## Migrations applied directly to the dedicated project
1. `brp_initial_audit_core` — core audit tables, firm-access helpers, RLS and role-based write policies.
2. `brp_extended_audit_suite` — engagement terms, independence, team, audit procedures, workpaper versions/tickmarks, analytics, sampling, PBC, time and billing, quality, professional judgment, going-concern, governance communication, knowledge, peer review, AI advisory metadata, portal settings, templates, subscriptions, performance snapshots, and append-only event chain.

The live schema currently has 43 public tables. No client, engagement, user, or accounting data was seeded. No unrelated Supabase project was modified.

## Security review and remaining gate
- RLS is enabled on business tables and the extended suite.
- Authenticated write policies require a firm-level role. User and role administration are intentionally blocked from ordinary authenticated client writes and must be bootstrapped through a trusted administrative path.
- `independence_declaration`, `working_paper_version`, and `immutable_event_chain` have append-only triggers against UPDATE/DELETE.
- `public.schema_version` has RLS enabled and an explicit deny policy for browser roles. The latest Security Advisor check returned no findings after the first-firm bootstrap RPC was restricted to the service role.
- Do not place a service-role key in frontend code. No credentials or API keys are stored in this repository.

## Important implementation boundary
The live schema was applied as an adapted core + extended suite, not by applying the repository's original draft SQL files verbatim. Those draft files have not been applied to this live project. Review and reconcile them before using the CLI to replay migrations; do not run the older draft migrations against the live schema as a blind operation.

## App connection status
The React app continues to keep audit records in local browser/Electron storage. Optional Supabase email/password sign-up and sign-in are wired in Settings. The first-firm bootstrap is deployed as a JWT-verified Edge Function; its database RPC is executable only by `service_role`. The first-firm onboarding path has not yet completed a live end-to-end sign-up test. Cloud sync, member invitations, storage buckets, binary evidence upload, and cross-tenant E2E tests remain pending.


## Build 1.0 — cloud authentication foundation (2026-10-20)

- Added optional email/password sign-up and sign-in to Settings using the browser-safe Supabase anon/publishable key. The app does not require cloud login to continue in local-first mode.
- Session tokens are held in `sessionStorage` with refresh-token handling; sign-out attempts to revoke the remote session and always clears the local session.
- Deployed Edge Function `ledgerly-bootstrap-first-firm` with JWT verification enabled. It validates the access token with Supabase Auth before invoking the administrative RPC.
- The RPC `ledgerly_bootstrap_first_firm(uuid, text, text)` is granted to `service_role` only, uses a transaction-scoped advisory lock, and rejects attempts to create a second firm. The first user receives the `firm_admin` role.
- Security Advisor: no findings at the latest check. This is not a substitute for live authentication, authorization, and tenant-isolation testing.
- The app still does not upload or synchronize clients, engagements, trial balances, working papers, or evidence. Do not use this as a cloud-ready multi-user deployment until invitation, membership, synchronization, and cross-tenant tests are complete.


### First-firm bootstrap allowlist

Before using the first-firm onboarding button, configure the Edge Function secret `LEDGERLY_BOOTSTRAP_EMAIL` in Supabase Dashboard → Edge Functions → Secrets with the exact owner email address. The Edge Function fails closed when the secret is missing, rejects other addresses, and requires the account email to be verified. Do not place this value in Vite variables or commit it to Git. The bootstrap function is intentionally not available to ordinary browser roles; only the service-role client used by the JWT-verified Edge Function can execute the database RPC.


## Member invitations — backend deployed, delivery requires configuration

- The `ledgerly-invite-member` Edge Function validates the caller's JWT and requires the inviter to have the firm-level `firm_admin` or `managing_partner` role. It excludes privilege-elevating roles from the invite form and provisions the user, role assignment, and invitation record through a service-role-only database function.
- The `firm_invitation` table has RLS enabled, an explicit deny policy for `anon` and `authenticated`, and no browser grants. The latest Supabase Security Advisor check returned no findings after the deny policy was added.
- Before sending invitations, configure the Edge Function secret `LEDGERLY_INVITE_REDIRECT_URL` to an HTTPS callback hosted for the application and add that URL to Supabase Auth's allowed redirect URLs. Configure production SMTP for invitation email delivery. These settings cannot safely be inferred from the repository.
- Invitations are not considered end-to-end validated until a real invite email is received, accepted, and the invited user can sign in with the intended firm role. Audit-data synchronization and evidence upload remain disabled.
