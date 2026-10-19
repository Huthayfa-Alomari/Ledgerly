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
- **Open security item:** Supabase's table check reports RLS disabled on `public.schema_version`. Do not expose this table through the client. Proposed remediation to consider and approve: `ALTER TABLE public.schema_version ENABLE ROW LEVEL SECURITY;`. With RLS enabled and no policies, `anon`/`authenticated` cannot access it; trusted administrative/service-role operations can still manage it. This was deliberately not applied automatically.
- Do not place a service-role key in frontend code. No credentials or API keys are stored in this repository.

## Important implementation boundary
The live schema was applied as an adapted core + extended suite, not by applying the repository's original draft SQL files verbatim. Those draft files have not been applied to this live project. Review and reconcile them before using the CLI to replay migrations; do not run the older draft migrations against the live schema as a blind operation.

## App connection status
The current React app still uses local browser storage. The Supabase project exists and the schema is deployed, but application authentication, storage buckets, binary evidence upload, cloud sync, user/firm bootstrap, and end-to-end authorization tests are not yet wired or production-validated.
