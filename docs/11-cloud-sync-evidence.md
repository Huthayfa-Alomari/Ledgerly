# Cloud workspace sync and private evidence (Build 0.8)

## Status

The existing local-first workflow remains the default. Cloud workspace sync and evidence upload are explicit user actions; signing in alone never uploads professional data. Migration `20261021040529_ledgerly_cloud_sync_private_evidence.sql` has been applied to the connected Supabase project. Live checks confirmed RLS is enabled on both new tables and the `ledgerly-evidence` bucket is private. The project has no real firm/user assignments, so runtime cross-firm isolation is not yet verified; do not upload real client data until the credential-gated tests pass in a dedicated staging environment.

## Workspace snapshot sync

- The first sync action is **Pull cloud snapshot**. If a snapshot exists, the user must confirm before local data is replaced. Export a local JSON backup first.
- A firm snapshot is versioned. Upload uses optimistic version checks; a stale client is rejected rather than overwriting a newer snapshot.
- Whole-office snapshot writes are restricted to firm administrators, managing partners, engagement partners, and managers. Staff can upload scoped evidence but cannot overwrite the entire office snapshot.
- Current MVP limit: 10 MiB JSON snapshot. This is a full snapshot, not per-record merge or real-time collaboration. Do not treat it as production-grade multi-user conflict resolution.
- Cloud snapshots contain all fields in the local DB payload. Only sync real client data after the firm approves cloud processing and retention.
- Snapshot deletion is not granted to browser roles.

## Private evidence

- Bucket ID: `ledgerly-evidence`; it must remain private.
- Maximum file size: 25 MiB. Allowed formats: PDF, JPEG/PNG/WebP, TXT/CSV, XLS/XLSX, DOCX.
- Object key format: `<firm_id>/<engagement_id>/<random_id>_<sanitized_filename>`.
- Upload metadata is stored in `public.workspace_evidence_file`, scoped by firm and engagement role checks.
- SHA-256 is calculated on upload and verified after download. Evidence objects and metadata are immutable through browser roles; corrections should be new records.
- If object upload succeeds but metadata insertion fails, the object remains private and may need administrative cleanup. It is never made public as a fallback.

## Tenant-isolation tests

Static regression tests run in CI. Cross-firm integration tests are credential-gated and are skipped unless all of these are supplied in a staging-only test environment:

- `LEDGERLY_TEST_SUPABASE_URL`
- `LEDGERLY_TEST_SUPABASE_ANON_KEY`
- `LEDGERLY_TEST_TOKEN_A`, `LEDGERLY_TEST_TOKEN_B` (two separate authenticated test users)
- `LEDGERLY_TEST_FIRM_A`, `LEDGERLY_TEST_FIRM_B` (different firm IDs)
- `LEDGERLY_TEST_ENGAGEMENT_A`

The tests exercise cross-firm snapshot reads/writes and evidence metadata/object access. Configure test accounts with deliberately distinct roles and engagement assignments. Never use production user tokens or client data in CI.

## Rollout gates

1. For any other environment, review the SQL migration and apply it to a dedicated staging project first. The currently connected project already has the migration applied.
2. Create two test firms and at least two users per firm; verify firm-level and engagement-only assignments.
3. Run the credential-gated integration tests and manually test browser upload/download.
4. Verify the bucket is private, cross-firm access returns no data/denial, and a stale snapshot write is rejected.
5. Test backup/restore, file integrity mismatch, unsupported file types, size limit, expired sessions, and simultaneous writes.
6. Only after those checks, apply the reviewed migration to production and enable invitations separately.

The connected Supabase project has no real firm rows or member assignments. The private bucket and RLS policies are present, but cross-firm runtime isolation cannot be claimed as verified until the staging integration tests run.
