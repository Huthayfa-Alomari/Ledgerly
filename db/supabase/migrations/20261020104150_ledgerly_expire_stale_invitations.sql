-- Reconstructed compatibility migration for recorded live version 20261020104150.
-- Expire already-stale, still-pending invitations as a one-time idempotent cleanup.
-- Invitation creation also performs expiry cleanup; this does not schedule background work.
UPDATE public.firm_invitation
SET status = 'expired',
    updated_at = pg_catalog.to_char(
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
WHERE status = 'sent'
  AND expires_at < pg_catalog.to_char(
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
