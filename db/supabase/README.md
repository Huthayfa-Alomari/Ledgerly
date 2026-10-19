# Supabase deployment notes

The dedicated live project and the applied schema are documented in [docs/09-supabase-live-project.md](../../docs/09-supabase-live-project.md). The SQL files under `migrations/` and `security/` that predate Build 0.9 are draft/reference migrations and were **not** applied verbatim to the live project. Reconcile them with the live schema before using Supabase CLI migration replay.

Never place a service-role key in the browser app. Bootstrap the first firm, app user, and firm-level role through a trusted administrative process.
