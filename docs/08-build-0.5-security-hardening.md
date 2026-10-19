# Build 0.5 — security hardening work

## Delivered

- Added a reviewed hardening SQL overlay under `db/supabase/security/`.
- Added a non-exposed `private` schema role lookup with a fixed empty search path and restricted execute grants.
- Changed firm, app-user, and role-assignment access to read-only for authenticated clients; provisioning is expected to happen through a trusted administrative process.
- Split ordinary business-table read policies from write policies that require firm membership plus a firm-level role assignment.
- Preserved append-only permissions for the change log at the database privilege layer.
- Added deployment prerequisites and explicit remaining limitations.

## Not delivered / release blockers

- No live Supabase project has been selected or modified.
- No real Auth login/session integration, cloud sync, secure evidence bucket, or server-side role-management endpoint is implemented.
- Generic business write authorization remains too broad for production and must become role/action/engagement-specific.
- RLS behavior still needs integration tests against a dedicated Supabase test project with multiple firms and roles.
- The current UI still stores records in browser LocalStorage; do not use it for real client audit data.
